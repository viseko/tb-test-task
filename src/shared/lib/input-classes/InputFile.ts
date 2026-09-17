import { registerFormField, unregisterFormField } from "./field-range-shared";
import { FieldErrorState } from "./error-state";

// Счётчик для генерации id блоку ошибки, если у поля нет своего (см. errorIdCounter в InputText.ts)
let errorIdCounter = 0;
// Счётчик для id элементов списка файлов. НЕ Date.now(): при пакетном выборе нескольких файлов
// addFile() отрабатывает для них всех синхронно в один и тот же тик, миллисекундная метка могла
// совпасть у соседних файлов — и кнопка "удалить" одного стирала бы сразу оба.
let fileIdCounter = 0;

type ErrorKey = "required" | "invalidType" | "maxSize";

// %f — имя файла, %s — отформатированный лимит размера (см. validateBy-подобный replace в InputText.ts)
const DEFAULT_ERRORS: Record<ErrorKey, string> = {
  required: "Прикрепите файл",
  invalidType: 'Файл "%f" не соответствует требованиям',
  maxSize: 'Файл "%f" превышает лимит %s',
};

export interface InputFileOptions {
  maxSize?: number; // байт, лимит размера одного файла
  errors?: Partial<Record<ErrorKey, string>>;
  errorTimeout?: number; // мс до автоскрытия тост-уведомления по файлу; 0 — не скрывать
}

interface FileItem {
  id: string;
  file: File;
  elem: HTMLElement;
}

/**
 * Загрузка файлов (см. field-file/_index.pug): кликабельная/drag&drop-зона (нативный
 * <input type="file"> растянут поверх неё на 100% и прозрачен — drag&drop работает силами
 * самого браузера, без drop/dragover-хендлеров) со списком выбранных файлов под ней.
 *
 * Источник правды для отправки формы — тот же <input type="file">: после каждого добавления/
 * удаления файла его .files пересобирается из filesList через DataTransfer (см. updateInputFiles),
 * поэтому повторное открытие диалога добавляет файлы к уже выбранным, а не заменяет их.
 *
 * Ошибки двух видов: per-файл тост (неверный тип/превышен размер) — временный, автоскрывается
 * (см. showFileError), и обычная required-валидация всего поля — постоянный блок [data-role='error'],
 * как у select/checkbox (см. validate()).
 */
export default class InputFile {
  private readonly elem: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly listElem: HTMLElement;
  private readonly fileTemplate: HTMLTemplateElement;
  private readonly errorElem: HTMLElement | null;
  private readonly errorState: FieldErrorState;
  private readonly form: HTMLFormElement | null;

  private readonly maxSize?: number;
  private readonly errors: Record<ErrorKey, string>;
  private readonly errorTimeout: number;
  private readonly required: boolean;

  private filesList: FileItem[] = [];

  /** Для интеграции с shared/lib/ui-classes/Form.ts (Form.validate()/setLock()). */
  valid = true;

  constructor(elem: HTMLElement, options: InputFileOptions = {}) {
    this.elem = elem;
    this.errors = { ...DEFAULT_ERRORS, ...options.errors };
    this.errorTimeout = options.errorTimeout ?? 3000;

    const input = elem.querySelector<HTMLInputElement>("[type='file']");
    const listElem = elem.querySelector<HTMLElement>("[data-role='list']");
    const fileTemplate = elem.querySelector<HTMLTemplateElement>("template");
    if (!input || !listElem || !fileTemplate) {
      throw new Error("InputFile: не найдены обязательные элементы разметки");
    }
    this.input = input;
    this.listElem = listElem;
    this.fileTemplate = fileTemplate;
    this.errorElem = elem.querySelector<HTMLElement>("[data-role='error']");
    this.errorState = new FieldErrorState(elem);

    this.maxSize = options.maxSize;
    this.required = input.required;
    this.form = input.closest("form");

    this.linkA11y();

    this.input.addEventListener("input", this.handleInput);
    this.listElem.addEventListener("click", this.handleListClick);
    this.form?.addEventListener("reset", this.reset);

    registerFormField(this.form, this.input.name, this);
  }

  // Доступность: связываем поле с текстом ошибки (см. errorIdCounter в InputText.ts)
  private linkA11y(): void {
    if (!this.errorElem) return;

    if (!this.errorElem.id) {
      this.errorElem.id = `field-file-error-${++errorIdCounter}`;
    }
    this.input.setAttribute("aria-describedby", this.errorElem.id);
  }

  private handleInput = (): void => {
    const newFiles = [...(this.input.files ?? [])];
    const { validFiles, invalidFiles } = this.validateFiles(newFiles);

    invalidFiles.forEach(({ file, reason }) => this.showFileError(file, reason));
    validFiles.forEach((file) => {
      if (!this.isFileExists(file)) this.addFile(file);
    });

    // Пересобираем input.files в любом случае, а не только когда добавился хотя бы один файл —
    // иначе при выборе ТОЛЬКО невалидных файлов input.files останется исходной (отклонённой)
    // выборкой браузера и она всё равно уйдёт на сервер при отправке формы.
    this.updateInputFiles();

    if (!this.valid) this.validate();
  };

