import type { LoaderFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import { googleFeed } from "../modules/promotions/design/googlePromotion";
import { buildGoogleFeed, feedByToken } from "../modules/promotions/services/googleFeed.server";

// The promotions file Google Merchant Center collects on a schedule. The private address is the key: it is a long random
// string, so only someone given it can read the file, and the file holds only promotions the merchant chose to send.
export async function loader({ params }: LoaderFunctionArgs) {
  const token = (params.token ?? "").replace(/\.txt$/, "");
  const feed = await feedByToken(token);
  if (!feed) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  let text = feed.feedText;
  // The first request, before any file has been built, builds it.
  if (!feed.builtAt) {
    try {
      const { admin } = await unauthenticated.admin(feed.shop);
      await buildGoogleFeed(admin, feed.shop);
      text = (await feedByToken(token))?.feedText ?? text;
    } catch (error) { console.error("The Google promotions file could not be built:", error instanceof Error ? error.message : error); }
  }
  return new Response(text || googleFeed([]), { headers: { "Content-Type": "text/tab-separated-values; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
