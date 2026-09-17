import { registerFormField, unregisterFormField } from "./field-range-shared";
import { FieldErrorState } from "./error-state";

// Счётчик для id блока ошибки, если у поля нет своего (см. errorIdCounter в InputText.ts)
let errorIdCounter = 0;

/**
 * Required-валидация ОДИНОЧНОГО чекбокса/радио (см. checkbox/radio _index.pug) — например
 * согласия с политикой в form-agreement: обязательность и текст ошибки задаются прямо
 * в разметке (required/errorText), проверка — валиден, если input.checked.
 *
 * Если элемент — часть +choice-group (см. ChoiceGroup.ts), полностью самоустраняется:
 * required и показ ошибки на себя берёт группа целиком. Без этой отсечки несколько
 * инстансов с общим name затирали бы друг друга в form.inputFields (см. registerFormField) —
 * остался бы валидным только последний зарегистрированный.
 */
export default class ChoiceInput {
  private readonly input: HTMLInputElement;
  private readonly errorElem: HTMLElement | null;
  private readonly errorState: FieldErrorState | null;
  private readonly form: HTMLFormElement | null;
  private readonly isGrouped: boolean;

  /** Контракт LegacyFormField, см. shared/lib/ui-classes/Form.ts. */
  valid = true;

  constructor(elem: HTMLElement) {
    const input = elem.querySelector<HTMLInputElement>("input[type='checkbox'], input[type='radio']");
    if (!input) {
      throw new Error("ChoiceInput: внутри элемента не найден чекбокс/радио");
    }
    this.input = input;
    this.form = elem.closest("form");
    this.isGrouped = !!elem.closest(".choice-group");

    this.errorElem = elem.querySelector<HTMLElement>("[data-role='error']");
    this.errorState = this.errorElem ? new FieldErrorState(elem) : null;

    if (this.isGrouped) return; // валидацию и регистрацию в форме берёт на себя ChoiceGroup

    this.linkA11y();
    this.input.addEventListener("change", this.handleChange);
    registerFormField(this.form, this.input.name, this);
  }

  // Доступность: связываем чекбокс/радио с текстом его ошибки (см. errorIdCounter в InputText.ts)
  private linkA11y(): void {
    if (!this.errorElem) return;

    if (!this.errorElem.id) {
      this.errorElem.id = `choice-error-${++errorIdCounter}`;
    }
    this.input.setAttribute("aria-describedby", this.errorElem.id);
  }

  private handleChange = (): void => {
    if (!this.valid) this.validate();
  };

  validate(): boolean {
    if (!this.input.required) {
      this.setValid();
      return true;
    }

    if (this.input.checked) {
      this.setValid();
    } else {
      this.setInvalid();
    }

    return this.valid;
  }

  setValid(): void {
    this.valid = true;
    this.errorState?.hide();
    this.input.removeAttribute("aria-invalid");
  }

  setInvalid(): void {
    this.valid = false;
    this.errorState?.show();
    this.input.setAttribute("aria-invalid", "true");
  }

  get disabled(): boolean {
    return this.input.disabled;
  }

  set disabled(value: boolean) {
    this.input.disabled = value;
  }

  destroy(): void {
    if (this.isGrouped) return;
    this.input.removeEventListener("change", this.handleChange);
    unregisterFormField(this.form, this.input.name, this);
  }
}
