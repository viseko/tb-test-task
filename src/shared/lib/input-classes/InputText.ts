import addMask from "../text/add-mask";
import { FieldErrorState } from "./error-state";

// HTML-классы состояний (класс ошибки — см. FieldErrorState в error-state.ts)
const STATES = {
  value: "_has-value",
  success: "_success",
  required: "_required",
} as const;

type InputTextErrorKey = "required" | "minlength" | "pattern" | "repeat";

// Тексты ошибок по умолчанию (переопределяются через options.errors)
const DEFAULT_ERRORS: Record<InputTextErrorKey, string> = {
  required: "Это обязательное поле",
  minlength: "Значение должно быть не меньше %n",
  pattern: "Некорректный формат",
  repeat: "Значения не совпадают",
};

// Счётчик для генерации уникальных id блокам ошибок, если у поля не задан id
let errorIdCounter = 0;

export interface InputTextOptions {
  required?: boolean; // Обязательное поле — переопределяется атрибутом required на самом поле
  mask?: string; // Маска ввода, напр. "+7 ___ ___-__-__"
  maskSwallow?: string[]; // Префиксы, которые "съедаются" при переполнении маски (см. add-mask.ts), напр. ["+7","7","8"]
  minLength?: number;
  maxLength?: number;
  blurValidate?: boolean; // Валидация после снятия фокуса
  inputValidate?: boolean; // Валидация при вводе
  pattern?: RegExp;
  onChange?: (event: Event) => void;
  onInput?: (event: Event) => void;
  onBlur?: (event: Event) => void;
  errorSelector?: string; // Селектор блока вывода ошибки (по умолчанию [data-role='error'])
  errors?: Partial<Record<InputTextErrorKey, string>>; // Переопределение текстов ошибок
  value?: string; // Значение, к которому возвращает reset()
}

export default class InputText {
  required: boolean;
  mask?: string;
  maskSwallow?: string[];
  minLength: number;
  maxLength: number;
  blurValidate: boolean;
  inputValidate: boolean;
  pattern?: RegExp;
  onChange?: (event: Event) => void;
  onInput?: (event: Event) => void;
  onBlur?: (event: Event) => void;
  errors: Record<InputTextErrorKey, string>;

  _elem: HTMLElement; // Обёртка .field
  _inputElem: HTMLInputElement | HTMLTextAreaElement; // Поле ввода
  _errorElem: HTMLElement | null; // Текст ошибки
  _errorState: FieldErrorState; // Рамка + временное сообщение (см. error-state.ts)
  clearButton: HTMLElement | null;

  value: string; // Значение поля после reset()
  maskHandler: ReturnType<typeof addMask> | null = null;
  repeat: HTMLInputElement | HTMLTextAreaElement | null = null; // Поле, с которым сверяется значение (напр. повтор пароля)
  valid = true;

