import { GET_DISCOUNT } from "../graphql/discount.graphql";
import { promotionDiscountId } from "../design/discountIdentity";
import type { ShopifyDiscountNode } from "../types/discount";

export type ShopifyAdminClient = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
};

type DiscountResponse = {
  data?: {
    discountNode?: ShopifyDiscountNode | null;
  };

  errors?: Array<{
    message: string;
  }>;
};

export async function getDiscount(
  admin: ShopifyAdminClient,
  discountNodeId: string,
  selectionLimit = 50,
): Promise<ShopifyDiscountNode | null> {
  const response = await admin.graphql(
    selectionLimit === 250 ? GET_DISCOUNT.replaceAll("first: 50", "first: 250") : GET_DISCOUNT,
    {
      variables: {
        id: discountNodeId,
      },
    },
  );

  const result =
    (await response.json()) as DiscountResponse;

  if (result.errors?.length) {
    throw new Error(
      result.errors
        .map((error) => error.message)
        .join(", "),
    );
  }

  const node = result.data?.discountNode;
  return node ? { ...node, id: promotionDiscountId(node.id) } : null;
}

export function getDiscountNodeId(
  routeId: string,
): string {
  if (routeId.startsWith("gid://shopify/")) {
    return routeId;
  }

  return `gid://shopify/DiscountNode/${routeId}`;
}
