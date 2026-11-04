import { placements, type WebsiteDraft } from "./design";
import type { PromotionRecord } from "../models/promotion";

// The priority order only ranks promotions that can actually appear on the storefront:
// not ended, enabled for the website, included in the sync, and with a block chosen.
export type RankingWebsite = Pick<WebsiteDraft, "websiteEnabled" | "showProductPage" | "showCollectionPage" | "showProductBadge" | "showHeaderBanner">;

/** Why a promotion is outside the priority order, from its end date and website settings. Null means it is in. */
export function rankBlocker(input: { endsAt: string | null | undefined; website: RankingWebsite }, now = Date.now()): string | null {
  if (input.endsAt && Date.parse(input.endsAt) <= now) return "It has ended.";
  if (!input.website.websiteEnabled) return "Its website status is Draft.";
  if (!placements.some(placement => input.website[placement.flag])) return "No website blocks are selected.";
  return null;
}

export function canRank(input: { endsAt: string | null | undefined; website: RankingWebsite }, now = Date.now()): boolean {
  return rankBlocker(input, now) === null;
}

/** The same rule for a saved promotion, using its Shopify status. Null means it is in the order. */
export function whyNotRanked(promotion: PromotionRecord): string | null {
  if (promotion.status === "EXPIRED") return "It has ended.";
  if (promotion.status !== "ACTIVE" && promotion.status !== "SCHEDULED") return "Its status is not Active or Scheduled.";
  return rankBlocker({ endsAt: null, website: promotion.settings });
}

export const isRanked = (promotion: PromotionRecord) => whyNotRanked(promotion) === null;
