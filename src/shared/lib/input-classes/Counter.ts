import InputNumber, { type InputNumberOptions } from "./InputNumber.js";
import {
  callNowAndOnFontsReady,
  InputWidthMeasurer,
  resolveUnitText,
} from "./field-range-shared.js";

// HTML-классы состояний (см. STATES в InputText.ts/InputPassword.ts)
const STATES = {
  empty: "_empty",
  over: "_over",
  limit: "_limit",
} as const;

// Инпуты, чьё свойство .value уже подменено на геттер/сеттер (см. watchExternalChanges) —
// WeakSet вместо кастомного поля на самом DOM-узле, чтобы не городить module augmentation
// под HTMLInputElement и не ловить утечки при повторном создании Counter на том же узле.
const patchedValueInputs = new WeakSet<HTMLInputElement>();

// Счётчик для генерации id элементу префикса, если у него нет своего (см. errorIdCounter в InputText.ts)
let prefixIdCounter = 0;

/**
 * Счётчик числового значения (см. counter/_index.pug): кнопки +/- поверх <input type="number">.
 *
 * Помимо обычного режима с шагом (min/max/step — атрибуты самого input, как и в InputNumber)
 * поддерживает:
 * - allowed-режим (data-allowed="1,5,10") — строгий список значений, +/- листают его по индексу
 *   вместо прибавления step;
 * - over-подсказку (data-over + [data-role='prefix']) — текст перед значением, когда оно упёрлось
 *   в max (напр. "от", если реальный лимит на самом деле больше видимого числа);
 * - minLimit-предупреждение (data-min-limit) — класс _limit на обёртке, когда значение ниже
 *   рекомендованного порога; это отдельная, более мягкая метка, чем жёсткий HTML min.
 * - unit-подпись (data-unit + [data-role='unit']) — единица измерения рядом со значением,
 *   со склонением по числу ("рубль, рубля, рублей", см. resolveUnitText в field-range-shared.ts).
 *   Именно отдельный элемент, а не суффикс в самом value, как делает InputNumber: у <input
 *   type="number"> value обязан парситься как число (HTML sanitization algorithm), запись
 *   вида "3 шт." браузер молча отбрасывает, откатывая value к "" — поэтому Counter не пробрасывает
 *   unit в опции InputNumber, а рисует его сам.
 *
 * unit/over/minLimit берутся из dataset самой обёртки, а не из options: installClass()
 * (см. counter/index.js) навешивает один и тот же options-объект на все .js-counter на странице,
 * так что поштучная настройка возможна только через dataset (тот же приём, что и у FieldRange).
 */
export default class Counter extends InputNumber {
  private btnPlus: HTMLButtonElement | null;
  private btnMinus: HTMLButtonElement | null;
  private prefixElement: HTMLElement | null;
  private hasOver: boolean;
  private over?: string;
  private minLimit?: number;

  // Названо не "unit" — так называется унаследованное от InputNumber публичное поле, отвечающее
  // за совсем другой (несовместимый с type="number", см. классовый комментарий) механизм.
  private unitElement: HTMLElement | null;
  private unitLabel?: string;

  private step: number;

  private allowedMode = false;
  private allowed: number[] = [];
  private valueIndex = 0;

  // Было ли у поля значение из разметки — используется только для того, чтобы не трогать
  // нетронутое необязательное пустое поле при blur (см. handleBlur). Фиксируется ДО initAllowed(),
  // которая для allowed-режима может сама подставить allowed[0] в пустое поле.
  private readonly hasInitialValue: boolean;
  private userInteracted = false;

  private readonly measurer = new InputWidthMeasurer();
  private mutationObserver?: MutationObserver;
  private syncing = false;

  // Запись в .value в обход подменённого сеттера (см. watchExternalChanges) — иначе собственные
  // же внутренние записи (plus/minus/toAllowedValue) каждый раз лишний раз реэнтерили бы sync().
  private nativeValueSetter?: (value: string) => void;
  private originalValueDescriptor?: PropertyDescriptor;

