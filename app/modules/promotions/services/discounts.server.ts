import { GET_DISCOUNTS_BY_IDS, GET_DISCOUNTS_PAGE } from "../graphql/discounts.graphql";
import { promotionDiscountId } from "../design/discountIdentity";
import type { ShopifyDiscountNode } from "../types/discount";
import type { ShopifyAdminClient } from "./discount.server";

/** Discounts on one page of the Promotions list. */
export const discountsPerPage = 50;

export type DiscountsPage = {
  nodes: ShopifyDiscountNode[];
  pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; startCursor: string | null; endCursor: string | null };
  /** How many discounts match the search, up to 10,000. */
  total: number | null;
};

type PageResponse = {
  data?: {
    discountNodes?: { nodes: ShopifyDiscountNode[]; pageInfo?: Partial<DiscountsPage["pageInfo"]> };
    discountNodesCount?: { count: number } | null;
  };
  errors?: Array<{ message: string }>;
};

/** A page cursor from the address bar: Shopify's own opaque text, or nothing. Anything else is ignored. */
export function listCursor(value: string | null): string | null {
  return value && /^[A-Za-z0-9+/=_-]{1,600}$/.test(value) ? value : null;
}

export const discountStatuses = ["active", "scheduled", "expired"] as const;
export type DiscountStatusFilter = (typeof discountStatuses)[number];

/**
 * Shopify's discount search for what the merchant typed and chose: free text, and a status. Characters that mean
 * something in Shopify's search syntax are dropped from the text, so what is typed is only ever searched for.
 */
export function discountSearch(text: string, status: string | null): string {
  const words = text.replace(/["'\\():]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  const parts = [words, status && (discountStatuses as readonly string[]).includes(status) ? `status:${status}` : ""].filter(Boolean);
  return parts.join(" ");
}

/**
 * One page of discounts, newest first. Going forward pass `after` (the last page's `endCursor`); going back pass
 * `before` (the first page's `startCursor`). With neither, the newest page.
 */
export async function getDiscountsPage(
  admin: ShopifyAdminClient,
  { after = null, before = null, query = "" }: { after?: string | null; before?: string | null; query?: string } = {},
): Promise<DiscountsPage> {
  const variables = before
    ? { last: discountsPerPage, before, query: query || null }
    : { first: discountsPerPage, after, query: query || null };
  const result = (await (await admin.graphql(GET_DISCOUNTS_PAGE, { variables })).json()) as PageResponse;
  if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join(", "));
  const connection = result.data?.discountNodes;
  return {
    // Newest first, whichever way the page was reached.
    nodes: (connection?.nodes ?? []).map(node => ({ ...node, id: promotionDiscountId(node.id) })),
    pageInfo: {
      hasNextPage: connection?.pageInfo?.hasNextPage ?? false,
      hasPreviousPage: connection?.pageInfo?.hasPreviousPage ?? false,
      startCursor: connection?.pageInfo?.startCursor ?? null,
      endCursor: connection?.pageInfo?.endCursor ?? null,
    },
    total: result.data?.discountNodesCount?.count ?? null,
  };
}

/** Specific discounts, in the order asked for. Ones Shopify no longer has are left out. */
export async function getDiscountsByIds(admin: ShopifyAdminClient, ids: string[]): Promise<ShopifyDiscountNode[]> {
  const found: ShopifyDiscountNode[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    const result = (await (await admin.graphql(GET_DISCOUNTS_BY_IDS, { variables: { ids: ids.slice(start, start + 100) } })).json()) as { data?: { nodes?: Array<ShopifyDiscountNode | null> }; errors?: Array<{ message: string }> };
    if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join(", "));
    for (const node of result.data?.nodes ?? []) if (node?.id) found.push({ ...node, id: promotionDiscountId(node.id) });
  }
  return found;
}
