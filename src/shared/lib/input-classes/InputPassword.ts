import InputText, { type InputTextOptions } from "./InputText.js";

const STATES = {
  show: "_show",
} as const;

export default class InputPassword extends InputText {
  // Поле пароля всегда рендерится через <input> (см. field-password/_index.pug) — сужаем
  // унаследованный тип, чтобы обращаться к .type без лишних проверок/приведений.
  declare _inputElem: HTMLInputElement;

  private hidden = true;

  constructor(elem: HTMLElement, options: InputTextOptions = {}) {
    super(elem, options);

    if (!(this._inputElem instanceof HTMLInputElement)) {
      throw new Error("InputPassword: ожидается <input>, а не <textarea>");
    }

    const btn = this._elem.querySelector<HTMLButtonElement>("button");
    if (!btn) {
      throw new Error("InputPassword: не найдена кнопка показать/скрыть пароль");
    }
    btn.addEventListener("click", this.showHide.bind(this));
  }

  private showHide(): void {
    this.hidden = !this.hidden;
    this._elem.classList.toggle(STATES.show, !this.hidden);
    this._inputElem.type = this.hidden ? "password" : "text";
  }
}