  constructor(elem: HTMLElement, options: InputNumberOptions = {}) {
    super(elem, options);

    this.btnPlus = elem.querySelector<HTMLButtonElement>("[data-role='plus']");
    this.btnMinus = elem.querySelector<HTMLButtonElement>("[data-role='minus']");
    if (!this.btnPlus || !this.btnMinus) {
      console.warn("Counter: не найдена кнопка plus/minus", elem);
    }

    this.step = Number(this._inputElem.step) || 1;

    this.prefixElement = elem.querySelector<HTMLElement>("[data-role='prefix']");
    this.over = elem.dataset.over;
    this.hasOver = Boolean(this.over && this.prefixElement);
    if (this.hasOver) this.linkPrefixForA11y();

    const minLimit = elem.dataset.minLimit !== undefined ? Number(elem.dataset.minLimit) : NaN;
    this.minLimit = Number.isNaN(minLimit) ? undefined : minLimit;

    this.unitElement = elem.querySelector<HTMLElement>("[data-role='unit']");
    this.unitLabel = elem.dataset.unit;

    this.btnPlus?.addEventListener("click", this.plus);
    this.btnMinus?.addEventListener("click", this.minus);

    this.hasInitialValue = this._inputElem.value !== "";
    this.initAllowed();

    this._inputElem.addEventListener("input", this.handleCounterInput);

    this.updateButtonStates();
    this.updateEmptyClass();
    this.updatePrefix();
    this.updateLimitClass();
    this.updateUnit();
    // Ширина зависит от реального начертания шрифта — на момент инициализации веб-шрифт мог
    // ещё не догрузиться, пересчитываем ещё раз, когда он готов (см. field-range-shared.ts).
    callNowAndOnFontsReady(() => this.updateInputWidth());

    this.watchExternalChanges();
  }

  // --- Переопределения жизненного цикла InputNumber (см. InputNumber.ts) ---

  protected override handleInput(): void {
    super.handleInput();
    this.userInteracted = true;
  }

  protected override handleBlur(): void {
    // Нетронутое необязательное пустое поле не трогаем — иначе super.handleBlur() принудительно
    // подставит min (Number("") === 0, что меньше почти любого min).
    if (!this.userInteracted && !this.hasInitialValue) return;

    // Клэмп к min/max и callback уже корректно умеет базовый класс (this.unit тут всегда
    // undefined — Counter не пробрасывает его в super(), см. классовый комментарий).
    super.handleBlur();
  }

  // --- allowed-режим (data-allowed="1,5,10") ---

  private initAllowed(): void {
    const allowedString = this._inputElem.dataset.allowed;
    if (!allowedString) return;

    const allowed = [
      ...new Set(
        allowedString
          .split(",")
          .map((v) => Number(v.trim()))
          .filter((v) => !Number.isNaN(v))
      ),
    ].sort((a, b) => a - b);

    if (allowed.length === 0) return;

    this.allowedMode = true;
    this.allowed = allowed;
    this.toAllowedValue();
  }

  // Округляет текущее значение input до ближайшего допустимого и синхронизирует valueIndex
  private toAllowedValue(): void {
    if (!this.allowedMode || this.allowed.length === 0) return;

    const value = this.parseValue(this._inputElem.value);

    if (Number.isNaN(value)) {
      this.valueIndex = 0;
      this.writeValue(String(this.allowed[0]));
      return;
    }

    const exactIndex = this.allowed.indexOf(value);
    if (exactIndex >= 0) {
      this.valueIndex = exactIndex;
      return;
    }

    let nearestIndex = 0;
    let minDiff = Infinity;
    for (let i = 0; i < this.allowed.length; i++) {
      const diff = Math.abs(this.allowed[i] - value);
      if (diff < minDiff) {
        minDiff = diff;
        nearestIndex = i;
      }
    }

    this.valueIndex = nearestIndex;
    this.writeValue(String(this.allowed[nearestIndex]));
  }

  // --- Кнопки +/- ---
  // Объявлены как поля-стрелки — не завязаны на порядок вызова addEventListener в конструкторе
  // (в отличие от handleInput/handleBlur, которые обязаны быть обычными методами, см. выше).

