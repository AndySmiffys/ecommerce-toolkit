export type PromotionMethod =
  | "Code"
  | "Automatic";

export type PromotionType =
  | "Product"
  | "Order"
  | "Shipping"
  | "Buy X get Y"
  | "Unknown";

export type PromotionStatus =
  | "ACTIVE"
  | "SCHEDULED"
  | "EXPIRED"
  | "UNKNOWN";

export type PromotionCapabilities = {
  supportsProducts: boolean;
  supportsShipping: boolean;
  supportsCustomers: boolean;
  supportsConditions: boolean;
  supportsCombinations: boolean;
  supportsWebsiteBadge: boolean;
  supportsCountdown: boolean;
  supportsLandingPage: boolean;
  supportsAnalytics: boolean;
  supportsHealthChecks: boolean;
};

/**
 * How much a product or order discount takes off, as Shopify gives it (not the text for people that `value` holds). A percentage is the
 * fraction Shopify uses (0.2 is 20%). An amount is in major units, and `perItem` says whether it comes off each item or off the whole order.
 */
export type PromotionReduction =
  | { kind: "percentage"; percentage: number }
  | { kind: "amount"; amount: number; currency: string; perItem: boolean };

export type PromotionGeneral = {
  title: string;
  summary: string;

  method: PromotionMethod;
  type: PromotionType;
  status: PromotionStatus;

  value: string;
  /** Null for buy X get Y, shipping and anything else that is not a plain percentage or amount off. */
  reduction?: PromotionReduction | null;
  code: string | null;

  createdBy: string;
};

export type PromotionProductReference = {
  id: string;
  title: string;
};

export type PromotionVariantReference = {
  id: string;
  title: string;
  productId: string | null;
  productTitle: string | null;
};

export type PromotionCollectionReference = {
  id: string;
  title: string;
  productCount: number | null;
};

export type PromotionProducts = {
  appliesTo: string;

  allProducts: boolean;

  products: PromotionProductReference[];
  variants: PromotionVariantReference[];
  collections: PromotionCollectionReference[];
};

export type PromotionBxgyRewardType =
  | "FREE"
  | "PERCENTAGE"
  | "FIXED_AMOUNT"
  | "UNKNOWN";

export type PromotionBxgy = {
  buy: {
    quantity: number | null;
    purchaseAmount: string | null;
    products: PromotionProducts;
  };

  get: {
    quantity: number | null;
    rewardType: PromotionBxgyRewardType;
    rewardValue: number | null;
    rewardCurrencyCode: string | null;
    products: PromotionProducts;
  };
};

export type PromotionShipping = {
  appliesTo: string;
  allCountries: boolean;
  countries: string[];

  maximumShippingPrice: {
    amount: string;
    currencyCode: string;
  } | null;

  appliesOnOneTimePurchase: boolean;
  appliesOnSubscription: boolean;
};

export type PromotionCustomers = {
  appliesToAllCustomers: boolean;

  customers: Array<{
    id: string;
    name: string;
  }>;

  segments: Array<{
    id: string;
    name: string;
  }>;
};

export type PromotionConditions = {
  minimumRequirement: string;

  minimumSubtotal: {
    amount: string;
    currencyCode: string;
  } | null;

  minimumQuantity: number | null;

  usageLimit: number | null;
  appliesOncePerCustomer: boolean;
};

export type PromotionSchedule = {
  startsAt: string | null;
  endsAt: string | null;
};

export type PromotionCombinations = {
  orderDiscounts: boolean;
  productDiscounts: boolean;
  shippingDiscounts: boolean;
};

export type ShopifyPromotion = {
  general: PromotionGeneral;
  capabilities: PromotionCapabilities;
  products: PromotionProducts;
  bxgy: PromotionBxgy | null;
  shipping: PromotionShipping | null;
  customers: PromotionCustomers;
  conditions: PromotionConditions;
  schedule: PromotionSchedule;
  combinations: PromotionCombinations;
};