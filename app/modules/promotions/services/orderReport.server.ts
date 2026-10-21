import type { PrismaClient } from "@prisma/client";
import db from "../../../db.server";
import { aggregateOrderLines, averages, buildOrderReport, daysAgo, orderHistoryDays, previousRange, today, type DayRow, type OrderDiscount, type OrderFilter, type OrderReport } from "../design/orderReport";
import { discountStatusAt, type DiscountStatus } from "../design/discountSource";
import { decimal, type Cell } from "../design/csv";
import { describeGroup } from "../design/reports";
import { listReportGroups } from "./reports.server";
import type { ShopifyAdminClient } from "./discount.server";

type Database = Pick<PrismaClient, "reportOrderDay" | "reportOrderSync" | "reportGroup" | "discountIndex" | "$transaction">;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Orders are read with Shopify's bulk export: one request names what is wanted, Shopify prepares a file in the
// background (minutes, not seconds, for tens of thousands of orders) and the app downloads and totals it. That avoids
// paging through orders under the rate limit. Customer details are never asked for.
const allocation = "discountAllocations { allocatedAmountSet { shopMoney { amount } } discountApplication { index } }";
const bulkQuery = (fromDay: string) => `{
  orders(query: "created_at:>=${fromDay} test:false") { edges { node {
    id createdAt cancelledAt
    totalPriceSet { shopMoney { amount currencyCode } }
    currentTotalPriceSet { shopMoney { amount } }
    totalDiscountsSet { shopMoney { amount } }
    discountApplications { edges { node { __typename index
      ... on DiscountCodeApplication { code }
      ... on AutomaticDiscountApplication { title }
      ... on ManualDiscountApplication { title }
      ... on ScriptDiscountApplication { title }
    } } }
    lineItems { edges { node { id ${allocation} } } }
    shippingLines { edges { node { id ${allocation} } } }
  } } }
}`;

const START = `mutation ReportOrders($query: String!) {
  bulkOperationRunQuery(query: $query) { bulkOperation { id status } userErrors { field message } }
}`;
const STATUS = `query ReportOrdersStatus($id: ID!) {
  node(id: $id) { ... on BulkOperation { id status errorCode objectCount url } }
}`;

export type OrderSyncState = "idle" | "running";

/** Streams a downloaded file line by line, so a large export is never held as one string. */
export async function* linesOf(response: Response): AsyncGenerator<string> {
  if (!response.body) { yield* (await response.text()).split("\n"); return; }
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    rest += decoder.decode(chunk, { stream: true });
    const parts = rest.split("\n");
    rest = parts.pop() ?? "";
    yield* parts;
  }
  rest += decoder.decode();
  if (rest) yield rest;
}

/** The first day to read: the whole history the first time, then a couple of days back so late changes and refunds are picked up. */
export function firstDayToRead(syncedThrough: string | null | undefined, now = Date.now()): string {
  const earliest = daysAgo(orderHistoryDays, now);
  if (!syncedThrough) return earliest;
  const back = daysAgo(2, Date.parse(`${syncedThrough}T00:00:00Z`));
  return back < earliest ? earliest : back;
}

/** Stores freshly read totals in place of everything from `fromDay` on, and drops days beyond the history kept. */
export async function storeOrderDays(shop: string, rows: DayRow[], fromDay: string, database: Database = db, now = Date.now()) {
  const keep = rows.filter(row => row.day >= fromDay);
  const inserts = [];
  for (let at = 0; at < keep.length; at += 5000) inserts.push(database.reportOrderDay.createMany({ data: keep.slice(at, at + 5000).map(row => ({ shop, ...row })) }));
  await database.$transaction([
    database.reportOrderDay.deleteMany({ where: { shop, OR: [{ day: { gte: fromDay } }, { day: { lt: daysAgo(orderHistoryDays, now) } }] } }),
    ...inserts,
  ]);
}

/**
 * Moves reading orders on one step: starts a bulk export if none is running, or checks the one that is and, when
 * Shopify has finished it, totals the file. Safe to call repeatedly. Returns whether an export is still in progress.
 */
