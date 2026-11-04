import { promotionDiscountId } from "../design/discountIdentity";
import { buildDiscountMutation, type CreateDiscountDraft } from "../design/discountMutation";
import type { ShopifyAdminClient } from "./discount.server";

export { buildDiscountMutation, type CreateDiscountDraft };
export async function createShopifyPromotion(admin: ShopifyAdminClient, draft: CreateDiscountDraft): Promise<string> {
  const request = buildDiscountMutation(draft);
  const response = await admin.graphql(request.query, { variables: request.variables });
  const result = await response.json();
  const errors = [...(result.errors ?? []), ...(result.data?.result?.userErrors ?? [])];
  if (errors?.length) throw new Error(errors.map((error: { message: string }) => error.message).join(", "));
  const id = result.data?.result?.codeDiscountNode?.id ?? result.data?.result?.automaticDiscountNode?.id;
  if (!id) throw new Error("Shopify did not return a discount ID.");
  // The settings model and detail route use the generic DiscountNode ID.
  return promotionDiscountId(id);
}
