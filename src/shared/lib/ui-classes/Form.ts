declare global {
  interface HTMLFormElement {
    /** Экземпляр Form, инициализированный на этом элементе (см. installClass(".js-form", Form, ...)). */
    Form?: Form;
    /**
     * Контроллеры полей формы. Заполняются внешним скриптом валидации полей
     * (не входит в этот репозиторий, например компонент Bitrix) — если он не
     * подключён на странице, свойство просто отсутствует и клиентская
     * валидация полей отключается сама собой.
     */
    inputFields?: Record<string, LegacyFormField>;
  }

  interface Element {
    /** UI-компонент поля, отображающий его ошибку. Заполняется тем же внешним скриптом. */
    FieldText?: LegacyFieldText;
  }

  // eslint-disable-next-line no-var -- ambient-декларация глобальной переменной ядра Bitrix
  var BX: BitrixCore | undefined;
}

interface LegacyFormField {
  validate(): void;
  valid: boolean;
  disabled: boolean;
}

interface LegacyFieldText {
  setInvalid(message: string): void;
}

interface BitrixCore {
  bitrix_sessid?: () => string;
}

interface FormResponseBody {
  status?: string;
  message?: string;
  errors?: Record<string, string> | Array<[string, string]>;
  reload?: boolean;
  redirect?: string;
  MESSAGE?: string;
}

interface FormOptions {
  errorClass?: string;
  successClass?: string;
  awaitClass?: string;
  resetAfterSuccess?: boolean;
  resetDelay?: number;
  onError?: (form: HTMLFormElement, message: string) => void;
  onSubmit?: (form: HTMLFormElement) => void;
  onSuccess?: (form: HTMLFormElement, data: unknown) => void;
}

/**
 * AJAX-отправка формы с опциональной клиентской валидацией полей.
 *
 * Валидация (`getFields()`/`validate()`) работает только если на странице
 * подключён внешний скрипт, заполняющий `formElement.inputFields` — иначе
 * полей не находится и форма отправляется без клиентской проверки.
 *
 * Список полей не кешируется — считается заново при каждом validate()/setLock(),
 * т.к. состав полей формы может меняться динамически (см. ModalShell.arrangeModalFields:
 * скрытые поля физически выносятся из DOM формы и не должны участвовать в валидации).
 */
export default class Form {
  errorClass: string;
  successClass: string;
  awaitClass: string;
  resetAfterSuccess: boolean;
  resetDelay: number;
  onError?: (form: HTMLFormElement, message: string) => void;
  onSubmit?: (form: HTMLFormElement) => void;
  onSuccess?: (form: HTMLFormElement, data: unknown) => void;
  form: HTMLFormElement;
  redirect?: string;
  noReset: boolean;
  submitButton: HTMLButtonElement | HTMLInputElement | null;

  constructor(formElement: HTMLElement, options: FormOptions) {
    if (!(formElement instanceof HTMLFormElement)) {
      throw new TypeError("Form: элемент должен быть <form>");
    }

    this.errorClass = options.errorClass ?? "_error";
    this.successClass = options.successClass ?? "_success";
    this.awaitClass = options.awaitClass ?? "_await";
    this.resetAfterSuccess = options.resetAfterSuccess ?? true;
    this.resetDelay = options.resetDelay ?? 10000;
    this.onError = options.onError;
    this.onSubmit = options.onSubmit;
    this.onSuccess = options.onSuccess;

    this.form = formElement;
    this.redirect = formElement.dataset.redirect;
    this.noReset = formElement.dataset.reset === "false";

    this.form.addEventListener("submit", (event) => this.submitHandler(event));

    this.submitButton = formElement.querySelector<HTMLButtonElement | HTMLInputElement>(
      "[type='submit']"
    );

    // Приделываем инстанс к DOM-объекту
    formElement.Form = this;
  }

  private submitHandler(event: SubmitEvent): void {
    event.preventDefault();
    if (!this.validate()) return;
    this.send();
  }

  /** Поля формы, известные inputFields, на текущий момент (только реально присутствующие в DOM формы). */
  private getFields(): LegacyFormField[] {
    const inputFields = this.form.inputFields;
    if (!inputFields) return [];

    return [...this.form.querySelectorAll("[name]")]
      .map((field) => {
        const name = field.getAttribute("name");
        return name ? inputFields[name] : undefined;
      })
      .filter((field): field is LegacyFormField => field !== undefined);
  }

  /**
   * Валидация формы: true, если все известные поля валидны (или полей нет).
   * .map() + .every(), а не .every() с валидацией внутри колбэка — .every() останавливается
   * на первом false, а нам нужно вызвать validate() у ВСЕХ полей (и показать все ошибки разом),
   * а не только у первого невалидного.
   */
  validate(): boolean {
    return this.getFields()
      .map((field) => {
        field.validate();
        return field.valid !== false;
      })
      .every(Boolean);
  }

