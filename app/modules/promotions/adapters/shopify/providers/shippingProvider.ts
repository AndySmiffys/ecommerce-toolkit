import type { PromotionCapabilities } from "../../../models/shopify";
import {
  getDiscountType,
  type ShopifyDiscountNode,
} from "../../../types/discount";
import type { PromotionTypeData } from "../types";
import { PromotionProvider } from "./PromotionProvider";
import { mapEmptyProducts, mapShipping } from "./shared";

/**
 * Owns shipping-promotion mapping and capabilities.
 * Does not own Shopify queries, UI rendering, or common promotion mapping.
 */
export class ShippingProvider extends PromotionProvider {
  readonly type = "Shipping" as const;

  readonly capabilities: PromotionCapabilities = {
    supportsProducts: false,
    supportsShipping: true,
    supportsCustomers: true,
    supportsConditions: true,
    supportsCombinations: true,
    supportsWebsiteBadge: false,
    supportsCountdown: true,
    supportsLandingPage: true,
    supportsAnalytics: true,
    supportsHealthChecks: true,
  };

  supports(node: ShopifyDiscountNode): boolean {
    return getDiscountType(node) === this.type;
  }

  map(node: ShopifyDiscountNode): PromotionTypeData {
    return {
      products: mapEmptyProducts(),
      bxgy: null,
      shipping: mapShipping(node),
    };
  }
}

export const shippingProvider = new ShippingProvider();
