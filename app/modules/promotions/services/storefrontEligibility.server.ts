import type { PromotionRecord } from "../models/promotion";
import type { Placement } from "../design/design";
export type StorefrontContext = { placement: Placement; productId: string | null; variantId: string | null; collectionId: string | null; productCollectionIds: string[]; customerId: string | null; memberSegmentIds: string[]; now: number };
export function storefrontIneligibility(promotion: PromotionRecord, context: StorefrontContext): string | null {
  if (promotion.method === "Code" && !promotion.code) return "No discount code is available.";
  if (!promotion.settings.websiteEnabled) return "Website status is Draft.";
  if (promotion.status !== "ACTIVE") return `Shopify discount status is ${promotion.status}.`;
  if (promotion.startsAt && Date.parse(promotion.startsAt) > context.now) return "The promotion has not started.";
  if (promotion.endsAt && Date.parse(promotion.endsAt) <= context.now) return "The promotion has ended.";
  const customers = promotion.shopify.customers;
  if (!customers.appliesToAllCustomers && !customers.customers.some(c => c.id === context.customerId) && !customers.segments.some(s => context.memberSegmentIds.includes(s.id))) return context.customerId ? "This customer does not qualify." : "Requires an eligible logged-in customer.";
  const scope = promotion.shopify.bxgy?.get.products ?? promotion.shopify.products;
  if (context.placement === "header") return null;
  if (promotion.type === "Order" || promotion.type === "Shipping" || scope.allProducts) return null;
  if (context.placement === "collection") {
    // Explicit product-only discounts don't qualify an entire collection banner.
    return context.collectionId && scope.collections.some(c => c.id === context.collectionId) ? null : "This collection does not qualify.";
  }
  if (!context.productId) return "No product context is available.";
  if (scope.products.some(p => p.id === context.productId)) return null;
  if (scope.collections.some(c => context.productCollectionIds.includes(c.id))) return null;
  return scope.variants.some(v => v.productId === context.productId && (context.placement === "badge" || v.id === context.variantId)) ? null : "This product or selected variant does not qualify.";
}

export function matchesStorefront(promotion: PromotionRecord, context: StorefrontContext): boolean {
  return storefrontIneligibility(promotion, context) === null;
}