  /**
   * Отправка формы через fetch: application/x-www-form-urlencoded, либо multipart/form-data,
   * если в форме реально выбраны файлы (см. hasFiles ниже).
   */
  send(): void {
    const form = this.form;
    const url = form.action;
    // FormData ДО setLock(): disabled-поля браузер молча исключает из FormData
    // (см. спецификацию) — setLock(true) как раз выставляет disabled всем this.fields,
    // так что при обратном порядке в теле запроса оставались бы только sessid/url.
    const formData = new FormData(form);

    this.setLock(true);
    this.onSubmit?.(this.form);

    // * Добавляем sessid
    const sessid = typeof BX !== "undefined" ? BX?.bitrix_sessid?.() : undefined;
    if (sessid) {
      formData.append("sessid", sessid);
    }

    // * Добавляем url (если нужно отправлять как поле, а не просто fetch)
    formData.append("url", window.location.href);

    // Файлы можно передать только multipart — включаем его только когда они реально есть
    // (пустой input[type=file] в FormData не даёт записи вовсе). Иначе шлём более компактный
    // urlencoded, как раньше — multipart умеет читать не каждый обработчик формы.
    const hasFiles = [...formData.values()].some((value) => value instanceof File && value.size > 0);

    let body: BodyInit;
    let headers: HeadersInit | undefined;

    if (hasFiles) {
      body = formData; // fetch сам выставит Content-Type: multipart/form-data с нужным boundary
    } else {
      const urlBody = new URLSearchParams();
      for (const [key, value] of formData.entries()) {
        if (typeof value === "string") urlBody.append(key, value);
      }
      body = urlBody.toString();
      headers = { "Content-Type": "application/x-www-form-urlencoded" };
    }

    fetch(url, {
      method: "POST",
      headers,
      body,
    })
      .then(async (response) => {
        const contentType = response.headers.get("Content-Type");
        const isJson = !!contentType && contentType.includes("application/json");
        const data = isJson ? ((await response.json()) as FormResponseBody) : await response.text();
        return { responseStatus: response.status, data };
      })
      .then(({ responseStatus, data }) => {
        const body: FormResponseBody = typeof data === "string" ? {} : data;
        const { status, message, errors, reload, redirect } = body;

        if (status === "error") {
          // * вывод текста общей ошибки
          if (message) {
            this.handleError(message);
          }

          // * вывод ошибок полей
          if (errors) {
            const errorsList = Array.isArray(errors) ? errors : Object.entries(errors);
            errorsList.forEach(([fieldName, msg]) => {
              const input = form.querySelector(`[name='${CSS.escape(fieldName)}']`);
              const field = input?.closest(".field")?.FieldText;
              field?.setInvalid(msg);
            });
          }
        } else if (responseStatus === 200) {
          this.handleSuccess(data);
        } else {
          const errorMessage =
            body.MESSAGE ??
            (typeof data === "string" && data ? data : "Ошибка обработки ответа сервера");
          this.handleError(errorMessage);
        }

        if (reload) {
          location.reload();
        }

        if (redirect) {
          window.location.href = redirect;
        }
      })
      .catch((err: unknown) => {
        this.handleError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => this.setLock(false));
  }

  /**
   * Включает/отключает режим ожидания: блокировка кнопки и полей ввода,
   * css-класс ожидания на форме.
   */
  setLock(locked: boolean): void {
    if (this.submitButton) this.submitButton.disabled = locked;
    this.getFields().forEach((field) => {
      field.disabled = locked;
    });
    this.form.classList[locked ? "add" : "remove"](this.awaitClass);
  }

  /** Очистка формы. */
  reset(): void {
    this.form.reset();
    this.form.querySelectorAll("._success").forEach((elem) => elem.classList.remove("_success"));
  }

  /** Обработка успешной отправки. */
  handleSuccess(data: unknown): void {
    if (!this.noReset) {
      this.reset();
    }

    this.form.classList.add(this.successClass);
    this.onSuccess?.(this.form, data);

    if (this.redirect) {
      window.location.href = this.redirect;
      return; // дальше таймеры и классы уже не нужны
    }

    if (this.resetAfterSuccess && this.resetDelay) {
      setTimeout(() => {
        this.form.classList.remove(this.successClass);
      }, this.resetDelay);
    }
  }

  /** Обработка ошибки. */
  handleError(message: string): void {
    this.form.classList.add(this.errorClass);
    this.onError?.(this.form, message);
  }
}
