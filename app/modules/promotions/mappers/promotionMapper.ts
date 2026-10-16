import { adaptShopifyDiscount } from "../adapters/shopifyDiscountAdapter";
import { promotionDiscountId } from "../design/discountIdentity";
import type { PromotionRecord } from "../models/promotion";
import type { PromotionWebsiteSettings } from "../models/website";
import type { ShopifyDiscountNode } from "../types/discount";

function mapDefaultWebsiteSettings(): PromotionWebsiteSettings {
  return {
    websiteEnabled: false,

    showProductPage: false,
    showCollectionPage: false,
    showProductBadge: false,
    showCountdown: false,
    showHeaderBanner: false,

    headline: null,
    body: null,
    badgeText: null,
    countdownText: null,
    buttonText: null,
    buttonUrl: null,

    backgroundColour: null,
    textColour: null,
    badgeColour: null,

    priority: 0,

    lastSyncedAt: null,
    lastSyncError: null,
  };
}

export function mapDiscountToPromotion(
  node: ShopifyDiscountNode,
): PromotionRecord {
  const {
    shopify,
    includedInSync,
  } = adaptShopifyDiscount(node);

  return {
    id: promotionDiscountId(node.id),
    routeId: getRouteId(node.id),

    /*
    |--------------------------------------------------------------------------
    | Temporary compatibility properties
    |--------------------------------------------------------------------------
    */

    title: shopify.general.title,
    summary: shopify.general.summary,

    method: shopify.general.method,
    type: shopify.general.type,
    status: shopify.general.status,

    value: shopify.general.value,
    code: shopify.general.code,

    appliesTo: shopify.products.appliesTo,
    minimumRequirement:
      shopify.conditions.minimumRequirement,
    createdBy: shopify.general.createdBy,
    includedInSync,

    startsAt: shopify.schedule.startsAt,
    endsAt: shopify.schedule.endsAt,

    /*
    |--------------------------------------------------------------------------
    | Canonical structured model
    |--------------------------------------------------------------------------
    */

    shopify,
    settings:
      mapDefaultWebsiteSettings(),
  };
}

export function mapDiscountsToPromotions(
  nodes: ShopifyDiscountNode[],
): PromotionRecord[] {
  return nodes.map(mapDiscountToPromotion);
}

function getRouteId(
  shopifyId: string,
): string {
  return shopifyId.split("/").pop() ?? shopifyId;
}
