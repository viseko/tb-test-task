const STOCK_MODIFIERS = ["_average", "_few", "_none"];

export default class ProductCard {
  private readonly inputs: HTMLInputElement[];
  private readonly priceElem: HTMLElement | null;
  private readonly oldPriceElem: HTMLElement | null;
  private readonly discountElem: HTMLElement | null;
  private readonly vendorElem: HTMLElement | null;
  private readonly stockElem: HTMLElement | null;
  private readonly stockValueElem: HTMLElement | null;

  constructor(elem: HTMLElement) {
    this.inputs = [...elem.querySelectorAll<HTMLInputElement>(".product-card__packaging-input")];
    this.priceElem = elem.querySelector<HTMLElement>("[data-role='price']");
    this.oldPriceElem = elem.querySelector<HTMLElement>("[data-role='old-price']");
    this.discountElem = elem.querySelector<HTMLElement>("[data-role='discount']");
    this.vendorElem = elem.querySelector<HTMLElement>("[data-role='vendor']");
    this.stockElem = elem.querySelector<HTMLElement>("[data-role='stock-indicator']");
    this.stockValueElem = elem.querySelector<HTMLElement>("[data-role='stock']");

    this.inputs.forEach((input) => input.addEventListener("change", this.handleChange));
  }

  private handleChange = (event: Event): void => {
    this.update(event.currentTarget as HTMLInputElement);
  };

  private update(input: HTMLInputElement): void {
    const { price, oldPrice, discount, vendor, stock, stockLabel } = input.dataset;

    if (this.priceElem) this.priceElem.textContent = price ?? "";
    if (this.vendorElem) this.vendorElem.textContent = vendor ? `${vendor}` : "";

    if (this.oldPriceElem) {
      this.oldPriceElem.textContent = oldPrice ?? "";
      this.oldPriceElem.hidden = !oldPrice;
    }

    if (this.discountElem) {
      this.discountElem.textContent = discount ?? "";
      this.discountElem.hidden = !oldPrice || !discount;
    }

    if (this.stockValueElem) this.stockValueElem.textContent = stockLabel ?? "";

    if (this.stockElem) {
      this.stockElem.classList.remove(...STOCK_MODIFIERS);
      if (stock && stock !== "lot") this.stockElem.classList.add(`_${stock}`);
    }
  }

  destroy(): void {
    this.inputs.forEach((input) => input.removeEventListener("change", this.handleChange));
  }
}
