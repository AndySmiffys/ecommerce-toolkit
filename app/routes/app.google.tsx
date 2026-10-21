import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import { buildGoogleFeed, googleFeedIsDue, isGoogleBuilding, loadGooglePage, regenerateFeedToken, setGoogleSelection, setGoogleTitle } from "../modules/promotions/services/googleFeed.server";
import { GoogleMerchantPage } from "../modules/promotions/components/GoogleMerchantPage";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const page = await loadGooglePage(session.shop);
  const pending = page.promotions.some(promotion => promotion.status === "pending");
  // The file is checked again in the background when it is stale or something has just changed.
  if (!isGoogleBuilding(session.shop) && (pending || await googleFeedIsDue(session.shop, 60))) void buildGoogleFeed(admin, session.shop).catch(error => console.error("The Google promotions file could not be built:", error instanceof Error ? error.message : error));
  const base = (process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "");
  return { ...page, feedUrl: `${base}/feeds/google-promotions/${page.token}.txt`, working: isGoogleBuilding(session.shop) || pending };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const rebuild = () => void buildGoogleFeed(admin, session.shop).catch(error => console.error("The Google promotions file could not be built:", error instanceof Error ? error.message : error));
  try {
    if (intent === "check") rebuild();
    else if (intent === "regenerate") await regenerateFeedToken(session.shop);
    else if (intent === "title") { await setGoogleTitle(session.shop, String(form.get("id") ?? ""), String(form.get("title") ?? "")); rebuild(); }
    else if (intent === "remove") { await setGoogleSelection(session.shop, [String(form.get("id") ?? "")], false); rebuild(); }
    else return { ok: false as const, error: "That action is not available.", intent };
    return { ok: true as const, error: null, intent };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "That could not be done.", intent };
  }
}

export default function Google() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<{ ok: boolean; error: string | null; intent: string }>();
  // While promotions are being checked, look again every few seconds so the result appears as soon as it is ready.
  useEffect(() => {
    if (!data.working) return;
    const timer = setTimeout(() => revalidator.revalidate(), 5000);
    return () => clearTimeout(timer);
  }, [data.working, data.builtAt, revalidator]);
  // After a change, look again at once.
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) revalidator.revalidate(); }, [fetcher.state, fetcher.data, revalidator]);
  return <GoogleMerchantPage data={data} fetcher={fetcher} />;
}
