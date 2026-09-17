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

export interface FieldRangeOptions {
  /** Вызывается при каждом подтверждённом изменении значения (ввод, движение ползунка, blur, reset). */
  onChange?: (value: number) => void;
}

interface UpdateValueOptions {
  format?: boolean;
  round?: boolean;
  fromInput?: boolean;
}

/**
 * Поле "число + ползунок" (см. field-range/_index.pug): синхронизирует текстовое поле
 * и `<input type="range">`, форматирует значение (группировка разрядов, единица измерения
 * со склонением), подгоняет ширину текстового поля под содержимое.
 *
 * min/max/step читаются из атрибутов самого range-инпута (единственный источник правды,
 * задаётся в _index.pug) — value там же, что даёт полю нативный `reset()` формы "бесплатно".
 *
 * Для варианта с двумя ползунками (диапазон "от — до") см. FieldRangeDouble.
 */
export default class FieldRange {
  private _elem: HTMLElement;
  private _form: HTMLFormElement | null;
  private _inputNumber: HTMLInputElement;
  private _inputRange: HTMLInputElement;
  private _unitElem: HTMLElement | null;
  private _measurer = new InputWidthMeasurer();
  private _resizeDebouncer = new RafDebouncer();

  private unit?: string;
  private unitHasSpace: boolean;
  private min: number;
  private max: number;
  private step: number;
  private isStepDecimal: boolean;
  private precision: number;
  private onChange?: (value: number) => void;

  /** Текущее значение поля (уже зажатое в диапазон [min, max] и округлённое до шага). */
  value: number;
  /** Для интеграции с shared/lib/ui-classes/Form.ts (Form.setLock() во время отправки формы). */
  valid = true;

  constructor(elem: HTMLElement, options: FieldRangeOptions = {}) {
    this._elem = elem;
    this._form = this._elem.closest("form");

    const inputNumber = this._elem.querySelector<HTMLInputElement>("[type='text']");
    const inputRange = this._elem.querySelector<HTMLInputElement>("[type='range']");
    if (!inputNumber || !inputRange) {
      throw new Error("FieldRange: не найдены поля ввода числа/диапазона");
    }
    this._inputNumber = inputNumber;
    this._inputRange = inputRange;
    this._unitElem = this._elem.querySelector("[data-role='unit']");

    const { unit, unitSpace } = this._elem.dataset;
    this.unit = unit;
    this.unitHasSpace = resolveUnitSpace(unit, unitSpace);

    this.min = readNumberAttr(inputRange.min, 0);
    this.max = readNumberAttr(inputRange.max, 100);
    this.step = readNumberAttr(inputRange.step, 1) || 1;
    if (this.max <= this.min) {
      console.warn("FieldRange: max должен быть больше min", this._elem);
    }
    this.isStepDecimal = this.step % 1 !== 0;
    this.precision = this.isStepDecimal ? this.step.toString().split(".")[1]?.length ?? 1 : 0;

    this.onChange = options.onChange;
    this.value = this.min;

    const initial = roundToStep(parseNumber(inputRange.value), this.step);
    this.updateValue(Number.isNaN(initial) ? this.min : initial, { round: true });

    // Фиксируем уже округлённое/зажатое значение как то, к которому вернёт reset() формы —
    // это может отличаться от исходного HTML-атрибута value, если он был вне диапазона.
    inputRange.defaultValue = inputRange.value;
    inputNumber.defaultValue = inputNumber.value;

    inputNumber.addEventListener("input", this.handleNumberInput);
    inputNumber.addEventListener("blur", this.handleNumberBlur);
    inputNumber.addEventListener("keydown", this.handleNumberKeydown);
    inputRange.addEventListener("input", this.handleRangeInput);
    this._form?.addEventListener("reset", this.handleFormReset);
    window.addEventListener("resize", this.handleResize);

    // Ширина текстового поля зависит от реального начертания шрифта — на момент
    // инициализации веб-шрифт мог ещё не догрузиться, пересчитываем, когда он готов.
    callNowAndOnFontsReady(() => this._measurer.update(this._inputNumber));

    // Регистрация в форме — чтобы Form.setLock()/validate() (см. ui-classes/Form.ts)
    // учитывали и это поле наравне с текстовыми.
    registerFormField(this._form, inputNumber.name, this);
  }