  plus = (): void => {
    if (this._inputElem.disabled) return;
    this.userInteracted = true;

    if (this.allowedMode) {
      if (this.valueIndex < this.allowed.length - 1) {
        this.valueIndex++;
        this.writeValue(String(this.allowed[this.valueIndex]));
      }
    } else {
      const max = this.max ?? Number.POSITIVE_INFINITY;

      let value = this.parseValue(this._inputElem.value);
      if (this._inputElem.value === "" || value === 0) {
        value = this.min ?? 0;
      }

      this.writeValue(String(Math.min(value + this.step, max)));
    }

    this.sync();
    this.callback?.(this._inputElem.value);
  };

  minus = (): void => {
    if (this._inputElem.disabled) return;
    this.userInteracted = true;

    if (this.allowedMode) {
      if (this.valueIndex > 0) {
        this.valueIndex--;
        this.writeValue(String(this.allowed[this.valueIndex]));
      }
    } else {
      const min = this.min ?? Number.NEGATIVE_INFINITY;

      let value = this.parseValue(this._inputElem.value);
      if (this._inputElem.value === "" || value === 0) {
        value = this.min ?? 0;
      }

      this.writeValue(String(Math.max(value - this.step, min)));
    }

    this.sync();
    this.callback?.(this._inputElem.value);
  };

  // Реакция на ввод с клавиатуры — снэп к allowed на лету + пересчёт состояний.
  // Отдельный слушатель "input", помимо унаследованного handleInput (см. выше): тот только
  // фильтрует цифры, этот — обновляет производное UI-состояние счётчика.
  private handleCounterInput = (): void => {
    if (this.allowedMode) this.toAllowedValue();
    this.sync();
  };

  // --- Производное UI-состояние (кнопки/ширина/префикс/лимит/пустота) ---

  // syncing — защита от реэнтерабельного вызова: запись в .value внутри самого sync()
  // (напр. toAllowedValue → writeValue) может пройти через подменённый сеттер и снова
  // вызвать sync() до завершения текущего прохода.
  private sync(): void {
    if (this.syncing) return;
    this.syncing = true;
    try {
      this.updateButtonStates();
      this.updateInputWidth();
      this.updatePrefix();
      this.updateLimitClass();
      this.updateEmptyClass();
      this.updateUnit();
    } finally {
      this.syncing = false;
    }
  }

  private updateButtonStates(): void {
    const disabled = this._inputElem.disabled;
    if (this.btnPlus) this.btnPlus.disabled = disabled;
    if (this.btnMinus) this.btnMinus.disabled = disabled;
    if (disabled) return;

    if (this.allowedMode) {
      if (this.btnPlus) this.btnPlus.disabled = this.valueIndex >= this.allowed.length - 1;
      if (this.btnMinus) this.btnMinus.disabled = this.valueIndex <= 0;
      return;
    }

    const value = this.parseValue(this._inputElem.value);
    if (this.btnPlus) this.btnPlus.disabled = this.max !== undefined && value >= this.max;
    if (this.btnMinus) this.btnMinus.disabled = this.min !== undefined && value <= this.min;
  }

  private updateInputWidth(): void {
    this.measurer.update(this._inputElem);
  }

  // Показывает data-over текст в [data-role='prefix'], когда значение достигло max
  // (напр. "от", если реальный лимит на самом деле больше видимого числа).
  private updatePrefix(): void {
    if (!this.hasOver || !this.prefixElement) return;

    if (this._inputElem.value === "") {
      this.prefixElement.textContent = "";
      this._inputElem.classList.remove(STATES.over);
      return;
    }

    const value = this.parseValue(this._inputElem.value);
    const isOver = this.max !== undefined && value >= this.max;

    this.prefixElement.textContent = isOver ? this.over ?? "" : "";
    this._inputElem.classList.toggle(STATES.over, isOver);
  }

  // Подставляет data-unit в [data-role='unit'] со склонением по текущему значению — отдельным
  // элементом, а не суффиксом в value (см. классовый комментарий про несовместимость с type="number").
  private updateUnit(): void {
    if (!this.unitLabel || !this.unitElement) return;

    const value = this.parseValue(this._inputElem.value);
    this.unitElement.textContent = resolveUnitText(value, this.unitLabel);
  }

  // Класс-предупреждение при значении ниже data-min-limit (мягкий порог, отдельный от HTML min).
  private updateLimitClass(): void {
    if (this.minLimit === undefined || this._inputElem.value === "") {
      this._elem.classList.remove(STATES.limit);
      return;
    }

    const value = this.parseValue(this._inputElem.value);
    this._elem.classList.toggle(STATES.limit, value < this.minLimit);
  }

