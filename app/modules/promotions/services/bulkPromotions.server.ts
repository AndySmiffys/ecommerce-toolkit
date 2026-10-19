import type { PrismaClient } from "@prisma/client";
import db from "../../../db.server";
import { promotionDiscountAliases, promotionDiscountId } from "../design/discountIdentity";
import { getDiscount, type ShopifyAdminClient } from "./discount.server";
import { getPromotionCodeBatch } from "./promotionCodeBatches.server";
import { priorityForSave } from "./promotionSettings.server";

/** Most promotions one action may change. Each one is a request to Shopify, made one after another. */
export const bulkLimit = 50;
export type BulkIntent = "activate" | "deactivate" | "delete" | "website-enable" | "website-draft";
export const bulkIntents: readonly BulkIntent[] = ["activate", "deactivate", "delete", "website-enable", "website-draft"];
export type BulkOutcome = { done: string[]; failed: Array<{ id: string; message: string }> };

const idPattern = /^gid:\/\/shopify\/(?:DiscountNode|DiscountCodeNode|DiscountAutomaticNode)\/\d+$/;

/** The promotion IDs from a request, as the app's own IDs. The browser's list is checked, never trusted. */
export function parseBulkIds(raw: unknown): string[] {
  let value = raw;
  if (typeof raw === "string") { try { value = JSON.parse(raw); } catch { value = null; } }
  if (!Array.isArray(value) || !value.length) throw new Error("Select at least one promotion.");
  if (value.length > bulkLimit) throw new Error(`Select up to ${bulkLimit} promotions at a time.`);
  if (!value.every(id => typeof id === "string" && idPattern.test(id))) throw new Error("A selected promotion is not valid. Refresh the page and try again.");
  return [...new Set(value.map(id => promotionDiscountId(id)))];
}

type Kind = "code" | "automatic";
type Database = Pick<PrismaClient, "promotionSettings" | "promotionCodeBatch">;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const mutation = (name: string, result: string) => `mutation PromotionBulk($id: ID!) { ${name}(id: $id) { ${result} userErrors { field message code } } }`;
const operations = {
  code: { activate: mutation("discountCodeActivate", "codeDiscountNode { id }"), deactivate: mutation("discountCodeDeactivate", "codeDiscountNode { id }"), delete: mutation("discountCodeDelete", "deletedCodeDiscountId") },
  automatic: { activate: mutation("discountAutomaticActivate", "automaticDiscountNode { id }"), deactivate: mutation("discountAutomaticDeactivate", "automaticDiscountNode { id }"), delete: mutation("discountAutomaticDelete", "deletedAutomaticDiscountId") },
} as const;

/** Runs one request to Shopify, waiting out its rate limit, and returns the data or throws the reason in plain words. */
async function request(admin: ShopifyAdminClient, query: string, id: string, wait: (ms: number) => Promise<unknown>) {
  for (let attempt = 0; ; attempt++) {
    const result = await (await admin.graphql(query, { variables: { id } })).json();
    const errors: Array<{ message: string; extensions?: { code?: string } }> = result.errors ?? [];
    if (errors.length && errors.every(error => error.extensions?.code === "THROTTLED") && attempt < 5) { await wait(1500 * (attempt + 1)); continue; }
    if (errors.length) throw new Error(errors.map(error => error.message).join(" "));
    const payload = Object.values(result.data ?? {})[0] as { userErrors?: Array<{ message: string }> } | undefined;
    if (payload?.userErrors?.length) throw new Error(payload.userErrors.map(error => error.message).join(" "));
    return payload;
  }
}

/** Whether the discount is a code or an automatic one, from Shopify, or null when it no longer exists. */
async function discountKind(admin: ShopifyAdminClient, id: string, wait: (ms: number) => Promise<unknown>): Promise<Kind | null> {
  for (let attempt = 0; ; attempt++) {
    const result = await (await admin.graphql(`query PromotionKind($id: ID!) { discountNode(id: $id) { discount { __typename } } }`, { variables: { id } })).json();
    const errors: Array<{ message: string; extensions?: { code?: string } }> = result.errors ?? [];
    if (errors.length && errors.every(error => error.extensions?.code === "THROTTLED") && attempt < 5) { await wait(1500 * (attempt + 1)); continue; }
    if (errors.length) throw new Error(errors.map(error => error.message).join(" "));
    const type: string | undefined = result.data?.discountNode?.discount?.__typename;
    if (!type) return null;
    if (type.startsWith("DiscountCode")) return "code";
    if (type.startsWith("DiscountAutomatic")) return "automatic";
    throw new Error("This kind of discount cannot be changed from here.");
  }
}

