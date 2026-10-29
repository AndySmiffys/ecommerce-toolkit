import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { loadPriceDisplay, savePriceDisplay } from "../modules/price/config.server";
import { PriceDisplayPage, type PriceResult } from "../modules/price/PriceDisplayPage";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  return loadPriceDisplay(admin);
}

export async function action({ request }: ActionFunctionArgs): Promise<PriceResult> {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "save") {
      let input: unknown;
      try { input = JSON.parse(String(form.get("config") ?? "")); } catch { return { ok: false, intent, errors: ["The settings could not be read. Reload the page and try again."] }; }
      const result = await savePriceDisplay(admin, input);
      return result.ok ? { ok: true, intent, errors: [], config: result.config } : { ok: false, intent, errors: result.errors };
    }
    return { ok: false, intent, errors: ["That action is not available."] };
  } catch (error) {
    return { ok: false, intent, errors: [error instanceof Error ? error.message : "That could not be done."] };
  }
}

export default function DiscountedPrice() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<PriceResult>();
  return <PriceDisplayPage initial={data.config} saved={data.saved} fetcher={fetcher} />;
}
