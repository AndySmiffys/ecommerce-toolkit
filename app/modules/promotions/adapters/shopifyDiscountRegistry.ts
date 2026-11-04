import type {
  PromotionMethod,
  PromotionType,
} from "../models/shopify";

export type ShopifyDiscountTypename =
  | "DiscountAutomaticBasic"
  | "DiscountCodeBasic"
  | "DiscountAutomaticBxgy"
  | "DiscountCodeBxgy"
  | "DiscountAutomaticFreeShipping"
  | "DiscountCodeFreeShipping";

type DiscountTypeDefinition = {
  method: PromotionMethod;
  type: PromotionType | null;
};

const SHOPIFY_DISCOUNT_REGISTRY: Record<
  ShopifyDiscountTypename,
  DiscountTypeDefinition
> = {
  DiscountAutomaticBasic: {
    method: "Automatic",
    type: null,
  },
  DiscountCodeBasic: {
    method: "Code",
    type: null,
  },
  DiscountAutomaticBxgy: {
    method: "Automatic",
    type: "Buy X get Y",
  },
  DiscountCodeBxgy: {
    method: "Code",
    type: "Buy X get Y",
  },
  DiscountAutomaticFreeShipping: {
    method: "Automatic",
    type: "Shipping",
  },
  DiscountCodeFreeShipping: {
    method: "Code",
    type: "Shipping",
  },
};

export function isSupportedShopifyDiscountTypename(
  value: string,
): value is ShopifyDiscountTypename {
  return value in SHOPIFY_DISCOUNT_REGISTRY;
}

export function getPromotionMethodFromShopifyType(
  typename: string,
): PromotionMethod {
  if (isSupportedShopifyDiscountTypename(typename)) {
    return SHOPIFY_DISCOUNT_REGISTRY[typename].method;
  }

  return typename.includes("Automatic")
    ? "Automatic"
    : "Code";
}

export function getPromotionTypeFromShopifyDiscount(
  typename: string,
  discountClasses: string[] = [],
): PromotionType {
  if (isSupportedShopifyDiscountTypename(typename)) {
    const registeredType =
      SHOPIFY_DISCOUNT_REGISTRY[typename].type;

    if (registeredType) {
      return registeredType;
    }
  }

  if (discountClasses.includes("PRODUCT")) {
    return "Product";
  }

  if (discountClasses.includes("ORDER")) {
    return "Order";
  }

  if (discountClasses.includes("SHIPPING")) {
    return "Shipping";
  }

  return "Unknown";
}
