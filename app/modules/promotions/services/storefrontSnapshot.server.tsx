import { renderToStaticMarkup } from "react-dom/server";
import { PromotionOffer, promotionCss, promotionInlineCss } from "../components/PromotionPreview";
import { placements, websiteFromSettings } from "../design/design";
import { encodeIds } from "../design/compactIds";
import { completeDiscountScope } from "./discountScope.server";
import { mapDiscountToPromotion } from "../mappers/promotionMapper";
import type { PromotionRecord } from "../models/promotion";
import { getDiscount, type ShopifyAdminClient } from "./discount.server";
import { storefrontRevision, storefrontRenderKey } from "./storefrontSelection.server";
import { getLatestPromotionSettings } from "./promotionSettings.server";

const namespace = "promotion_engine";
const key = "storefront";
/** Bump when the published shape changes. The theme blocks read only this version and fall back to the live path otherwise. */
export const snapshotVersion = 3;
const shortId = (id: string) => id.split("/").pop()!;
// The small snapshot is read on every page, so it stays small (Shopify limits a JSON metafield to 128 KB). The long
// product lists and the badge data are separate metafields that only the pages needing them read.
const mainLimit = 128000;

// This is public storefront data. Never publish customer IDs, segment IDs or
// restricted offer content. Liquid checks dates and product/collection scope.
export function publicSnapshotEntry(promotion: PromotionRecord, now = Date.now(), complete = true) {
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
    // The scope lists are read in full before this runs. If Shopify could not give the whole list, defer to the
    // live renderer rather than mis-ranking a scoped offer.
    if (!all && placement.id !== "header" && !complete) continue;
    renderKeys[placement.id] = storefrontRenderKey(promotion, placement.id);
    html[placement.id] = renderToStaticMarkup(<PromotionOffer value={value} placement={placement.id} endsAt={promotion.endsAt} now={now} discountCode={promotion.code} offerNote={promotion.code ? `Use code: ${promotion.code}` : "Applied automatically at checkout."} />);
  }
  return { id: promotion.id, priority: promotion.settings.priority,
    starts: promotion.startsAt ? Math.floor(Date.parse(promotion.startsAt) / 1000) : 0,
    ends: promotion.endsAt ? Math.floor(Date.parse(promotion.endsAt) / 1000) : 0,
    all, products: scope.products.map(p => shortId(p.id)), collections: scope.collections.map(c => shortId(c.id)),
    variants: scope.variants.map(v => ({ id: shortId(v.id), product: v.productId ? shortId(v.productId) : "" })), html, renderKeys };
}

type SnapshotEntry = NonNullable<ReturnType<typeof publicSnapshotEntry>>;
type Scope = { products?: string[]; collections?: string[]; variants?: Array<{ id: string; product: string }> };

// A badge needs only its own rule, not the whole shared stylesheet.
const badgeCss = (promotionCss.match(/\.pe-badge\{[^}]*\}/)?.[0] ?? "") + ".pe-badge{position:static;display:inline-block}";

// JSON placed in a page's script tag must not contain "<", so it cannot end the tag early.
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/**
 * Splits the entries into what each part of the storefront reads: the small snapshot every block reads, the product
 * lists Liquid checks on product and collection pages (one per promotion), and the compact badge data the card
 * script reads (one per promotion, joined into the page by the loader embed).
 */
export function splitSnapshot(entries: SnapshotEntry[], revision: string) {
  const promotions = [];
  const scopes: Record<string, Scope> = {};
  const badgeShards: Record<string, string> = {};
  const badgeKeys: string[] = [];
  for (const entry of entries) {
    const scopeKey = shortId(entry.id);
    const { products, collections, variants, ...rest } = entry;
    promotions.push({ ...rest, key: scopeKey });
    if (!entry.all && (products.length || collections.length || variants.length)) {
      scopes[scopeKey] = { ...(products.length ? { products } : {}), ...(collections.length ? { collections } : {}), ...(variants.length ? { variants } : {}) };
    }
    // Cards can only be matched by product, so a badge needs specific products (or every product).
    const badgeProducts = [...products, ...variants.map(v => v.product).filter(Boolean)];
    if (entry.html.badge && (entry.all || badgeProducts.length)) {
      badgeShards[scopeKey] = safeJson({ k: scopeKey, p: entry.priority, s: entry.starts, e: entry.ends, a: entry.all ? 1 : 0, i: entry.all ? "" : encodeIds(badgeProducts), h: entry.html.badge, r: entry.renderKeys.badge });
      badgeKeys.push(scopeKey);
    }
  }
  return { promotions, scopes, badgeShards, badgeIndex: { v: 1, rev: revision, css: badgeCss, keys: badgeKeys } };
}

// Shopify limits a JSON metafield to 128 KB and a text metafield to 64 KB, so each promotion's lists get their own.
const scopeLimit = 120000;
const badgeLimit = 60000;
const metafieldBatch = 25;
const companionPattern = /^(scope|badge)_/;

/** The per-promotion metafields (everything except the main snapshot), by key. Throws when one promotion's data is too big to publish. */
export function companionMetafields(split: ReturnType<typeof splitSnapshot>, titles: Map<string, string> = new Map()) {
  const result = new Map<string, { type: string; value: string }>();
  const name = (id: string) => `“${titles.get(id) ?? id}”`;
  for (const [id, scope] of Object.entries(split.scopes)) {
    const value = JSON.stringify(scope);
    if (Buffer.byteLength(value, "utf8") > scopeLimit) throw new Error(`The promotion ${name(id)} lists too many products to publish to the storefront (about 7,000 is the most). Target a collection or all products instead.`);
    result.set(`scope_${id}`, { type: "json", value });
  }
  for (const [id, value] of Object.entries(split.badgeShards)) {
    if (Buffer.byteLength(value, "utf8") > badgeLimit) throw new Error(`The promotion ${name(id)} lists too many products for storefront badges. Target fewer products, or turn off its product badge.`);
    result.set(`badge_${id}`, { type: "multi_line_text_field", value });
  }
  result.set("badge_index", { type: "json", value: JSON.stringify(split.badgeIndex) });
  return result;
}

