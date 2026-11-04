import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { loadPriceDisplay, savePriceDisplay } from "../modules/price/config.server";
import { automaticDiscountsNotShown, comparePrices, currentPriceEntries, publishedPriceEntries } from "../modules/promotions/services/priceReport.server";
import { syncStorefrontSnapshot } from "../modules/promotions/services/storefrontSnapshot.server";
import { PriceDisplayPage, type PriceResult } from "../modules/price/PriceDisplayPage";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  // The lists are only shown, so a failure to read them must not stop the settings opening.
  const [settings, notShown, prices] = await Promise.all([
    loadPriceDisplay(admin),
    automaticDiscountsNotShown(admin).catch(() => null),
    Promise.all([currentPriceEntries(admin, session.shop), publishedPriceEntries(admin)]).then(([current, published]) => comparePrices(current, published)).catch(() => null),
  ]);
  return { ...settings, notShown, prices };
}

export async function action({ request }: ActionFunctionArgs): Promise<PriceResult> {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "save") {
      let input: unknown;
      try { input = JSON.parse(String(form.get("config") ?? "")); } catch { return { ok: false, intent, errors: ["The settings could not be read. Reload the page and try again."] }; }
      const before = (await loadPriceDisplay(admin)).config.cardsEnabled;
      const result = await savePriceDisplay(admin, input);
      if (!result.ok) return { ok: false, intent, errors: result.errors };
      // Switching product cards on or off changes what is published (the products each automatic discount covers), so publish again now.
      if (result.config.cardsEnabled !== before) await syncStorefrontSnapshot(admin, session.shop);
      return { ok: true, intent, errors: [], config: result.config };
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
  return <PriceDisplayPage initial={data.config} saved={data.saved} notShown={data.notShown} prices={data.prices} fetcher={fetcher} />;
}
