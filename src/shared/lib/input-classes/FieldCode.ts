const FOCUS_CLASS = "_focus";

/**
 * Поле ввода кода (см. field-code/_index.pug): реальный ввод идёт в скрытый <input>,
 * визуально цифры раскладываются по ячейкам (label span) с подсветкой активной ячейки.
 * Состояния _error/_await/_timeout — чисто визуальные хуки в scss, переключаются снаружи
 * (после проверки кода на сервере), сам FieldCode их не трогает.
 */
export default class FieldCode {
  private readonly input: HTMLInputElement;
  private readonly cells: HTMLSpanElement[];

  constructor(elem: HTMLElement) {
    const input = elem.querySelector("input");
    const cells = [...elem.querySelectorAll<HTMLSpanElement>("label span")];

    if (!input || cells.length < 1) {
      throw new Error("FieldCode: не найден input или ячейки label span");
    }

    this.input = input;
    this.cells = cells;

    this.input.addEventListener("input", this.handleInput);
    this.input.addEventListener("focus", this.handleFocus);
    this.input.addEventListener("blur", this.hideFocus);

    // Синхронизация с предзаполненным значением (напр. value из разметки) — до первого input
    this.render();
  }

  private handleInput = (): void => {
    const input = this.input;
    input.value = input.value.replace(/\D/g, "").slice(0, this.cells.length);

    this.render();
    this.showFocus();
  };

  private handleFocus = (): void => {
    this.showFocus();
  };

  private render(): void {
    const value = this.input.value;
    this.cells.forEach((cell, i) => {
      cell.textContent = value[i] ?? "";
    });
  }

  private showFocus(): void {
    this.hideFocus();
    const index = Math.min(this.cells.length - 1, this.input.value.length);
    this.cells[index].classList.add(FOCUS_CLASS);
  }

  private hideFocus = (): void => {
    this.cells.forEach((cell) => cell.classList.remove(FOCUS_CLASS));
  };

  destroy(): void {
    this.input.removeEventListener("input", this.handleInput);
    this.input.removeEventListener("focus", this.handleFocus);
    this.input.removeEventListener("blur", this.hideFocus);
  }
}
