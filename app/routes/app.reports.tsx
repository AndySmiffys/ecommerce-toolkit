import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { filterFromParams } from "../modules/promotions/design/orderReport";
import { periodDays } from "../modules/promotions/design/reports";
import { driveOrderSync, loadOrderReport, orderSyncIsDue } from "../modules/promotions/services/orderReport.server";
import { deleteReportGroup, isSnapshotRunning, loadDiscountCounts, loadReport, moveReportGroup, saveReportGroup, snapshotIsStale, takeSnapshot } from "../modules/promotions/services/reports.server";
import { ReportsPage } from "../modules/promotions/components/ReportsPage";

// How old the figures may be before opening the page reads them again from Shopify.
const staleAfterHours = 6;

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const period = new URL(request.url).searchParams.get("period") ?? "all";
  // Reading every discount's usage can take a while, so it happens in the background and the page shows what it has.
  if (!isSnapshotRunning(session.shop) && await snapshotIsStale(session.shop, staleAfterHours)) {
    void takeSnapshot(admin, session.shop).catch(error => console.error("The report reading failed:", error instanceof Error ? error.message : error));
  }
  // Orders are read the same way: in the background, with the page showing what is stored meanwhile.
  if (await orderSyncIsDue(session.shop, staleAfterHours)) void driveOrderSync(async () => (await unauthenticated.admin(session.shop)).admin, session.shop);
  const orders = await loadOrderReport(session.shop, filterFromParams(new URL(request.url).searchParams));
  return { data: await loadReport(session.shop, periodDays(period)), orders, counts: await loadDiscountCounts(admin), period, refreshing: isSnapshotRunning(session.shop) || orders.syncing };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "refresh") {
      void takeSnapshot(admin, session.shop).catch(error => console.error("The report reading failed:", error instanceof Error ? error.message : error));
      void driveOrderSync(async () => (await unauthenticated.admin(session.shop)).admin, session.shop);
    } else if (intent === "saveGroup") {
      await saveReportGroup(session.shop, { id: form.get("id") || undefined, name: form.get("name"), matchOn: form.get("matchOn"), matchType: form.get("matchType"), pattern: form.get("pattern") });
    } else if (intent === "deleteGroup") {
      await deleteReportGroup(session.shop, Number(form.get("id")));
    } else if (intent === "moveGroup") {
      await moveReportGroup(session.shop, Number(form.get("id")), form.get("direction") === "up" ? "up" : "down");
    } else return { ok: false as const, error: "That action is not available." };
    return { ok: true as const, error: null, intent };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "That could not be saved." };
  }
}

export default function Reports() {
  const { data, orders, counts, period, refreshing } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  // While the figures are being read, check back every few seconds so they appear as soon as they are ready.
  useEffect(() => {
    if (!refreshing) return;
    const timer = setTimeout(() => revalidator.revalidate(), 6000);
    return () => clearTimeout(timer);
  }, [refreshing, data.takenAt, revalidator]);
  return <ReportsPage data={data} orders={orders} counts={counts} period={period} refreshing={refreshing} />;
}
