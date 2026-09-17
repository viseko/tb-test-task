import {
  blurOnEnter,
  callNowAndOnFontsReady,
  formatNumber,
  formatValueWithUnit,
  InputWidthMeasurer,
  parseNumber,
  RafDebouncer,
  readNumberAttr,
  registerFormField,
  resolveUnitSpace,
  resolveUnitText,
  roundToStep,
  unregisterFormField,
} from "./field-range-shared";

export interface FieldRangeDoubleOptions {
  /** Вызывается при каждом подтверждённом изменении значений (ввод, движение любого ползунка, blur, reset). */
  onChange?: (from: number, to: number) => void;
}

type Side = "from" | "to";

interface UpdateSideOptions {
  format?: boolean;
  round?: boolean;
  fromInput?: boolean;
}

interface SideHandlers {
  numberInput: () => void;
  numberBlur: () => void;
  numberKeydown: (event: KeyboardEvent) => void;
  rangeInput: () => void;
  activate: () => void;
}

const SIDES = ["from", "to"] as const;

/** Диаметр thumb'а, если --thumb-size (см. _index.scss) почему-то не читается. */
const THUMB_SIZE_FALLBACK = 14;

/**
 * Вариант FieldRange с двумя ползунками — выбор диапазона "от — до" (см. field-range/_index.pug,
 * рендерится когда data.value передан массивом [from, to]).
 *
 * from и to всегда упорядочены (from <= to). min/max у обоих range-инпутов НЕ трогаются
 * и всегда равны исходным границам всего диапазона — сознательно не сужаем их друг под
 * друга: смена min/max у чужого инпута заставляет браузер пересчитать позицию ЕГО thumb'а
 * даже когда value не менялось (визуальный "прыжок" второго ползунка), а на грани equal
 * min===max — деление на вырожденный интервал и глючный рендер. Вместо этого "не пересечься"
 * обеспечивается только на уровне значения: updateSide() зажимает val о текущий values[other]
 * и тут же программно возвращает range.value на зажатую границу — с точки зрения пользователя
 * ползунок просто упирается в соседний и дальше не идёт. Между ползунками поверх трека лежит
 * .field-range__fill — закрашенный отрезок [from, to], его позицию/ширину считает JS.
 */
export default class FieldRangeDouble {
  private _elem: HTMLElement;
  private _form: HTMLFormElement | null;
  private _inputs: Record<Side, HTMLInputElement>;
  private _ranges: Record<Side, HTMLInputElement>;
  private _handlers: Record<Side, SideHandlers>;
  private _trackElem: HTMLElement | null;
  private _fillElem: HTMLElement | null;
  private _unitElem: HTMLElement | null;
  /** Диаметр thumb'а в px — для поправки при расчёте позиции заливки, см. renderFill(). */
  private _thumbSize: number;
  private _measurers: Record<Side, InputWidthMeasurer> = {
    from: new InputWidthMeasurer(),
    to: new InputWidthMeasurer(),
  };
  private _resizeDebouncer = new RafDebouncer();

  private unit?: string;
  private unitHasSpace: boolean;
  private min: number;
  private max: number;
  private step: number;
  private isStepDecimal: boolean;
  private precision: number;
  private onChange?: (from: number, to: number) => void;

  /** Текущие значения (упорядоченные: from <= to, зажатые в [min, max], округлённые до шага). */
  values: Record<Side, number> = { from: 0, to: 0 };
  /** Для интеграции с shared/lib/ui-classes/Form.ts (Form.setLock() во время отправки формы). */
  valid = true;

