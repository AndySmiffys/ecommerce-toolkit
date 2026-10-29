import { getDiscount, type ShopifyAdminClient } from "./discount.server";
import { listAutomaticDiscountIds } from "./automaticDiscounts.server";
import { completeDiscountScope } from "./discountScope.server";
import { getLatestPromotionSettings } from "./promotionSettings.server";
import { mapDiscountToPromotion } from "../mappers/promotionMapper";
import { priceEntryFor, priceProblem, type PriceEntry } from "../design/priceRule";
import { promotionDiscountId } from "../design/discountIdentity";
import { syncStorefrontSnapshot } from "./storefrontSnapshot.server";

export type NotShown = { id: string; routeId: string; title: string; reason: string };

/**
 * The active automatic discounts that change prices at checkout but cannot be written into a product's price (a minimum spend, an amount
 * off the whole order, certain customers only, and so on), with why. Shoppers still get them in the cart, so the shop should know the block
 * does not show them.
 */
export async function automaticDiscountsNotShown(admin: ShopifyAdminClient): Promise<NotShown[]> {
  const result: NotShown[] = [];
  for (const id of await listAutomaticDiscountIds(admin)) {
    const node = await getDiscount(admin, id);
    if (!node) continue;
    const promotion = mapDiscountToPromotion(node);
    if (!["ACTIVE", "SCHEDULED"].includes(promotion.status)) continue;
    const reason = priceProblem(promotion);
    if (reason) result.push({ id, routeId: promotion.routeId, title: promotion.title, reason });
  }
  return result;
}

/** What the price block would be given if the data were published now, from Shopify's discounts as they are. */
export type CurrentPrice = { key: string; routeId: string; title: string; entry: PriceEntry };

export async function currentPriceEntries(admin: ShopifyAdminClient, shop: string, readSettings = getLatestPromotionSettings): Promise<CurrentPrice[]> {
  const result: CurrentPrice[] = [];
  const seen = new Set<string>();
  const add = (entry: PriceEntry | null, routeId: string, title: string) => { if (entry) result.push({ key: entry.id.split("/").pop()!, routeId, title, entry }); };
  for (const row of (await readSettings(shop)).filter(item => item.websiteEnabled)) {
    const node = await getDiscount(admin, row.shopifyDiscountId, 250);
    seen.add(promotionDiscountId(row.shopifyDiscountId));
    if (!node || (node.discount.codesCount?.count ?? node.discount.codes?.nodes.length ?? 0) > 1) continue;
    const { complete } = await completeDiscountScope(admin, node);
    const promotion = mapDiscountToPromotion(node);
    promotion.settings = { ...promotion.settings, ...row, lastSyncedAt: null };
    add(priceEntryFor(promotion, complete), promotion.routeId, promotion.title);
  }
  for (const id of await listAutomaticDiscountIds(admin)) {
    if (seen.has(id)) continue;
    const node = await getDiscount(admin, id, 250);
    if (!node) continue;
    const { complete } = await completeDiscountScope(admin, node);
    const promotion = mapDiscountToPromotion(node);
    add(priceEntryFor(promotion, complete), promotion.routeId, promotion.title);
  }
  return result;
}

/** The entries the storefront has, as published in the app's snapshot (`prices`). Null when nothing has been published, or by an older version. */
export async function publishedPriceEntries(admin: ShopifyAdminClient): Promise<Array<Record<string, unknown>> | null> {
  const result = await (await admin.graphql(`query PromotionPricesPublished { currentAppInstallation { metafield(namespace: "promotion_engine", key: "storefront") { value } } }`)).json();
  if (result.errors?.length) throw new Error(result.errors.map((error: { message: string }) => error.message).join(" "));
  try {
    const snapshot = JSON.parse(result.data?.currentAppInstallation?.metafield?.value ?? "null") as { priceRules?: number; prices?: Array<Record<string, unknown>> } | null;
    return snapshot?.priceRules && Array.isArray(snapshot.prices) ? snapshot.prices : null;
  } catch { return null; }
}

