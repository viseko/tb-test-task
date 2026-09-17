import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";

// Директории, в которых будем искать компоненты
const rootDirs = ["src/shared/ui", "src/widgets"];
const IGNORE_DIRS = new Set(["themes", "sizes", "lib"]);

// -------------------------
// helpers
// -------------------------

function toPosix(p) {
  return p.replace(/\\/g, "/");
}

function ensureDotSlash(relPosixPath) {
  // Pug нормально работает и без ./, но так стабильнее и читабельнее
  if (relPosixPath.startsWith(".") || relPosixPath.startsWith("/")) return relPosixPath;
  return `./${relPosixPath}`;
}

function readFileSafe(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function writeFileIfChanged(filePath, nextContent) {
  const prev = readFileSafe(filePath);
  if (prev === nextContent) return false;
  fs.writeFileSync(filePath, nextContent, "utf8");
  return true;
}

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "", "utf8");
    console.log(chalk.green(`Created ${filePath}`));
  }
}

function listSubdirs(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !IGNORE_DIRS.has(name));
}

function walkDirs(rootDir, onDir) {
  // обход только директорий (без файлов)
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    onDir(current);

    const subdirs = listSubdirs(current);
    for (const name of subdirs) {
      stack.push(path.join(current, name));
    }
  }
}

