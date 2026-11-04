import { createHash } from "node:crypto";
import { getDiscount, type ShopifyAdminClient } from "./discount.server";
import { mapDiscountToPromotion } from "../mappers/promotionMapper";
import { placements, websiteFromSettings, type Placement } from "../design/design";
import { storefrontIneligibility, type StorefrontContext } from "./storefrontEligibility.server";
import type { getLatestPromotionSettings } from "./promotionSettings.server";
import type { PromotionRecord } from "../models/promotion";

type Settings = Awaited<ReturnType<typeof getLatestPromotionSettings>>;
export const storefrontVersion = "selection-check-1";
export function storefrontRevision(shop: string, rows: Settings, appId = process.env.SHOPIFY_API_KEY || "") {
  return createHash("sha256").update(JSON.stringify({ shop, appId, rows })).digest("hex");
}
export function storefrontRenderKey(promotion: PromotionRecord, placement: Placement) {
  return createHash("sha256").update(JSON.stringify({ placement, value: websiteFromSettings(promotion.settings), code: promotion.code, endsAt: promotion.endsAt })).digest("hex");
}
export type SelectionCheck = { id: string; title: string; priority: number; reason: string; eligible: boolean };
export async function selectStorefrontPromotion(api: ShopifyAdminClient, rows: Settings, context: StorefrontContext, inspectAll = false) {
  const checks: SelectionCheck[] = [];
  let selected: PromotionRecord | null = null;
  const flag = placements.find(placement => placement.id === context.placement)!.flag;
  for (const stored of rows) {
    let reason = !stored.websiteEnabled ? "Website status is Draft." : !stored[flag] ? `${context.placement === "header" ? "Header" : "This placement"} is not selected.` : null;
    let promotion: PromotionRecord | null = null;
    let title = `Discount ${stored.shopifyDiscountId.split("/").pop()}`;
    if (!reason || inspectAll) {
      const node = await getDiscount(api, stored.shopifyDiscountId, 250);
      if (!node) reason ||= "The Shopify discount no longer exists.";
      else {
        promotion = mapDiscountToPromotion(node);
        title = promotion.title;
        promotion.settings = { ...promotion.settings, ...stored, lastSyncedAt: null };
        let memberSegmentIds: string[] = [];
        const segments = promotion.shopify.customers.segments;
        if (!reason && context.customerId && segments.length) {
          const response = await api.graphql(`query PromotionMembership($customer: ID!, $segments: [ID!]!) { customerSegmentMembership(customerId: $customer, segmentIds: $segments) { memberships { segmentId isMember } } }`, { variables: { customer: context.customerId, segments: segments.map(segment => segment.id) } });
          const result = await response.json();
          if (result.errors?.length) reason = "Customer segment membership could not be checked.";
          memberSegmentIds = (result.data?.customerSegmentMembership?.memberships ?? []).filter((member: { isMember: boolean }) => member.isMember).map((member: { segmentId: string }) => member.segmentId);
        }
        reason ||= storefrontIneligibility(promotion, { ...context, memberSegmentIds });
      }
    }
    const eligible = !reason && Boolean(promotion);
    if (eligible && !selected) selected = promotion;
    checks.push({ id: stored.shopifyDiscountId, title, priority: stored.priority, eligible, reason: reason || (selected === promotion ? "Selected for the header." : "Eligible, but another promotion takes precedence.") });
    if (selected && !inspectAll) break;
  }
  return { selected, checks };
}

export async function checkStorefrontConnection(shop: string, revision: string, expectedId: string | null, fetcher: typeof fetch = fetch) {
  const url = new URL('/apps/promotion-engine', `https://${shop}`);
  url.searchParams.set('placement', 'header');
  url.searchParams.set('_check', String(Date.now()));
  try {
    const response = await fetcher(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) return `The storefront request returned HTTP ${response.status}.`;
    if (!response.headers.get('content-type')?.includes('application/json')) return "The storefront did not return promotion data. A password page, redirect, or different proxy route may be blocking the check.";
    const result = await response.json();
    if (result.version !== storefrontVersion) return "The storefront returned an older or different renderer. Check that the theme embed and CLI session use the same installed app and proxy URL.";
    if (result.revision !== revision) return "The storefront is reading different saved settings or a different app configuration. Check the installed app, CLI configuration, and proxy destination.";
    if ((result.promotionId ?? null) !== expectedId) return "The settings match, but the selected promotion differs. Run the check again in case a discount or its schedule changed.";
    return "The storefront and editor agree on the saved settings and selected header for a visitor who is not logged in.";
  } catch { return "The storefront connection could not be checked. It may be password protected, unavailable, or the request may have timed out."; }
}