/** The fields that decide what a product page shows. The product lists are not compared here: they are their own metafields. */
const fingerprint = (item: Record<string, unknown>) => JSON.stringify([item.c ?? "", item.price ?? null, item.k, Boolean(item.cp), Boolean(item.co), Boolean(item.all), item.starts ?? 0, item.ends ?? 0]);

export type PriceRow = {
  key: string;
  routeId: string | null;
  title: string;
  /** "Automatic", or the code. */
  kind: string;
  /** What the discount takes off now in Shopify, in words, or why there is no price. */
  now: string;
  /** What the storefront is using, in words. Empty when it has nothing for it. */
  published: string;
  state: "matches" | "outdated" | "missing" | "stale";
};

const describe = (item: Record<string, unknown> | null) => {
  if (!item) return "";
  const price = item.price as { t: "p" | "a"; v: number; u?: string } | undefined;
  if (!price) return "No price to show";
  if (price.t === "p") return `${(price.v / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}% off`;
  return `${new Intl.NumberFormat("en-GB", { style: "currency", currency: price.u || "GBP" }).format(price.v / 100)} off each item`;
};

/**
 * Sets what Shopify holds now beside what the storefront is using, one row per discount the block speaks of, so a difference is seen here
 * instead of on a product page. `outdated` means the storefront has an older value, `missing` that it has nothing yet, and `stale` that it
 * still has a discount that no longer applies.
 */
export function comparePrices(current: CurrentPrice[], published: Array<Record<string, unknown>> | null): PriceRow[] {
  const rows: PriceRow[] = [];
  const have = new Map((published ?? []).map(item => [String(item.key), item]));
  for (const item of current) {
    const found = have.get(item.key) ?? null;
    have.delete(item.key);
    const state: PriceRow["state"] = !found ? "missing" : fingerprint(found) === fingerprint({ ...item.entry }) ? "matches" : "outdated";
    rows.push({ key: item.key, routeId: item.routeId, title: item.title, kind: item.entry.c || "Automatic", now: describe({ ...item.entry }), published: describe(found), state });
  }
  for (const [key, found] of have) rows.push({ key, routeId: null, title: `Discount ${key}`, kind: String(found.c || "Automatic"), now: "No longer applies", published: describe(found), state: "stale" });
  return rows;
}

const checkedAt = new Map<string, number>();
/** How often opening the app checks that the storefront's prices still match Shopify. */
export const priceCheckEvery = 10 * 60 * 1000;

/**
 * A safety for the prices the storefront shows: when the app is opened, and not more than every ten minutes, it compares what Shopify holds now
 * with what the storefront has, and publishes again if anything differs (a discount changed while no change reached the app, say). The
 * storefront is also updated whenever a promotion or automatic discount changes; this catches whatever that missed.
 */
export async function ensurePricesCurrent(admin: ShopifyAdminClient, shop: string, options: { now?: number; sync?: typeof syncStorefrontSnapshot; readSettings?: typeof getLatestPromotionSettings } = {}): Promise<"skipped" | "current" | "updated"> {
  const now = options.now ?? Date.now();
  const last = checkedAt.get(shop);
  if (last !== undefined && now - last < priceCheckEvery) return "skipped";
  checkedAt.set(shop, now);
  try {
    const rows = comparePrices(await currentPriceEntries(admin, shop, options.readSettings), await publishedPriceEntries(admin));
    if (rows.every(row => row.state === "matches")) return "current";
    await (options.sync ?? syncStorefrontSnapshot)(admin, shop, options.readSettings);
    return "updated";
  } catch (error) {
    checkedAt.delete(shop); // try again next time the app opens
    throw error;
  }
}

/** Forgets when each shop was last checked. For tests. */
export function forgetPriceChecks() { checkedAt.clear(); }
