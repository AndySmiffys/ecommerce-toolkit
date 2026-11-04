import { getDiscount, type ShopifyAdminClient } from "./discount.server";
import type { ShopifyDiscountNode } from "../types/discount";
import { isSupportedShopifyDiscountTypename } from "../adapters/shopifyDiscountRegistry";
type Items = NonNullable<ShopifyDiscountNode["discount"]["customerGets"]>["items"];
export async function getEditableDiscount(admin: ShopifyAdminClient, id: string): Promise<ShopifyDiscountNode | null> {
  const node = await getDiscount(admin, id);
  if (!node || !isSupportedShopifyDiscountTypename(node.discount.__typename)) return node;
  for (const scope of ["customerGets", "customerBuys"] as const) {
    const items = node.discount[scope]?.items;
    if (!items) continue;
    for (const connection of ["products", "productVariants", "collections"] as const) {
      let pageInfo = items[connection]?.pageInfo;
      while (pageInfo?.hasNextPage && (items[connection]?.nodes.length ?? 0) < 250) {
        if (!pageInfo.endCursor) throw new Error("Shopify did not return a cursor for the selected items.");
        const fragment = connection === "collections" ? "DiscountCollections" : "DiscountProducts";
        const fields = connection === "productVariants" ? "id title product { id title }" : connection === "collections" ? "id title productsCount { count }" : "id title";
        const response = await admin.graphql(`query PromotionSelectedItems($id: ID!, $cursor: String!, $first: Int!) { discountNode(id: $id) { discount { ... on ${node.discount.__typename} { ${scope} { items { ... on ${fragment} { ${connection}(first: $first, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { ${fields} } } } } } } } } }`, { variables: { id, cursor: pageInfo.endCursor, first: Math.min(100, 250 - (items[connection]?.nodes.length ?? 0)) } });
        const result = await response.json() as { errors?: Array<{ message: string }>; data?: { discountNode?: { discount?: { customerGets?: { items: Items }; customerBuys?: { items: Items } } } } };
        if (result.errors?.length) throw new Error(result.errors.map(e => e.message).join(", "));
        const nextItems = result.data?.discountNode?.discount?.[scope]?.items;
        if (!nextItems?.[connection]) throw new Error("The discount's selected items could not be loaded.");
        const next = nextItems[connection]!;
        if (next.pageInfo?.hasNextPage && next.pageInfo.endCursor === pageInfo.endCursor) throw new Error("Shopify did not advance the selected items cursor.");
        // Matching connection keys keep product, variant and collection lists separate.
        if (connection === "products") items.products!.nodes.push(...nextItems.products!.nodes);
        else if (connection === "productVariants") items.productVariants!.nodes.push(...nextItems.productVariants!.nodes);
        else items.collections!.nodes.push(...nextItems.collections!.nodes);
        pageInfo = next.pageInfo;
        items[connection]!.pageInfo = pageInfo;
      }
    }
  }
  return node;
}
