// Sending promotions to Google Merchant Center. Google collects a promotions file on a schedule; this turns a Shopify
// discount into one line of that file, or says in plain words why it cannot be sent yet. The rules are Google's
// (https://support.google.com/merchants/answer/2906014): every promotion needs a start and an end date and may run for at
// most 183 days; only promotions for all customers can be shown; a code is one shared code of up to 20 characters; a
// title is up to 60 characters; a promotion can list up to 1,000 product IDs (here, SKUs).
import type { ShopifyDiscountNode } from "../types/discount";

export const googleLimits = { title: 60, code: 20, days: 183, skus: 1000 } as const;

export const googleColumns = [
  "promotion_id", "product_applicability", "offer_type", "long_title", "promotion_effective_dates", "redemption_channel",
  "generic_redemption_code", "coupon_value_type", "percent_off", "money_off_amount", "minimum_purchase_amount", "buy_this_quantity", "item_id",
] as const;
export type GoogleColumn = (typeof googleColumns)[number];
export type GoogleRow = Record<GoogleColumn, string>;
export type GoogleCheck = { row: GoogleRow | null; issues: string[] };

/** The ID Google knows a promotion by: stable, at most 50 characters, no spaces or symbols. */
export function googlePromotionId(discountId: string): string {
  const number = /(\d+)$/.exec(discountId)?.[1];
  if (!number) throw new Error("Invalid discount ID.");
  return `shopify-${number}`;
}

/** What a discount applies to, read from the node: everything, or lists of products, variants and collections. */
export type DiscountScope = { allItems: boolean; productIds: string[]; variantIds: string[]; collectionIds: string[]; complete: boolean };

export function scopeOf(node: ShopifyDiscountNode): DiscountScope {
  const items = node.discount.customerGets?.items;
  // A discount with no item list (free shipping, or an order discount) applies to the whole order.
  if (!items || items.allItems) return { allItems: true, productIds: [], variantIds: [], collectionIds: [], complete: true };
  const incomplete = [items.products, items.productVariants, items.collections].some(list => list?.pageInfo?.hasNextPage);
  return {
    allItems: false,
    productIds: (items.products?.nodes ?? []).map(product => product.id),
    variantIds: (items.productVariants?.nodes ?? []).map(variant => variant.id),
    collectionIds: (items.collections?.nodes ?? []).map(collection => collection.id),
    complete: !incomplete,
  };
}

/** The SKUs behind a scope, worked out by the caller (null when the discount covers everything). */
export type ScopeSkus = { skus: string[]; tooMany: boolean } | null;

const asGoogleDate = (iso: string) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, "+00:00");

/**
 * Turns one Shopify discount into a line of the Google promotions file. `skus` is the product list when the discount
 * covers specific products, or null when it covers everything. Anything Google cannot take is returned as a sentence
 * each, with no row, so the page can say what to change.
 */
