import type { ShopifyAdminClient } from "./discount.server";
import { promotionDiscountId } from "../design/discountIdentity";

const query = `query PromotionAutomaticDiscounts($first: Int!, $after: String) {
  automaticDiscountNodes(first: $first, after: $after, query: "status:active OR status:scheduled") {
    pageInfo { hasNextPage endCursor }
    nodes { id automaticDiscount { __typename ... on DiscountAutomaticBasic { status } ... on DiscountAutomaticBxgy { status } ... on DiscountAutomaticFreeShipping { status } ... on DiscountAutomaticApp { status } } }
  }
}`;

/** The most automatic discounts read. A shop has a handful; this only stops a runaway read. */
export const automaticDiscountLimit = 200;

/**
 * The ids of the shop's active and scheduled automatic discounts, as the app's own discount ids. Shopify applies these in the cart whether or not
 * the shop has enabled them for the website, so the price shown on a product page has to know about them.
 */
export async function listAutomaticDiscountIds(admin: ShopifyAdminClient): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;
  while (ids.length < automaticDiscountLimit) {
    const result = await (await admin.graphql(query, { variables: { first: 50, after } })).json() as {
      errors?: Array<{ message: string }>;
      data?: { automaticDiscountNodes?: { pageInfo?: { hasNextPage: boolean; endCursor: string | null }; nodes?: Array<{ id: string; automaticDiscount?: { status?: string } | null }> } };
    };
    if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join(", "));
    const connection = result.data?.automaticDiscountNodes;
    for (const node of connection?.nodes ?? []) {
      const status = node.automaticDiscount?.status;
      if (status && status !== "ACTIVE" && status !== "SCHEDULED") continue;
      ids.push(promotionDiscountId(node.id));
    }
    if (!connection?.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) break;
    after = connection.pageInfo.endCursor;
  }
  return ids.slice(0, automaticDiscountLimit);
}
