import { authenticate, unauthenticated } from "../../../shopify.server";
import { filterFromParams } from "../design/orderReport";
import { periodDays } from "../design/reports";
import { driveOrderSync, loadOrderReport, orderSyncIsDue } from "./orderReport.server";
import { deleteReportGroup, isSnapshotRunning, loadDiscountCounts, loadReport, moveReportGroup, saveReportGroup, snapshotIsStale, takeSnapshot } from "./reports.server";

// How old the figures may be before opening a report page reads them again from Shopify.
const staleAfterHours = 6;

/** What every Reports page needs. Reading from Shopify happens in the background, and the page shows what is stored meanwhile. */
export async function loadReportsPage(request: Request) {
  const { admin, session } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const period = params.get("period") ?? "all";
  if (!isSnapshotRunning(session.shop) && await snapshotIsStale(session.shop, staleAfterHours)) {
    void takeSnapshot(admin, session.shop).catch(error => console.error("The report reading failed:", error instanceof Error ? error.message : error));
  }
  if (await orderSyncIsDue(session.shop, staleAfterHours)) void driveOrderSync(async () => (await unauthenticated.admin(session.shop)).admin, session.shop);
  const compare = params.get("compare") !== "0";
  const orders = await loadOrderReport(session.shop, filterFromParams(params), undefined, { compare });
  return { data: await loadReport(session.shop, periodDays(period)), orders, counts: await loadDiscountCounts(admin), period, compare, refreshing: isSnapshotRunning(session.shop) || orders.syncing };
}

/** The changes made on a Reports page: refresh the figures, and manage the groups. */
export async function runReportsAction(request: Request) {
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
