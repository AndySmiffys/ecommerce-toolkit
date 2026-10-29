import script from "../../../extensions/promotion-engine/assets/discounted-price.js?raw";

/** A rule as the product page gets it (see promotions/design/priceRule.ts), with `vs` naming the variants it covers when it is not all of them. */
export type PriceRuleInput = { t: "p"; v: number; c: string; vs?: string[] } | { t: "a"; v: number; c: string; u: string; vs?: string[] };
export type PriceVariant = { id: number; price: number; compare_at_price?: number | null };
export type PriceState = { now: number; was: number; saving: number; percent: number; code: { price: number; name: string; saving: number; percent: number } | null };

type Logic = {
  priceState(variant: PriceVariant, rules: PriceRuleInput[], currency: string): PriceState;
  formatMoney(minor: number, format: string): string;
  fillText(template: string, values: Record<string, string>): string;
};

/**
 * The storefront's own price logic, run here so the preview in the app can never disagree with the shop. The file is a plain browser script
 * that also exports its functions when it finds a CommonJS `module`.
 */
const holder: { exports: Partial<Logic> } = { exports: {} };
// HTMLElement and customElements are hidden from it on purpose: the script then only exports its functions and never defines the storefront element here.
new Function("module", "exports", "HTMLElement", "customElements", script)(holder, holder.exports, undefined, undefined);
export const priceLogic = holder.exports as Logic;
