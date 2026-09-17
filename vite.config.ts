import { defineConfig } from "vite";

import { resolve } from "path";

import { buildServer, buildPlugins } from "./app/modules/_index";

import purgecss from "@fullhuman/postcss-purgecss";

export default defineConfig(({ mode }) => {
  const IS_DEV = mode === "development";
  const BASE_URL = ""; // сайт раздаётся с корня домена (Vercel)

  return {
    root: "src",
    publicDir: resolve(__dirname, "public"),
    base: BASE_URL,
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
    plugins: buildPlugins({
      locals: {
        IS_DEV,
        BASE_URL,
        PATH: {
          img: `${BASE_URL}/assets/img`,
          fonts: `${BASE_URL}/assets/fonts`,
          video: `${BASE_URL}/assets/video`,
          json: `${BASE_URL}/assets/json`,
        },
        TIMESTAMP: Date.now().toString(32),
      },
    }),
    build: {
      outDir: "../build",
      emptyOutDir: true,
      assetsDir: "assets",
      polyfillModulePreload: false,
      // main.ts и main.scss — два отдельных rollup-входа, оба маппятся в один "main.min.css"
      // через assetFileNames ниже; без этого CSS, импортированный из TS (напр. fancybox.css),
      // попадает в отдельный чанк, который никак не подключён в index.html.
      cssCodeSplit: false,
      rollupOptions: {
        input: {
          main: resolve(__dirname, "src/main.ts"),
          styles: resolve(__dirname, "src/main.scss"),
        },
        output: {
          entryFileNames: "assets/js/[name].min.js",
          chunkFileNames: "assets/js/chunks/[name].js",
          assetFileNames: (assetInfo: any) =>
            assetInfo.name?.endsWith(".css")
              ? "assets/css/main.min[extname]"
              : "assets/[name][extname]",
        },
        plugins: [
          {
            name: "fix-css-font-paths",
            generateBundle(_options, bundle) {
              for (const fileName in bundle) {
                const chunk = bundle[fileName];
                if (chunk.type === "asset" && fileName.endsWith(".css")) {
                  if (typeof chunk.source === "string") {
                    chunk.source = chunk.source.replace(/url\(assets\//g, "url(../assets/");
                  }
                }
              }
            },
          },
        ],
      },
    },
    css: {
      devSourcemap: true,
      preprocessorOptions: {
        scss: {
          // Скрываем уведомления об устаревающих функциях
          silenceDeprecations: ["import", "global-builtin", "color-functions"],
          // Делаем везде видимыми SCSS-переменные
          // $img-path — абсолютный путь до /public/assets/img с учётом BASE_URL,
          // чтобы url() в SCSS не резолвился относительно самого файла стилей
          // (см. PATH.img в locals — тот же путь, но для Pug).
          additionalData: `@import "@/shared/styles/variables.scss"; $img-path: "${BASE_URL}/assets/img";`,
        },
      },
      postcss: {
        plugins: IS_DEV
          ? []
          : [
              purgecss({
                content: [
                  "./src/**/*.html",
                  "./src/**/*.pug",
                  "./src/**/*.ts",
                  "./src/**/*.tsx",
                  "./src/**/*.js",
                  "./src/**/*.jsx",
                ],
                safelist: {
                  // Сохраняем динамические классы и состояния
                  standard: [/^swiper/, /^is-/, /^has-/, /^active/, /^show/, /^hide/, /^f-/, /^fancybox/],
                  deep: [/^swiper/, /^accordion/, /^f-/, /^fancybox/],
                  // Модификаторы theme/size собираются в миксинах через шаблонные строки
                  // (`btn--theme--${data.theme}`, см. +btn/+btn-element/+breadcrumbs/+page-header),
                  // поэтому итоговое имя класса нигде не встречается в исходниках буквально —
                  // PurgeCSS такие классы не находит и вырезает их в проде. Сохраняем по паттерну.
                  greedy: [/^data-/, /--theme--/, /--size--/],
                },
                // Удаляем неиспользуемые keyframes и CSS-переменные
                keyframes: true,
                variables: true,
                // Более агрессивная очистка для утилитарных классов
                defaultExtractor: (content: string) => {
                  const broadMatches = content.match(/[^<>"'`\s]*[^<>"'`\s:]/g) || [];
                  const innerMatches = content.match(/[^<>"'`\s.()]*[^<>"'`\s.():]/g) || [];
                  return [...broadMatches, ...innerMatches];
                },
              }),
            ],
      },
    },
    server: buildServer(),
  };
});
