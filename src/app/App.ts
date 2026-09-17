/** CSS-селектор для поиска и инициализации DOM-элементов. */
export type Selector = `.js-${string}` | `[data-${string}]`;

/** Функция инициализации DOM-элемента, возвращающая связанный с ним экземпляр. */
export type InitFunction<T, O> = (el: HTMLElement, options: O) => T;

/** Конструктор класса, инициализирующего DOM-элемент. */
export type ElementConstructor<T, O> = new (el: HTMLElement, options: O) => T;


/**
 * Точка входа приложения: инициализация DOM-виджетов по CSS-селекторам.
 */
const App = {
  /** Находит все элементы по `selector` и инициализирует их через `fn`. */
  install<T, O = unknown>(selector: Selector, fn: InitFunction<T, O>, options: O = {} as O): T[] {
    const instances: T[] = [];

    document.querySelectorAll<HTMLElement>(selector).forEach((elem) => {
      try {
        instances.push(fn(elem, options));
      } catch (e) {
        console.error(
          `Ошибка при инициализации элемента: ${e instanceof Error ? e.message : String(e)}`,
          elem
        );
      }
    });

    return instances;
  },

  /** То же, что install(), но создаёт экземпляр через `new ClassConstructor(el, options)`. */
  installClass<T, O = unknown>(
    selector: Selector,
    ClassConstructor: ElementConstructor<T, O>,
    options: O = {} as O
  ): T[] {
    return this.install(selector, (el, opts) => new ClassConstructor(el, opts), options);
  },
};

// Привязываем методы к контексту App, чтобы их можно было деструктурировать при экспорте
App.install = App.install.bind(App);
App.installClass = App.installClass.bind(App);

export default App;
export const { install, installClass } = App;