export function checkGooglePromotion(node: ShopifyDiscountNode, options: { title?: string; skus: ScopeSkus; now: Date; currency?: string }): GoogleCheck {
  const issues: string[] = [];
  const discount = node.discount;
  const typename = String(discount.__typename ?? "");
  const isCode = typename.startsWith("DiscountCode");
  const isShipping = typename.includes("FreeShipping");
  const isBxgy = typename.includes("Bxgy");
  const isBasic = typename.includes("Basic");

  if (isBxgy) issues.push("Buy X get Y promotions can’t be sent to Google yet.");
  else if (!isBasic && !isShipping) issues.push("This kind of discount can’t be sent to Google.");

  // Dates: Google needs both, within 183 days, and not already over.
  const starts = discount.startsAt ? new Date(discount.startsAt) : null;
  const ends = discount.endsAt ? new Date(discount.endsAt) : null;
  if (!starts || Number.isNaN(starts.getTime())) issues.push("It has no start date. Google needs a start and an end date.");
  if (!ends || Number.isNaN(ends.getTime())) issues.push("It has no end date. Google needs one, and no more than 183 days after the start.");
  if (starts && ends && !Number.isNaN(starts.getTime()) && !Number.isNaN(ends.getTime())) {
    if (ends <= options.now) issues.push("It has ended.");
    else if (ends.getTime() - starts.getTime() > googleLimits.days * 86400000) issues.push(`It runs for more than ${googleLimits.days} days. Google allows up to ${googleLimits.days}, so shorten the dates in Shopify.`);
  }

  // Who it is for.
  const context = discount.context;
  if (context && context.__typename !== "DiscountBuyerSelectionAll") issues.push("It is only for certain customers. Google can only show promotions for all customers.");

  // The code.
  let code = "";
  if (isCode) {
    const count = discount.codesCount?.count ?? discount.codes?.nodes.length ?? 0;
    code = discount.codes?.nodes[0]?.code ?? "";
    if (count > 1) issues.push("It has a list of individual codes. Google needs one shared code.");
    else if (!code) issues.push("It has no code.");
    else if (code.length > googleLimits.code) issues.push(`Its code is ${code.length} characters. Google allows up to ${googleLimits.code}.`);
  } else if (isShipping) issues.push("Free shipping needs a code for Google. This one is automatic.");

  // The title.
  const title = (options.title?.trim() || discount.title || "").trim();
  if (!title) issues.push("It has no title.");
  else if (title.length > googleLimits.title) issues.push(`The title is ${title.length} characters. Google allows up to ${googleLimits.title}, so give it a shorter Google title.`);

  // What it takes off.
  let currency = options.currency ?? "GBP";
  let couponType = "";
  let percentOff = "";
  let moneyOff = "";
  if (isShipping) couponType = "free_shipping_standard";
  else if (isBasic) {
    const value = discount.customerGets?.value;
    if (value?.__typename === "DiscountPercentage" && typeof value.percentage === "number") {
      const percent = Math.round(value.percentage * 1e6) / 1e4;
      if (!Number.isInteger(percent)) issues.push("The percentage isn’t a whole number. Google needs one.");
      else if (percent < 1 || percent > 99) issues.push("Google can only show percentages from 1 to 99.");
      else { couponType = "percent_off"; percentOff = String(percent); }
    } else if (value?.__typename === "DiscountAmount" && value.amount) {
      couponType = "money_off";
      currency = value.amount.currencyCode || currency;
      moneyOff = `${Number(value.amount.amount).toFixed(2)} ${currency}`;
    } else issues.push("It takes off something Google can’t describe.");
  }

  // The smallest order.
  let minimumAmount = "";
  let minimumQuantity = "";
  const minimum = discount.minimumRequirement;
  if (minimum?.__typename === "DiscountMinimumSubtotal" && minimum.greaterThanOrEqualToSubtotal) {
    currency = minimum.greaterThanOrEqualToSubtotal.currencyCode || currency;
    minimumAmount = `${Number(minimum.greaterThanOrEqualToSubtotal.amount).toFixed(2)} ${currency}`;
  } else if (minimum?.__typename === "DiscountMinimumQuantity" && minimum.greaterThanOrEqualToQuantity) {
    minimumQuantity = String(Number(minimum.greaterThanOrEqualToQuantity));
  }

  // The products.
  let applicability = "all_products";
  let itemIds = "";
  if (options.skus) {
    applicability = "specific_products";
    if (options.skus.tooMany) issues.push(`It covers more than ${googleLimits.skus} products. Google can list up to ${googleLimits.skus}.`);
    else if (!options.skus.skus.length) issues.push("None of its products have a SKU.");
    else itemIds = options.skus.skus.join(",");
  }

  if (issues.length || !starts || !ends) return { row: null, issues };
  return {
    issues: [],
    row: {
      promotion_id: googlePromotionId(node.id),
      product_applicability: applicability,
      offer_type: isCode ? "generic_code" : "no_code",
      long_title: title,
      promotion_effective_dates: `${asGoogleDate(starts.toISOString())}/${asGoogleDate(ends.toISOString())}`,
      redemption_channel: "online",
      generic_redemption_code: code,
      coupon_value_type: couponType,
      percent_off: percentOff,
      money_off_amount: moneyOff,
      minimum_purchase_amount: minimumAmount,
      buy_this_quantity: minimumQuantity,
      item_id: itemIds,
    },
  };
}

/** The tab-delimited file Merchant Center reads: a header line, then one line per promotion. Tabs and line breaks in text are made spaces. */
export function googleFeed(rows: GoogleRow[]): string {
  const clean = (value: string) => value.replace(/[\t\r\n]+/g, " ").trim();
  return [googleColumns.join("\t"), ...rows.map(row => googleColumns.map(column => clean(row[column])).join("\t"))].join("\n") + "\n";
}
