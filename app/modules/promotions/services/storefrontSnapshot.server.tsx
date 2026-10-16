import { renderToStaticMarkup } from "react-dom/server";
import { PromotionOffer, promotionCss, promotionInlineCss } from "../components/PromotionPreview";
import { placements, websiteFromSettings } from "../design/design";
import { mapDiscountToPromotion } from "../mappers/promotionMapper";
import type { PromotionRecord } from "../models/promotion";
import { getDiscount, type ShopifyAdminClient } from "./discount.server";
import { storefrontRevision, storefrontRenderKey } from "./storefrontSelection.server";
import { getLatestPromotionSettings } from "./promotionSettings.server";

const namespace = "promotion_engine";
const key = "storefront";
const shortId = (id: string) => id.split("/").pop()!;

// This is public storefront data. Never publish customer IDs, segment IDs or
// restricted offer content. Liquid checks dates and product/collection scope.
export function publicSnapshotEntry(promotion: PromotionRecord, now = Date.now()) {
  if (!promotion.settings.websiteEnabled ||
      !promotion.shopify.customers.appliesToAllCustomers ||
      !["ACTIVE", "SCHEDULED"].includes(promotion.status) ||
      (promotion.endsAt && Date.parse(promotion.endsAt) <= now) ||
      (promotion.method === "Code" && !promotion.code)) return null;
  const scope = promotion.shopify.bxgy?.get.products ?? promotion.shopify.products;
  const all = promotion.type === "Order" || promotion.type === "Shipping" || scope.allProducts;
  const value = websiteFromSettings(promotion.settings);
  const html: Record<string, string> = {};
  const renderKeys: Record<string, string> = {};
  for (const placement of placements) {
    if (!promotion.settings[placement.flag]) continue;
    // The existing Shopify query caps scope lists. Defer to the live renderer
    // when a list might be incomplete rather than mis-ranking a scoped offer.
    if (!all && placement.id !== "header" && [scope.products, scope.collections, scope.variants].some(list => list.length >= 250)) continue;
    renderKeys[placement.id] = storefrontRenderKey(promotion, placement.id);
    html[placement.id] = renderToStaticMarkup(<PromotionOffer value={value} placement={placement.id} endsAt={promotion.endsAt} now={now} discountCode={promotion.code} offerNote={promotion.code ? `Use code: ${promotion.code}` : "Applied automatically at checkout."} />);
  }
  return { id: promotion.id, priority: promotion.settings.priority,
    starts: promotion.startsAt ? Math.floor(Date.parse(promotion.startsAt) / 1000) : 0,
    ends: promotion.endsAt ? Math.floor(Date.parse(promotion.endsAt) / 1000) : 0,
    all, products: scope.products.map(p => shortId(p.id)), collections: scope.collections.map(c => shortId(c.id)),
    variants: scope.variants.map(v => ({ id: shortId(v.id), product: v.productId ? shortId(v.productId) : "" })), html, renderKeys };
}

export async function syncStorefrontSnapshot(admin: ShopifyAdminClient, shop: string, readSettings = getLatestPromotionSettings) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // Read the digest before the source settings so a concurrent save cannot
    // overwrite a newer snapshot with older settings.
    const installationResult = await (await admin.graphql(`query PromotionInstallation { currentAppInstallation { id metafield(namespace: "${namespace}", key: "${key}") { value compareDigest } } }`)).json();
    if (installationResult.errors?.length) throw new Error(installationResult.errors.map((e: { message: string }) => e.message).join(" "));
    const installation = installationResult.data?.currentAppInstallation;
    if (!installation) throw new Error("Shopify app installation could not be read.");
    const rows = await readSettings(shop);
    const entries = [];
    for (const row of rows.filter(row => row.websiteEnabled)) {
      const node = await getDiscount(admin, row.shopifyDiscountId, 250);
      if (!node || (node.discount.codesCount?.count ?? node.discount.codes?.nodes.length ?? 0) > 1) continue;
      const promotion = mapDiscountToPromotion(node);
      promotion.settings = { ...promotion.settings, ...row, lastSyncedAt: null };
      const entry = publicSnapshotEntry(promotion);
      if (entry) entries.push(entry);
    }
    const value = JSON.stringify({ version: 2, revision: storefrontRevision(shop, rows), css: promotionCss, inlineCss: promotionInlineCss, promotions: entries });
    if (Buffer.byteLength(value, "utf8") > 128000) throw new Error("The public storefront designs exceed Shopify’s JSON size limit. Reduce the number of enabled promotions or shorten their content.");
    if (value === installation.metafield?.value) return;
    const result = await (await admin.graphql(`mutation PromotionSnapshot($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { code message } } }`, { variables: { metafields: [{ ownerId: installation.id, namespace, key, type: "json", value, compareDigest: installation.metafield?.compareDigest ?? null }] } })).json();
    if (result.errors?.length) throw new Error(result.errors.map((e: { message: string }) => e.message).join(" "));
    const errors = result.data?.metafieldsSet?.userErrors;
    if (!errors) throw new Error("Shopify did not confirm the storefront promotion sync.");
    if (!errors.length) return;
    if (!errors.every((e: { code: string }) => ["STALE_OBJECT", "INVALID_COMPARE_DIGEST"].includes(e.code))) throw new Error(errors.map((e: { message: string }) => e.message).join(" "));
  }
  throw new Error("Another promotion save is still syncing. Retry saving.");
}

// Bootstrap upgrades from every app entry point, including bookmarked editors.
export async function ensureStorefrontSnapshot(admin: ShopifyAdminClient, shop: string) {
  const result = await (await admin.graphql(`query PromotionSnapshotVersion { currentAppInstallation { metafield(namespace: "${namespace}", key: "${key}") { value } } }`)).json();
  if (result.errors?.length) throw new Error(result.errors.map((e: { message: string }) => e.message).join(" "));
  let snapshot: { version?: number; inlineCss?: string; css?: string } | null = null;
  try { snapshot = JSON.parse(result.data?.currentAppInstallation?.metafield?.value ?? "null"); } catch { /* Republish malformed data. */ }
  if (snapshot?.version !== 2 || snapshot.inlineCss !== promotionInlineCss || snapshot.css !== promotionCss) await syncStorefrontSnapshot(admin, shop);
}
