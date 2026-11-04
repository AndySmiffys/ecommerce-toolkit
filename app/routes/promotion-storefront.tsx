import type { LoaderFunctionArgs } from "react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { authenticate } from "../shopify.server";
import { getLatestPromotionSettings } from "../modules/promotions/services/promotionSettings.server";
import { type ShopifyAdminClient } from "../modules/promotions/services/discount.server";
import { placements, websiteFromSettings, type Placement } from "../modules/promotions/design/design";
import { promotionCss, PromotionOffer } from "../modules/promotions/components/PromotionPreview";
import { selectStorefrontPromotion, storefrontRenderKey, storefrontRevision, storefrontVersion } from "../modules/promotions/services/storefrontSelection.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.public.appProxy(request);
  let revision: string | null = null;
  const empty = () => Response.json({ html: "", css: "", promotionId: null, revision, version: storefrontVersion }, { headers: { "Cache-Control": "no-store" } });
  if (!admin || !session) return empty();
  const api: ShopifyAdminClient = admin;
  const url = new URL(request.url);
  const placement = url.searchParams.get("placement") as Placement;
  if (!placements.some(p => p.id === placement)) return empty();
  function gid(name: string, type: string): string | null { const value = url.searchParams.get(name); return value && /^\d+$/.test(value) ? `gid://shopify/${type}/${value}` : null; }
  const productId = gid("product_id", "Product");
  const collectionId = gid("collection_id", "Collection");
  const variantId = gid("variant_id", "ProductVariant");
  // This parameter is signed and supplied by Shopify, never taken from a customer-facing form.
  const customerId = gid("logged_in_customer_id", "Customer");
  const settings = await getLatestPromotionSettings(session.shop);
  revision = storefrontRevision(session.shop, settings);
  if (!settings.length) return empty();
  try {
    const productCollectionIds: string[] = [];
    if (productId && (placement === "product" || placement === "badge")) {
      let cursor: string | null = null;
      let hasNext = true;
      while (hasNext) {
        const response: Response = await api.graphql(`query PromotionProductContext($id: ID!, $after: String) { node(id: $id) { ... on Product { collections(first: 250, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } } } }`, { variables: { id: productId, after: cursor } });
        const result = await response.json();
        if (result.errors?.length) return empty();
        const collections = result.data?.node?.collections;
        productCollectionIds.push(...(collections?.nodes ?? []).map((c: { id: string }) => c.id));
        hasNext = collections?.pageInfo?.hasNextPage ?? false;
        cursor = collections?.pageInfo?.endCursor ?? null;
      }
    }
    const { selected: promotion } = await selectStorefrontPromotion(api, settings, { placement, productId, collectionId, variantId, productCollectionIds, customerId, memberSegmentIds: [], now: Date.now() });
    if (promotion) {
      const value = websiteFromSettings(promotion.settings);
      const html = renderToStaticMarkup(<PromotionOffer discountCode={promotion.code} offerNote={promotion.code ? `Use code: ${promotion.code}` : "Applied automatically at checkout."} value={value} placement={placement} endsAt={promotion.endsAt} now={Date.now()} mobile={url.searchParams.get("mobile") === "1"} />);
      return Response.json({ html, css: promotionCss, endsAt: promotion.endsAt, promotionId: promotion.id, priority: promotion.settings.priority, renderKey: storefrontRenderKey(promotion, placement), revision, version: storefrontVersion }, { headers: { "Cache-Control": "private, no-store" } });
    }
  } catch (error) { console.error("Promotion storefront render failed:", error); }
  return empty();
}
