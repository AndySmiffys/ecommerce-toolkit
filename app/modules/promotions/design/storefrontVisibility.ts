import { placements, type WebsiteDraft } from "./design";
export type StorefrontVisibilityContext = {
  eligibility: "all" | "segments" | "customers";
  eligibilityCount: number;
  startsAt: string | null;
  endsAt: string | null;
  codeList: boolean;
  productTarget: "products" | "collections" | null;
};
export type VisibilityNotice = { id: string; tone: "warning" | "info"; message: string };
export function customerVisibilityMessage(eligibility: StorefrontVisibilityContext["eligibility"]) {
  // The storefront is served from data Shopify holds for every visitor, which cannot include who a customer is.
  return eligibility === "segments" || eligibility === "customers"
    ? "Promotions for specific customers or segments are not shown on the website yet. Shopify still applies the discount at checkout for the eligible customers, but this promotion will stay hidden on the storefront."
    : null;
}
export function storefrontVisibilityNotices(value: WebsiteDraft, context: StorefrontVisibilityContext, now: number): VisibilityNotice[] {
  const notices: VisibilityNotice[] = [];
  const caution = (id: string, message: string) => notices.push({ id, tone: "warning", message });
  if (context.codeList) caution("codes", "Individual code lists are not displayed on the website. Keep this promotion in Draft and distribute the codes using the CSV download.");
  else if (!value.websiteEnabled) caution("draft", "Website status is Draft. This promotion will not appear on the website until it is Enabled and saved.");
  if (!placements.some(placement => value[placement.flag])) caution("blocks", "No website blocks are selected. Select at least one block to display this promotion.");
  const audience = customerVisibilityMessage(context.eligibility);
  if (audience) {
    caution("audience", audience);
    if (!context.eligibilityCount) caution("audience-empty", "No customers or segments are selected. Select the eligible audience before saving.");
  }
  if (context.startsAt && Date.parse(context.startsAt) > now) caution("scheduled", "The start date is in the future. This promotion will stay hidden until its start date and time.");
  if (context.endsAt && Date.parse(context.endsAt) <= now) caution("ended", "The end date has passed. This promotion will stay hidden unless you change or remove the end date and save.");
  if (context.productTarget === "products" && value.showCollectionPage) caution("collection", "The collection banner will not appear for discounts targeting individual products or variants. Target qualifying collections to show a collection banner.");
  if (context.productTarget === "collections" && value.showProductBadge) caution("badge-collections", "Product badges can only be shown for specific products. This discount targets collections, so no badge will appear. Choose Specific products under Applies to to show badges.");
  if (context.productTarget && (value.showProductPage || value.showProductBadge)) notices.push({ id: "products", tone: "info", message: context.productTarget === "collections" ? "Product offers and badges only appear on products in the qualifying collections." : "Product offers and badges only appear on qualifying products. For variant-only discounts, the product offer also requires an eligible variant to be selected." });
  return notices;
}
