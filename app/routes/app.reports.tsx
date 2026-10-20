import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { loadReportsPage, runReportsAction } from "../modules/promotions/services/reportsPage.server";
import { ReportOverview } from "../modules/promotions/components/ReportOverview";

export const loader = ({ request }: LoaderFunctionArgs) => loadReportsPage(request);
export const action = ({ request }: ActionFunctionArgs) => runReportsAction(request);

export default function Reports() {
  const { orders, compare, refreshing, data } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const fetcher = useFetcher();
  // While the figures are being read, check back every few seconds so they appear as soon as they are ready.
  useEffect(() => {
    if (!refreshing) return;
    const timer = setTimeout(() => revalidator.revalidate(), 6000);
    return () => clearTimeout(timer);
  }, [refreshing, data.takenAt, orders.syncedAt, revalidator]);
  return <ReportOverview data={orders} compare={compare} refreshing={refreshing || fetcher.state !== "idle"} onRefresh={() => fetcher.submit({ intent: "refresh" }, { method: "post" })} />;
}
