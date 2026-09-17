# Teaboom — тестовое задание

Вёрстка страницы товара интернет-магазина чая. Стек: Vite, Pug, SCSS, TypeScript.

## Запуск

```bash
npm install       # установка зависимостей
npm start         # dev-сервер (HMR) — http://localhost:3000
npm run build     # production-сборка в build/
npm run preview   # предпросмотр production-сборки
```

## Скрипты

| Команда                 | Описание                       |
| ----------------------- | ------------------------------ |
| `npm start`             | dev-сервер                     |
| `npm run build`         | production-сборка              |
| `npm run preview`       | предпросмотр production-сборки |
| `npm run lint`          | ESLint + Stylelint             |
| `npm run lint:fix`      | автофикс ESLint + Stylelint    |
| `npm run format`        | форматирование Prettier        |
| `npm run format:check`  | проверка форматирования        |
| `npm run validate:html` | валидация собранного HTML      |

## Структура

```
src/
├── app/                # инициализация DOM-виджетов
├── features/           # ripple-эффект, галерея (Fancybox)
├── pages/               # страницы (Pug)
├── shared/
│   ├── styles/          # токены, переменные, миксины, база
│   └── ui/               # переиспользуемые компоненты (кнопки, headless-примитивы)
└── widgets/             # хедер, карточка товара
```

## Технологии

Vite · Pug · SCSS · TypeScript · Fancybox · ESLint · Stylelint · Prettier