export async function stepOrderSync(admin: ShopifyAdminClient, shop: string, database: Database = db, now = Date.now(), download: (url: string) => Promise<Response> = url => fetch(url)): Promise<OrderSyncState> {
  const sync = await database.reportOrderSync.findUnique({ where: { shop } });
  if (sync?.operationId) {
    const result = await (await admin.graphql(STATUS, { variables: { id: sync.operationId } })).json();
    const operation = result.data?.node as { status?: string; errorCode?: string | null; url?: string | null } | null | undefined;
    const status = operation?.status;
    if (status === "CREATED" || status === "RUNNING" || status === "CANCELING") {
      // An export that has not finished in two hours is abandoned, so a stuck one cannot block reports for good.
      if (sync.startedAt && now - sync.startedAt.getTime() > 2 * 3600000) {
        await database.reportOrderSync.update({ where: { shop }, data: { operationId: null, error: "Shopify took too long to prepare the orders. It will be tried again." } });
        return "idle";
      }
      return "running";
    }
    if (status === "COMPLETED") {
      try {
        const fromDay = sync.fromDay ?? firstDayToRead(null, now);
        const { rows, currency } = operation?.url ? await aggregateOrderLines(linesOf(await download(operation.url))) : { rows: [], currency: null };
        await storeOrderDays(shop, rows, fromDay, database, now);
        await database.reportOrderSync.update({ where: { shop }, data: { operationId: null, syncedThrough: today(now), syncedAt: new Date(now), currency: currency ?? sync.currency, error: null } });
      } catch (error) {
        await database.reportOrderSync.update({ where: { shop }, data: { operationId: null, error: `The orders could not be totalled: ${error instanceof Error ? error.message : "unknown error"}` } });
      }
      return "idle";
    }
    await database.reportOrderSync.update({ where: { shop }, data: { operationId: null, error: `Shopify could not prepare the orders (${operation?.errorCode ?? status ?? "unknown"}). It will be tried again.` } });
    return "idle";
  }
  const fromDay = firstDayToRead(sync?.syncedThrough, now);
  const result = await (await admin.graphql(START, { variables: { query: bulkQuery(fromDay) } })).json();
  const errors: Array<{ message: string }> = [...(result.errors ?? []), ...(result.data?.bulkOperationRunQuery?.userErrors ?? [])];
  const id = result.data?.bulkOperationRunQuery?.bulkOperation?.id as string | undefined;
  if (!id) {
    const message = errors.map(error => error.message).join(" ") || "Shopify did not start reading the orders.";
    await database.reportOrderSync.upsert({ where: { shop }, create: { shop, error: message }, update: { error: message } });
    return "idle";
  }
  await database.reportOrderSync.upsert({ where: { shop }, create: { shop, operationId: id, fromDay, startedAt: new Date(now) }, update: { operationId: id, fromDay, startedAt: new Date(now), error: null } });
  return "running";
}

const driving = new Set<string>();
export const isOrderSyncDriven = (shop: string) => driving.has(shop);

/** Starts reading the orders if none is being read, then checks every few seconds until Shopify is done. One at a time per shop. */
export async function driveOrderSync(getAdmin: () => Promise<ShopifyAdminClient>, shop: string, database: Database = db, wait: (ms: number) => Promise<unknown> = sleep, maxChecks = 720): Promise<void> {
  if (driving.has(shop)) return;
  driving.add(shop);
  try {
    for (let check = 0; check < maxChecks; check++) {
      if (await stepOrderSync(await getAdmin(), shop, database) === "idle") return;
      await wait(5000);
    }
  } catch (error) {
    // For example the permission to read orders has not been granted yet. The page shows this instead of failing.
    const message = error instanceof Error ? error.message : "The orders could not be read.";
    await database.reportOrderSync.upsert({ where: { shop }, create: { shop, error: message }, update: { operationId: null, error: message } });
  } finally { driving.delete(shop); }
}

/** True when the orders have never been read, or were last read more than `hours` ago, and none is being read now. */
export async function orderSyncIsDue(shop: string, hours: number, database: Database = db, now = Date.now()): Promise<boolean> {
  const sync = await database.reportOrderSync.findUnique({ where: { shop } });
  if (sync?.operationId && sync.startedAt && now - sync.startedAt.getTime() < 2 * 3600000) return false;
  return !sync?.syncedAt || now - sync.syncedAt.getTime() > hours * 3600000;
}

export type OrderReportData = {
  report: OrderReport;
  /** The same figures for the days straight before, when the orders held reach back that far. */
  previous: OrderReport | null;
  previousRange: { from: string; to: string } | null;
  filter: OrderFilter;
  currency: string;
  syncedAt: string | null;
  syncing: boolean;
  error: string | null;
  groups: Array<{ id: number; name: string }>;
};

export async function loadOrderReport(shop: string, filter: OrderFilter, database: Database = db, options: { compare?: boolean; now?: number } = {}): Promise<OrderReportData> {
  const before = options.compare ? previousRange(filter, options.now) : null;
  const [groups, rows, sync] = await Promise.all([
    listReportGroups(shop, database),
    database.reportOrderDay.findMany({ where: { shop, day: { gte: before?.from ?? filter.from, lte: filter.to } } }),
    database.reportOrderSync.findUnique({ where: { shop } }),
  ]);
  return {
    report: buildOrderReport(rows, groups, filter),
    previous: before ? buildOrderReport(rows, groups, { ...filter, ...before }) : null,
    previousRange: before,
    filter,
    currency: sync?.currency ?? "GBP",
    syncedAt: sync?.syncedAt?.toISOString() ?? null,
    syncing: Boolean(sync?.operationId) || isOrderSyncDriven(shop),
    error: sync?.error ?? null,
    groups: groups.map(group => ({ id: group.id, name: group.name })),
  };
}

