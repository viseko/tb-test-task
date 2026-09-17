export default function throttle<T extends (...args: any[]) => any>(func: T, wait: number) {
  let lastCall = 0;

  return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    const now = Date.now();
    if (now - lastCall >= wait) {
      func.apply(this, args);
      lastCall = now;
    }
  };
}