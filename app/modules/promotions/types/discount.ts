import {
  getPromotionMethodFromShopifyType,
  getPromotionTypeFromShopifyDiscount,
  type ShopifyDiscountTypename,
} from "../adapters/shopifyDiscountRegistry";

import type {
  PromotionMethod,
  PromotionType,
} from "../models/shopify";

export type ShopifyDiscountNode = {
  id: string;

  events: {
    nodes: Array<{
      id: string;
      createdAt: string;
      message: string;
      appTitle?: string | null;
      attributeToApp?: boolean;
      attributeToUser?: boolean;
    }>;
  };

  discount: {
    __typename: ShopifyDiscountTypename | string;
    title?: string;
    status?: string;
    summary?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    discountClasses?: string[];
    usageLimit?: number | null;
    appliesOncePerCustomer?: boolean;
    usesPerOrderLimit?: string | number | null;
    combinesWith?: { productDiscounts: boolean; orderDiscounts: boolean; shippingDiscounts: boolean; productDiscountsWithTagsOnSameCartLine?: string[] | null };
    customerBuys?: { value: { __typename: string; quantity?: string; amount?: string }; items: NonNullable<ShopifyDiscountNode["discount"]["customerGets"]>["items"] };


    context?: {
      __typename: string;
      all?: string;
      customers?: Array<{
        id: string;
        displayName: string;
      }>;
      segments?: Array<{
        id: string;
        name: string;
      }>;
    };

    codesCount?: { count: number } | null;
    codes?: {
      nodes: Array<{
        code: string;
      }>;
    };

    customerGets?: {
      appliesOnOneTimePurchase?: boolean;
      appliesOnSubscription?: boolean;
      value: {
        __typename: string;
        quantity?: { quantity: string };
        effect?: { __typename: string; percentage?: number; amount?: { amount: string; currencyCode: string }; appliesOnEachItem?: boolean };
        percentage?: number;
        amount?: {
          amount: string;
          currencyCode: string;
        };
        appliesOnEachItem?: boolean;
      };

      items: {
        __typename: string;
        allItems?: boolean;
        products?: {
          pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
          nodes: Array<{
            id: string;
            title: string;
          }>;
        };
        productVariants?: {
          pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
          nodes: Array<{
            id: string;
            title: string;
            product?: {
              id: string;
              title: string;
            };
          }>;
        };
        collections?: {
          pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
          nodes: Array<{
            id: string;
            title: string;
            productsCount?: {
              count: number;
            };
          }>;
        };
      };
    };

    minimumRequirement?: {
      __typename: string;
      greaterThanOrEqualToSubtotal?: {
        amount: string;
        currencyCode: string;
      };
      greaterThanOrEqualToQuantity?: string;
    } | null;

    appliesOnOneTimePurchase?: boolean;
    appliesOnSubscription?: boolean;

    maximumShippingPrice?: {
      amount: string;
      currencyCode: string;
    } | null;

    destinationSelection?: {
      __typename: string;
      allCountries?: boolean;
      countries?: string[];
    } | null;
  };
};

const EXCLUDED_DISCOUNT_APPS = [
  "Dotdigital",
];

export function getDiscountCreator(
  node: ShopifyDiscountNode,
): string {
  const creationEvent = node.events.nodes[0];

  if (!creationEvent) {
    return "Unknown";
  }

  if (
    creationEvent.attributeToApp &&
    creationEvent.appTitle
  ) {
    return creationEvent.appTitle;
  }

  if (creationEvent.attributeToUser) {
    return creationEvent.appTitle ?? "Shopify admin user";
  }

  return creationEvent.appTitle ?? "Unknown";
}

export function getDiscountType(
  node: ShopifyDiscountNode,
): PromotionType {
  return getPromotionTypeFromShopifyDiscount(
    node.discount.__typename,
    node.discount.discountClasses,
  );
}

export function shouldSyncDiscount(
  node: ShopifyDiscountNode,
): boolean {
  const creator = getDiscountCreator(node).toLowerCase();

  return !EXCLUDED_DISCOUNT_APPS.some(
    (excludedApp) =>
      creator === excludedApp.toLowerCase(),
  );
}

export function getDiscountMethod(
  node: ShopifyDiscountNode,
): PromotionMethod {
  return getPromotionMethodFromShopifyType(
    node.discount.__typename,
  );
}

export function getDiscountCode(
  node: ShopifyDiscountNode,
): string | null {
  if ((node.discount.codesCount?.count ?? node.discount.codes?.nodes.length ?? 0) > 1) return null;
  return node.discount.codes?.nodes[0]?.code ?? null;
}

export function getDiscountValue(
  node: ShopifyDiscountNode,
): string {
  if (getDiscountType(node) === "Shipping") {
    return "Free shipping";
  }

  const value = node.discount.customerGets?.value;

  if (!value) {
    return "Not yet supported";
  }

  if (
    value.__typename === "DiscountPercentage" &&
    value.percentage !== undefined
  ) {
    const percentage = value.percentage * 100;

    return `${percentage.toLocaleString("en-GB", {
      maximumFractionDigits: 2,
    })}%`;
  }

  if (
    value.__typename === "DiscountAmount" &&
    value.amount
  ) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: value.amount.currencyCode,
    }).format(Number(value.amount.amount));
  }

  return "Unknown";
}

export function getDiscountAppliesTo(
  node: ShopifyDiscountNode,
): string {
  if (getDiscountType(node) === "Shipping") {
    const destination = node.discount.destinationSelection;

    if (destination?.allCountries) {
      return "All countries";
    }

    const countryCount = destination?.countries?.length ?? 0;

    if (countryCount > 0) {
      return `${countryCount} selected ${countryCount === 1 ? "country" : "countries"}`;
    }

    return "Shipping destinations";
  }

  const items = node.discount.customerGets?.items;

  if (!items) {
    return "Not yet supported";
  }

  if (items.__typename === "AllDiscountItems") {
    return "All products";
  }

  if (items.__typename === "DiscountCollections") {
    const count = items.collections?.nodes.length ?? 0;

    return `${count} selected ${count === 1 ? "collection" : "collections"}`;
  }

  if (items.__typename === "DiscountProducts") {
    const productCount = items.products?.nodes.length ?? 0;
    const variantCount = items.productVariants?.nodes.length ?? 0;

    if (variantCount > 0) {
      return `${productCount} products and ${variantCount} variants`;
    }

    return `${productCount} selected ${productCount === 1 ? "product" : "products"}`;
  }

  return "Unknown";
}

export function getMinimumRequirement(
  node: ShopifyDiscountNode,
): string {
  const requirement = node.discount.minimumRequirement;

  if (!requirement) {
    return "None";
  }

  if (
    requirement.__typename === "DiscountMinimumSubtotal" &&
    requirement.greaterThanOrEqualToSubtotal
  ) {
    const subtotal = requirement.greaterThanOrEqualToSubtotal;

    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: subtotal.currencyCode,
    }).format(Number(subtotal.amount));
  }

  if (
    requirement.__typename === "DiscountMinimumQuantity" &&
    requirement.greaterThanOrEqualToQuantity
  ) {
    return `${requirement.greaterThanOrEqualToQuantity} items`;
  }

  return "None";
}
