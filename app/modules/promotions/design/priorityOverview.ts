import { placements } from "./design";
import { toLocalDateTime } from "./editorDraft";
import { summaryDate } from "./promotionSummary";
import { isRanked, whyNotRanked } from "./ranking";
import type { PromotionRecord } from "../models/promotion";

export type PriorityRow = {
  id: string;
  routeId: string;
  title: string;
  priority: number;
  status: "Active" | "Scheduled";
  blocks: string[];
  audience: string;
  restricted: boolean;
  schedule: string;
  warning: string | null;
};
export type HiddenPromotion = { id: string; routeId: string; title: string; reason: string };

const when = (iso: string | null) => summaryDate(toLocalDateTime(iso));

/**
 * One ordered list for the whole storefront. Only promotions that can appear are ranked, highest priority first.
 * The input order breaks ties, so callers pass promotions newest-saved first, as the storefront does.
 */
export function buildPriorityList(promotions: PromotionRecord[]): { rows: PriorityRow[]; hidden: HiddenPromotion[] } {
  // Stable sorting preserves the saved creation-order tie break.
  const ranked = promotions.filter(isRanked).sort((a, b) => b.settings.priority - a.settings.priority);
  const rows = ranked.map((promotion): PriorityRow => {
    const customers = promotion.shopify.customers;
    const restricted = !customers.appliesToAllCustomers;
    const scope = promotion.shopify.bxgy?.get.products ?? promotion.shopify.products;
    const allProducts = promotion.type === "Order" || promotion.type === "Shipping" || scope.allProducts;
    const startsOn = when(promotion.startsAt);
    const endsOn = when(promotion.endsAt);
    return {
      id: promotion.id,
      routeId: promotion.routeId,
      title: promotion.title,
      priority: promotion.settings.priority,
      status: promotion.status === "SCHEDULED" ? "Scheduled" : "Active",
      blocks: placements.filter(placement => promotion.settings[placement.flag]).map(placement => placement.title),
      audience: !restricted ? "All customers" : customers.segments.length ? "Selected customer segments (login required)" : "Selected customers (login required)",
      restricted,
      schedule: promotion.status === "SCHEDULED" && startsOn ? `Starts ${startsOn}` : endsOn ? `Ends ${endsOn}` : "No end date",
      warning: promotion.settings.showCollectionPage && !allProducts && !scope.collections.length ? "The collection banner needs a discount that targets collections, so it will not appear." : null,
    };
  });
  const hidden = promotions.filter(promotion => !isRanked(promotion)).map(promotion => ({ id: promotion.id, routeId: promotion.routeId, title: promotion.title, reason: whyNotRanked(promotion)! }));
  return { rows, hidden };
}
