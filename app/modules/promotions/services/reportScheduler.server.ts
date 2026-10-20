import db from "../../../db.server";
import { unauthenticated } from "../../../shopify.server";
import { snapshotIsStale, takeSnapshot } from "./reports.server";

/**
 * Takes the usage snapshot for every shop that has the app installed and has none from the last day. The Reports page
 * measures a period from two snapshots, so a regular one is what makes its trends work. A shop that fails is logged
 * and skipped, and the others carry on. Two server copies running at once may each take one, which does no harm.
 */
export async function takeDueSnapshots(): Promise<void> {
  const shops = await db.session.findMany({ where: { isOnline: false }, select: { shop: true }, distinct: ["shop"] });
  for (const { shop } of shops) {
    try {
      if (!(await snapshotIsStale(shop, 23))) continue;
      const { admin } = await unauthenticated.admin(shop);
      await takeSnapshot(admin, shop);
    } catch (error) {
      console.error(`The report snapshot for ${shop} failed:`, error instanceof Error ? error.message : error);
    }
  }
}

/** Starts the hourly check once per server process, however many times this is called (dev reloads included). */
export function startReportScheduler(): void {
  const marker = Symbol.for("ecommerce-toolkit.report-scheduler");
  const global = globalThis as Record<symbol, unknown>;
  if (global[marker]) return;
  global[marker] = true;
  // The first check waits a couple of minutes so start-up is not slowed. `unref` lets the server shut down normally.
  setTimeout(() => { void takeDueSnapshots(); }, 2 * 60 * 1000).unref?.();
  setInterval(() => { void takeDueSnapshots(); }, 60 * 60 * 1000).unref?.();
}
