import { getDiscount, type ShopifyAdminClient } from "./discount.server";
import { listAutomaticDiscountIds } from "./automaticDiscounts.server";
import { mapDiscountToPromotion } from "../mappers/promotionMapper";
import { priceProblem } from "../design/priceRule";

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
