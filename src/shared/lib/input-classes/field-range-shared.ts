// TODO: декомпозировать!
/**
 * Общий инструментарий для FieldRange/FieldRangeDouble: форматирование и разбор чисел,
 * переиспользуемый измеритель ширины текста, debounce-по-rAF и регистрация в форме —
 * вынесены сюда, чтобы не дублировать между односторонним и двусторонним вариантами.
 */

/** Разбивает цифры на разряды пробелом: "12345" → "12 345". */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Форматирует число для отображения в текстовом поле.
 * @param isInput — форматирование "на лету" во время набора текста: сохраняет то, что печатает
 *   пользователь (например, незавершённую дробную часть "12."), не переформатируя её на каждый символ.
 */
export function formatNumber(
  num: number,
  allowDecimal: boolean,
  precision: number,
  isInput: boolean,
  rawInput: string
): string {
  if (Number.isNaN(num) && !rawInput) return "";

  if (!allowDecimal) {
    // Math.round, а не Math.floor — иначе дробная часть отрицательных чисел
    // (напр. -0.5) отбрасывалась бы не в ту сторону.
    return groupThousands(Math.round(num).toString());
  }

  // Пока пользователь дописывает дробную часть — не переформатируем строку,
  // иначе после "12." сразу схлопнется обратно в "12" и точку не напечатать.
  if (isInput && rawInput.includes(".")) {
    return rawInput.replace(",", ".");
  }

  if (Number.isInteger(num)) {
    return groupThousands(num.toString());
  }

  const formatted = num.toFixed(precision);
  return isInput ? formatted : groupThousands(formatted);
}

/** Разбор пользовательского ввода/значения слайдера в число (запятая = десятичный разделитель). */
export function parseNumber(value: string | number): number {
  if (value === "") return NaN;
  const cleaned = value
    .toString()
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  return parseFloat(cleaned);
}

export function roundToStep(value: number, step: number): number {
  if (Number.isNaN(value) || !step) return value;
  const multiplier = 1 / step;
  return Math.round(value * multiplier) / multiplier;
}

/** Склонение единицы измерения по числу: unit вида "рубль, рубля, рублей". Одна форма — без склонения. */
export function pluralizeUnit(num: number, unit: string): string {
  const forms = unit.split(", ");
  if (forms.length === 1 || Number.isNaN(num)) return forms[0];

  const mod10 = num % 10;
  const mod100 = num % 100;

  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

/** unit с учётом склонения (форма выбирается по конкретному val), без пробела/номера. */
export function resolveUnitText(val: number, unit: string): string {
  return unit.includes(",") ? pluralizeUnit(val, unit) : unit;
}

/** По умолчанию — без пробела перед "%" и с пробелом перед остальными единицами;
 *  data-unit-space="true"/"false" (см. _index.pug) переопределяет это явно. */
export function resolveUnitSpace(
  unit: string | undefined,
  unitSpaceAttr: string | undefined
): boolean {
  return unitSpaceAttr === undefined ? unit !== "%" : unitSpaceAttr !== "false";
}

/** Число + единица измерения одной строкой — для aria-valuetext ползунка. */
export function formatValueWithUnit(
  val: number,
  isStepDecimal: boolean,
  precision: number,
  unit: string | undefined,
  unitHasSpace: boolean
): string {
  const number = formatNumber(val, isStepDecimal, precision, false, "");
  if (!unit) return number;
  const text = resolveUnitText(val, unit);
  return unitHasSpace ? `${number} ${text}` : `${number}${text}`;
}

/** Читает числовой HTML-атрибут (напр. input.min/.max/.step — они типа string), с фолбэком. */
export function readNumberAttr(raw: string, fallback: number): number {
  const parsed = parseFloat(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Enter в текстовом поле — то же самое, что снять фокус (запускает blur-коммит значения). */
export function blurOnEnter(event: KeyboardEvent, input: HTMLInputElement): void {
  if (event.key === "Enter") input.blur();
}

/**
 * Вызывает callback сразу и повторно, когда веб-шрифты догрузятся (см. document.fonts) —
 * на момент первого вызова точная ширина глифов ещё может быть неизвестна браузеру.
 * `document.fonts` объявлен в lib.dom как несомненный, но реально бывает не определён
 * в части браузеров/окружений — поэтому опциональная цепочка, а не прямой вызов.
 */
export function callNowAndOnFontsReady(callback: () => void): void {
  callback();
  void document.fonts?.ready.then(callback);
}

/**
 * Подгоняет ширину текстового поля под содержимое через переиспользуемый скрытый <span>
 * (один инстанс на измеритель — без создания/удаления DOM-узла на каждый чих).
 */
export class InputWidthMeasurer {
  private elem: HTMLElement | null = null;

  update(input: HTMLInputElement): void {
    if (!this.elem) {
      const span = document.createElement("span");
      span.style.position = "absolute";
      span.style.top = "-9999px";
      span.style.left = "-9999px";
      span.style.visibility = "hidden";
      span.style.whiteSpace = "pre";
      document.body.appendChild(span);
      this.elem = span;
    }

    const computed = window.getComputedStyle(input);
    this.elem.style.font = computed.font;
    this.elem.style.letterSpacing = computed.letterSpacing;
    this.elem.style.padding = computed.padding;
    this.elem.textContent = input.value || input.placeholder || "0";

    input.style.width = `${this.elem.offsetWidth + 3}px`;
  }

  destroy(): void {
    this.elem?.remove();
    this.elem = null;
  }
}

/** Схлопывает частые события (напр. "resize") в один вызов на следующий кадр отрисовки. */
export class RafDebouncer {
  private raf: number | null = null;

  schedule(callback: () => void): void {
    if (this.raf !== null) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      callback();
    });
  }

  cancel(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }
}

/** Форма поля, достаточная для регистрации в form.inputFields (см. shared/lib/ui-classes/Form.ts). */
interface FormFieldLike {
  validate(): void;
  valid: boolean;
  disabled: boolean;
}

/**
 * Регистрирует поле в form.inputFields[name] — чтобы Form.setLock()/validate()
 * (см. shared/lib/ui-classes/Form.ts) учитывали его наравне с текстовыми полями.
 * Молча ничего не делает, если поле не внутри <form> или у инпута нет name.
 */
export function registerFormField(
  form: HTMLFormElement | null,
  name: string | undefined,
  field: FormFieldLike
): void {
  if (!form || !name) return;
  form.inputFields ??= {};
  form.inputFields[name] = field;
}

/** Снимает регистрацию, сделанную registerFormField() — только если она всё ещё указывает на field. */
export function unregisterFormField(
  form: HTMLFormElement | null,
  name: string | undefined,
  field: FormFieldLike
): void {
  if (form?.inputFields && name && form.inputFields[name] === field) {
    delete form.inputFields[name];
  }
}
