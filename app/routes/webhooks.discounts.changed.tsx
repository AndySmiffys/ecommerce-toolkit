import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { promotionDiscountAliases } from "../modules/promotions/design/discountIdentity";
import { forgetDiscounts } from "../modules/promotions/services/discountIndex.server";
import { syncStorefrontSnapshot } from "../modules/promotions/services/storefrontSnapshot.server";

export async function action({ request }: ActionFunctionArgs) {
  const { admin, shop, topic, payload } = await authenticate.webhook(request);
  const id = typeof (payload as { admin_graphql_api_id?: unknown })?.admin_graphql_api_id === "string" ? (payload as { admin_graphql_api_id: string }).admin_graphql_api_id : null;
  if (id && /delete/i.test(String(topic))) await forgetDiscounts(shop, [id]);
  // Other apps (Dotdigital) change thousands of discounts. The storefront data only covers discounts that have website
  // settings saved here, so a change to any other discount cannot alter it and is not worth a resync.
  if (id && !(await db.promotionSettings.count({ where: { shop, shopifyDiscountId: { in: promotionDiscountAliases(id) } } }))) return new Response(null, { status: 200 });
  if (admin) await syncStorefrontSnapshot(admin, shop);
  // Throw on sync failure so Shopify retries. Dates are also checked by Liquid,
  // since reaching a scheduled start/end need not emit an update webhook.
  return new Response(null, { status: 200 });
}
