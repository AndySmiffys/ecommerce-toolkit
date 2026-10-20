// Who made a discount decides where it appears in the Promotions list. Discounts made by hand in Shopify, by Shopify
// itself or by this app are the merchant's promotions. Discounts made by any other app (Dotdigital makes thousands of
// single-use codes) are kept out of the way by default, and can be shown on request. Only a creator that is clearly
// another app is treated as one: when the creator is not known the discount stays visible.

/** How a Shopify event names the creator of a discount made by hand in the admin. */
const ownCreators = /^(shopify\b|ecommerce toolkit|smiffys promotion engine|unknown$)/i;

export function isOtherApp(createdBy: string | null | undefined): boolean {
  const name = (createdBy ?? "").trim();
  return Boolean(name) && !ownCreators.test(name);
}

export const sourceChoices = ["", "other", "all"] as const;
export type SourceChoice = (typeof sourceChoices)[number];

/** The source filter from the address: promotions by default, "other" for other apps, "all" for everything. */
export function sourceFromParam(value: string | null): SourceChoice {
  return value === "other" || value === "all" ? value : "";
}

export type DiscountStatus = "active" | "scheduled" | "expired";

/** A discount's status from its dates, the way Shopify works it out. */
export function discountStatusAt(startsAt: Date | null, endsAt: Date | null, now: Date): DiscountStatus {
  if (startsAt && startsAt > now) return "scheduled";
  if (endsAt && endsAt <= now) return "expired";
  return "active";
}
