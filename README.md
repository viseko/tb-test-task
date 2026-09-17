# 🚀 Vite Starter Template

Стартовый шаблон для быстрой разработки веб-приложений с использованием Vite, Pug, SCSS и TypeScript.

## ✨ Особенности

- ⚡️ **Vite 7** - молниеносная сборка и HMR
- 🎨 **Pug** - мощный шаблонизатор HTML
- 💅 **SCSS** - продвинутый препроцессор CSS с модульной архитектурой
- 📘 **TypeScript** - типизированный JavaScript
- 🎭 **Swiper** - современный слайдер из коробки
- 🧹 **PurgeCSS** - автоматическая очистка неиспользуемого CSS
- 🔍 **Линтеры** - ESLint, Stylelint, HTML Validate

## 📁 Структура проекта

```
vite-starter/
├── app/                      # Конфигурация сборки
│   ├── modules/             # Модули Vite (плагины, сервер)
│   └── npm-scripts/         # Утилиты для автоматизации
├── public/                   # Статические файлы
│   ├── assets/              # Готовые ассеты
│   │   ├── fonts/          # Шрифты
│   │   └── img/            # Изображения и спрайты
│   └── favicon/            # Фавиконки
├── src/                      # Исходный код
│   ├── app/                # Ядро приложения
│   ├── features/           # Фичи (Feature-Sliced Design)
│   ├── pages/               # Страницы (Pug)
│   ├── shared/               # Общие ресурсы
│   │   ├── lib/             # Утилиты и хелперы
│   │   ├── styles/           # Глобальные стили
│   │   └── ui/                # UI компоненты
│   ├── widgets/             # Виджеты (хедер, футер и т.д.)
│   ├── main.ts               # Точка входа JS
│   └── main.scss             # Точка входа стилей
└── build/                   # Собранный проект (генерируется)
```

## 🎯 Архитектура

Проект следует принципам **Feature-Sliced Design** с адаптацией под классическую верстку:

- **`app/`** - инициализация приложения
- **`features/`** - бизнес-функциональность
- **`widgets/`** - композитные блоки (header, footer)
- **`shared/`** - переиспользуемые ресурсы
  - **`lib/`** - утилиты (debounce, throttle, DOM helpers)
  - **`styles/`** - миксины, переменные, токены, утилиты
  - **`ui/`** - базовые UI компоненты
- **`pages/`** - страницы приложения

## 🚀 Быстрый старт

### Установка

```bash
npm install
```

### Разработка

```bash
npm start
```

Откроется dev-сервер с hot reload на `http://localhost:3000`

### Сборка

```bash
npm run build
```

Результат сборки будет в папке `build/`

### Предпросмотр сборки

```bash
npm run preview
```

## 📜 Доступные скрипты

| Команда                 | Описание                                     |
| ------------------------ | --------------------------------------------- |
| `npm start`               | Запуск dev-сервера                            |
| `npm run build`           | Production сборка                             |
| `npm run preview`         | Предпросмотр production сборки                |
| `npm run imports`         | Автогенерация индекс-файлов импортов компонентов |
| `npm run validate:html`   | Валидация HTML                                |
| `npm run lint`            | Проверка SCSS и TS                            |
| `npm run lint:fix`        | Автофикс ошибок линтинга                      |
| `npm run lint:scss`       | Проверка SCSS                                 |
| `npm run lint:ts`         | Проверка TypeScript                           |
| `npm run format`          | Форматирование кода (Prettier)                |
| `npm run format:check`    | Проверка форматирования                       |

## 🎨 Работа со стилями

### SCSS архитектура

```
shared/styles/
├── tokens.scss          # Design tokens (цвета, размеры)
├── variables.scss       # SCSS переменные (доступны везде)
├── animations/          # Анимации (@keyframes)
├── base/               # Базовые стили (normalize, fonts)
├── layout/             # Сетки и контейнеры
├── mixins/             # SCSS миксины
│   ├── components/    # Компонентные миксины
│   ├── interactions/  # Ховеры, скроллбары
│   ├── layout/        # Сетки, центрирование
│   ├── responsive/    # Брейкпоинты, fluid
│   └── typography/    # Типографика
├── typography/         # Стили текста
└── utils/             # Утилитарные классы
```

