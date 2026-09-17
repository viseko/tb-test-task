import { RafDebouncer, registerFormField, unregisterFormField } from "./field-range-shared";
import { FieldErrorState } from "./error-state";

// Отступ попапа от кнопки, если --gap в select.scss почему-то не читается (см. reposition()).
const POPUP_GAP_FALLBACK = 4;
// Минимальный отступ попапа от края вьюпорта при горизонтальном/вертикальном клампе.
const VIEWPORT_MARGIN = 8;

// HTML-классы состояний (класс ошибки — см. FieldErrorState в error-state.ts)
const STATES = {
  open: "_open",
  active: "_active",
  empty: "_empty",
} as const;

// Пауза между печатаемыми символами, после которой буфер быстрого поиска (typeahead) сбрасывается
const TYPEAHEAD_TIMEOUT = 600;

// Счётчик для генерации уникальных id элементам попапа/опций (см. errorIdCounter в InputText.ts)
let idCounter = 0;

export interface SelectOptions {
  onChange?: (select: HTMLSelectElement) => void;
}

/**
 * Кастомный select (см. select/_index.pug): доступный комбобокс с попапом-списком опций —
 * замена нативному <select>, нужная там, где требуется мультивыбор и/или поиск по опциям
 * (нативный select ни то, ни другое в едином UI не умеет).
 *
 * Источник правды для отправки формы и reset() — настоящий <select class="select__native">
 * внутри разметки (скрыт визуально и из таб-порядка, tabindex="-1" + aria-hidden). Он же
 * определяет multiple/required/disabled — эти атрибуты не дублируются в опциях класса.
 * Доступный интерфейс — попап: кнопка role сообщается через aria-haspopup="listbox",
 * список — role="listbox" (aria-multiselectable в режиме мультивыбора), опции — role="option".
 *
 * Поиск (searchable) не отдельный режим, а надстройка: строка фильтра живёт внутри попапа
 * и работает как в одиночном, так и в мультивыборе одновременно — см. память по этому компоненту.
 *
 * Попап портализуется в document.body (см. preparePortal()) — иначе overflow:hidden/z-index
 * любого предка (карточка, модалка, ячейка таблицы) обрежет или перекроет список. ARIA-связи
 * это не ломает (aria-controls/aria-activedescendant работают по id, а не по DOM-соседству),
 * а вот CSS-наследование от .select — ломает, поэтому попап получает те же классы модификаторов
 * и position: fixed с координатами из getBoundingClientRect(), а не поток/наследование.
 */
export default class Select {
  private _elem: HTMLElement;
  private _form: HTMLFormElement | null;
  private errorState: FieldErrorState;

  private control: HTMLButtonElement;
  private valueElem: HTMLElement;
  private popup: HTMLElement;
  private optionsList: HTMLElement;
  private optionElems: HTMLElement[];
  private optionLabels: string[];
  private nativeSelect: HTMLSelectElement;
  private errorElem: HTMLElement | null;
  private searchInput: HTMLInputElement | null;
  private searchEmptyElem: HTMLElement | null;

  private readonly multiple: boolean;
  private readonly searchable: boolean;
  private readonly placeholder: string;

  private onChange?: (select: HTMLSelectElement) => void;

  private isOpen = false;
  private activeIndex = -1;
  private typeaheadBuffer = "";
  private typeaheadTimer?: ReturnType<typeof setTimeout>;

  private readonly repositionDebouncer = new RafDebouncer();

  /** Для интеграции с shared/lib/ui-classes/Form.ts (Form.validate()/setLock()). */
  valid = true;

