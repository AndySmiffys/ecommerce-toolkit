import type { ShopifyAdminClient } from "./discount.server";
import type { PreviewProduct } from "../components/PromotionPreview";
const fields = `id title featuredImage { url } priceRangeV2 { minVariantPrice { amount currencyCode } }`;
export async function getPreviewProducts(admin: ShopifyAdminClient, productIds: string[], collectionIds: string[]): Promise<PreviewProduct[]> {
  const ids = [...productIds.slice(0, 20), ...collectionIds.slice(0, 6)];
  if (ids.some(id => !/^gid:\/\/shopify\/(Product|Collection)\/\d+$/.test(id))) throw new Error("Invalid preview selection.");
  const response = await admin.graphql(ids.length ? `query PreviewSelection($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { ${fields} } ... on Collection { products(first: 3) { nodes { ${fields} } } } } }` : `query PreviewSamples { products(first: 12) { nodes { ${fields} } } }`, ids.length ? { variables: { ids } } : undefined);
  const result = await response.json();
  if (result.errors?.length) throw new Error(result.errors.map((e: { message: string }) => e.message).join(", "));
  type Product = { id: string; title: string; featuredImage?: { url: string }; priceRangeV2?: { minVariantPrice: { amount: string; currencyCode: string } }; products?: { nodes: Product[] } };
  const nodes: Product[] = ids.length ? (result.data?.nodes ?? []).filter(Boolean).flatMap((p: Product) => p.products?.nodes ?? [p]) : result.data?.products?.nodes ?? [];
  return [...new Map(nodes.map(p => { const price = p.priceRangeV2?.minVariantPrice; return [p.id, { id: p.id, title: p.title, image: p.featuredImage?.url, price: price ? new Intl.NumberFormat("en-GB", { style: "currency", currency: price.currencyCode }).format(Number(price.amount)) : null }]; })).values()];
}
