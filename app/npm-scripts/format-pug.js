import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import prettier from "prettier";
import * as pugPlugin from "@prettier/plugin-pug";
import pugLexer from "pug-lexer";

const SRC = path.resolve("./src");

// Маркер-обёртка, которой мы прячем от Prettier скобки, явно написанные автором.
// Выглядит как вызов функции — такие скобки Prettier никогда не считает "лишними"
// и не убирает, в отличие от обычных группирующих скобок вокруг выражения.
const KEEP_PARENS = "__KEEP_PARENS__";

/**
 * Находит индекс закрывающей скобки, парной открывающей скобке в позиции openIndex.
 * Понимает вложенность ( { [ ] } ) и строковые литералы ' " ` (с экранированием).
 */
function findMatchingBracket(text, openIndex) {
  let depth = 0;
  let quote = null;

  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];

    if (quote) {
      if (ch === "\\") {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
    } else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Оборачивает каждую группирующую пару скобок ( ... ), написанную автором в JS-выражении,
 * в фиктивный вызов __KEEP_PARENS__(...), чтобы Prettier не посчитал её "лишней" и не убрал.
 * Скобки вызова/индексации (сразу после идентификатора, ) или ]) не трогает — только рекурсивно
 * проходит внутрь них, чтобы найти вложенные группирующие скобки. Понимает строки/шаблонные литералы.
 */
function protectGroupingParens(text) {
  let result = "";
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === '"' || ch === "'" || ch === "`") {
      const start = i;
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === ch) {
          i++;
          break;
        }
        i++;
      }
      result += text.slice(start, i);
      continue;
    }

    if (ch === "(") {
      const prevMatch = result.match(/(\S)\s*$/);
      const prevChar = prevMatch ? prevMatch[1] : "";
      const isCallOrGroupAccess = /[\w$)\]]/.test(prevChar);

      const closeIdx = findMatchingBracket(text, i);
      if (closeIdx === -1) {
        result += ch;
        i++;
        continue;
      }

      const inner = protectGroupingParens(text.slice(i + 1, closeIdx));
      result += isCallOrGroupAccess ? `(${inner})` : `${KEEP_PARENS}(${inner})`;
      i = closeIdx + 1;
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}