### Миксины

```scss
// Адаптивность
@include breakpoint(md) {
  /* стили */
}
@include fluid(font-size, 16px, 24px);

// Центрирование
@include flex-center;
@include center;

// Ховеры
@include hover {
  /* стили */
}
@include button-hover;

// Кастомный скроллбар
@include custom-scrollbar;
```

### Утилитарные классы

```html
<!-- Отступы -->
<div class="mt-4 mb-8 px-6">
  <!-- Flex -->
  <div class="flex flex-center gap-4">
    <!-- Grid -->
    <div class="grid grid-cols-3 gap-6">
      <!-- Цвета -->
      <p class="text-primary bg-secondary"></p>
    </div>
  </div>
</div>
```

## 🧩 Работа с Pug

### Структура шаблонов

```pug
//- app/templates/_default.pug - базовый шаблон
extends /app/templates/_default

block variables
  - const title = "Главная страница"
  - const description = "Описание страницы"

block content
  include /widgets/page-header/_index

  main.page-main
    //- Контент страницы

  include /widgets/page-footer/_index
```

### Компоненты

```pug
//- Использование компонентов
include /shared/ui/headless/icon/_index
include /shared/ui/headless/img/_index

+icon('arrow-right')
+img({ src: 'image.jpg', alt: 'Описание' })
```

## 📦 Работа с ассетами

Готовые ассеты (изображения, шрифты, спрайт иконок, фавиконки) уже лежат в `public/assets/` и `public/favicon/`. Добавляйте новые файлы туда напрямую и подключайте их в коде:

```pug
+img({ src: PATH.img + '/photo.jpg', alt: 'Фото' })
```

```pug
+icon('icon-name')
```

### Шрифты

Поместите готовый `.woff2` в `public/assets/fonts/` и подключите в [`fonts.scss`](src/shared/styles/base/fonts.scss):

```scss
@include font-face("FontName", "font-file-name", 400, normal);
```

## 🛠 TypeScript утилиты

### DOM helpers

```typescript
import {
  getElementIndex,
  setDropdownPosition,
  setHeightProperty,
  useIntersectionObserver,
} from "@/shared/lib/dom";

// Получить индекс элемента
const index = getElementIndex(element);

// Установить позицию dropdown
setDropdownPosition(dropdown, trigger);

// Установить CSS переменную высоты
setHeightProperty(element, "--header-height");

// Intersection Observer
useIntersectionObserver(elements, callback, options);
```

### Функции

```typescript
import { debounce, throttle } from "@/shared/lib/functions";

// Debounce
const debouncedFn = debounce(() => {
  console.log("Вызов с задержкой");
}, 300);

// Throttle
const throttledFn = throttle(() => {
  console.log("Вызов не чаще раза в 300мс");
}, 300);
```

## 🎯 Рекомендации

### Добавление новой страницы

1. Создайте `src/pages/new-page.pug`
2. Используйте базовый шаблон:

```pug
extends /app/templates/_default

block variables
  - const title = "Новая страница"

block content
  //- Контент
```

### Добавление нового компонента

1. Создайте папку в `src/shared/ui/component-name/`
2. Добавьте файлы:
   - `_index.pug` - разметка
   - `_index.scss` - стили
   - `index.ts` - логика (опционально)
3. Подключите в `src/shared/ui/_index.pug` и `_index.scss`

### Добавление виджета

1. Создайте папку в `src/widgets/widget-name/`
2. Структура аналогична компонентам
3. Подключите в `src/widgets/_index.pug` и `_index.scss`

## 🔧 Технологии

- [Vite](https://vitejs.dev/) - сборщик
- [Pug](https://pugjs.org/) - шаблонизатор
- [SCSS](https://sass-lang.com/) - препроцессор CSS
- [TypeScript](https://www.typescriptlang.org/) - типизация
- [Swiper](https://swiperjs.com/) - слайдер
- [ESLint](https://eslint.org/) - линтер JS/TS
- [Stylelint](https://stylelint.io/) - линтер CSS/SCSS
- [Prettier](https://prettier.io/) - форматтер кода
- [PurgeCSS](https://purgecss.com/) - оптимизация CSS
