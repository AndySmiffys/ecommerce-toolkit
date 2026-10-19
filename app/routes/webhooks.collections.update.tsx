import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { forgetCollectionProducts } from "../modules/promotions/services/collectionProducts.server";
import { syncStorefrontSnapshot } from "../modules/promotions/services/storefrontSnapshot.server";

// Badges for a discount on a collection list the products in that collection when the storefront data is published.
// When a collection changes, forget its products and publish again. Collections no promotion uses are ignored.
export async function action({ request }: ActionFunctionArgs) {
  const { admin, shop, payload } = await authenticate.webhook(request);
  const used = forgetCollectionProducts(String(payload.admin_graphql_api_id ?? payload.id ?? ""));
  if (used && admin) await syncStorefrontSnapshot(admin, shop);
  return new Response(null, { status: 200 });
}
