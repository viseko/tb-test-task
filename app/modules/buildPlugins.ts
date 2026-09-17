import { viteConvertPugInHtml } from "@mish.dev/vite-convert-pug-in-html";
import { pagesWatchPlugin } from "./pagesWatchPlugin";
import { pathAliasPlugin } from "./pathAliasPlugin";

export interface PluginsOptions {
  locals: Record<string, any>;
}

export default function buildPlugins(options: PluginsOptions) {
  return [
    viteConvertPugInHtml({
      pugOptions: { pretty: true },
      locals: options.locals,
    }),
    // Перезапускает dev-сервер при добавлении новой страницы в src/pages
    pagesWatchPlugin(),
    // Заменяет "@img/", "@fonts/" и т.д. в разметке на реальные пути из PATH
    pathAliasPlugin(options.locals.PATH),
  ];
}
