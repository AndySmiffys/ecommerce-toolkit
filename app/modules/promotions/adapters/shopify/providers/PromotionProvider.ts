import type {
  PromotionCapabilities,
  PromotionType,
} from "../../../models/shopify";
import type { ShopifyDiscountNode } from "../../../types/discount";
import type {
  PromotionTypeData,
  ShopifyPromotionProvider,
} from "../types";

/**
 * Defines the common contract for Shopify promotion providers.
 *
 * Concrete providers own promotion-type-specific capabilities, detection,
 * and mapping. This base class provides the shared extension point for
 * future provider behaviour such as health, analytics, website presentation,
 * editing, and actions.
 */
export abstract class PromotionProvider
  implements ShopifyPromotionProvider
{
  abstract readonly type: PromotionType;
  abstract readonly capabilities: PromotionCapabilities;

  abstract supports(node: ShopifyDiscountNode): boolean;
  abstract map(node: ShopifyDiscountNode): PromotionTypeData;
}
