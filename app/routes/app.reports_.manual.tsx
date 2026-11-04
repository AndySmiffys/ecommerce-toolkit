import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import { loadManualOrders } from "../modules/promotions/services/orderReport.server";
import { loadReportsPage, runReportsAction } from "../modules/promotions/services/reportsPage.server";
import { ReportManual } from "../modules/promotions/components/ReportManual";

export async function loader({ request }: LoaderFunctionArgs) {
  const page = await loadReportsPage(request);
  const { session } = await authenticate.admin(request);
  return { ...page, manualOrders: await loadManualOrders(session.shop, page.orders.filter) };
}
export const action = ({ request }: ActionFunctionArgs) => runReportsAction(request);

export default function Manual() {
  const { orders, manualOrders, refreshing, data } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const fetcher = useFetcher();
  // While the figures are being read, check back every few seconds so they appear as soon as they are ready.
  useEffect(() => {
    if (!refreshing) return;
    const timer = setTimeout(() => revalidator.revalidate(), 6000);
    return () => clearTimeout(timer);
  }, [refreshing, data.takenAt, orders.syncedAt, revalidator]);
  return <ReportManual orders={orders} manualOrders={manualOrders} refreshing={refreshing || fetcher.state !== "idle"} onRefresh={() => fetcher.submit({ intent: "refresh" }, { method: "post" })} />;
}
