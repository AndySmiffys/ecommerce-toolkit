import type { PromotionRecord } from "../models/promotion";

/**
 * What the product page needs to show a discount's price: the plain rule, nothing else. `t` is "p" (a percentage, `v` in hundredths of a
 * percent: 2000 is 20%) or "a" (an amount off each item, `v` in minor units: 500 is £5, `u` its currency). `c` is the code the shopper
 * types, or "" for an automatic discount.
 */
export type PriceRule = { t: "p"; v: number; c: string } | { t: "a"; v: number; c: string; u: string };

/**
 * The price rule for a promotion, or null when its effect on one product's price cannot be told from the product alone. Shown: a percentage
 * off products or the whole order, and an amount off each item of specific products. Not shown: an amount off the whole order (it is spread
 * over what is in the cart), buy X get Y and free shipping, and anything with a minimum spend or quantity (the price depends on the cart).
 * Checkout stays authoritative for the rest: customers, usage limits and combinations.
 */
export function priceRuleFor(promotion: PromotionRecord): PriceRule | null {
  const reduction = promotion.shopify.general.reduction;
  if (!reduction || (promotion.type !== "Product" && promotion.type !== "Order")) return null;
  const { minimumSubtotal, minimumQuantity } = promotion.shopify.conditions;
  if (minimumSubtotal || minimumQuantity) return null;
  const code = promotion.method === "Code" ? promotion.code : "";
  if (code === null || code === undefined) return null;
  if (reduction.kind === "percentage") {
    const v = Math.round(reduction.percentage * 10000);
    return v > 0 && v <= 10000 ? { t: "p", v, c: code } : null;
  }
  if (promotion.type !== "Product" || !reduction.perItem) return null;
  const v = Math.round(reduction.amount * 100);
  return v > 0 ? { t: "a", v, c: code, u: reduction.currency } : null;
}