  constructor(elem: HTMLElement, options: FieldRangeDoubleOptions = {}) {
    this._elem = elem;
    this._form = this._elem.closest("form");

    const inputFrom = this._elem.querySelector<HTMLInputElement>("[type='text'][data-role='from']");
    const inputTo = this._elem.querySelector<HTMLInputElement>("[type='text'][data-role='to']");
    const rangeFrom = this._elem.querySelector<HTMLInputElement>(
      "[type='range'][data-role='from']"
    );
    const rangeTo = this._elem.querySelector<HTMLInputElement>("[type='range'][data-role='to']");
    if (!inputFrom || !inputTo || !rangeFrom || !rangeTo) {
      throw new Error("FieldRangeDouble: не найдены поля ввода числа/диапазона (from/to)");
    }
    this._inputs = { from: inputFrom, to: inputTo };
    this._ranges = { from: rangeFrom, to: rangeTo };
    this._trackElem = this._elem.querySelector(".field-range__track");
    this._fillElem = this._elem.querySelector("[data-role='fill']");
    this._unitElem = this._elem.querySelector("[data-role='unit']");

    // Нативный thumb физически не доезжает до краёв трека — его центр движется от
    // half(thumbSize) до trackWidth - half(thumbSize), а не от 0 до 100% ширины.
    // Без этой поправки заливка между ползунками "перехлёстывает" за их центр.
    const thumbSizeRaw = this._trackElem
      ? parseFloat(getComputedStyle(this._trackElem).getPropertyValue("--thumb-size"))
      : NaN;
    this._thumbSize = Number.isNaN(thumbSizeRaw) ? THUMB_SIZE_FALLBACK : thumbSizeRaw;

    const { unit, unitSpace } = this._elem.dataset;
    this.unit = unit;
    this.unitHasSpace = resolveUnitSpace(unit, unitSpace);

    // min/max — фиксированные границы всего диапазона, у обоих range-инпутов в разметке
    // одинаковые (см. _index.pug) и JS их не меняет (см. комментарий к классу выше).
    this.min = readNumberAttr(rangeFrom.min, 0);
    this.max = readNumberAttr(rangeTo.max, 100);
    this.step = readNumberAttr(rangeFrom.step, 1) || 1;
    if (this.max <= this.min) {
      console.warn("FieldRangeDouble: max должен быть больше min", this._elem);
    }
    this.isStepDecimal = this.step % 1 !== 0;
    this.precision = this.isStepDecimal ? this.step.toString().split(".")[1]?.length ?? 1 : 0;

    this.onChange = options.onChange;
    this.resyncFromRanges();

    SIDES.forEach((side) => {
      this._ranges[side].defaultValue = this._ranges[side].value;
      this._inputs[side].defaultValue = this._inputs[side].value;
    });

    this._handlers = { from: this.createSideHandlers("from"), to: this.createSideHandlers("to") };
    SIDES.forEach((side) => {
      const h = this._handlers[side];
      this._inputs[side].addEventListener("input", h.numberInput);
      this._inputs[side].addEventListener("blur", h.numberBlur);
      this._inputs[side].addEventListener("keydown", h.numberKeydown);
      this._ranges[side].addEventListener("input", h.rangeInput);
      // mousedown/touchstart, а не pointerdown — оба реальных range-инпута лежат друг на друге
      // (см. _index.scss), поднимаем на верх z-index тот, за чей thumb взялись.
      this._ranges[side].addEventListener("mousedown", h.activate);
      this._ranges[side].addEventListener("touchstart", h.activate);
    });

    this._form?.addEventListener("reset", this.handleFormReset);
    window.addEventListener("resize", this.handleResize);

    // Ширина текстовых полей зависит от реального начертания шрифта — на момент
    // инициализации веб-шрифт мог ещё не догрузиться, пересчитываем, когда он готов.
    callNowAndOnFontsReady(() => this.updateWidths());

    // Регистрация в форме под обоими именами — чтобы Form.setLock()/validate()
    // (см. ui-classes/Form.ts) учитывали поле независимо от того, к какому из
    // двух текстовых инпутов обратились.
    SIDES.forEach((side) => registerFormField(this._form, this._inputs[side].name, this));
  }

  private createSideHandlers(side: Side): SideHandlers {
    return {
      numberInput: () => this.handleNumberInput(side),
      numberBlur: () => this.handleNumberBlur(side),
      numberKeydown: (event: KeyboardEvent) => blurOnEnter(event, this._inputs[side]),
      rangeInput: () => this.handleRangeInput(side),
      activate: () => this.activateSide(side),
    };
  }

  private handleNumberInput(side: Side): void {
    let value = this._inputs[side].value.replace(/,/g, ".").replace(/[^\d.]/g, "");

    const dotCount = (value.match(/\./g) ?? []).length;
    if (dotCount > 1) {
      // Пользователь напечатал вторую точку — оставляем только последнюю.
      value = value.replace(/\.(?=.*\.)/g, "");
    }

    this.updateSide(side, value, { format: true, round: false, fromInput: true });
    this._measurers[side].update(this._inputs[side]);
  }

  private handleNumberBlur(side: Side): void {
    this.updateSide(side, this._inputs[side].value, { format: true, round: true });
    this._measurers[side].update(this._inputs[side]);
  }

  private handleRangeInput(side: Side): void {
    this.updateSide(side, this._ranges[side].value, { format: true, round: true });
    this._measurers[side].update(this._inputs[side]);
  }

  private activateSide(side: Side): void {
    this._ranges.from.classList.toggle("_active", side === "from");
    this._ranges.to.classList.toggle("_active", side === "to");
  }

  private handleFormReset = (): void => {
    // К этому моменту браузер уже сбросил value всех полей на их defaultValue —
    // сброс значений полей форма выполняет до отправки события "reset" (спецификация HTML).
    this.resyncFromRanges();
    this.updateWidths();
  };

  private handleResize = (): void => {
    this._resizeDebouncer.schedule(() => this.updateWidths());
  };

  private updateWidths(): void {
    this._measurers.from.update(this._inputs.from);
    this._measurers.to.update(this._inputs.to);
  }

  /** Перечитывает from/to из текущих value range-инпутов (после инициализации/reset формы). */
  private resyncFromRanges(): void {
    const from = roundToStep(parseNumber(this._ranges.from.value), this.step);
    const to = roundToStep(parseNumber(this._ranges.to.value), this.step);
    this.commitPair(from, to);
  }

