// Добавление маски к полю ввода
// * inputElem - <input>-элемент
// * mask - маска, где _ заменяется на цифру
// * swallow - массив префиксов, которые "съедаем" при вводе/вставке (напр. ["+7","7","8"])

type MaskInputElement = HTMLInputElement | HTMLTextAreaElement;
type MaskEvent = Event | { type: string; target: MaskInputElement };

export default function addMask(
  inputElem: MaskInputElement,
  mask: string,
  swallow: string[] | null = null
): (event: MaskEvent) => void {
  const maskDigits = mask.replace(/\D/g, ""); // фиксированные цифры маски (для "+7 ___" это "7")
  const capacity = (mask.match(/_/g) ?? []).length; // сколько цифр в маске

  const swallowDigits = Array.isArray(swallow)
    ? swallow
        .map((s) => String(s || "").replace(/\D/g, "")) // "+7" -> "7"
        .filter(Boolean)
        // сначала длинные, потом короткие (на случай "+375" и т.п.)
        .sort((a, b) => b.length - a.length)
    : [];

  function formatByMask(digits: string): string {
    let newValue = mask;
    let i = 0;

    while (newValue.includes("_") && i < digits.length) {
      newValue = newValue.replace(/_/, digits[i++]);
    }

    // отрезаем хвост маски после последней вставленной цифры
    const slicePos = newValue.search(/\d(?=\D*$)/);
    return slicePos === -1 ? "" : newValue.slice(0, slicePos + 1);
  }

  function eventHandler(event: MaskEvent): void {
    const type = event.type;
    const input = event.target as MaskInputElement;
    const value = input.value;

    const valueDigitsAll = value.replace(/\D/g, "");

    // Focus
    if (type === "focus" && value === "") {
      const sliceIndex = mask.indexOf("_");
      input.value = mask.slice(0, sliceIndex);
      return;
    }

    // Blur
    if (type === "blur" && maskDigits === valueDigitsAll) {
      input.value = "";
      return;
    }

    // Input
    if (type === "input") {
      // 1) Берём все цифры из value
      let digits = valueDigitsAll;

      // 2) Если value начинается с фиксированных цифр маски — убираем их
      //    (для "+7 ___" это убирает первую "7" и оставляет "национальные" цифры)
      if (maskDigits && digits.startsWith(maskDigits)) {
        digits = digits.slice(maskDigits.length);
      }

      // 3) Если цифр больше, чем ёмкость маски — делаем "съедание"
      //    а) сначала попробуем проглотить один из swallow-префиксов (если задан)
      //    б) если всё ещё переполнение — оставляем последние capacity цифр (сдвиг)
      if (capacity > 0 && digits.length > capacity) {
        if (swallowDigits.length) {
          const found = swallowDigits.find((pref) => digits.startsWith(pref));
          if (found) {
            digits = digits.slice(found.length);
          }
        }
      }

      // 4) Если ничего не введено — показываем префикс маски
      if (digits.length === 0) {
        const sliceIndex = mask.indexOf("_");
        input.value = mask.slice(0, sliceIndex);
        return;
      }

      // 5) Форматируем по маске
      input.value = formatByMask(digits);
    }
  }

  // Применяем маску к начальному значению, если оно есть
  if (inputElem.value) {
    eventHandler({ type: "input", target: inputElem });
  }

  // Привязка обработчиков
  (["focus", "blur", "input"] as const).forEach((ev) => {
    inputElem.addEventListener(ev, eventHandler);
  });

  return eventHandler;
}