  constructor(elem: HTMLElement, options: InputTextOptions = {}) {
    // Опции
    this.required = options.required ?? false;
    this.mask = options.mask;
    this.maskSwallow = options.maskSwallow;
    this.minLength = options.minLength ?? 0;
    this.maxLength = options.maxLength ?? 0;
    this.blurValidate = options.blurValidate ?? false;
    this.inputValidate = options.inputValidate ?? false;
    this.pattern = options.pattern;
    this.onChange = options.onChange;
    this.onInput = options.onInput;
    this.onBlur = options.onBlur;
    this.errors = { ...DEFAULT_ERRORS, ...options.errors };

    // HTML-элементы
    this._elem = elem;
    this._errorState = new FieldErrorState(elem);

    const inputElem =
      elem.querySelector<HTMLInputElement>("input") ??
      elem.querySelector<HTMLTextAreaElement>("textarea");
    if (!inputElem) {
      throw new Error("InputText: внутри элемента не найден <input> или <textarea>");
    }
    this._inputElem = inputElem;

    this._errorElem =
      (options.errorSelector ? elem.querySelector<HTMLElement>(options.errorSelector) : null) ??
      elem.querySelector<HTMLElement>("[data-role='error']");
    this.clearButton = elem.querySelector<HTMLElement>("[data-role='clear']");

    // Доступность: связываем поле с текстом ошибки, чтобы скринридер озвучивал её при появлении
    if (this._errorElem) {
      if (!this._errorElem.id) {
        this._errorElem.id = `field-error-${++errorIdCounter}`;
      }
      this._inputElem.setAttribute("aria-describedby", this._errorElem.id);
    }

    // Доп. поля — значение, к которому вернёт reset(): текущее значение поля,
    // а если оно пустое — значение из options (пустая строка не считается "значением")
    this.value = this._inputElem.value !== "" ? this._inputElem.value : options.value ?? "";

    // Проверка параметров инпута
    // * required
    if (this._inputElem.required) {
      this.required = true;
    }

    // * minlength / maxlength — берём из HTML-атрибутов, если они заданы
    if (this._inputElem.hasAttribute("minlength")) {
      this.minLength = Number(this._inputElem.getAttribute("minlength"));
    }
    if (this._inputElem.hasAttribute("maxlength")) {
      this.maxLength = Number(this._inputElem.getAttribute("maxlength"));
    }

    // * поле, которое нужно повторить (напр. подтверждение пароля)
    const repeatId = this._inputElem.dataset.repeat;
    if (repeatId) {
      const repeatElem = document.getElementById(repeatId);
      this.repeat = repeatElem as HTMLInputElement | HTMLTextAreaElement | null;
    }

    // Добавление маски, если требуется
    if (this.mask) {
      this.maskHandler = addMask(this._inputElem, this.mask, this.maskSwallow ?? null);
    }

    // Добавление класса для обязательного элемента
    if (this.required) {
      this._elem.classList.add(STATES.required);
    }

    // Ввод - основной обработчик
    this._inputElem.addEventListener("input", () => {
      //  * снимаем состояние ошибки
      if (!this.valid) {
        this.valid = true;
        this._errorState.hide();
      }

      // * затем обрабатываем значение
      this.checkValue();
    });

    // Валидация поля при снятии фокуса
    if (this.blurValidate) {
      this._inputElem.addEventListener("blur", this.validate.bind(this));
    }

    // Валидация поля при вводе
    if (this.inputValidate) {
      this._inputElem.addEventListener("input", this.validate.bind(this));
    }

    // Колбеки
    const input = this._inputElem;
    if (this.onChange) input.addEventListener("change", this.onChange);
    if (this.onInput) input.addEventListener("input", this.onInput);
    if (this.onBlur) input.addEventListener("blur", this.onBlur);

    this.clearButton?.addEventListener("click", this.clear.bind(this));

    // Прописка инстанса в родительскую форму (для валидации и сброса полей)
    const parentForm = this._elem.closest("form");
    if (parentForm) {
      parentForm.inputFields ??= {};

      const name = this._inputElem.name;
      if (name) {
        parentForm.inputFields[name] = this;
      }
    }

    // Если textarea — вешаем автоувеличение
    if (this._inputElem instanceof HTMLTextAreaElement) {
      this._inputElem.style.overflow = "hidden";
      this._inputElem.addEventListener("input", this.autoResize.bind(this));
      // Чтобы при загрузке страницы уже был корректный размер
      this.autoResize();
    }

    // Проверка наличия значения с задержкой (для правильного отображения аним. плейсхолдеров)
    setTimeout(() => this.checkValue(), 100);

    // Прописка инстанса в элемент
    elem.FieldText = this;

    // Кнопки с рек. списком
    const recs = elem.querySelector<HTMLElement>("[data-role='recs']");
    recs?.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const btn = target?.closest("button");
      if (!btn) return;

      this._inputElem.value = btn.textContent ?? "";
    });
  }

  // --- Автоувеличение текстовой области ---
  private autoResize(): void {
    const el = this._inputElem;
    el.style.height = "auto"; // сбрасываем, чтобы рассчитать новую высоту
    el.style.height = `${el.scrollHeight}px`;
  }

  // Проверка наличия значения
  private checkValue(): void {
    const input = this._inputElem;
    const value = input.value;

    // Обрезка по макс. длине, если есть
    if (this.maxLength > 0) {
      input.value = value.slice(0, this.maxLength);
    }

    // Добавление/снятие класса состояния
    this._elem.classList.toggle(STATES.value, value.length > 0);
  }

  // Валидация поля
  validate(): boolean {
    const value = this._inputElem.value;

    if (value.length > 1) {
      // Валидация по шаблону
      if (this.pattern) {
        this.validateBy(this.pattern.test(value), this.errors.pattern);
      }

      // Валидация по мин. длине
      if (this.valid && this.minLength > 1) {
        this.validateBy(value.length >= this.minLength, this.errors.minlength, this.minLength);
      }
    } else if (this.required) {
      // Проверка обязательного поля
      this.validateBy(value.length >= 1, this.errors.required);
    } else {
      this._errorState.hide();
      this.clearValidityAttrs();
    }

    if (this.repeat) {
      this.validateBy(value === this.repeat.value, this.errors.repeat);
    }

    return this.valid;
  }

  setValid(): void {
    this._elem.classList.add(STATES.success);
    this._errorState.hide();
    this.valid = true;

    this.clearValidityAttrs();
  }

  setInvalid(errorText?: string): void {
    this._elem.classList.remove(STATES.success);
    this._inputElem.setAttribute("aria-invalid", "true");
    this.valid = false;

    if (this._errorElem && errorText) {
      this._errorElem.innerHTML = errorText;
    }
    this._errorState.show();
  }

  // Чистит aria-invalid и текст ошибки — иначе они останутся висеть в aria-describedby
  // и озвучатся скринридером при следующем фокусе на поле, хотя визуально уже скрыты
  private clearValidityAttrs(): void {
    this._inputElem.removeAttribute("aria-invalid");
    if (this._errorElem) {
      this._errorElem.innerHTML = "";
    }
  }

  validateBy(condition: boolean, errorText: string, n?: number): void {
    const message = n ? errorText.replace("%n", String(n)) : errorText;

    if (condition) {
      this.setValid();
    } else {
      this.setInvalid(message);
    }
  }

  get disabled(): boolean {
    return this._inputElem.disabled;
  }

  set disabled(value: boolean) {
    this._inputElem.disabled = value;
  }

  // Сброс
  reset(): void {
    this.valid = true;
    this._elem.classList.remove(STATES.success);
    this._errorState.hide();
    this.clearValidityAttrs();
    this._inputElem.value = this.value;
  }

  // Очистка
  clear(): void {
    this.valid = true;
    this._elem.classList.remove(STATES.success, STATES.value);
    this._errorState.hide();
    this.clearValidityAttrs();
    this._inputElem.value = "";
  }
}