// ---- Downloads ----

export const exportKinds = ["discounts", "days", "groups", "prefixes"] as const;
export type ExportKind = (typeof exportKinds)[number];

const money = (cents: number) => decimal(cents);
const totalsCells = (totals: { orders: number; valueCents: number; discountCents: number; refundCents: number }): Cell[] => {
  const average = averages(totals);
  return [totals.orders, money(totals.valueCents), money(totals.discountCents), money(totals.refundCents), average.orderValueCents === null ? "" : money(average.orderValueCents), average.discountPerOrderCents === null ? "" : money(average.discountPerOrderCents)];
};
const totalsHeaders = ["Orders", "Revenue", "Discount given", "Refunded", "Average order value", "Average discount per order"];

/** The table behind a report as rows for a download: every row, not just the ones the page shows. */
export async function exportOrderTable(shop: string, kind: ExportKind, filter: OrderFilter, database: Database = db): Promise<{ filename: string; headers: string[]; rows: Cell[][] }> {
  const groups = await listReportGroups(shop, database);
  const rows = await database.reportOrderDay.findMany({ where: { shop, day: { gte: filter.from, lte: filter.to } } });
  const report = buildOrderReport(rows, groups, filter, Number.MAX_SAFE_INTEGER);
  const range = `${filter.from}_to_${filter.to}`;
  if (kind === "days") return { filename: `discounts-by-day-${range}.csv`, headers: ["Day", ...totalsHeaders], rows: report.days.map(item => [item.day, ...totalsCells(item)]) };
  if (kind === "groups") return { filename: `discounts-by-group-${range}.csv`, headers: ["Group", "Rule", ...totalsHeaders], rows: report.groups.map(line => [line.name, groups.find(group => `group-${group.id}` === line.key) ? describeGroup(groups.find(group => `group-${group.id}` === line.key)!) : "Discounts in no group", ...totalsCells(line)]) };
  if (kind === "prefixes") return { filename: `discounts-by-code-prefix-${range}.csv`, headers: ["Code prefix", ...totalsHeaders], rows: report.prefixes.map(line => [line.name, ...totalsCells(line)]) };
  return { filename: `discounts-${range}.csv`, headers: ["Discount", "Type", ...totalsHeaders], rows: report.discounts.map(item => [item.label, item.kind === "code" ? "Discount code" : item.kind === "manual" ? "Manual discount" : "Automatic discount", ...totalsCells(item)]) };
}

// ---- Discounts that no group catches ----

export type UngroupedDiscount = OrderDiscount & { status: DiscountStatus | null };

/**
 * The discounts used in the period that belong to none of the merchant's groups, most revenue first, each with its
 * status where the app can match it to a discount it knows: a code by the code, an automatic or manual discount by
 * its title. A code that cannot be matched (for example one of many in a discount) has no status.
 */
export async function loadUngrouped(shop: string, filter: OrderFilter, database: Database = db, now = new Date()): Promise<{ rows: UngroupedDiscount[]; count: number }> {
  const groups = await listReportGroups(shop, database);
  const days = await database.reportOrderDay.findMany({ where: { shop, day: { gte: filter.from, lte: filter.to } } });
  const report = buildOrderReport(days, groups, { ...filter, group: "other" }, 200);
  const found = [...report.discounts].sort((a, b) => b.valueCents - a.valueCents || b.orders - a.orders);
  const codes = found.filter(item => item.kind === "code").map(item => item.label);
  const titles = found.filter(item => item.kind !== "code").map(item => item.label);
  const variants = [...new Set(codes.flatMap(code => [code, code.toUpperCase(), code.toLowerCase()]))];
  const indexed = codes.length || titles.length
    ? await database.discountIndex.findMany({ where: { shop, OR: [...(variants.length ? [{ code: { in: variants } }] : []), ...(titles.length ? [{ kind: "automatic", title: { in: titles } }] : [])] }, select: { code: true, title: true, kind: true, startsAt: true, endsAt: true } })
    : [];
  const byCode = new Map(indexed.filter(row => row.kind === "code").map(row => [row.code.toLowerCase(), row]));
  const byTitle = new Map(indexed.filter(row => row.kind !== "code").map(row => [row.title, row]));
  const rows = found.map(item => {
    const match = item.kind === "code" ? byCode.get(item.label.toLowerCase()) : byTitle.get(item.label);
    return { ...item, status: match ? discountStatusAt(match.startsAt, match.endsAt, now) : null };
  });
  return { rows, count: report.discountCount };
}
