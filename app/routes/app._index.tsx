import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { useEffect } from "react";
import { authenticate, unauthenticated } from "../shopify.server";
import { emptyFilter, daysAgo, today } from "../modules/promotions/design/orderReport";
import { countActivePromotions, indexState } from "../modules/promotions/services/discountIndex.server";
import { driveOrderSync, loadOrderReport, orderSyncIsDue } from "../modules/promotions/services/orderReport.server";
import { HomeDashboard } from "../modules/promotions/components/HomeDashboard";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  // Opening the app keeps the figures fresh: orders are read in the background if they are over six hours old.
  if (await orderSyncIsDue(session.shop, 6)) void driveOrderSync(async () => (await unauthenticated.admin(session.shop)).admin, session.shop);
  const [current, previous, index] = await Promise.all([
    loadOrderReport(session.shop, emptyFilter(daysAgo(30), today())),
    // The 30 days before those, to show whether things are up or down.
    loadOrderReport(session.shop, emptyFilter(daysAgo(60), daysAgo(31))),
    indexState(session.shop),
  ]);
  return { current, previous, activeCount: index.ready ? await countActivePromotions(session.shop) : null };
}

export default function DashboardPage() {
  const { current, previous, activeCount } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!current.syncing) return;
    const timer = setTimeout(() => revalidator.revalidate(), 6000);
    return () => clearTimeout(timer);
  }, [current.syncing, current.syncedAt, revalidator]);
  return (
    <s-page heading="eCommerce Toolkit" inlineSize="large">
      <HomeDashboard current={current} previous={previous} activeCount={activeCount} />
    </s-page>
  );
}
