import type { ShopifyAdminClient } from "./discount.server";

// Product cards can only be matched by product, so a badge for a discount on a collection needs the products in
// that collection. They are read when the storefront data is published (never while a shopper browses) and kept
// for a few minutes, so saving one promotion does not read every collection again.
const cacheMinutes = 10;
/** The most products one collection may have for badges: the badge data for a promotion is limited to 60 KB. */
export const collectionProductLimit = 9000;
const pageSize = 250;
const throttleRetries = 8;

const cache = new Map<string, { at: number; ids: string[] }>();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const PAGE = `query CollectionProductIds($id: ID!, $after: String) {
  collection(id: $id) { products(first: ${pageSize}, after: $after) { pageInfo { hasNextPage endCursor } nodes { id } } }
}`;

/** Forget what is known about one collection (or all of them). Returns whether anything was forgotten. */
export function forgetCollectionProducts(collectionId?: string): boolean {
  if (!collectionId) { const had = cache.size > 0; cache.clear(); return had; }
  return cache.delete(collectionId.startsWith("gid://") ? collectionId : `gid://shopify/Collection/${collectionId}`);
}

/** Whether any collection is in use for badges, and whether the oldest list is due to be read again. */
export function collectionCacheState(now = Date.now()) {
  const oldest = Math.min(...[...cache.values()].map(entry => entry.at));
  return { inUse: cache.size > 0, due: cache.size > 0 && now - oldest > cacheMinutes * 60000 };
}

async function readPage(admin: ShopifyAdminClient, id: string, after: string | null, wait: (ms: number) => Promise<unknown>) {
  for (let attempt = 0; ; attempt++) {
    const result = await (await admin.graphql(PAGE, { variables: { id, after } })).json();
    const errors: Array<{ message: string; extensions?: { code?: string } }> = result.errors ?? [];
    if (!errors.length) return result.data?.collection?.products as { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ id: string }> } | undefined;
    // Shopify limits how fast the Admin API can be read. Wait for the allowance to refill, then continue.
    if (errors.every(error => error.extensions?.code === "THROTTLED") && attempt < throttleRetries) { await wait(1500 * (attempt + 1)); continue; }
    if (errors.some(error => error.extensions?.code === "THROTTLED")) throw new Error("Shopify is limiting requests right now, so the products in a collection could not be read for badges. Try saving again in a minute.");
    throw new Error(errors.map(error => error.message).join(" "));
  }
}

/**
 * The short product IDs in each collection, as one list. A collection with more products than a badge can list is
 * reported as too large rather than cut short, which would give some products the wrong badge.
 */
export async function collectionProductIds(admin: ShopifyAdminClient, collectionIds: string[], now = Date.now(), wait: (ms: number) => Promise<unknown> = sleep): Promise<{ ids: string[]; tooLarge: string[] }> {
  const ids = new Set<string>();
  const tooLarge: string[] = [];
  for (const collectionId of collectionIds) {
    let members = cache.get(collectionId);
    if (!members || now - members.at > cacheMinutes * 60000) {
      const found: string[] = [];
      let after: string | null = null;
      for (;;) {
        const page = await readPage(admin, collectionId, after, wait);
        if (!page) break;
        found.push(...page.nodes.map(node => node.id.split("/").pop()!));
        if (found.length > collectionProductLimit) break;
        if (!page.pageInfo.hasNextPage) break;
        after = page.pageInfo.endCursor;
      }
      members = { at: now, ids: found };
      if (found.length <= collectionProductLimit) cache.set(collectionId, members);
    }
    if (members.ids.length > collectionProductLimit) { tooLarge.push(collectionId); continue; }
    for (const id of members.ids) ids.add(id);
  }
  return { ids: [...ids], tooLarge };
}