  constructor(elem: HTMLElement, options: SelectOptions = {}) {
    this._elem = elem;
    this._form = elem.closest("form");
    this.errorState = new FieldErrorState(elem);
    this.onChange = options.onChange;

    const control = elem.querySelector<HTMLButtonElement>(".select__control");
    const valueElem = elem.querySelector<HTMLElement>("[data-role='value']");
    const popup = elem.querySelector<HTMLElement>("[data-role='popup']");
    const optionsList = elem.querySelector<HTMLElement>("[data-role='options']");
    const nativeSelect = elem.querySelector<HTMLSelectElement>(".select__native");
    if (!control || !valueElem || !popup || !optionsList || !nativeSelect) {
      throw new Error("Select: не найдены обязательные элементы разметки");
    }
    this.control = control;
    this.valueElem = valueElem;
    this.popup = popup;
    this.optionsList = optionsList;
    this.nativeSelect = nativeSelect;
    this.errorElem = elem.querySelector<HTMLElement>("[data-role='error']");
    this.searchInput = elem.querySelector<HTMLInputElement>("[data-role='search']");
    this.searchEmptyElem = elem.querySelector<HTMLElement>("[data-role='empty']");

    this.optionElems = Array.from(elem.querySelectorAll<HTMLElement>(".select__option"));
    this.optionLabels = this.optionElems.map(
      (el) => el.querySelector(".select__option-label")?.textContent?.trim() ?? ""
    );

    this.multiple = nativeSelect.multiple;
    this.searchable = Boolean(this.searchInput);
    this.placeholder = elem.dataset.placeholder ?? "Выберите";

    this.preparePortal();
    this.linkA11y();

    this.control.addEventListener("click", this.handleControlClick);
    this.control.addEventListener("keydown", this.handleControlKeydown);
    this.control.addEventListener("blur", this.handleBlur);
    this.optionsList.addEventListener("click", this.handleOptionClick);
    // Опции не фокусируемы — без этого клик по ним увёл бы фокус на <body> (браузер снимает
    // фокус с кнопки/поиска при mousedown по нефокусируемому элементу), что в мультивыборе
    // (попап остаётся открытым) обрывает последующую клавиатурную навигацию по списку.
    this.optionsList.addEventListener("mousedown", this.handleOptionsMousedown);

    if (this.searchInput) {
      this.searchInput.addEventListener("input", this.handleSearchInput);
      this.searchInput.addEventListener("keydown", this.handleSearchKeydown);
      this.searchInput.addEventListener("blur", this.handleBlur);
    }

    this._form?.addEventListener("reset", this.handleFormReset);

    // Регистрация в форме — чтобы Form.setLock()/validate() (см. ui-classes/Form.ts)
    // учитывали и это поле наравне с текстовыми (см. registerFormField в field-range-shared.ts).
    registerFormField(this._form, this.nativeSelect.name, this);
  }

  // --- Портал: попап переезжает в конец document.body ---

  private preparePortal(): void {
    // Копируем статические классы .select (модификаторы multiple/searchable/theme/size/
    // className) на сам попап — CSS-переменные --popup-*/--option-* объявлены на .select,
    // а попап после переноса больше не его потомок, наследование от родителя не сработает.
    // "js-select" исключаем явно: иначе попап в body совпадёт с тем же CSS-селектором,
    // что и исходный .js-select, хотя структуры .select__control/.select__native у него нет.
    const staticClasses = Array.from(this._elem.classList).filter((c) => c !== "js-select");
    this.popup.classList.add(...staticClasses);

    document.body.appendChild(this.popup);
  }

  // --- Доступность: id/aria-связи, генерируемые в рантайме (см. errorIdCounter в InputText.ts) ---

  private linkA11y(): void {
    const uid = ++idCounter;

    this.control.id ||= `select-control-${uid}`;
    this.optionsList.id ||= `select-listbox-${uid}`;
    this.optionsList.setAttribute("aria-labelledby", this.control.id);
    this.control.setAttribute("aria-controls", this.optionsList.id);

    this.optionElems.forEach((el, i) => {
      el.id ||= `select-option-${uid}-${i}`;
    });

    if (this.errorElem) {
      this.errorElem.id ||= `select-error-${uid}`;
      this.control.setAttribute("aria-describedby", this.errorElem.id);
    }

    if (this.searchInput) {
      this.searchInput.id ||= `select-search-${uid}`;
      this.searchInput.setAttribute("role", "combobox");
      this.searchInput.setAttribute("aria-expanded", "false");
      this.searchInput.setAttribute("aria-controls", this.optionsList.id);
      this.searchInput.setAttribute("aria-autocomplete", "list");
    }
  }

  // --- Открытие/закрытие попапа ---

  private handleControlClick = (): void => {
    if (this.isOpen) {
      this.close(true);
    } else {
      this.open(true);
    }
  };

  open(focusSearch: boolean): void {
    if (this.isOpen || this.control.disabled) return;
    this.isOpen = true;

    // Safari не фокусирует <button> по клику — фиксируем фокус явно, иначе клавиатурная
    // навигация после открытия мышью не будет работать (см. handleControlKeydown).
    this.control.focus({ preventScroll: true });

    this._elem.classList.add(STATES.open);
    this.popup.hidden = false;
    this.control.setAttribute("aria-expanded", "true");
    this.searchInput?.setAttribute("aria-expanded", "true");

    this.reposition();

    // Фокус должен осесть на своём итоговом месте (кнопка или поиск) ДО вычисления активной
    // опции — setActiveIndex сам определяет владельца aria-activedescendant по document.activeElement.
    if (this.searchable && focusSearch && this.searchInput) {
      this.searchInput.focus();
    }
    this.setActiveIndex(this.findInitialActiveIndex());

    document.addEventListener("click", this.handleDocumentClick);
    window.addEventListener("resize", this.handleReposition);
    window.addEventListener("scroll", this.handleReposition, true);
  }

