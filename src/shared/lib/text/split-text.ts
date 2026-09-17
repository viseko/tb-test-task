type SplitMethods = "letters" | "words" | "lines";

export function splitText(elem: HTMLElement, method: SplitMethods) {
  const nodes = [...elem.childNodes];
  elem.textContent = "";

  nodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (!text) return;

      if (method === "letters") {
        const words = text.split(/(\s+)/); // сохраняем пробелы

        words.forEach((word) => {
          if (/\s+/.test(word)) {
            elem.appendChild(document.createTextNode(word));
          } else {
            const wordWrapper = document.createElement("span");
            wordWrapper.classList.add("text-word");

            // Обрабатываем &shy;
            const letterParts = word.split(/(\u00AD)/); // \u00AD — это &shy;

            letterParts.forEach((segment) => {
              if (segment === "\u00AD") {
                wordWrapper.appendChild(document.createTextNode("\u00AD"));
              } else {
                segment.split("").forEach((char) => {
                  const span = document.createElement("span");
                  span.classList.add("text-part");
                  span.textContent = char;
                  wordWrapper.appendChild(span);
                });
              }
            });

            elem.appendChild(wordWrapper);
          }
        });
      } else if (method === "words") {
        const parts = text.split(/(\s+)/); // сохраняем пробелы
        parts.forEach((part) => {
          if (/\s+/.test(part)) {
            elem.appendChild(document.createTextNode(part));
          } else {
            const span = document.createElement("span");
            span.classList.add("text-part");
            span.textContent = part;
            elem.appendChild(span);
          }
        });
      }
    } else {
      // Оставляем <br> и другие узлы как есть
      elem.appendChild(node.cloneNode(true));
    }
  });
}

export function splitByVisualLines(elem: HTMLElement) {
  const textNodes: ChildNode[] = [];

  // Собираем все текстовые ноды (включая те, что после <br>)
  function collectTextNodes(node: ChildNode) {
    if (node.nodeType === Node.TEXT_NODE) {
      textNodes.push(node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      node.childNodes.forEach(collectTextNodes);
    }
  }

  collectTextNodes(elem);

  // Оборачиваем каждую букву временно в span, чтобы прочитать строки
  const letterSpans: HTMLSpanElement[] = [];

  textNodes.forEach((node) => {
    const chars = node.textContent?.split("") ?? [];

    chars.forEach((char) => {
      const span = document.createElement("span");
      span.textContent = char;
      span.style.display = "inline";
      span.classList.add("__line-measure");
      letterSpans.push(span);
      elem.insertBefore(span, node);
    });
    node.remove(); // удаляем оригинальный текст
  });

  // Группировка по визуальным строкам
  const lines = [];
  let currentLine: HTMLSpanElement[] = [];
  let lastTop: null | number = null;

  letterSpans.forEach((span) => {
    const { top } = span.getBoundingClientRect();

    if (lastTop === null || Math.abs(top - lastTop) < 1) {
      currentLine.push(span);
    } else {
      lines.push([...currentLine]);
      currentLine = [span];
    }

    lastTop = top;
  });

  if (currentLine.length) {
    lines.push(currentLine);
  }

  // Перестраиваем DOM
  elem.innerHTML = "";

  lines.forEach((line) => {
    const div = document.createElement("div");
    div.classList.add("text-line");

    line.forEach((span: HTMLSpanElement) => {
      div.textContent += span.textContent || "";
    });

    elem.appendChild(div);
  });
}
