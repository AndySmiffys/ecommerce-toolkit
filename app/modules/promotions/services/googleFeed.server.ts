import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import db from "../../../db.server";
import { promotionDiscountId } from "../design/discountIdentity";
import { checkGooglePromotion, googleFeed, googleLimits, scopeOf, type GoogleRow, type ScopeSkus } from "../design/googlePromotion";
import { collectionProductIds } from "./collectionProducts.server";
import { getDiscount, type ShopifyAdminClient } from "./discount.server";
import { completeDiscountScope } from "./discountScope.server";

type Database = Pick<PrismaClient, "googlePromotion" | "googleFeed">;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The most promotions that can be sent at once. Google also limits how many promotions an account may have active. */
export const maxGooglePromotions = 200;

// ---- SKUs ----

const PRODUCT_SKUS = `query GoogleProductSkus($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Product { variants(first: 50) { pageInfo { hasNextPage } nodes { sku } } } }
}`;
const VARIANT_SKUS = `query GoogleVariantSkus($ids: [ID!]!) {
  nodes(ids: $ids) { ... on ProductVariant { sku } }
}`;

async function ask(admin: ShopifyAdminClient, query: string, ids: string[], wait: (ms: number) => Promise<unknown>) {
  for (let attempt = 0; ; attempt++) {
    const result = await (await admin.graphql(query, { variables: { ids } })).json();
    const errors: Array<{ message: string; extensions?: { code?: string } }> = result.errors ?? [];
    if (!errors.length) return (result.data?.nodes ?? []) as Array<Record<string, unknown> | null>;
    if (errors.every(error => error.extensions?.code === "THROTTLED") && attempt < 8) { await wait(1500 * (attempt + 1)); continue; }
    throw new Error(errors.map(error => error.message).join(" "));
  }
}

/**
 * The SKUs of the products, variants and collections a discount covers, up to Google's limit. More than that, or a
 * product with more variants than one read can list, is reported as too many rather than cut short.
 */
export async function skusFor(admin: ShopifyAdminClient, scope: { productIds: string[]; variantIds: string[]; collectionIds: string[] }, wait: (ms: number) => Promise<unknown> = sleep): Promise<{ skus: string[]; tooMany: boolean }> {
  const skus = new Set<string>();
  const products = new Set(scope.productIds.map(id => id.split("/").pop()!));
  if (scope.collectionIds.length) {
    const found = await collectionProductIds(admin, scope.collectionIds, Date.now(), wait);
    if (found.tooLarge.length) return { skus: [], tooMany: true };
    for (const id of found.ids) products.add(id);
  }
  // Every product has at least one SKU, so more products than SKUs allowed can never fit.
  if (products.size > googleLimits.skus) return { skus: [], tooMany: true };
  const productIds = [...products].map(id => `gid://shopify/Product/${id}`);
  for (let start = 0; start < productIds.length; start += 8) {
    for (const node of await ask(admin, PRODUCT_SKUS, productIds.slice(start, start + 8), wait)) {
      const variants = node?.variants as { pageInfo?: { hasNextPage?: boolean }; nodes?: Array<{ sku?: string | null }> } | undefined;
      if (variants?.pageInfo?.hasNextPage) return { skus: [], tooMany: true };
      for (const variant of variants?.nodes ?? []) if (variant.sku?.trim()) skus.add(variant.sku.trim());
    }
    if (skus.size > googleLimits.skus) return { skus: [], tooMany: true };
  }
  for (let start = 0; start < scope.variantIds.length; start += 100) {
    for (const node of await ask(admin, VARIANT_SKUS, scope.variantIds.slice(start, start + 100), wait)) if (typeof node?.sku === "string" && node.sku.trim()) skus.add(node.sku.trim());
  }
  // A SKU with a comma would be read as two, so it cannot be listed.
  const listed = [...skus].filter(sku => !sku.includes(","));
  return { skus: listed.slice(0, googleLimits.skus), tooMany: listed.length > googleLimits.skus };
}

// ---- The feed ----

export function newFeedToken(): string { return randomBytes(24).toString("hex"); }

/** The shop's feed record, made with a new private address the first time. */
export async function ensureFeed(shop: string, database: Database = db) {
  return database.googleFeed.upsert({ where: { shop }, create: { shop, token: newFeedToken() }, update: {} });
}

/** Gives the feed a new private address, so the old one stops working. */
export async function regenerateFeedToken(shop: string, database: Database = db) {
  return database.googleFeed.upsert({ where: { shop }, create: { shop, token: newFeedToken() }, update: { token: newFeedToken() } });
}

export async function feedByToken(token: string, database: Database = db) {
  return /^[a-f0-9]{48}$/.test(token) ? database.googleFeed.findUnique({ where: { token } }) : null;
}

const building = new Set<string>();
export const isGoogleBuilding = (shop: string) => building.has(shop);

/**
 * Checks every promotion chosen for Google against Google's rules, records how each did, and rebuilds the file with the
 * ones that pass. One at a time per shop; a second call while one runs does nothing.
 */