  private updateEmptyClass(): void {
    this._elem.classList.toggle(STATES.empty, this._inputElem.value === "");
  }

  // Числовое значение из строки инпута; нечисловое/пустое — 0 (совпадает с поведением Number("")).
  private parseValue(raw: string): number {
    const num = Number(raw.replace(/[^\d.-]/g, ""));
    return Number.isNaN(num) ? 0 : num;
  }

  // Связывает [data-role='prefix'] с input через aria-describedby (по аналогии с _errorElem
  // в InputText.ts) — иначе текст-подсказка о "over" виден только зряче.
  private linkPrefixForA11y(): void {
    if (!this.prefixElement) return;

    if (!this.prefixElement.id) {
      this.prefixElement.id = `counter-prefix-${++prefixIdCounter}`;
    }

    const ids = new Set(
      (this._inputElem.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)
    );
    ids.add(this.prefixElement.id);
    this._inputElem.setAttribute("aria-describedby", [...ids].join(" "));
  }

  // Запись в input.value в обход подменённого сеттера — см. комментарий у nativeValueSetter.
  private writeValue(value: string): void {
    if (this.nativeValueSetter) {
      this.nativeValueSetter(value);
    } else {
      this._inputElem.value = value;
    }
  }

  private refreshBounds(): void {
    this.step = Number(this._inputElem.step) || 1;
    this.min = this._inputElem.hasAttribute("min") ? Number(this._inputElem.min) : undefined;
    this.max = this._inputElem.hasAttribute("max") ? Number(this._inputElem.max) : undefined;
  }

  // --- Реакция на изменения значения извне (не через plus/minus/тайпинг) ---

  private watchExternalChanges(): void {
    const input = this._inputElem;

    // 1) Перехватываем programmatic set: input.value = ... — HTML-атрибут "value" при этом
    //    не меняется (это лишь начальное значение), поэтому MutationObserver ниже его не увидит.
    if (!patchedValueInputs.has(input)) {
      const proto = Object.getPrototypeOf(input) as object;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");

      if (desc?.get && desc?.set) {
        const nativeGet = desc.get;
        const nativeSet = desc.set;
        const onExternalChange = this.onExternalChange;

        patchedValueInputs.add(input);
        this.originalValueDescriptor = desc;
        this.nativeValueSetter = (v: string) => nativeSet.call(input, v);

        Object.defineProperty(input, "value", {
          configurable: true,
          get(this: HTMLInputElement): string {
            return nativeGet.call(this);
          },
          set(this: HTMLInputElement, v: string) {
            nativeSet.call(this, v);
            onExternalChange();
          },
        });
      }
    }

    // 2) MutationObserver на атрибуты (disabled/min/max/step/data-allowed; "value" — на случай
    //    input.setAttribute("value", ...), которым изредка пользуются вместо .value =).
    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "attributes") continue;

        if (mutation.attributeName === "data-allowed") {
          this.allowedMode = false;
          this.allowed = [];
          this.valueIndex = 0;
          this.initAllowed();
        }

        this.refreshBounds();
        this.onExternalChange();
      }
    });

    this.mutationObserver.observe(input, {
      attributes: true,
      attributeFilter: ["value", "disabled", "min", "max", "step", "data-allowed"],
    });

    // 3) На всякий случай — change (напр. если кто-то диспатчит его вручную).
    input.addEventListener("change", this.onExternalChange);

    this.onExternalChange();
  }

  private onExternalChange = (): void => {
    if (this.allowedMode) this.toAllowedValue();
    this.sync();
  };

  destroy(): void {
    this.mutationObserver?.disconnect();
    this.btnPlus?.removeEventListener("click", this.plus);
    this.btnMinus?.removeEventListener("click", this.minus);
    this._inputElem.removeEventListener("input", this.handleCounterInput);
    this._inputElem.removeEventListener("change", this.onExternalChange);
    this.measurer.destroy();

    if (this.originalValueDescriptor) {
      Object.defineProperty(this._inputElem, "value", this.originalValueDescriptor);
      patchedValueInputs.delete(this._inputElem);
    }
  }
}
