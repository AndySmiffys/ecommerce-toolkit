import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { isAutomaticDiscountId, promotionDiscountAliases } from "../modules/promotions/design/discountIdentity";
import { forgetDiscounts } from "../modules/promotions/services/discountIndex.server";
import { buildGoogleFeed, isSentToGoogle } from "../modules/promotions/services/googleFeed.server";
import { syncStorefrontSnapshot } from "../modules/promotions/services/storefrontSnapshot.server";

export async function action({ request }: ActionFunctionArgs) {
  const { admin, shop, topic, payload } = await authenticate.webhook(request);
  const id = typeof (payload as { admin_graphql_api_id?: unknown })?.admin_graphql_api_id === "string" ? (payload as { admin_graphql_api_id: string }).admin_graphql_api_id : null;
  const deleted = /delete/i.test(String(topic));
  if (id && deleted) {
    await forgetDiscounts(shop, [id]);
    await db.googlePromotion.deleteMany({ where: { shop, discountId: { in: promotionDiscountAliases(id) } } });
  }
  // A change to a promotion sent to Google (its dates, value or products) rebuilds the file, in the background.
  if (id && admin && (await isSentToGoogle(shop, id))) void buildGoogleFeed(admin, shop).catch(error => console.error("The Google promotions file could not be built:", error instanceof Error ? error.message : error));
  // Other apps (Dotdigital) change thousands of discounts. The banners only cover discounts that have website settings saved here, so a
  // change to a code discount without them cannot alter the storefront data and is not worth a resync. An automatic discount can: the
  // price shown on a product page includes every active one, enabled for the website or not, because the cart applies it.
  if (id && !isAutomaticDiscountId(id) && !(await db.promotionSettings.count({ where: { shop, shopifyDiscountId: { in: promotionDiscountAliases(id) } } }))) return new Response(null, { status: 200 });
  if (admin) await syncStorefrontSnapshot(admin, shop);
  // Throw on sync failure so Shopify retries. Dates are also checked by Liquid,
  // since reaching a scheduled start/end need not emit an update webhook.
  return new Response(null, { status: 200 });
}