  close(returnFocus: boolean): void {
    if (!this.isOpen) return;
    this.isOpen = false;

    this._elem.classList.remove(STATES.open);
    this.popup.hidden = true;
    this.control.setAttribute("aria-expanded", "false");
    this.searchInput?.setAttribute("aria-expanded", "false");
    this.setActiveIndex(-1);

    if (this.searchable && this.searchInput) {
      this.searchInput.value = "";
      this.filterOptions("");
    }

    document.removeEventListener("click", this.handleDocumentClick);
    window.removeEventListener("resize", this.handleReposition);
    window.removeEventListener("scroll", this.handleReposition, true);
    this.repositionDebouncer.cancel();

    if (returnFocus) this.control.focus({ preventScroll: true });
  }

  // Попап живёт в document.body с position: fixed — setDropdownPosition (см. shared/lib/dom)
  // тут не подходит, она рассчитана на попап-соседа в потоке того же родителя (position: absolute
  // + top/left в его системе координат), а не на viewport-координаты портализованного узла.
  private reposition(): void {
    const rect = this.control.getBoundingClientRect();

    // --gap/--popup-min-width читаем с исходного .select (он никуда не переехал, см.
    // preparePortal()) — так зазор и минимальная ширина попапа остаются настраиваемыми
    // через CSS-переменные, а не задублированными магическими числами в JS.
    const style = getComputedStyle(this._elem);
    const gap = parseFloat(style.getPropertyValue("--gap")) || POPUP_GAP_FALLBACK;
    const minWidth = parseFloat(style.getPropertyValue("--popup-min-width")) || 0;

    const width = Math.max(rect.width, minWidth);
    this.popup.style.width = `${width}px`;

    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const popupHeight = this.popup.offsetHeight;

    const spaceBelow = viewportHeight - rect.bottom;
    const openUp = spaceBelow < popupHeight + gap && rect.top > popupHeight + gap;
    this.popup.style.top = openUp ? `${rect.top - popupHeight - gap}px` : `${rect.bottom + gap}px`;

    // Прижимаем к правому краю вьюпорта, если не влезает, но не уводим за левый край.
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN);
    this.popup.style.left = `${Math.min(rect.left, maxLeft)}px`;
  }

  private handleReposition = (): void => {
    this.repositionDebouncer.schedule(() => this.reposition());
  };

  // Попап портализован в body — он больше не потомок _elem, проверять контейнмент нужно
  // по обоим узлам (см. preparePortal()).
  private isInsideComponent(node: Node | null): boolean {
    return Boolean(node) && (this._elem.contains(node) || this.popup.contains(node));
  }

  private handleDocumentClick = (event: MouseEvent): void => {
    if (!this.isInsideComponent(event.target as Node)) this.close(false);
  };

  // Компонент покинут целиком (а не просто фокус перешёл со кнопки на поиск внутри того же
  // попапа) — самый подходящий момент проверить required, аналог blurValidate в InputText.
  private handleBlur = (): void => {
    requestAnimationFrame(() => {
      if (!this.isInsideComponent(document.activeElement)) this.validate();
    });
  };

  // --- Клавиатура: кнопка (закрытый select — как APG "select-only combobox") ---

  private handleControlKeydown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (this.isOpen) this.moveActive(1);
        else this.open(false);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (this.isOpen) this.moveActive(-1);
        else this.open(false);
        break;
      case "Home":
        if (this.isOpen) {
          event.preventDefault();
          this.moveActiveToEdge("first");
        }
        break;
      case "End":
        if (this.isOpen) {
          event.preventDefault();
          this.moveActiveToEdge("last");
        }
        break;
      case " ":
      case "Enter":
        event.preventDefault();
        if (this.isOpen) this.selectActive();
        else this.open(false);
        break;
      case "Escape":
        if (this.isOpen) {
          event.preventDefault();
          this.close(true);
        }
        break;
      case "Tab":
        // Не мешаем стандартному переходу фокуса — просто закрываем попап вслед за ним.
        if (this.isOpen) this.close(false);
        break;
      default:
        if (!this.searchable && event.key.length === 1) this.handleTypeahead(event.key);
    }
  };

  private handleTypeahead(char: string): void {
    if (!this.isOpen) this.open(false);

    clearTimeout(this.typeaheadTimer);
    this.typeaheadBuffer += char.toLowerCase();

    const indices = this.visibleEnabledIndices();
    const match = indices.find((i) =>
      this.optionLabels[i].toLowerCase().startsWith(this.typeaheadBuffer)
    );
    if (match !== undefined) this.setActiveIndex(match);

    this.typeaheadTimer = setTimeout(() => {
      this.typeaheadBuffer = "";
    }, TYPEAHEAD_TIMEOUT);
  }

  // --- Клавиатура: строка поиска (searchable) ---

  private handleSearchKeydown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        this.moveActive(-1);
        break;
      case "Enter":
        event.preventDefault();
        this.selectActive();
        break;
      case "Escape":
        event.preventDefault();
        this.close(true);
        break;
      case "Tab":
        if (this.isOpen) this.close(false);
        break;
    }
  };

  private handleSearchInput = (): void => {
    this.filterOptions(this.searchInput?.value.trim().toLowerCase() ?? "");
  };

  private filterOptions(query: string): void {
    let anyVisible = false;

    this.optionElems.forEach((el, i) => {
      const match = this.optionLabels[i].toLowerCase().includes(query);
      el.hidden = !match;
      if (match) anyVisible = true;
    });

    if (this.searchEmptyElem) this.searchEmptyElem.hidden = anyVisible;
    // Список полностью прячем, а не только его строки — иначе <ul>.select__options остаётся
    // в потоке с собственным padding вокруг пустоты (видимый "хвост" под рамкой попапа).
    this.optionsList.hidden = !anyVisible;
    this.setActiveIndex(anyVisible ? this.visibleEnabledIndices()[0] ?? -1 : -1);

    // Высота попапа меняется вместе со списком — без пересчёта top/bottom попап остаётся
    // приклеенным к координатам, посчитанным для прежнего (обычно куда более высокого) содержимого.
    if (this.isOpen) this.reposition();
  }

  // --- Активная опция (aria-activedescendant), см. APG combobox ---

  private findInitialActiveIndex(): number {
    const selectedIndex = this.optionElems.findIndex(
      (el) => el.getAttribute("aria-selected") === "true"
    );
    if (selectedIndex >= 0 && !this.optionElems[selectedIndex].hidden) return selectedIndex;
    return this.visibleEnabledIndices()[0] ?? -1;
  }

  private visibleEnabledIndices(): number[] {
    return this.optionElems
      .map((_, i) => i)
      .filter(
        (i) =>
          !this.optionElems[i].hidden &&
          this.optionElems[i].getAttribute("aria-disabled") !== "true"
      );
  }

  private moveActive(delta: number): void {
    const indices = this.visibleEnabledIndices();
    if (indices.length === 0) return;

    const currentPos = indices.indexOf(this.activeIndex);
    const nextPos = currentPos === -1 ? (delta > 0 ? 0 : indices.length - 1) : currentPos + delta;

    this.setActiveIndex(indices[Math.max(0, Math.min(indices.length - 1, nextPos))]);
  }

  private moveActiveToEdge(edge: "first" | "last"): void {
    const indices = this.visibleEnabledIndices();
    if (indices.length === 0) return;
    this.setActiveIndex(edge === "first" ? indices[0] : indices[indices.length - 1]);
  }

  private setActiveIndex(index: number): void {
    if (this.activeIndex >= 0 && this.optionElems[this.activeIndex]) {
      this.optionElems[this.activeIndex].classList.remove(STATES.active);
    }

    this.activeIndex = index;
    // Владелец aria-activedescendant — тот, кто реально сейчас в фокусе (кнопка либо поиск),
    // а не просто "есть ли поиск" — иначе после открытия стрелкой с фокусом на кнопке атрибут
    // указывал бы не на тот элемент, который скринридер озвучивает как активный.
    const owner =
      this.searchInput && document.activeElement === this.searchInput
        ? this.searchInput
        : this.control;

    if (index === -1) {
      owner.removeAttribute("aria-activedescendant");
      return;
    }

    const el = this.optionElems[index];
    el.classList.add(STATES.active);
    owner.setAttribute("aria-activedescendant", el.id);
    el.scrollIntoView({ block: "nearest" });
  }

  // --- Выбор опций ---

  private handleOptionClick = (event: MouseEvent): void => {
    const li = (event.target as HTMLElement).closest<HTMLElement>(".select__option");
    if (li) this.selectOption(li);
  };

  private handleOptionsMousedown = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private selectActive(): void {
    if (this.activeIndex === -1) return;
    this.selectOption(this.optionElems[this.activeIndex]);
  }

  private selectOption(li: HTMLElement): void {
    if (li.getAttribute("aria-disabled") === "true") return;
    const index = this.optionElems.indexOf(li);

    if (this.multiple) {
      const nowSelected = li.getAttribute("aria-selected") !== "true";
      li.setAttribute("aria-selected", String(nowSelected));
      this.syncNativeOption(li.dataset.value ?? "", nowSelected);
      this.setActiveIndex(index);
      this.updateValueText();
      this.emitChange();
      // Попап остаётся открытым — мультивыбор подразумевает выбор нескольких опций подряд.
    } else {
      this.optionElems.forEach((el) => {
        const isTarget = el === li;
        el.setAttribute("aria-selected", String(isTarget));
        if (isTarget) this.syncNativeOption(el.dataset.value ?? "", true);
      });
      this.updateValueText();
      this.emitChange();
      this.close(true);
    }

    // Снимаем зависшую ошибку сразу по выбору, а не только по blur/submit — так же,
    // как это делает InputText/ChoiceInput на своих событиях input/change.
    if (!this.valid) this.validate();
  }

  private syncNativeOption(value: string, isSelected: boolean): void {
    const opt = this.nativeSelect.querySelector<HTMLOptionElement>(
      `option[value="${CSS.escape(value)}"]`
    );
    if (opt) opt.selected = isSelected;

    if (!this.multiple) {
      const blank = this.nativeSelect.querySelector<HTMLOptionElement>('option[value=""]');
      if (blank) blank.selected = false;
    }
  }

  private updateValueText(): void {
    const selected = this.optionElems.filter((el) => el.getAttribute("aria-selected") === "true");

    let text: string;
    if (selected.length === 0) {
      text = this.placeholder;
    } else if (this.multiple && selected.length >= 2) {
      text = `Выбрано ${selected.length}`;
    } else {
      text = selected[0].querySelector(".select__option-label")?.textContent?.trim() ?? "";
    }

    this.valueElem.textContent = text;
    this._elem.classList.toggle(STATES.empty, selected.length === 0);
  }

  private emitChange(): void {
    this.nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    this.onChange?.(this.nativeSelect);
  }

  // --- Сброс формы: нативный select уже сброшен браузером к этому моменту (см. спецификацию
  // HTMLFormElement.reset()), синхронизируем попап с его актуальной selectedness ---

  private handleFormReset = (): void => {
    this.optionElems.forEach((el) => {
      const value = el.dataset.value ?? "";
      const opt = this.nativeSelect.querySelector<HTMLOptionElement>(
        `option[value="${CSS.escape(value)}"]`
      );
      el.setAttribute("aria-selected", String(opt?.selected ?? false));
    });

    this.updateValueText();
    this.setValid();
  };

  // --- Валидация (required + ничего не выбрано) — контракт LegacyFormField, см. Form.ts ---

  validate(): boolean {
    if (!this.nativeSelect.required) {
      this.setValid();
      return true;
    }

    const hasSelection = this.optionElems.some((el) => el.getAttribute("aria-selected") === "true");
    if (hasSelection) {
      this.setValid();
    } else {
      this.setInvalid();
    }

    return this.valid;
  }

  setValid(): void {
    this.errorState.hide();
    this.control.removeAttribute("aria-invalid");
    this.valid = true;
  }

  setInvalid(): void {
    this.errorState.show();
    this.control.setAttribute("aria-invalid", "true");
    this.valid = false;
  }

  get disabled(): boolean {
    return this.control.disabled;
  }

  set disabled(value: boolean) {
    this.control.disabled = value;
    this.nativeSelect.disabled = value;
    if (this.searchInput) this.searchInput.disabled = value;
    if (value) this.close(false);
  }

  destroy(): void {
    this.close(false);

    this.control.removeEventListener("click", this.handleControlClick);
    this.control.removeEventListener("keydown", this.handleControlKeydown);
    this.control.removeEventListener("blur", this.handleBlur);
    this.optionsList.removeEventListener("click", this.handleOptionClick);
    this.optionsList.removeEventListener("mousedown", this.handleOptionsMousedown);

    if (this.searchInput) {
      this.searchInput.removeEventListener("input", this.handleSearchInput);
      this.searchInput.removeEventListener("keydown", this.handleSearchKeydown);
      this.searchInput.removeEventListener("blur", this.handleBlur);
    }

    this._form?.removeEventListener("reset", this.handleFormReset);
    unregisterFormField(this._form, this.nativeSelect.name, this);

    // Попап живёт в body отдельно от _elem (см. preparePortal()) — удаление _elem со страницы
    // само по себе его не уберёт, надо явно.
    this.popup.remove();
  }
}