export async function syncStorefrontSnapshot(admin: ShopifyAdminClient, shop: string, readSettings = getLatestPromotionSettings) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // Read the digest before the source settings so a concurrent save cannot
    // overwrite a newer snapshot with older settings.
    const installationResult = await (await admin.graphql(`query PromotionInstallation { currentAppInstallation { id metafield(namespace: "${namespace}", key: "${key}") { value compareDigest } companions: metafields(namespace: "${namespace}", first: 250) { nodes { key value } } } }`)).json();
    if (installationResult.errors?.length) throw new Error(installationResult.errors.map((e: { message: string }) => e.message).join(" "));
    const installation = installationResult.data?.currentAppInstallation;
    if (!installation) throw new Error("Shopify app installation could not be read.");
    const rows = await readSettings(shop);
    const entries = [];
    const titles = new Map<string, string>();
    for (const row of rows.filter(row => row.websiteEnabled)) {
      const node = await getDiscount(admin, row.shopifyDiscountId, 250);
      if (!node || (node.discount.codesCount?.count ?? node.discount.codes?.nodes.length ?? 0) > 1) continue;
      const { complete } = await completeDiscountScope(admin, node);
      const promotion = mapDiscountToPromotion(node);
      promotion.settings = { ...promotion.settings, ...row, lastSyncedAt: null };
      const entry = publicSnapshotEntry(promotion, Date.now(), complete);
      if (entry) { entries.push(entry); titles.set(shortId(entry.id), promotion.title); }
    }
    const revision = storefrontRevision(shop, rows);
    const split = splitSnapshot(entries, revision);
    const value = JSON.stringify({ version: snapshotVersion, revision, css: promotionCss, inlineCss: promotionInlineCss, promotions: split.promotions });
    if (Buffer.byteLength(value, "utf8") > mainLimit) throw new Error("The public storefront designs exceed Shopify’s JSON size limit. Reduce the number of enabled promotions or shorten their content.");
    const companions = companionMetafields(split, titles);
    const existing = new Map<string, string>((installation.companions?.nodes ?? []).map((node: { key: string; value: string }) => [node.key, node.value]));
    const changed = [...companions].filter(([name, field]) => existing.get(name) !== field.value);
    const stale = [...existing.keys()].filter(name => companionPattern.test(name) && !companions.has(name));
    const mainChanged = value !== installation.metafield?.value;
    if (!mainChanged && !changed.length && !stale.length) return;

    const main = { ownerId: installation.id, namespace, key, type: "json", value, compareDigest: installation.metafield?.compareDigest ?? null };
    const others = changed.map(([name, field]) => ({ ownerId: installation.id, namespace, key: name, type: field.type, value: field.value }));
    // The main snapshot goes in the last (or only) batch, so it only starts pointing at lists that already exist.
    const batches: Array<Array<typeof main | (typeof others)[number]>> = [];
    const all = mainChanged ? [main, ...others] : others;
    if (all.length <= metafieldBatch) batches.push(all);
    else {
      for (let i = 0; i < others.length; i += metafieldBatch) batches.push(others.slice(i, i + metafieldBatch));
      if (mainChanged) batches.push([main]);
    }
    let retry = false;
    for (const metafields of batches) {
      const result = await (await admin.graphql(`mutation PromotionSnapshot($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { code message } } }`, { variables: { metafields } })).json();
      if (result.errors?.length) throw new Error(result.errors.map((e: { message: string }) => e.message).join(" "));
      const errors = result.data?.metafieldsSet?.userErrors;
      if (!errors) throw new Error("Shopify did not confirm the storefront promotion sync.");
      if (!errors.length) continue;
      if (!errors.every((e: { code: string }) => ["STALE_OBJECT", "INVALID_COMPARE_DIGEST"].includes(e.code))) throw new Error(errors.map((e: { message: string }) => e.message).join(" "));
      retry = true;
      break;
    }
    if (retry) continue;
    // Lists of promotions that are gone or no longer public. Harmless if this fails; the next sync tries again.
    for (let i = 0; i < stale.length; i += 250) {
      await admin.graphql(`mutation PromotionStale($metafields: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $metafields) { userErrors { message } } }`, { variables: { metafields: stale.slice(i, i + 250).map(name => ({ ownerId: installation.id, namespace, key: name })) } }).catch(() => undefined);
    }
    return;
  }
  throw new Error("Another promotion save is still syncing. Retry saving.");
}

// Bootstrap upgrades from every app entry point, including bookmarked editors.
export async function ensureStorefrontSnapshot(admin: ShopifyAdminClient, shop: string) {
  const result = await (await admin.graphql(`query PromotionSnapshotVersion { currentAppInstallation { metafield(namespace: "${namespace}", key: "${key}") { value } } }`)).json();
  if (result.errors?.length) throw new Error(result.errors.map((e: { message: string }) => e.message).join(" "));
  let snapshot: { version?: number; inlineCss?: string; css?: string } | null = null;
  try { snapshot = JSON.parse(result.data?.currentAppInstallation?.metafield?.value ?? "null"); } catch { /* Republish malformed data. */ }
  if (snapshot?.version !== snapshotVersion || snapshot.inlineCss !== promotionInlineCss || snapshot.css !== promotionCss) await syncStorefrontSnapshot(admin, shop);
}
