import script from "../../../extensions/promotion-engine/assets/discounted-price.js?raw";

/**
 * A rule as the product page gets it (see promotions/design/priceRule.ts): a percentage ("p"), an amount off each item ("a"), or a code
 * promotion with no price ("n"). `k` is its kind (P product, O order), `cp` and `co` whether it combines with product and order discounts, and
 * `vs` names the variants it covers when it is not all of them.
 */
export type PriceRuleInput = ({ t: "p"; v: number; c: string } | { t: "a"; v: number; c: string; u: string } | { t: "n"; c: string }) & { k?: "P" | "O"; cp?: number | boolean; co?: number | boolean; vs?: string[] };
export type PriceVariant = { id: number; price: number; compare_at_price?: number | null };
export type PriceState = { now: number; was: number; saving: number; percent: number; auto: { price: number; saving: number; percent: number } | null; code: { price: number; name: string; saving: number; percent: number } | null };

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
