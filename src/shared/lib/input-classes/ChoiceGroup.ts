import { registerFormField, unregisterFormField } from "./field-range-shared";
import { FieldErrorState } from "./error-state";

// Счётчик для id блока ошибки группы (см. errorIdCounter в InputText.ts/ChoiceInput.ts)
let errorIdCounter = 0;

/**
 * Required-валидация ГРУППЫ чекбоксов/радиокнопок (см. +choice-group в choice-group/_index.pug):
 * условие — "отмечен хотя бы один пункт группы". В отличие от ChoiceInput (одиночный чекбокс,
 * ошибка над ним самим), ошибка здесь одна на всю группу — обязательность задаётся на самой
 * группе (data-required), а не на отдельных +checkbox/+radio внутри неё.
 */
export default class ChoiceGroup {
  private readonly inputs: HTMLInputElement[];
  private readonly errorElem: HTMLElement | null;
  private readonly errorState: FieldErrorState;
  private readonly required: boolean;
  private readonly form: HTMLFormElement | null;
  private readonly name?: string;

  /** Контракт LegacyFormField, см. shared/lib/ui-classes/Form.ts. */
  valid = true;

  constructor(elem: HTMLElement) {
    this.inputs = [
      ...elem.querySelectorAll<HTMLInputElement>("input[type='checkbox'], input[type='radio']"),
    ];
    if (this.inputs.length === 0) {
      throw new Error("ChoiceGroup: внутри группы не найдено ни одного чекбокса/радио");
    }

    this.errorElem = elem.querySelector<HTMLElement>("[data-role='error']");
    this.errorState = new FieldErrorState(elem);
    this.required = elem.dataset.required === "true";
    this.form = elem.closest("form");
    this.name = this.inputs[0].name;

    this.linkA11y();
    this.inputs.forEach((input) => input.addEventListener("change", this.handleChange));

    registerFormField(this.form, this.name, this);
  }

  // Доступность: связываем каждый пункт группы с общим текстом ошибки (см. ChoiceInput.ts)
  private linkA11y(): void {
    const errorElem = this.errorElem;
    if (!errorElem) return;

    if (!errorElem.id) {
      errorElem.id = `choice-group-error-${++errorIdCounter}`;
    }
    this.inputs.forEach((input) => input.setAttribute("aria-describedby", errorElem.id));
  }

  private handleChange = (): void => {
    if (!this.valid) this.validate();
  };

  validate(): boolean {
    if (!this.required) {
      this.setValid();
      return true;
    }

    const hasChecked = this.inputs.some((input) => input.checked);
    if (hasChecked) {
      this.setValid();
    } else {
      this.setInvalid();
    }

    return this.valid;
  }

  setValid(): void {
    this.valid = true;
    this.errorState.hide();
  }

  setInvalid(): void {
    this.valid = false;
    this.errorState.show();
  }

  get disabled(): boolean {
    return this.inputs.every((input) => input.disabled);
  }

  set disabled(value: boolean) {
    this.inputs.forEach((input) => {
      input.disabled = value;
    });
  }

  destroy(): void {
    this.inputs.forEach((input) => input.removeEventListener("change", this.handleChange));
    unregisterFormField(this.form, this.name, this);
  }
}
