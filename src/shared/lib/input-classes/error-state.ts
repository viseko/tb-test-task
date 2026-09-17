/**
 * Единая точка настройки тайминга валидации: сколько мс висит текст ошибки поля
 * (см. FieldErrorState ниже), прежде чем скрыться, оставив только подсветку рамки.
 */
export const ERROR_MESSAGE_DURATION = 5000;

const ERROR_CLASS = "_error";
const MESSAGE_CLASS = "_show-error";

/**
 * Двухфазное состояние ошибки поля — общее для InputText/Select/InputFile/ChoiceInput/
 * ChoiceGroup, чтобы у всех была одна и та же логика и один визуальный формат
 * (см. @include field-error-tooltip в shared/styles/mixins/components/field-error.scss):
 *
 * 1. ERROR_CLASS ("_error") — держится, пока поле не станет валидным (подсветка рамки);
 * 2. MESSAGE_CLASS ("_show-error") — включает видимость самого текста-подсказки и гаснет
 *    сама через `duration` мс, не трогая ERROR_CLASS.
 */
export class FieldErrorState {
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly elem: HTMLElement) {}

  show(duration: number = ERROR_MESSAGE_DURATION): void {
    this.clearTimer();
    this.elem.classList.add(ERROR_CLASS, MESSAGE_CLASS);

    if (duration > 0) {
      this.hideTimer = setTimeout(() => {
        this.elem.classList.remove(MESSAGE_CLASS);
        this.hideTimer = null;
      }, duration);
    }
  }

  hide(): void {
    this.clearTimer();
    this.elem.classList.remove(ERROR_CLASS, MESSAGE_CLASS);
  }

  private clearTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}
