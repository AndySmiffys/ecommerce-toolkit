import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { useEffect } from "react";
import { authenticate, unauthenticated } from "../shopify.server";
import { emptyFilter, lastDays } from "../modules/promotions/design/orderReport";
import { loadHomeStats } from "../modules/promotions/services/homeStats.server";
import { driveOrderSync, loadOrderReport, orderSyncIsDue } from "../modules/promotions/services/orderReport.server";
import { HomeDashboard } from "../modules/promotions/components/HomeDashboard";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  // Opening the app keeps the figures fresh: orders are read in the background if they are over six hours old.
  if (await orderSyncIsDue(session.shop, 6)) void driveOrderSync(async () => (await unauthenticated.admin(session.shop)).admin, session.shop);
  const range = lastDays(30);
  const [current, stats] = await Promise.all([
    // With the 30 days before them, so each figure can show whether it is up or down.
    loadOrderReport(session.shop, emptyFilter(range.from, range.to), undefined, { compare: true }),
    loadHomeStats(session.shop),
  ]);
  return { current, stats };
}

export default function DashboardPage() {
  const { current, stats } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!current.syncing) return;
    const timer = setTimeout(() => revalidator.revalidate(), 6000);
    return () => clearTimeout(timer);
  }, [current.syncing, current.syncedAt, revalidator]);
  return (
    <s-page heading="eCommerce Toolkit" inlineSize="large">
      <HomeDashboard current={current} stats={stats} />
    </s-page>
  );
}
