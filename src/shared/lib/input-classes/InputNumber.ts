import InputText, { type InputTextOptions } from "./InputText.js";

export interface InputNumberOptions extends InputTextOptions {
  unit?: string; // Единица измерения, дописывается к значению после потери фокуса (напр. "руб.")
  callback?: (value: string) => void;
}

// Экранирование спецсимволов regexp — нужно, чтобы unit вида "руб." не ломал маску сравнения
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default class InputNumber extends InputText {
  // Числовое поле всегда рендерится через <input type="number"> (см. field/_index.pug) — сужаем
  // унаследованный тип, чтобы обращаться к .min/.max без лишних проверок/приведений.
  declare _inputElem: HTMLInputElement;

  unit?: string;
  // undefined — ограничение не задано; важно не сворачивать это в 0 (min="0" — вполне
  // законное ограничение "не может быть отрицательным", falsy-проверкой его не отличить от "не задано")
  min?: number;
  max?: number;
  callback?: (value: string) => void;

  constructor(elem: HTMLElement, options: InputNumberOptions = {}) {
    super(elem, options);

    if (!(this._inputElem instanceof HTMLInputElement)) {
      throw new Error("InputNumber: ожидается <input>, а не <textarea>");
    }

    this.unit = options.unit;
    this.min = this._inputElem.hasAttribute("min") ? Number(this._inputElem.min) : undefined;
    this.max = this._inputElem.hasAttribute("max") ? Number(this._inputElem.max) : undefined;
    this.callback = options.callback;

    this._inputElem.addEventListener("input", this.handleInput.bind(this));
    this._inputElem.addEventListener("focus", this.handleFocus.bind(this));
    this._inputElem.addEventListener("blur", this.handleBlur.bind(this));

    this._inputElem.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        this._inputElem.blur();
      }
    });

    this.handleBlur();
  }

  // protected, а не private — переопределяются в Counter (см. Counter.ts), которому нужно
  // навесить свою логику (allowed-режим, состояния кнопок) поверх этого базового поведения.
  protected handleInput(): void {
    // Разрешаем вводить только цифры
    this._inputElem.value = this._inputElem.value.replace(/\D/g, "");
  }

  protected handleFocus(): void {
    // Убираем пробелы при фокусе
    this._inputElem.value = this._inputElem.value.replace(/\s/g, "");

    if (this.unit) {
      const regexp = new RegExp(`${escapeRegExp(this.unit)}$`);
      this._inputElem.value = this._inputElem.value.replace(regexp, "");
    }
  }

  protected handleBlur(): void {
    const value = Number(this._inputElem.value);

    // Приводим значение к допустимому диапазону
    if (this.min !== undefined && value < this.min) {
      this._inputElem.value = String(this.min);
    } else if (this.max !== undefined && value > this.max) {
      this._inputElem.value = String(this.max);
    }

    this.callback?.(this._inputElem.value);

    // Format number
    // this._inputElem.value = this._inputElem.value.replace(
    //   /(\d)(?=(\d{3})+$)/g,
    //   "$1 "
    // );

    if (this.unit) {
      this._inputElem.value = this._inputElem.value.replace(/$/, ` ${this.unit}`);
    }
  }

  setRange(min: number, max: number): void {
    this.min = min;
    this.max = max;

    const input = this._inputElem;
    const value = parseInt(input.value, 10);

    if (value < min) {
      input.value = String(min);
      input.focus();
      input.blur();
    } else if (value > max) {
      input.value = String(max);
      input.focus();
      input.blur();
    }
  }
}
