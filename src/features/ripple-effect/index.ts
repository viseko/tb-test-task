import { install } from "@/app/App";

install("[data-ripple-effect]", (elem) => {
  const { overflow, position } = getComputedStyle(elem);

  if (overflow === "visible") {
    elem.style.overflow = "hidden";
  }

  if (position === "static") {
    elem.style.position = "relative";
  }

  elem.addEventListener("mouseenter", function (event) {
    const ripple = document.createElement("span");
    ripple.classList.add("ripple");
    const rect = elem.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    ripple.style.left = `${x - ripple.offsetWidth / 2}px`;
    ripple.style.top = `${y - ripple.offsetHeight / 2}px`;
    elem.appendChild(ripple);
    setTimeout(() => {
      ripple.remove();
    }, 1000);
  });
});