  private handleNumberInput = (): void => {
    let value = this._inputNumber.value.replace(/,/g, ".").replace(/[^\d.]/g, "");

    const dotCount = (value.match(/\./g) ?? []).length;
    if (dotCount > 1) {
      // Пользователь напечатал вторую точку — оставляем только последнюю.
      value = value.replace(/\.(?=.*\.)/g, "");
    }

    this.updateValue(value, { format: true, round: false, fromInput: true });
    this._measurer.update(this._inputNumber);
  };

  private handleNumberBlur = (): void => {
    this.updateValue(this._inputNumber.value, { format: true, round: true });
    this._measurer.update(this._inputNumber);
  };

  private handleNumberKeydown = (event: KeyboardEvent): void => {
    blurOnEnter(event, this._inputNumber);
  };

  private handleRangeInput = (): void => {
    this.updateValue(this._inputRange.value, { format: true, round: true });
    this._measurer.update(this._inputNumber);
  };

  private handleFormReset = (): void => {
    // К этому моменту браузер уже сбросил value обоих полей на их defaultValue —
    // сброс значений полей форма выполняет до отправки события "reset" (спецификация HTML).
    this.updateValue(this._inputRange.value, { format: true, round: true });
    this._measurer.update(this._inputNumber);
  };

  private handleResize = (): void => {
    this._resizeDebouncer.schedule(() => this._measurer.update(this._inputNumber));
  };

  private updateValue(rawValue: number | string, opts: UpdateValueOptions = {}): void {
    const { format = true, round = false, fromInput = false } = opts;
    const rawStr = rawValue.toString();

    // Поле очищено целиком во время набора — не откатываем принудительно к min,
    // даём пользователю напечатать число заново; ползунок при этом уходит в min.
    if (fromInput && rawStr === "") {
      this._inputNumber.value = "";
      this.value = this.min;
      this._inputRange.value = this.min.toString();
      this.updateUnitText(this.min);
      this.renderScaleFill();
      return;
    }

    let val = parseNumber(rawValue);
    if (Number.isNaN(val)) {
      val = this.min;
    } else {
      if (round) val = roundToStep(val, this.step);
      val = Math.min(this.max, Math.max(this.min, val));
    }
    this.value = val;

    this._inputNumber.value = format
      ? formatNumber(val, this.isStepDecimal, this.precision, fromInput, rawStr)
      : val.toString();

    if (fromInput && document.activeElement === this._inputNumber) {
      const caret = this._inputNumber.value.length;
      this._inputNumber.setSelectionRange(caret, caret);
    }

    this.updateUnitText(val);
    this._inputRange.value = val.toString();
    this._inputRange.setAttribute(
      "aria-valuetext",
      formatValueWithUnit(val, this.isStepDecimal, this.precision, this.unit, this.unitHasSpace)
    );
    this.renderScaleFill();
    this.onChange?.(val);
  }

  private updateUnitText(val: number): void {
    if (!this._unitElem || !this.unit) return;
    const text = resolveUnitText(val, this.unit);
    this._unitElem.textContent = this.unitHasSpace ? ` ${text}` : text;
  }

  private renderScaleFill(): void {
    const scaleMax = this.max - this.min;
    if (scaleMax <= 0) {
      this._inputRange.style.backgroundSize = "0% 100%";
      return;
    }

    const value = parseFloat(this._inputRange.value) - this.min;
    const percentage = (100 / scaleMax) * value;
    this._inputRange.style.backgroundSize = `${percentage}% 100%`;
  }

  /** Программная установка значения (напр. из внешнего кода) с зажатием в диапазон и округлением до шага. */
  setValue(value: number): void {
    this.updateValue(value, { format: true, round: true });
    this._measurer.update(this._inputNumber);
  }

  /** Для интеграции с shared/lib/ui-classes/Form.ts — у поля нет собственной валидации, оно всегда валидно. */
  validate(): void {
    this.valid = true;
  }

  get disabled(): boolean {
    return this._inputNumber.disabled;
  }

  set disabled(value: boolean) {
    this._inputNumber.disabled = value;
    this._inputRange.disabled = value;
  }

  destroy(): void {
    this._inputNumber.removeEventListener("input", this.handleNumberInput);
    this._inputNumber.removeEventListener("blur", this.handleNumberBlur);
    this._inputNumber.removeEventListener("keydown", this.handleNumberKeydown);
    this._inputRange.removeEventListener("input", this.handleRangeInput);
    this._form?.removeEventListener("reset", this.handleFormReset);
    window.removeEventListener("resize", this.handleResize);

    this._resizeDebouncer.cancel();
    this._measurer.destroy();

    unregisterFormField(this._form, this._inputNumber.name, this);
  }
}