/** Строит массив смещений начала каждой строки — для перевода {line, column} pug-lexer в индекс в тексте. */
function buildLineOffsets(text) {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function locToIndex(lineOffsets, loc) {
  return lineOffsets[loc.line - 1] + (loc.column - 1);
}

/**
 * Защищает авторские скобки внутри значений атрибутов (class=(...) и т.п.) и аргументов
 * вызовов миксинов (+name(...)) от удаления Prettier'ом. Работает на СЫРОМ исходнике,
 * до prettier.format — только так можно повлиять на то, что увидит встроенный JS-форматтер.
 * Границы значений атрибутов берёт из pug-lexer (а не из регулярок), чтобы гарантированно
 * не задеть обычный pug-текст/комментарии. Если лексер падает — молча возвращает текст как есть.
 */
function protectSourceParens(pugText) {
  let tokens;
  try {
    tokens = pugLexer(pugText, { filename: "format-pug-source" });
  } catch {
    return pugText;
  }

  const lineOffsets = buildLineOffsets(pugText);
  const spans = [];

  for (const token of tokens) {
    if (token.type !== "attribute" || !token.val || typeof token.val !== "string") continue;
    if (!token.loc) continue;

    const tokenStart = locToIndex(lineOffsets, token.loc.start);
    const tokenEnd = locToIndex(lineOffsets, token.loc.end);
    if (tokenStart < 0 || tokenEnd <= tokenStart || tokenEnd > pugText.length) continue;

    // loc покрывает весь "name=value" — найдём "=" внутри диапазона, чтобы взять только value.
    const eqIdx = pugText.indexOf("=", tokenStart);
    if (eqIdx === -1 || eqIdx >= tokenEnd) continue; // булевый атрибут без значения — нечего защищать

    const start = eqIdx + 1;
    const end = tokenEnd;
    if (end <= start) continue;

    spans.push({ start, end });
  }

  // Аргументы вызовов миксинов +name(...) — тем же сканером, что и в expandMixinObjectCalls.
  const callRe = /^([ \t]*)\+([A-Za-z][\w-]*)\(/gm;
  let match;
  while ((match = callRe.exec(pugText))) {
    const openParenIdx = match.index + match[0].length - 1;
    const closeParenIdx = findMatchingBracket(pugText, openParenIdx);
    if (closeParenIdx === -1) continue;
    spans.push({ start: openParenIdx + 1, end: closeParenIdx });
  }

  if (spans.length === 0) return pugText;

  spans.sort((a, b) => a.start - b.start);

  let result = "";
  let cursor = 0;
  for (const { start, end } of spans) {
    if (start < cursor) continue; // перекрывающиеся диапазоны — пропускаем на всякий случай
    result += pugText.slice(cursor, start) + protectGroupingParens(pugText.slice(start, end));
    cursor = end;
  }
  result += pugText.slice(cursor);

  return result;
}

/** Проверяет, что весь текст аргументов вызова — это ровно один объектный литерал `{ ... }`. */
function isSingleObjectArg(argsText) {
  const trimmed = argsText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;

  const start = argsText.indexOf("{");
  const end = findMatchingBracket(argsText, start);
  if (end === -1) return false;

  const before = argsText.slice(0, start).trim();
  const after = argsText.slice(end + 1).trim();
  const inner = argsText.slice(start + 1, end).trim();

  return before === "" && after === "" && inner !== "";
}

/** Форматирует объектный литерал через babel-парсер Prettier, принудительно разворачивая его построчно. */
async function expandObjectLiteral(objText, jsOptions) {
  const openIdx = objText.indexOf("{");
  const closeIdx = objText.lastIndexOf("}");

  const forced =
    objText.slice(0, openIdx + 1) +
    "\n" +
    objText.slice(openIdx + 1, closeIdx) +
    "\n" +
    objText.slice(closeIdx);

  const wrapped = `x(${forced});`;
  const formatted = await prettier.format(wrapped, {
    ...jsOptions,
    parser: "babel",
  });

  const body = formatted.trim();
  const withoutPrefix = body.slice(2); // убрать "x("
  const withoutSuffix = withoutPrefix.endsWith(");")
    ? withoutPrefix.slice(0, -2)
    : withoutPrefix.replace(/\)$/, "");

  return withoutSuffix;
}

/** Разворачивает объектные аргументы во всех вызовах миксинов `+name({ ... })` на новые строки. */
async function expandMixinObjectCalls(pugText, jsOptions) {
  const callRe = /^([ \t]*)\+([A-Za-z][\w-]*)\(/gm;

  const replacements = [];
  let match;

  while ((match = callRe.exec(pugText))) {
    const indent = match[1];
    const openParenIdx = match.index + match[0].length - 1;
    const closeParenIdx = findMatchingBracket(pugText, openParenIdx);
    if (closeParenIdx === -1) continue;

    const argsText = pugText.slice(openParenIdx + 1, closeParenIdx);
    if (!isSingleObjectArg(argsText)) continue;

    const expanded = await expandObjectLiteral(argsText.trim(), jsOptions);
    const lines = expanded.split("\n");
    const rebuilt =
      lines[0] +
      "\n" +
      lines
        .slice(1, -1)
        .map((line) => indent + line)
        .join("\n") +
      "\n" +
      indent +
      lines[lines.length - 1];

    replacements.push({ start: openParenIdx + 1, end: closeParenIdx, text: rebuilt });
  }

  if (replacements.length === 0) return pugText;

  let result = "";
  let cursor = 0;
  for (const { start, end, text } of replacements) {
    result += pugText.slice(cursor, start) + text;
    cursor = end;
  }
  result += pugText.slice(cursor);

  return result;
}

/** Форматирует один .pug файл: сначала общий проход prettier-pug, затем разворот объектных аргументов. */
export async function formatPugFile(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  // Нормализуем перевод строк заранее: pug-lexer считает {line, column} по \n,
  // а prettier сам приведёт всё к LF согласно .prettierrc (endOfLine: "lf").
  const normalized = original.replace(/\r\n/g, "\n");
  const config = (await prettier.resolveConfig(filePath)) || {};

  const protectedSource = protectSourceParens(normalized);

  const pugFormatted = await prettier.format(protectedSource, {
    ...config,
    parser: "pug",
    plugins: [pugPlugin],
    filepath: filePath,
  });

  const jsOptions = { ...config, plugins: [] };
  delete jsOptions.overrides;

  const expanded = await expandMixinObjectCalls(pugFormatted, jsOptions);
  const result = expanded.split(`${KEEP_PARENS}(`).join("(");

  return { original, result, changed: result !== original };
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walk(fullPath));
    } else if (entry.name.endsWith(".pug")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const fileArgs = args.filter((a) => a !== "--check");

  const files = fileArgs.length > 0 ? fileArgs.map((f) => path.resolve(f)) : walk(SRC);

  let hasChanges = false;

  for (const file of files) {
    const { result, changed } = await formatPugFile(file);

    if (changed) {
      hasChanges = true;
      if (checkOnly) {
        console.log(`[format:pug] would reformat: ${path.relative(process.cwd(), file)}`);
      } else {
        fs.writeFileSync(file, result, "utf8");
        console.log(`[format:pug] reformatted: ${path.relative(process.cwd(), file)}`);
      }
    }
  }

  if (checkOnly && hasChanges) {
    process.exitCode = 1;
  }
}

// Запускать main() только когда файл вызван напрямую как CLI (node format-pug.js),
// а не при импорте formatPugFile() из другого модуля/скрипта.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