function sortLinesAlpha(lines) {
  // Стабильная сортировка без учёта регистра
  return [...lines].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

// -------------------------
// import line builders
// -------------------------

function buildPugInclude(fromIndexFile, targetIndexPugFile) {
  // include <relative-to-index-dir>/<component>/index  (без .pug)
  const rel = toPosix(path.relative(path.dirname(fromIndexFile), targetIndexPugFile));
  const withoutExt = rel.replace(/\/index\.pug$/i, "/index");
  return `include ${ensureDotSlash(withoutExt)}`;
}

function buildScssImport(fromIndexFile, targetIndexScssFile) {
  // @import "<relative-to-index-dir>/<component>";  (без /_index.scss)
  const rel = toPosix(path.relative(path.dirname(fromIndexFile), targetIndexScssFile));
  const withoutIndex = rel.replace(/\/_index\.scss$/i, "");
  return `@import "${ensureDotSlash(withoutIndex)}";`;
}

// -------------------------
// file sync (the important part)
// -------------------------

const PUG_IMPORT_RE = /^\s*include\s+.+\s*$/;
const SCSS_IMPORT_RE = /^\s*@import\s+["'][^"']+["']\s*;\s*$/;

/**
 * Синхронизирует импортные строки в файле:
 * - сохраняет все строки, которые не являются импортами
 * - импортные строки заменяет на desiredImports (уникальные, отсортированные)
 */
function syncImportFile(filePath, desiredImports, kind) {
  if (!fs.existsSync(filePath)) return { changed: false, removed: 0, added: 0 };

  const raw = readFileSafe(filePath);
  const lines = raw.split(/\r?\n/);

  const importRe = kind === "pug" ? PUG_IMPORT_RE : SCSS_IMPORT_RE;

  const otherLines = [];
  const currentImports = [];

  for (const line of lines) {
    if (importRe.test(line)) currentImports.push(line.trim());
    else if (line.length > 0 || otherLines.length > 0) otherLines.push(line); // сохраняем структуру/пустые строки аккуратно
  }

  const desiredUniqueSorted = sortLinesAlpha(
    Array.from(new Set(desiredImports.map((s) => s.trim()))).filter(Boolean)
  );

  const currentSet = new Set(currentImports);
  const desiredSet = new Set(desiredUniqueSorted);

  let added = 0;
  let removed = 0;

  for (const d of desiredSet) if (!currentSet.has(d)) added++;
  for (const c of currentSet) if (!desiredSet.has(c)) removed++;

  // Собираем контент:
  // - otherLines (как есть)
  // - если есть и otherLines, и импорты — ставим пустую строку между
  // - затем блок импортов
  const out = [];
  // подчистим хвостовые пустые строки у otherLines, чтобы не плодить "дырки"
  while (otherLines.length && otherLines[otherLines.length - 1] === "") otherLines.pop();

  out.push(...otherLines);

  if (out.length && desiredUniqueSorted.length) out.push("");

  out.push(...desiredUniqueSorted);

  // Финальный newline
  const nextContent = out.join("\n") + "\n";

  const changed = writeFileIfChanged(filePath, nextContent);
  return { changed, added, removed };
}

// -------------------------
// main logic
// -------------------------

function updateImports() {
  console.log(chalk.yellow("Starting to update imports..."));

  // Для каждого index-файла соберём “идеальный” набор импортов
  const desiredPugImportsByFile = new Map();  // filePath -> Set<string>
  const desiredScssImportsByFile = new Map(); // filePath -> Set<string>

  function want(map, filePath, line) {
    if (!map.has(filePath)) map.set(filePath, new Set());
    map.get(filePath).add(line);
  }

  for (const rootDir of rootDirs) {
    const rootAbs = path.resolve(rootDir);

    walkDirs(rootDir, (dir) => {
      // 1) Проверяем детей
      const children = listSubdirs(dir);

      // 2) Определяем, нужны ли _index файлы (только если есть дети с соответствующими _index)
      let hasPugChildren = false;
      let hasScssChildren = false;
      
      for (const childName of children) {
        const childDir = path.join(dir, childName);
        
        const childPugIndex = path.join(childDir, "_index.pug");
        if (fs.existsSync(childPugIndex)) {
          hasPugChildren = true;
        }
        
        const childScssIndex = path.join(childDir, "_index.scss");
        if (fs.existsSync(childScssIndex)) {
          hasScssChildren = true;
        }
        
        if (hasPugChildren && hasScssChildren) break;
      }

      // 3) Создаём _index файлы только если есть дети
      const pugIndex = path.join(dir, "_index.pug");
      if (hasPugChildren) {
        ensureFileExists(pugIndex);
      }

      const scssIndex = path.join(dir, "_index.scss");
      if (hasScssChildren) {
        ensureFileExists(scssIndex);
      }

      // 4) Импорты детей в текущий index.*
      for (const childName of children) {
        const childDir = path.join(dir, childName);

        if (hasPugChildren) {
          const childPugIndex = path.join(childDir, "_index.pug");
          if (fs.existsSync(childPugIndex)) {
            want(desiredPugImportsByFile, pugIndex, buildPugInclude(pugIndex, childPugIndex));
          }
        }
        
        if (hasScssChildren) {
          const childScssIndex = path.join(childDir, "_index.scss");
          if (fs.existsSync(childScssIndex)) {
            want(desiredScssImportsByFile, scssIndex, buildScssImport(scssIndex, childScssIndex));
          }
        }
      }

      // 4) Импорт текущей директории в родителя (если родитель внутри rootDir)
      const parentDir = path.dirname(dir);
      if (path.resolve(parentDir).startsWith(rootAbs) && path.resolve(parentDir) !== rootAbs - "" /* noop */) {
        // условие выше не очень; сделаем корректно:
      }
    });

    // Перезапустим walkDirs с нормальной проверкой родителя внутри root
    walkDirs(rootDir, (dir) => {
      const rootAbs2 = path.resolve(rootDir);

      const parentDir = path.dirname(dir);
      if (!path.resolve(parentDir).startsWith(rootAbs2)) return;
      if (path.resolve(dir) === rootAbs2) return; // сам root не импортируется в родителя

      const childPugIndex = path.join(dir, "_index.pug");
      if (fs.existsSync(childPugIndex)) {
        const parentPugIndex = path.join(parentDir, "_index.pug");
        ensureFileExists(parentPugIndex);
        want(desiredPugImportsByFile, parentPugIndex, buildPugInclude(parentPugIndex, childPugIndex));
      }

      const childScssIndex = path.join(dir, "_index.scss");
      if (fs.existsSync(childScssIndex)) {
        const parentScssIndex = path.join(parentDir, "_index.scss");
        ensureFileExists(parentScssIndex);
        want(desiredScssImportsByFile, parentScssIndex, buildScssImport(parentScssIndex, childScssIndex));
      }
    });
  }

  // Теперь синхронизируем файлы по “идеальному” состоянию
  let changedFiles = 0;
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const [filePath, set] of desiredPugImportsByFile.entries()) {
    const res = syncImportFile(filePath, Array.from(set), "pug");
    if (res.changed) changedFiles++;
    totalAdded += res.added;
    totalRemoved += res.removed;
  }

  for (const [filePath, set] of desiredScssImportsByFile.entries()) {
    const res = syncImportFile(filePath, Array.from(set), "scss");
    if (res.changed) changedFiles++;
    totalAdded += res.added;
    totalRemoved += res.removed;
  }

  console.log(
    chalk.green(
      `Done. Changed files: ${changedFiles}, added imports: ${totalAdded}, removed imports: ${totalRemoved}`
    )
  );
}

updateImports();
