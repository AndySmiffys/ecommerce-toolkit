import test from "node:test";
import assert from "node:assert/strict";
import { checkStorefrontConnection, selectStorefrontPromotion, storefrontRevision, storefrontVersion } from "../app/modules/promotions/services/storefrontSelection.server";
import type { getLatestPromotionSettings } from "../app/modules/promotions/services/promotionSettings.server";
import type { StorefrontContext } from "../app/modules/promotions/services/storefrontEligibility.server";
import { defaultDesign } from "../app/modules/promotions/design/design";
import type { ShopifyDiscountNode } from "../app/modules/promotions/types/discount";
import type { ShopifyAdminClient } from "../app/modules/promotions/services/discount.server";
const context: StorefrontContext = { placement: "header", productId: null, variantId: null, collectionId: null, productCollectionIds: [], customerId: null, memberSegmentIds: [], now: Date.parse("2026-10-09T12:00:00Z") };
type Rows = Awaited<ReturnType<typeof getLatestPromotionSettings>>;
function row(id: number, priority: number): Rows[number] {
  return { id, shop: "test.myshopify.com", shopifyDiscountId: `gid://shopify/DiscountNode/${id}`, priority, included: true, websiteEnabled: true, showHeaderBanner: true, showProductPage: true, showCollectionPage: true, showProductBadge: true, showCountdown: false, headline: `Header ${id}`, body: "", badgeText: "", countdownText: "", buttonText: "", buttonUrl: "", backgroundColour: "#ffffff", textColour: "#000000", badgeColour: "#000000", designJson: JSON.stringify(defaultDesign()), lastSyncedAt: null, lastSyncError: null, createdAt: new Date(0), updatedAt: new Date(0) };
}
function node(id: number): ShopifyDiscountNode {
  return { id: `gid://shopify/DiscountCodeNode/${id}`, events: { nodes: [] }, discount: { __typename: "DiscountCodeBasic", title: `Offer ${id}`, status: "ACTIVE", startsAt: "2026-10-01T00:00:00Z", endsAt: null, discountClasses: ["ORDER"], codes: { nodes: [{ code: `CODE${id}` }] }, context: { __typename: "DiscountBuyerSelectionAll", all: "ALL" }, customerGets: { value: { __typename: "DiscountPercentage", percentage: .1 }, items: { __typename: "AllDiscountItems", allItems: true } } } };
}
function api(nodes: ShopifyDiscountNode[]): ShopifyAdminClient {
  return { graphql: async (_query, options) => Response.json({ data: { discountNode: nodes.find(node => node.id.split("/").pop() === String(options?.variables?.id).split("/").pop()) || null } }) };
}
test("full Shopify selection switches to an edited higher priority, not the newest discount", async () => {
  const nodes = [node(1), node(2)];
  const first = await selectStorefrontPromotion(api(nodes), [row(2, 0), row(1, 0)], context);
  assert.equal(first.selected?.id, row(2, 0).shopifyDiscountId);
  const edited = await selectStorefrontPromotion(api(nodes), [row(1, 100), row(2, 0)], context);
  assert.equal(edited.selected?.id, row(1, 100).shopifyDiscountId);
  assert.equal(edited.selected?.settings.priority, 100);
  assert.equal(edited.selected?.settings.headline, "Header 1");
  const inspected = await selectStorefrontPromotion(api(nodes), [row(1, 100), row(2, 0)], context, true);
  assert.equal(inspected.selected?.id, edited.selected?.id);
  assert.equal(inspected.checks[1].reason, "Eligible, but another promotion takes precedence.");
});
test("header check explains each eligibility skip without bypassing customer restrictions", async () => {
  const nodes = Array.from({ length: 7 }, (_, i) => node(i + 1));
  nodes[2].discount.status = "SCHEDULED";
  nodes[4].discount.context = { __typename: "DiscountCustomers", customers: [{ id: "gid://shopify/Customer/42", displayName: "Test customer" }] };
  nodes[5].discount.endsAt = "2026-10-08T00:00:00Z";
  const rows = Array.from({ length: 7 }, (_, i) => row(i + 1, 100 - i));
  rows[0].websiteEnabled = false;
  rows[1].showHeaderBanner = false;
  nodes[3].discount.status = "EXPIRED";
  const result = await selectStorefrontPromotion(api(nodes), rows, context, true);
  assert.equal(result.selected?.id, rows[6].shopifyDiscountId);
  assert.deepEqual(result.checks.map(check => check.reason), ["Website status is Draft.", "Header is not selected.", "Shopify discount status is SCHEDULED.", "Shopify discount status is EXPIRED.", "Requires an eligible logged-in customer.", "The promotion has ended.", "Selected for the header."]);
});
test("proxy identity detects outdated responses and different saved data, with clear password-page results", async () => {
  const rows = [row(1, 100)];
  const revision = storefrontRevision("test.myshopify.com", rows, "app-one");
  assert.notEqual(revision, storefrontRevision("test.myshopify.com", [row(1, 101)], "app-one"));
  assert.notEqual(revision, storefrontRevision("test.myshopify.com", rows, "app-two"));
  const check = (response: Response) => checkStorefrontConnection("test.myshopify.com", revision, rows[0].shopifyDiscountId, async () => response);
  assert.match(await check(Response.json({ version: storefrontVersion, revision, promotionId: rows[0].shopifyDiscountId })), /agree/);
  assert.match(await check(Response.json({ version: storefrontVersion, revision: "old", promotionId: rows[0].shopifyDiscountId })), /different saved settings/);
  assert.match(await check(Response.json({ html: "Old header" })), /older or different renderer/);
  assert.match(await check(new Response('<html>Password</html>', { headers: { 'Content-Type': 'text/html' } })), /password page/);
  assert.match(await check(Response.json({ version: storefrontVersion, revision, promotionId: "different" })), /selected promotion differs/);
});
test("an enabled promotion is shown even if its record once said it was excluded from the sync", async () => {
  const rows = [{ ...row(1, 100), included: false }];
  const result = await selectStorefrontPromotion(api([node(1)]), rows, context, true);
  assert.equal(result.selected?.id, rows[0].shopifyDiscountId);
  assert.equal(result.checks[0].reason, "Selected for the header.");
});
