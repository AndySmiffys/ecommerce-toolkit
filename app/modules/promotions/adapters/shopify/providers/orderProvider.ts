import type { PromotionCapabilities } from "../../../models/shopify";
import {
  getDiscountType,
  type ShopifyDiscountNode,
} from "../../../types/discount";
import type { PromotionTypeData } from "../types";
import { PromotionProvider } from "./PromotionProvider";
import { mapDiscountProducts } from "./shared";

/**
 * Owns order-promotion mapping and capabilities.
 * Does not own Shopify queries, UI rendering, or common promotion mapping.
 */
export class OrderProvider extends PromotionProvider {
  readonly type = "Order" as const;

  readonly capabilities: PromotionCapabilities = {
    supportsProducts: false,
    supportsShipping: false,
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
      products: mapDiscountProducts(node),
      bxgy: null,
      shipping: null,
    };
  }
}

export const orderProvider = new OrderProvider();
