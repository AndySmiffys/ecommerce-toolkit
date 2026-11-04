import type { PromotionRecord } from "../models/promotion";

/**
 * What the product page needs to show a discount's price: the plain rule, nothing else. `t` is "p" (a percentage, `v` in hundredths of a
 * percent: 2000 is 20%) or "a" (an amount off each item, `v` in minor units: 500 is £5, `u` its currency). `c` is the code the shopper
 * types, or "" for an automatic discount.
 */
export type PriceRule = { t: "p"; v: number; c: string } | { t: "a"; v: number; c: string; u: string };

/** Why a promotion has no price rule, or null when it has one. The Discounted price page lists these for automatic discounts, which change prices at checkout whether or not they can be shown. */
export function priceProblem(promotion: PromotionRecord): string | null {
  const reduction = promotion.shopify.general.reduction;
  if (promotion.type !== "Product" && promotion.type !== "Order") return "Buy X get Y and free shipping discounts do not change a product's price.";
  if (!promotion.shopify.customers.appliesToAllCustomers) return "It is limited to certain customers, so the price differs by shopper.";
  const { minimumSubtotal, minimumQuantity } = promotion.shopify.conditions;
  if (minimumSubtotal || minimumQuantity) return "It needs a minimum spend or quantity, so the price depends on the cart.";
  if (!reduction) return "Its value could not be read.";
  if (reduction.kind === "percentage") return reduction.percentage > 0 && reduction.percentage <= 1 ? null : "Its percentage is not between 0 and 100.";
  if (promotion.type !== "Product" || !reduction.perItem) return "It takes an amount off the whole order, which is spread over what is in the cart.";
  return reduction.amount > 0 ? null : "Its amount could not be read.";
}

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

const shortId = (id: string) => id.split("/").pop()!;

/**
 * One promotion as the Discounted price block reads it. Every automatic discount that can be shown is here, whether or not it is enabled for
 * the website, because Shopify applies it in the cart either way. A code promotion is here only when it is enabled for the website (the shop
 * advertises it), in priority order, even when it has no rule: it still decides which code the block speaks of, so a code the banner is
 * not about is never shown instead. `k` is its kind (P product, O order) and `cp`/`co` whether it combines with product and order discounts.
 */
export type PriceEntry = {
  id: string;
  starts: number;
  ends: number;
  all: boolean;
  products: string[];
  collections: string[];
  variants: Array<{ id: string; product: string }>;
  /** The code, or "" for an automatic discount. */
  c: string;
  price?: { t: "p"; v: number } | { t: "a"; v: number; u: string };
  k: "P" | "O";
  cp: boolean;
  co: boolean;
};

/**
 * The entry for the price block, or null when there is nothing true to say. `complete` is whether Shopify gave the whole list of products the
 * discount covers: without it a scoped discount is never claimed for a product it may not cover.
 */
export function priceEntryFor(promotion: PromotionRecord, complete = true, now = Date.now()): PriceEntry | null {
  if (promotion.type !== "Product" && promotion.type !== "Order") return null;
  if (!["ACTIVE", "SCHEDULED"].includes(promotion.status) || (promotion.endsAt && Date.parse(promotion.endsAt) <= now)) return null;
  if (!promotion.shopify.customers.appliesToAllCustomers) return null;
  const scope = promotion.shopify.products;
  const all = promotion.type === "Order" || scope.allProducts;
  if (!all && !complete) return null;
  const isCode = promotion.method === "Code";
  // A code is only spoken of when the shop has advertised it, and only when there is one code to speak of.
  if (isCode && (!promotion.settings.websiteEnabled || !promotion.code)) return null;
  const rule = priceRuleFor(promotion);
  if (!isCode && !rule) return null;
  const price: PriceEntry["price"] = !rule ? undefined : rule.t === "p" ? { t: "p", v: rule.v } : { t: "a", v: rule.v, u: rule.u };
  const combines = promotion.shopify.combinations;
  return {
    id: promotion.id,
    starts: promotion.startsAt ? Math.floor(Date.parse(promotion.startsAt) / 1000) : 0,
    ends: promotion.endsAt ? Math.floor(Date.parse(promotion.endsAt) / 1000) : 0,
    all,
    products: scope.products.map(p => shortId(p.id)),
    collections: scope.collections.map(c => shortId(c.id)),
    variants: scope.variants.map(v => ({ id: shortId(v.id), product: v.productId ? shortId(v.productId) : "" })),
    c: isCode ? promotion.code! : "",
    ...(price ? { price } : {}),
    k: promotion.type === "Order" ? "O" : "P",
    cp: Boolean(combines.productDiscounts),
    co: Boolean(combines.orderDiscounts),
  };
}

/**
 * One automatic discount as a product card reads it (the card script works out each card's price in the browser from the page's own data, so
 * nothing is asked of the app). Cards are matched by product, and a card shows the first variant's price, so only discounts that take
 * the same rule off every variant of the products are given: an automatic discount with a price rule, for everything or for products
 * (`resolved` is the products found in its collections). A discount limited to certain variants is left out rather than claimed for a
 * product it may not cover. Codes are never shown on a card: the shopper has not entered one.
 */
export type CardPriceEntry = { k: string; s: number; e: number; a: 0 | 1; i: string; t: "p" | "a"; v: number; u?: string };

export function cardPriceFor(entry: PriceEntry, resolved: string[] | null, encode: (ids: string[]) => string): CardPriceEntry | null {
  if (entry.c || !entry.price) return null;
  const base = { k: shortId(entry.id), s: entry.starts, e: entry.ends, t: entry.price.t, v: entry.price.v, ...(entry.price.t === "a" ? { u: entry.price.u } : {}) };
  if (entry.all) return { ...base, a: 1, i: "" };
  if (entry.variants.length) return null;
  const products = [...entry.products, ...(resolved ?? [])];
  return products.length ? { ...base, a: 0, i: encode(products) } : null;
}

/** Whether an entry covers products only through collections, so the publisher has to read their products. */
export function needsCollectionProducts(entry: PriceEntry): boolean {
  return !entry.c && Boolean(entry.price) && !entry.all && !entry.variants.length && !entry.products.length && entry.collections.length > 0;
}
