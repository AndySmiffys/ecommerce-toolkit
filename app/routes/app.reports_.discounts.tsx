import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { loadReportsPage, runReportsAction } from "../modules/promotions/services/reportsPage.server";
import { ReportsPage } from "../modules/promotions/components/ReportsPage";

export const loader = ({ request }: LoaderFunctionArgs) => loadReportsPage(request);
export const action = ({ request }: ActionFunctionArgs) => runReportsAction(request);

export default function Report() {
  const { data, orders, counts, period, refreshing } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  // While the figures are being read, check back every few seconds so they appear as soon as they are ready.
  useEffect(() => {
    if (!refreshing) return;
    const timer = setTimeout(() => revalidator.revalidate(), 6000);
    return () => clearTimeout(timer);
  }, [refreshing, data.takenAt, orders.syncedAt, revalidator]);
  return <ReportsPage view="discounts" data={data} orders={orders} counts={counts} period={period} refreshing={refreshing} />;
}
