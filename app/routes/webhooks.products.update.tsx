import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { collectionCacheState } from "../modules/promotions/services/collectionProducts.server";
import { syncStorefrontSnapshot } from "../modules/promotions/services/storefrontSnapshot.server";

// A product changing can move it in or out of a smart collection. Badges for collection discounts follow the
// products found when the data was last published, so a product update refreshes them, but only once their
// lists are old enough to be read again, and only when a collection is in use at all.
export async function action({ request }: ActionFunctionArgs) {
  const { admin, shop } = await authenticate.webhook(request);
  if (admin && collectionCacheState().due) await syncStorefrontSnapshot(admin, shop);
  return new Response(null, { status: 200 });
}
