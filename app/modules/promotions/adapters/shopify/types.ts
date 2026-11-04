import type {
  PromotionBxgy,
  PromotionCapabilities,
  PromotionProducts,
  PromotionShipping,
  PromotionType,
} from "../../models/shopify";
import type { ShopifyDiscountNode } from "../../types/discount";

export type PromotionTypeData = {
  products: PromotionProducts;
  bxgy: PromotionBxgy | null;
  shipping: PromotionShipping | null;
};

export interface ShopifyPromotionProvider {
  readonly type: PromotionType;
  readonly capabilities: PromotionCapabilities;

  supports(node: ShopifyDiscountNode): boolean;
  map(node: ShopifyDiscountNode): PromotionTypeData;
}
