import {
  getDiscountCode,
  getDiscountCreator,
  getDiscountMethod,
  getDiscountValue,
  getMinimumRequirement,
  shouldSyncDiscount,
  type ShopifyDiscountNode,
} from "../types/discount";

import type {
  PromotionConditions,
  PromotionCustomers,
  PromotionGeneral,
  PromotionReduction,
  PromotionSchedule,
  PromotionStatus,
  PromotionCombinations,
  ShopifyPromotion,
} from "../models/shopify";
import { shopifyProviderManager } from "./shopify/registry";
import type { ShopifyPromotionProvider } from "./shopify/types";

export type AdaptedShopifyDiscount = {
  shopify: ShopifyPromotion;
  includedInSync: boolean;
};

function mapPromotionStatus(
  value: string | undefined,
): PromotionStatus {
  switch (value) {
    case "ACTIVE":
      return "ACTIVE";
    case "SCHEDULED":
      return "SCHEDULED";
    case "EXPIRED":
      return "EXPIRED";
    default:
      return "UNKNOWN";
  }
}

/** The plain percentage or amount a discount takes off, or null for anything else (buy X get Y, shipping, a discount we cannot read). */
function adaptReduction(node: ShopifyDiscountNode): PromotionReduction | null {
  const value = node.discount.customerGets?.value;
  if (!value) return null;
  if (value.__typename === "DiscountPercentage" && typeof value.percentage === "number") return { kind: "percentage", percentage: value.percentage };
  if (value.__typename === "DiscountAmount" && value.amount) {
    const amount = Number(value.amount.amount);
    if (Number.isFinite(amount)) return { kind: "amount", amount, currency: value.amount.currencyCode, perItem: value.appliesOnEachItem === true };
  }
  return null;
}

function adaptGeneral(
  node: ShopifyDiscountNode,
  provider: ShopifyPromotionProvider,
): PromotionGeneral {
  return {
    title: node.discount.title ?? "Untitled promotion",
    summary: node.discount.summary ?? "No summary available",
    method: getDiscountMethod(node),
    type: provider.type,
    status: mapPromotionStatus(node.discount.status),
    value: getDiscountValue(node),
    reduction: adaptReduction(node),
    code: getDiscountCode(node),
    createdBy: getDiscountCreator(node),
  };
}

function adaptCustomers(
  node: ShopifyDiscountNode,
): PromotionCustomers {
  const context = node.discount.context;

  if (!context || context.__typename === "DiscountBuyerSelectionAll") {
    return {
      appliesToAllCustomers: true,
      customers: [],
      segments: [],
    };
  }

  if (context.__typename === "DiscountCustomers") {
    return {
      appliesToAllCustomers: false,
      customers: (context.customers ?? []).map((customer) => ({
        id: customer.id,
        name: customer.displayName,
      })),
      segments: [],
    };
  }

  if (context.__typename === "DiscountCustomerSegments") {
    return {
      appliesToAllCustomers: false,
      customers: [],
      segments: (context.segments ?? []).map((segment) => ({
        id: segment.id,
        name: segment.name,
      })),
    };
  }

  return {
    appliesToAllCustomers: false,
    customers: [],
    segments: [],
  };
}

function adaptConditions(
  node: ShopifyDiscountNode,
): PromotionConditions {
  const requirement = node.discount.minimumRequirement;

  const minimumSubtotal =
    requirement?.__typename === "DiscountMinimumSubtotal" &&
    requirement.greaterThanOrEqualToSubtotal
      ? {
          amount:
            requirement.greaterThanOrEqualToSubtotal.amount,
          currencyCode:
            requirement.greaterThanOrEqualToSubtotal.currencyCode,
        }
      : null;

  const rawMinimumQuantity =
    requirement?.__typename === "DiscountMinimumQuantity"
      ? requirement.greaterThanOrEqualToQuantity
      : undefined;

  const parsedMinimumQuantity =
    rawMinimumQuantity !== undefined
      ? Number(rawMinimumQuantity)
      : null;

  return {
    minimumRequirement: getMinimumRequirement(node),
    minimumSubtotal,
    minimumQuantity:
      parsedMinimumQuantity !== null &&
      Number.isFinite(parsedMinimumQuantity)
        ? parsedMinimumQuantity
        : null,
    usageLimit: null,
    appliesOncePerCustomer: false,
  };
}

function adaptSchedule(
  node: ShopifyDiscountNode,
): PromotionSchedule {
  return {
    startsAt: node.discount.startsAt ?? null,
    endsAt: node.discount.endsAt ?? null,
  };
}

function adaptCombinations(): PromotionCombinations {
  return {
    orderDiscounts: false,
    productDiscounts: false,
    shippingDiscounts: false,
  };
}

export function adaptShopifyDiscount(
  node: ShopifyDiscountNode,
): AdaptedShopifyDiscount {
  const { provider, typeData } = shopifyProviderManager.map(node);

  return {
    shopify: {
      general: adaptGeneral(node, provider),
      capabilities: provider.capabilities,
      products: typeData.products,
      bxgy: typeData.bxgy,
      shipping: typeData.shipping,
      customers: adaptCustomers(node),
      conditions: adaptConditions(node),
      schedule: adaptSchedule(node),
      combinations: adaptCombinations(),
    },
    includedInSync: shouldSyncDiscount(node),
  };
}
