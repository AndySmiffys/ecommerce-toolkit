import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import { periodDays } from "../modules/promotions/design/reports";
import { deleteReportGroup, isSnapshotRunning, loadReport, moveReportGroup, saveReportGroup, snapshotIsStale, takeSnapshot } from "../modules/promotions/services/reports.server";
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
  return { data: await loadReport(session.shop, periodDays(period)), period, refreshing: isSnapshotRunning(session.shop) };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "refresh") {
      void takeSnapshot(admin, session.shop).catch(error => console.error("The report reading failed:", error instanceof Error ? error.message : error));
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
  const { data, period, refreshing } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  // While the figures are being read, check back every few seconds so they appear as soon as they are ready.
  useEffect(() => {
    if (!refreshing) return;
    const timer = setTimeout(() => revalidator.revalidate(), 6000);
    return () => clearTimeout(timer);
  }, [refreshing, data.takenAt, revalidator]);
  return <ReportsPage data={data} period={period} refreshing={refreshing} />;
}
