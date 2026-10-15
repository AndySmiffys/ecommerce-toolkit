import type { ShopifyAdminClient } from "./discount.server";

export const destinationTypes = ["collection", "product", "page", "blog"] as const;
export type DestinationType = typeof destinationTypes[number];
export type LinkDestination = { id: string; title: string; url: string };
export type LinkDestinationResult = { items: LinkDestination[]; error: string | null };

const roots: Record<DestinationType, { field: string; path: string }> = {
  collection: { field: "collections", path: "collections" },
  product: { field: "products", path: "products" },
  page: { field: "pages", path: "pages" },
  blog: { field: "blogs", path: "blogs" },
};

export function isDestinationType(value: unknown): value is DestinationType {
  return typeof value === "string" && (destinationTypes as readonly string[]).includes(value);
}

/** A Shopify search term that matches the title, with the user's text quoted so it cannot add filters. */
export function destinationSearch(text: string): string {
  const clean = text.replace(/["\\*:()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return clean ? `title:*${clean.replace(/ /g, "* AND title:*")}*` : "";
}

export async function searchLinkDestinations(admin: ShopifyAdminClient, type: DestinationType, text: string): Promise<LinkDestinationResult> {
  const { field, path } = roots[type];
  const response = await admin.graphql(`#graphql
    query PromotionLinkDestinations($query: String) {
      ${field}(first: 25, sortKey: TITLE, query: $query) { nodes { id title handle } }
    }`, { variables: { query: destinationSearch(text) || null } });
  const result = await response.json() as { data?: Record<string, { nodes: Array<{ id: string; title: string; handle: string }> }>; errors?: Array<{ message: string; extensions?: { code?: string } }> };
  if (result.errors?.length) {
    const denied = result.errors.some(error => error.extensions?.code === "ACCESS_DENIED" || /access denied|required access/i.test(error.message));
    return { items: [], error: denied && (type === "page" || type === "blog")
      ? "Pages and blogs need the read_online_store_pages permission. Deploy the app configuration and approve the new permission, then try again."
      : result.errors.map(error => error.message).join(", ") };
  }
  return { items: (result.data?.[field]?.nodes ?? []).map(node => ({ id: node.id, title: node.title, url: `/${path}/${node.handle}` })), error: null };
}
