import path from "node:path";
import type { Plugin } from "vite";

/**
 * @mish.dev/vite-convert-pug-in-html строит карту URL → .pug один раз при старте dev-сервера
 * (глобом по src/pages в своём config()), поэтому новая страница не раздаётся, пока карта не
 * пересоберётся. Перезапускаем dev-сервер сами при появлении нового .pug в src/pages — это
 * заново прогоняет config() у всех плагинов и подхватывает страницу без ручного перезапуска.
 */
export function pagesWatchPlugin(): Plugin {
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  function isNewPageFile(relativePath: string): boolean {
    if (!relativePath.startsWith("pages/") || !relativePath.endsWith(".pug")) return false;
    return !(relativePath.split("/").pop() ?? "").startsWith("_");
  }

  return {
    name: "pages-watch-restart",
    apply: "serve",
    configureServer(server) {
      server.watcher.on("add", (file) => {
        const relativePath = path.relative(server.config.root, file).replace(/\\/g, "/");
        if (!isNewPageFile(relativePath)) return;

        if (restartTimer) clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          server.config.logger.info(
            `[pages-watch] Новая страница ${relativePath}, перезапуск dev-сервера…`,
            { timestamp: true }
          );
          server.restart();
        }, 150);
      });
    },
  };
}
