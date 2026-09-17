export default function animateCount(element: HTMLElement, duration = 1000) {
  const target = parseInt(element.textContent || "", 10);
  const startTime = performance.now();

  function updateCount(currentTime: number) {
    const elapsedTime = currentTime - startTime;
    const progress = Math.min(elapsedTime / duration, 1);
    const currentValue = Math.floor(progress * target);

    element.textContent = `${currentValue}`;

    if (progress < 1) {
      requestAnimationFrame(updateCount);
    }
  }

  requestAnimationFrame(updateCount);
}
