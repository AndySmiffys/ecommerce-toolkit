import type { ShopifyDiscountNode } from "../types/discount";
import type { ShopifyAdminClient } from "./discount.server";

// A discount's first query returns up to 250 products, variants or collections. Larger lists are read in further
// pages so the storefront can be told about every product. The ceiling stops one huge discount from using the
// whole Admin API allowance; a list that hits it is reported as truncated and stays on the live path.
const pageLimit = 40;
const itemCeiling = 10000;

const SCOPE_PAGE = `
  query DiscountScopePage($id: ID!, $productsAfter: String, $variantsAfter: String, $collectionsAfter: String) {
    discountNode(id: $id) {
      discount {
        ... on DiscountCodeBasic { customerGets { items { ...ScopeItems } } }
        ... on DiscountAutomaticBasic { customerGets { items { ...ScopeItems } } }
        ... on DiscountCodeBxgy { customerGets { items { ...ScopeItems } } }
        ... on DiscountAutomaticBxgy { customerGets { items { ...ScopeItems } } }
      }
    }
  }
  fragment ScopeItems on DiscountItems {
    ... on DiscountProducts {
      products(first: 250, after: $productsAfter) { pageInfo { hasNextPage endCursor } nodes { id title } }
      productVariants(first: 250, after: $variantsAfter) { pageInfo { hasNextPage endCursor } nodes { id title product { id title } } }
    }
    ... on DiscountCollections {
      collections(first: 250, after: $collectionsAfter) { pageInfo { hasNextPage endCursor } nodes { id title productsCount { count } } }
    }
  }
`;

type Connection = { pageInfo?: { hasNextPage: boolean; endCursor: string | null }; nodes: unknown[] };
const lists = ["products", "productVariants", "collections"] as const;
const cursorName = { products: "productsAfter", productVariants: "variantsAfter", collections: "collectionsAfter" } as const;

/**
 * Reads the rest of a discount's product, variant and collection lists into the node. Returns whether every list
 * is now complete. Anything that cannot be read is left as it was and reported as incomplete.
 */
export async function completeDiscountScope(admin: ShopifyAdminClient, node: ShopifyDiscountNode): Promise<{ complete: boolean }> {
  const items = node.discount.customerGets?.items as unknown as Record<string, Connection | undefined> | undefined;
  if (!items) return { complete: true };
  const pending = () => lists.filter(name => items[name]?.pageInfo?.hasNextPage);
  for (let page = 0; page < pageLimit && pending().length; page++) {
    const variables: Record<string, unknown> = { id: node.id };
    for (const name of pending()) variables[cursorName[name]] = items[name]!.pageInfo!.endCursor;
    // Lists that are already complete would return their first page again, so only pending lists are read from the result.
    let result;
    try { result = await (await admin.graphql(SCOPE_PAGE, { variables })).json(); } catch { return { complete: false }; }
    if (result.errors?.length) return { complete: false };
    const next = result.data?.discountNode?.discount?.customerGets?.items as Record<string, Connection | undefined> | undefined;
    if (!next) return { complete: false };
    for (const name of pending()) {
      const current = items[name]!;
      const more = next[name];
      if (!more) { current.pageInfo = { hasNextPage: false, endCursor: null }; continue; }
      current.nodes.push(...more.nodes);
      current.pageInfo = more.pageInfo ?? { hasNextPage: false, endCursor: null };
      if (current.nodes.length >= itemCeiling) break;
    }
  }
  return { complete: pending().length === 0 };
}
