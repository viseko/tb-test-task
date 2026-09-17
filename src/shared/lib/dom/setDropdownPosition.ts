// Вычисление свободной позиции для всплывающих элементов

export default function setDropdownPosition(parent: HTMLElement, child: HTMLElement, offset?: number) {
  const rect = parent.getBoundingClientRect();
  const width = parent.offsetWidth;
  const height = parent.offsetHeight;
  const windowWidth = document.documentElement.clientWidth;
  const windowHeight = document.documentElement.clientHeight;
  const listHeight = child.offsetHeight;
  const listWidth = child.offsetWidth;

  const top = rect.top;
  const left = rect.left;
  const right = windowWidth - width - left;
  const bottom = windowHeight - top - height;

  if (left < (listWidth - width) / 2) {
    child.style.left = `calc(50% + ${(listWidth - width) / 2}px)`;
  } else if (right < (listWidth - width) / 2) {
    child.style.left = `calc(50% - ${(listWidth - width) / 2}px)`;
  } else {
    child.style.left = "";
  }

  if (bottom < listHeight && top > listHeight) {
    child.style.bottom = `calc(100% + ${offset}px)`;
    child.style.top = "unset";
  } else {
    child.style.bottom = "";
    child.style.top = "";
  }
}