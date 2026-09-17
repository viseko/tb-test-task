import { Fancybox } from "@fancyapps/ui/dist/fancybox/fancybox.js";
import "@fancyapps/ui/dist/fancybox/fancybox.css";

Fancybox.bind("[data-fancybox]", {
  theme: "light",
  Carousel: {
    Toolbar: {
      display: {
        left: ["counter"],
        right: ["autoplay", "thumbs", "close"],
      },
    },
    Zoomable: {
      Panzoom: {
        maxScale: 1,
        clickAction: false,
        dblClickAction: false,
        wheelAction: false,
      },
    },
  },
});