export async function buildGoogleFeed(admin: ShopifyAdminClient, shop: string, database: Database = db, now = new Date(), wait: (ms: number) => Promise<unknown> = sleep): Promise<{ count: number } | null> {
  if (building.has(shop)) return null;
  building.add(shop);
  try {
    const chosen = await database.googlePromotion.findMany({ where: { shop }, orderBy: { createdAt: "asc" } });
    const rows: GoogleRow[] = [];
    for (const item of chosen) {
      let issues: string[];
      let label = item.label;
      try {
        const node = await getDiscount(admin, item.discountId, 250);
        if (!node) issues = ["It no longer exists in Shopify."];
        else {
          label = node.discount.title ?? label;
          let scope = scopeOf(node);
          if (!scope.allItems && !scope.complete) { await completeDiscountScope(admin, node); scope = scopeOf(node); }
          let skus: ScopeSkus = null;
          if (!scope.allItems) skus = scope.complete ? await skusFor(admin, scope, wait) : { skus: [], tooMany: true };
          const check = checkGooglePromotion(node, { title: item.title, skus, now });
          issues = check.issues;
          if (check.row) rows.push(check.row);
        }
      } catch (error) {
        issues = [`Shopify could not be read for this one: ${error instanceof Error ? error.message : "unknown error"}. It will be checked again.`];
      }
      await database.googlePromotion.update({ where: { shop_discountId: { shop, discountId: item.discountId } }, data: { label, status: issues.length ? "issues" : "ready", issues: JSON.stringify(issues), checkedAt: now } });
    }
    const text = googleFeed(rows);
    await ensureFeed(shop, database);
    await database.googleFeed.update({ where: { shop }, data: { feedText: text, count: rows.length, builtAt: now } });
    return { count: rows.length };
  } finally { building.delete(shop); }
}

// ---- What the merchant chose ----

/** Adds promotions to, or takes them out of, what is sent to Google. Returns how many there are now. */
export async function setGoogleSelection(shop: string, ids: string[], on: boolean, database: Database = db): Promise<number> {
  const canonical = [...new Set(ids.map(id => promotionDiscountId(id)))];
  if (!on) await database.googlePromotion.deleteMany({ where: { shop, discountId: { in: canonical } } });
  else {
    const existing = await database.googlePromotion.count({ where: { shop } });
    const present = await database.googlePromotion.count({ where: { shop, discountId: { in: canonical } } });
    if (existing - present + canonical.length > maxGooglePromotions) throw new Error(`Up to ${maxGooglePromotions} promotions can be sent to Google at once.`);
    await database.googlePromotion.createMany({ data: canonical.map(discountId => ({ shop, discountId })), skipDuplicates: true });
  }
  return database.googlePromotion.count({ where: { shop } });
}

/** Gives a promotion its own, shorter title for Google. An empty title goes back to the discount's own. */
export async function setGoogleTitle(shop: string, id: string, title: string, database: Database = db): Promise<void> {
  const cleaned = title.replace(/\s+/g, " ").trim().slice(0, 120);
  const updated = await database.googlePromotion.updateMany({ where: { shop, discountId: promotionDiscountId(id) }, data: { title: cleaned, status: "pending" } });
  if (!updated.count) throw new Error("That promotion is not being sent to Google.");
}

/** How the last check went for these promotions, for the Google column on the list. */
export async function googleStatuses(shop: string, ids: string[], database: Pick<PrismaClient, "googlePromotion"> = db): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const rows = await database.googlePromotion.findMany({ where: { shop, discountId: { in: ids.map(id => promotionDiscountId(id)) } }, select: { discountId: true, status: true } });
  return Object.fromEntries(rows.map(row => [row.discountId, row.status]));
}

export async function loadGooglePage(shop: string, database: Database = db) {
  const [feed, rows] = await Promise.all([ensureFeed(shop, database), database.googlePromotion.findMany({ where: { shop }, orderBy: { createdAt: "asc" } })]);
  return {
    token: feed.token,
    builtAt: feed.builtAt?.toISOString() ?? null,
    count: feed.count,
    promotions: rows.map(row => ({ id: row.discountId, routeId: row.discountId.split("/").pop()!, label: row.label, title: row.title, status: row.status, issues: JSON.parse(row.issues) as string[], checkedAt: row.checkedAt?.toISOString() ?? null })),
  };
}

/** True when promotions are chosen and the file is missing or older than `minutes`. */
export async function googleFeedIsDue(shop: string, minutes: number, database: Database = db, now = Date.now()): Promise<boolean> {
  if (!(await database.googlePromotion.count({ where: { shop } }))) return false;
  const feed = await database.googleFeed.findUnique({ where: { shop } });
  return !feed?.builtAt || now - feed.builtAt.getTime() > minutes * 60000;
}

/** True when this discount is one of those sent to Google, so a change to it should rebuild the file. */
export async function isSentToGoogle(shop: string, id: string, database: Database = db): Promise<boolean> {
  return (await database.googlePromotion.count({ where: { shop, discountId: promotionDiscountId(id) } })) > 0;
}
