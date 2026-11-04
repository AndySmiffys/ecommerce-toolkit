import type {
  PromotionBxgy,
  PromotionBxgyRewardType,
  PromotionCapabilities,
} from "../../../models/shopify";
import {
  getDiscountType,
  type ShopifyDiscountNode,
} from "../../../types/discount";
import type { PromotionTypeData } from "../types";
import { PromotionProvider } from "./PromotionProvider";
import { mapProductsFromItems } from "./shared";

type DiscountItems = NonNullable<
  NonNullable<ShopifyDiscountNode["discount"]["customerGets"]>["items"]
>;

type RewardEffect = {
  __typename: string;
  percentage?: number;
  amount?: {
    amount: string;
    currencyCode: string;
  };
};

type BxgyDiscountData = ShopifyDiscountNode["discount"] & {
  customerBuys?: {
    value?: {
      __typename: string;
      quantity?: string;
      amount?: string;
    };
    items?: DiscountItems;
  };
  customerGets?: {
    value: {
      __typename: string;
      quantity?: {
        quantity: string;
      };
      effect?: RewardEffect;
    };
    items: DiscountItems;
  };
};

function parseNumber(value: string | number | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getRewardType(
  effect: RewardEffect | undefined,
): PromotionBxgyRewardType {
  if (!effect) {
    return "UNKNOWN";
  }

  if (
    effect.__typename === "DiscountPercentage" &&
    effect.percentage !== undefined
  ) {
    return effect.percentage === 1 ? "FREE" : "PERCENTAGE";
  }

  if (
    effect.__typename === "DiscountAmount" &&
    effect.amount
  ) {
    return "FIXED_AMOUNT";
  }

  return "UNKNOWN";
}

function mapBxgy(node: ShopifyDiscountNode): PromotionBxgy {
  const discount = node.discount as BxgyDiscountData;
  const buyValue = discount.customerBuys?.value;
  const getValue = discount.customerGets?.value;
  const effect = getValue?.effect;
  const rewardType = getRewardType(effect);

  const rewardValue =
    rewardType === "FREE"
      ? 100
      : effect?.__typename === "DiscountPercentage"
        ? (effect.percentage ?? 0) * 100
        : effect?.amount
          ? Number(effect.amount.amount)
          : null;

  return {
    buy: {
      quantity:
        buyValue?.__typename === "DiscountQuantity"
          ? parseNumber(buyValue.quantity)
          : null,
      purchaseAmount:
        buyValue?.__typename === "DiscountPurchaseAmount"
          ? buyValue.amount ?? null
          : null,
      products: mapProductsFromItems(
        discount.customerBuys?.items,
        "No qualifying products returned",
      ),
    },
    get: {
      quantity: parseNumber(getValue?.quantity?.quantity),
      rewardType,
      rewardValue:
        rewardValue !== null && Number.isFinite(rewardValue)
          ? rewardValue
          : null,
      rewardCurrencyCode: effect?.amount?.currencyCode ?? null,
      products: mapProductsFromItems(
        discount.customerGets?.items,
        "No reward products returned",
      ),
    },
  };
}

/**
 * Owns Buy X get Y promotion mapping and capabilities.
 * Does not own Shopify queries, UI rendering, or common promotion mapping.
 */
export class BxgyProvider extends PromotionProvider {
  readonly type = "Buy X get Y" as const;

  readonly capabilities: PromotionCapabilities = {
    supportsProducts: false,
    supportsShipping: false,
    supportsCustomers: true,
    supportsConditions: true,
    supportsCombinations: true,
    supportsWebsiteBadge: true,
    supportsCountdown: true,
    supportsLandingPage: true,
    supportsAnalytics: true,
    supportsHealthChecks: true,
  };

  supports(node: ShopifyDiscountNode): boolean {
    return getDiscountType(node) === this.type;
  }

  map(node: ShopifyDiscountNode): PromotionTypeData {
    const bxgy = mapBxgy(node);

    return {
      products: bxgy.get.products,
      bxgy,
      shipping: null,
    };
  }
}

export const bxgyProvider = new BxgyProvider();
