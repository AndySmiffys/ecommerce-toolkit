import type { PrismaClient } from "@prisma/client";
import db from "../../../db.server";
import { promotionDiscountAliases, promotionDiscountId } from "../design/discountIdentity";
import { attachPromotionSettings, getLatestPromotionSettings } from "./promotionSettings.server";
import { getDiscount, type ShopifyAdminClient } from "./discount.server";
import { getDiscountsByIds } from "./discounts.server";
import { mapDiscountToPromotion, mapDiscountsToPromotions } from "../mappers/promotionMapper";
import type { PromotionRecord } from "../models/promotion";
import { buildPriorityList } from "../design/priorityOverview";
import { isRanked } from "../design/ranking";
export async function loadPromotionPriorities(api: ShopifyAdminClient, shop: string, database: PrismaClient = db) {
  const settings = await getLatestPromotionSettings(shop, database);
  const promotions: PromotionRecord[] = [];
  const errors: string[] = [];
  for (const stored of settings) {
    try {
      const node = await getDiscount(api, stored.shopifyDiscountId, 250);
      // Shopify-deleted discounts can leave saved designs behind. Preserve those
      // records, but omit them from the active management lists without an alarm.
      if (!node) continue;
      const promotion = mapDiscountToPromotion(node);
      promotion.settings = { ...promotion.settings, ...stored, lastSyncedAt: null };
      promotions.push(promotion);
    } catch (error) { errors.push(`Could not load discount ${stored.shopifyDiscountId.split("/").pop()}: ${error instanceof Error ? error.message : "Please refresh."}`); }
  }
  return { ...buildPriorityList(promotions), errors };
}

/** Where one promotion sits in the priority order, from a single list of the shop's discounts. Null when it is not ranked. */
export async function getPriorityPosition(api: ShopifyAdminClient, shop: string, promotionId: string, database: PrismaClient = db) {
  const settings = await getLatestPromotionSettings(shop, database);
  // The discounts that have saved settings, found by id: the order does not depend on how many discounts the shop has.
  const discounts = await getDiscountsByIds(api, settings.map(row => row.shopifyDiscountId));
  const promotions = await attachPromotionSettings(shop, mapDiscountsToPromotions(discounts), database);
  const byId = new Map(promotions.map(promotion => [promotionDiscountId(promotion.id), promotion]));
  // Settings come newest first within a priority, which is how the storefront breaks ties.
  const ranked = settings.map(row => byId.get(row.shopifyDiscountId)).filter((promotion): promotion is PromotionRecord => Boolean(promotion) && isRanked(promotion!));
  const index = ranked.findIndex(promotion => promotionDiscountId(promotion.id) === promotionDiscountId(promotionId));
  return index === -1 ? null : { position: index + 1, total: ranked.length };
}
type PriorityChange = { id: string; priority: number; expectedPriority: number };
export async function savePromotionPriorities(shop: string, input: unknown, database: PrismaClient = db) {
  if (!Array.isArray(input) || !input.length || input.length > 1000) throw new Error("Choose between 1 and 1,000 priority changes.");
  const changes: PriorityChange[] = input.map(value => {
    if (!value || typeof value !== "object" || typeof value.id !== "string") throw new Error("Invalid promotion priority change.");
    for (const priority of [value.priority, value.expectedPriority]) if (typeof priority !== "number" || !Number.isInteger(priority) || priority < 0 || priority > 9999) throw new Error("Priorities must be whole numbers between 0 and 9999.");
    return { id: promotionDiscountId(value.id), priority: value.priority, expectedPriority: value.expectedPriority };
  });
  if (new Set(changes.map(change => change.id)).size !== changes.length) throw new Error("Each promotion can only have one priority change.");
  await database.$transaction(async transaction => {
    const rows = await transaction.promotionSettings.findMany({ where: { shop, shopifyDiscountId: { in: changes.flatMap(change => promotionDiscountAliases(change.id)) } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] });
    for (const change of changes) {
      const row = rows.find(row => promotionDiscountId(row.shopifyDiscountId) === change.id);
      if (!row) throw new Error("A promotion is no longer available. Refresh the lists and try again.");
      if (row.priority !== change.expectedPriority) throw new Error("A priority was changed elsewhere. Review the refreshed lists before saving again.");
      const updated = await transaction.promotionSettings.updateMany({ where: { id: row.id, shop, priority: change.expectedPriority }, data: { priority: change.priority } });
      if (updated.count !== 1) throw new Error("A priority changed while saving. Refresh the lists and try again.");
    }
  });
}