const typedId = (id: string, kind: Kind) => `gid://shopify/${kind === "code" ? "DiscountCodeNode" : "DiscountAutomaticNode"}/${id.split("/").pop()}`;

/**
 * Activates, deactivates or deletes the Shopify discounts, one by one, and reports each result. Deleting also removes
 * what the app saved for the promotion (its website design and code batches); nothing is removed locally for a
 * discount Shopify refused to delete.
 */
export async function bulkDiscountAction(admin: ShopifyAdminClient, shop: string, action: "activate" | "deactivate" | "delete", ids: string[], database: Database = db, wait: (ms: number) => Promise<unknown> = sleep): Promise<BulkOutcome> {
  const outcome: BulkOutcome = { done: [], failed: [] };
  for (const id of ids) {
    try {
      const kind = await discountKind(admin, id, wait);
      if (kind) await request(admin, operations[kind][action], typedId(id, kind), wait);
      else if (action !== "delete") throw new Error("This discount no longer exists in Shopify.");
      if (action === "delete") {
        // A discount already gone from Shopify is cleaned up here too.
        const aliases = promotionDiscountAliases(id);
        await database.promotionSettings.deleteMany({ where: { shop, shopifyDiscountId: { in: aliases } } });
        await database.promotionCodeBatch.deleteMany({ where: { shop, shopifyDiscountId: { in: aliases } } });
      }
      outcome.done.push(id);
    } catch (error) {
      outcome.failed.push({ id, message: error instanceof Error ? error.message : "Shopify could not change this discount." });
    }
  }
  return outcome;
}

/** Turns the website promotion on (Enabled) or off (Draft) for each promotion. Enabling needs a chosen block. */
export async function bulkWebsiteStatus(admin: ShopifyAdminClient, shop: string, enabled: boolean, ids: string[], database: Database = db): Promise<BulkOutcome> {
  const outcome: BulkOutcome = { done: [], failed: [] };
  for (const id of ids) {
    try {
      const where = { shop, shopifyDiscountId: { in: promotionDiscountAliases(id) } };
      const rows = await database.promotionSettings.findMany({ where });
      if (!rows.length) {
        if (enabled) throw new Error("This promotion has no website blocks yet. Open it and choose where it should appear.");
        outcome.done.push(id);
        continue;
      }
      if (enabled) {
        if (!rows.some(row => row.showHeaderBanner || row.showCollectionPage || row.showProductPage || row.showProductBadge)) throw new Error("No website block is selected for this promotion. Open it and choose where it should appear.");
        const node = await getDiscount(admin, id);
        if (!node) throw new Error("This discount no longer exists in Shopify.");
        if ((node.discount.codesCount?.count ?? node.discount.codes?.nodes.length ?? 0) > 1 || await getPromotionCodeBatch(shop, id, database as PrismaClient)) throw new Error("A list of individual codes stays in Draft. Share its codes with the CSV download.");
        // A promotion that enters the order starts at the top, as it does when saved in the editor.
        const priority = rows.some(row => row.websiteEnabled) ? undefined : await priorityForSave(shop, id, true, database as PrismaClient);
        await database.promotionSettings.updateMany({ where, data: { websiteEnabled: true, ...(priority === undefined ? {} : { priority }) } });
      } else {
        await database.promotionSettings.updateMany({ where, data: { websiteEnabled: false } });
      }
      outcome.done.push(id);
    } catch (error) {
      outcome.failed.push({ id, message: error instanceof Error ? error.message : "This promotion could not be changed." });
    }
  }
  return outcome;
}

export async function runBulkAction(admin: ShopifyAdminClient, shop: string, intent: BulkIntent, ids: string[], database: Database = db): Promise<BulkOutcome> {
  return intent === "website-enable" ? bulkWebsiteStatus(admin, shop, true, ids, database)
    : intent === "website-draft" ? bulkWebsiteStatus(admin, shop, false, ids, database)
      : bulkDiscountAction(admin, shop, intent, ids, database);
}