  private handleListClick = (event: MouseEvent): void => {
    const removeBtn = (event.target as HTMLElement).closest<HTMLElement>("[data-role='remove']");
    if (removeBtn?.dataset.fileid) this.removeFile(removeBtn.dataset.fileid);
  };

  private validateFiles(files: File[]): {
    validFiles: File[];
    invalidFiles: Array<{ file: File; reason: "invalidType" | "maxSize" }>;
  } {
    const validFiles: File[] = [];
    const invalidFiles: Array<{ file: File; reason: "invalidType" | "maxSize" }> = [];

    files.forEach((file) => {
      if (!this.validateFileType(file)) {
        invalidFiles.push({ file, reason: "invalidType" });
      } else if (!this.validateFileSize(file)) {
        invalidFiles.push({ file, reason: "maxSize" });
      } else {
        validFiles.push(file);
      }
    });

    return { validFiles, invalidFiles };
  }

  private validateFileType(file: File): boolean {
    const accept = this.input.accept;
    if (!accept) return true;

    return accept
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .some((pattern) => {
        if (pattern.startsWith(".")) {
          return file.name.toLowerCase().endsWith(pattern);
        }

        if (pattern === "video/mp4") {
          return ["video/mp4", "video/mpeg4", "application/mp4"].includes(file.type.toLowerCase());
        }

        if (pattern.endsWith("/*")) {
          const [type] = pattern.split("/");
          return file.type.startsWith(`${type}/`);
        }

        return file.type === pattern;
      });
  }

  private validateFileSize(file: File): boolean {
    return this.maxSize === undefined || file.size <= this.maxSize;
  }

  // Файл считается уже выбранным по имени+размеру+дате изменения — одного имени недостаточно:
  // два разных файла (напр. перезаписанный экспорт) могут называться одинаково.
  private isFileExists(file: File): boolean {
    return this.filesList.some(
      (item) =>
        item.file.name === file.name &&
        item.file.size === file.size &&
        item.file.lastModified === file.lastModified
    );
  }

  private addFile(file: File): void {
    const id = `f${++fileIdCounter}`;
    const clone = this.fileTemplate.content.cloneNode(true) as DocumentFragment;

    const itemElem = clone.querySelector<HTMLElement>(".field-file__list-item");
    const nameElem = clone.querySelector<HTMLElement>("[data-role='filename']");
    const removeBtn = clone.querySelector<HTMLElement>("[data-role='remove']");
    if (!itemElem || !nameElem || !removeBtn) return;

    nameElem.textContent = file.name;
    removeBtn.dataset.fileid = id;

    this.filesList.push({ id, file, elem: itemElem });
    this.listElem.append(itemElem);
  }

  private removeFile(id: string): void {
    const index = this.filesList.findIndex((item) => item.id === id);
    if (index === -1) return;

    this.filesList[index].elem.remove();
    this.filesList.splice(index, 1);
    this.updateInputFiles();

    if (!this.valid) this.validate();
  }

  private updateInputFiles(): void {
    const dataTransfer = new DataTransfer();
    this.filesList.forEach(({ file }) => dataTransfer.items.add(file));
    this.input.files = dataTransfer.files;
  }

  // Тост-уведомление по конкретному файлу — временное, автоскрывается через errorTimeout
  // (не путать с validate()/errorElem ниже — required-валидация всего поля, живёт постоянно)
  private showFileError(file: File, reason: "invalidType" | "maxSize"): void {
    const message = this.errors[reason]
      .replace("%f", file.name)
      .replace("%s", this.formatSize(this.maxSize ?? 0));

    const toastElem = document.createElement("div");
    toastElem.className = "field-file__toast";
    toastElem.setAttribute("role", "alert");
    toastElem.textContent = message;

    this.elem.append(toastElem);
    if (this.errorTimeout > 0) {
      setTimeout(() => toastElem.remove(), this.errorTimeout);
    }
  }

  private formatSize(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  validate(): boolean {
    if (this.required && this.filesList.length === 0) {
      this.setInvalid();
    } else {
      this.setValid();
    }

    return this.valid;
  }

  setValid(): void {
    this.errorState.hide();
    this.input.removeAttribute("aria-invalid");
    this.valid = true;
  }

  setInvalid(): void {
    this.input.setAttribute("aria-invalid", "true");
    this.valid = false;

    if (this.errorElem) this.errorElem.textContent = this.errors.required;
    this.errorState.show();
  }

  get disabled(): boolean {
    return this.input.disabled;
  }

  set disabled(value: boolean) {
    this.input.disabled = value;
    this.listElem.querySelectorAll<HTMLButtonElement>("[data-role='remove']").forEach((btn) => {
      btn.disabled = value;
    });
  }

  reset = (): void => {
    this.filesList = [];
    this.input.value = "";
    this.listElem.innerHTML = "";
    this.setValid();
  };

  destroy(): void {
    this.input.removeEventListener("input", this.handleInput);
    this.listElem.removeEventListener("click", this.handleListClick);
    this.form?.removeEventListener("reset", this.reset);
    unregisterFormField(this.form, this.input.name, this);
  }
}
