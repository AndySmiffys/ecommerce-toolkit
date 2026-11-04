import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import { loadUngrouped } from "../modules/promotions/services/orderReport.server";
import { loadReportsPage, runReportsAction } from "../modules/promotions/services/reportsPage.server";
import { ReportGroups } from "../modules/promotions/components/ReportGroups";

export async function loader({ request }: LoaderFunctionArgs) {
  const page = await loadReportsPage(request);
  const { session } = await authenticate.admin(request);
  return { ...page, ungrouped: await loadUngrouped(session.shop, page.orders.filter) };
}
export const action = ({ request }: ActionFunctionArgs) => runReportsAction(request);

export default function Groups() {
  const { data, orders, ungrouped, refreshing } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  // While the figures are being read, check back every few seconds so they appear as soon as they are ready.
  useEffect(() => {
    if (!refreshing) return;
    const timer = setTimeout(() => revalidator.revalidate(), 6000);
    return () => clearTimeout(timer);
  }, [refreshing, data.takenAt, orders.syncedAt, revalidator]);
  return <ReportGroups groups={data.groups} orders={orders} ungrouped={ungrouped} refreshing={refreshing} />;
}
