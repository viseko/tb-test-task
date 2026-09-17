import type Swiper from "swiper";

export default function setHeightProperty(elem: HTMLElement, correction = 0) {
  elem.style.setProperty("--height", "0px");
  const children = [...elem.children] as HTMLElement[];
  const height = children.reduce((sum, item) => sum + item.offsetHeight, 0);
  elem.style.setProperty("--height", height + correction + "px");

  // * доп. корректировка если внутри слайдера
  setTimeout(() => {
    const swiperElem = elem.closest(".swiper") as (HTMLElement & { swiper?: Swiper }) | null;
    swiperElem?.swiper?.updateSize();
  }, 100);
}
