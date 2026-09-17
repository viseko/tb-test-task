import type { Plugin } from "vite";

/**
 * Заменяет "@<ключ>/" в готовой разметке на значение из aliases (например, из PATH:
 * "@img/" → PATH.img, "@fonts/" → PATH.fonts и т.д.) — без хардкода конкретных алиасов,
 * набор берётся из переданного объекта целиком.
 * Работает через transformIndexHtml — на dev и при сборке, для любого места в HTML
 * (атрибуты, инлайн-скрипты/стили), а не только внутри конкретных миксинов.
 */
export function pathAliasPlugin(aliases: Record<string, string>): Plugin {
  const entries = Object.entries(aliases);

  return {
    name: "path-alias",
    transformIndexHtml(html) {
      return entries.reduce(
        (result, [alias, value]) => result.replaceAll(`@${alias}/`, `${value}/`),
        html
      );
    },
  };
}
