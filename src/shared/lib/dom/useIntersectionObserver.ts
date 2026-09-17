interface Options {
  onVisible?: (elem: HTMLElement) => void;
  onHide?: (elem: HTMLElement) => void;
  repeatable?: boolean;
  threshold?: number;
}

export default function useIntersectionObserver(elem: HTMLElement, options: Options) {
  const onVisible = options.onVisible;
  const onHide = options.onHide;
  const repeatable = options.repeatable ?? true;
  const threshold = options.threshold ?? 0.2;

  let fired = false;

  const callback = function (entries: IntersectionObserverEntry[]) {
    const isIntersecting = entries[0].isIntersecting;

    if (isIntersecting) {
      if (!repeatable && fired) return;
      onVisible?.(elem);
      fired = true;
    } else {
      onHide?.(elem);
    }
  };

  const observer = new IntersectionObserver(callback, {
    rootMargin: "0px",
    threshold: threshold,
  });

  observer.observe(elem);

  return {
    disconnect: () => observer.disconnect(),
  };
}
