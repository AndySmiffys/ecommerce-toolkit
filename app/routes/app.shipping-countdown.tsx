import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { loadShippingConfig, saveShippingConfig } from "../modules/shipping/config.server";
import { fetchUpcomingBankHolidays } from "../modules/shipping/bankHolidays.server";
import { ShippingCountdownPage, type ShippingResult } from "../modules/shipping/ShippingCountdownPage";

const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  return { ...(await loadShippingConfig(admin)), today: londonToday() };
}

export async function action({ request }: ActionFunctionArgs): Promise<ShippingResult> {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "import") return { ok: true, intent, errors: [], dates: await fetchUpcomingBankHolidays(londonToday()) };
    if (intent === "save") {
      let input: unknown;
      try { input = JSON.parse(String(form.get("config") ?? "")); } catch { return { ok: false, intent, errors: ["The settings could not be read. Reload the page and try again."] }; }
      const result = await saveShippingConfig(admin, input);
      return result.ok ? { ok: true, intent, errors: [], config: result.config } : { ok: false, intent, errors: result.errors };
    }
    return { ok: false, intent, errors: ["That action is not available."] };
  } catch (error) {
    return { ok: false, intent, errors: [error instanceof Error ? error.message : "That could not be done."] };
  }
}

export default function ShippingCountdown() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ShippingResult>();
  return <ShippingCountdownPage initial={data.config} saved={data.saved} today={data.today} fetcher={fetcher} />;
}
