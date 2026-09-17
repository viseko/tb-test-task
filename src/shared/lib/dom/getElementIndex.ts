// Возвращает индекс выбранного элемента относительно его родителя

export default function getElementIndex(element: HTMLElement): number {
  const parent = element.parentElement;
  if (!parent) return -1;

  return Array.prototype.indexOf.call(parent.children, element);
}