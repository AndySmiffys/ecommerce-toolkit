import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { loadPriceDisplay, savePriceDisplay } from "../modules/price/config.server";
import { automaticDiscountsNotShown } from "../modules/promotions/services/priceReport.server";
import { syncStorefrontSnapshot } from "../modules/promotions/services/storefrontSnapshot.server";
import { PriceDisplayPage, type PriceResult } from "../modules/price/PriceDisplayPage";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  // The list is only shown, so a failure to read it must not stop the settings opening.
  const [settings, notShown] = await Promise.all([loadPriceDisplay(admin), automaticDiscountsNotShown(admin).catch(() => null)]);
  return { ...settings, notShown };
}

export async function action({ request }: ActionFunctionArgs): Promise<PriceResult> {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "save") {
      let input: unknown;
      try { input = JSON.parse(String(form.get("config") ?? "")); } catch { return { ok: false, intent, errors: ["The settings could not be read. Reload the page and try again."] }; }
      const result = await savePriceDisplay(admin, input);
      return result.ok ? { ok: true, intent, errors: [], config: result.config } : { ok: false, intent, errors: result.errors };
    }
    // Rewrites what the storefront reads from Shopify's discounts as they are now, for when a change in Shopify has not reached it.
    if (intent === "republish") {
      await syncStorefrontSnapshot(admin, session.shop);
      return { ok: true, intent, errors: [] };
    }
    return { ok: false, intent, errors: ["That action is not available."] };
  } catch (error) {
    return { ok: false, intent, errors: [error instanceof Error ? error.message : "That could not be done."] };
  }
}

export default function DiscountedPrice() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<PriceResult>();
  return <PriceDisplayPage initial={data.config} saved={data.saved} notShown={data.notShown} fetcher={fetcher} />;
}