  /**
   * Синхронно фиксирует пару значений, временно расслабляя внутренние this.values —
   * иначе, например, setValue(70, 80) при текущем диапазоне [10, 20] зажало бы
   * новое "от" о старое "до" ещё до того, как новое "до" будет применено (см. updateSide()).
   */
  private commitPair(from: number, to: number): void {
    this.values = { from: this.min, to: this.max };

    let a = Number.isNaN(from) ? this.min : from;
    let b = Number.isNaN(to) ? this.max : to;
    if (a > b) [a, b] = [b, a];

    this.updateSide("from", a, { round: true });
    this.updateSide("to", b, { round: true });
  }

  private updateSide(side: Side, rawValue: number | string, opts: UpdateSideOptions = {}): void {
    const { format = true, round = false, fromInput = false } = opts;
    const rawStr = rawValue.toString();

    // Поле очищено целиком во время набора — не откатываем принудительно к границе,
    // даём пользователю напечатать число заново; соответствующий ползунок уходит к краю.
    if (fromInput && rawStr === "") {
      this._inputs[side].value = "";
      this.values[side] = side === "from" ? this.min : this.max;
      this._ranges[side].value = this.values[side].toString();
      this.updateUnitText();
      this.renderFill();
      this.onChange?.(this.values.from, this.values.to);
      return;
    }

    let val = parseNumber(rawValue);
    if (Number.isNaN(val)) {
      val = side === "from" ? this.min : this.max;
    } else {
      if (round) val = roundToStep(val, this.step);
      val = Math.min(this.max, Math.max(this.min, val));
      // Не даём ползункам пересечься: "от" не может стать больше текущего "до" и наоборот.
      val = side === "from" ? Math.min(val, this.values.to) : Math.max(val, this.values.from);
    }
    this.values[side] = val;

    this._inputs[side].value = format
      ? formatNumber(val, this.isStepDecimal, this.precision, fromInput, rawStr)
      : val.toString();

    if (fromInput && document.activeElement === this._inputs[side]) {
      const caret = this._inputs[side].value.length;
      this._inputs[side].setSelectionRange(caret, caret);
    }

    this._ranges[side].value = val.toString();
    this._ranges[side].setAttribute(
      "aria-valuetext",
      formatValueWithUnit(val, this.isStepDecimal, this.precision, this.unit, this.unitHasSpace)
    );
    this.updateUnitText();
    this.renderFill();
    this.onChange?.(this.values.from, this.values.to);
  }

  /** Единица измерения общая на пару — склоняется по верхней границе диапазона ("до"). */
  private updateUnitText(): void {
    if (!this._unitElem || !this.unit) return;
    const text = resolveUnitText(this.values.to, this.unit);
    this._unitElem.textContent = this.unitHasSpace ? ` ${text}` : text;
  }

  private renderFill(): void {
    if (!this._fillElem) return;

    const scaleMax = this.max - this.min;
    if (scaleMax <= 0) {
      this._fillElem.style.left = "0px";
      this._fillElem.style.width = "0px";
      return;
    }

    // Оба range-инпута всегда используют одни и те же (фиксированные) min/max — см.
    // комментарий к классу выше, — поэтому доля обоих thumb'ов считается по одной шкале.
    const fromFrac = (this.values.from - this.min) / scaleMax;
    const toFrac = (this.values.to - this.min) / scaleMax;
    const thumb = this._thumbSize;

    // left thumb'а = half(thumb) + доля * (100% - thumb) — нативный thumb не доезжает до
    // краёв трека на свой радиус. Тот же физический (100% - thumb) множитель для обоих
    // сторон, поэтому в ширине half(thumb) сокращается и вычитать его не нужно.
    this._fillElem.style.left = `calc((100% - ${thumb}px) * ${fromFrac} + ${thumb / 2}px)`;
    this._fillElem.style.width = `calc((100% - ${thumb}px) * ${toFrac - fromFrac})`;
  }

  /** Программная установка обоих значений с зажатием в диапазон и округлением до шага. */
  setValue(from: number, to: number): void {
    this.commitPair(from, to);
    this.updateWidths();
  }

  /** Для интеграции с shared/lib/ui-classes/Form.ts — у поля нет собственной валидации, оно всегда валидно. */
  validate(): void {
    this.valid = true;
  }

  get disabled(): boolean {
    return this._inputs.from.disabled;
  }

  set disabled(value: boolean) {
    SIDES.forEach((side) => {
      this._inputs[side].disabled = value;
      this._ranges[side].disabled = value;
    });
  }

  destroy(): void {
    SIDES.forEach((side) => {
      const h = this._handlers[side];
      this._inputs[side].removeEventListener("input", h.numberInput);
      this._inputs[side].removeEventListener("blur", h.numberBlur);
      this._inputs[side].removeEventListener("keydown", h.numberKeydown);
      this._ranges[side].removeEventListener("input", h.rangeInput);
      this._ranges[side].removeEventListener("mousedown", h.activate);
      this._ranges[side].removeEventListener("touchstart", h.activate);

      unregisterFormField(this._form, this._inputs[side].name, this);
    });

    this._form?.removeEventListener("reset", this.handleFormReset);
    window.removeEventListener("resize", this.handleResize);

    this._resizeDebouncer.cancel();
    this._measurers.from.destroy();
    this._measurers.to.destroy();
  }
}
