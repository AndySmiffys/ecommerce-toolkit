import type { PrismaClient } from "@prisma/client";
import db from "../../../db.server";
import { promotionDiscountId } from "../design/discountIdentity";
import { buildReport, maxGroups, validateGroup, type GroupDef, type Report, type UsageRow } from "../design/reports";
import type { ShopifyAdminClient } from "./discount.server";

type Database = Pick<PrismaClient, "reportGroup" | "reportSnapshot">;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ---- Reading how often each discount has been used ----

// Only discounts that have been used are asked for. A page is kept small enough to stay inside Shopify's limit on how
// costly one request may be, and pages are read one after another, waiting out Shopify's rate limit when it applies.
const pageSize = 100;
const maxPages = 250;
const USAGE_PAGE = `query ReportUsage($first: Int!, $after: String) {
  discountNodes(first: $first, after: $after, query: "times_used:>0", sortKey: ID) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      events(first: 1, query: "action:create") { nodes { ... on BasicEvent { appTitle } } }
      discount {
        __typename
        ... on DiscountCodeBasic { title asyncUsageCount codes(first: 1) { nodes { code } } }
        ... on DiscountCodeBxgy { title asyncUsageCount codes(first: 1) { nodes { code } } }
        ... on DiscountCodeFreeShipping { title asyncUsageCount codes(first: 1) { nodes { code } } }
        ... on DiscountCodeApp { title asyncUsageCount codes(first: 1) { nodes { code } } }
        ... on DiscountAutomaticBasic { title asyncUsageCount }
        ... on DiscountAutomaticBxgy { title asyncUsageCount }
        ... on DiscountAutomaticFreeShipping { title asyncUsageCount }
        ... on DiscountAutomaticApp { title asyncUsageCount }
      }
    }
  }
}`;

type UsageNode = {
  id: string;
  events?: { nodes?: Array<{ appTitle?: string | null } | null> };
  discount?: { __typename?: string; title?: string | null; asyncUsageCount?: number | null; codes?: { nodes?: Array<{ code?: string } | null> } } | null;
};

/**
 * Every discount that has been used, from every source: made by hand, by this app, or by any other app. `complete` is
 * false only if it stopped at the page limit, so a report never passes off partial figures as the whole.
 */
export async function loadUsage(admin: ShopifyAdminClient, wait: (ms: number) => Promise<unknown> = sleep): Promise<{ rows: UsageRow[]; complete: boolean }> {
  const rows: UsageRow[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    let result;
    for (let attempt = 0; ; attempt++) {
      result = await (await admin.graphql(USAGE_PAGE, { variables: { first: pageSize, after } })).json();
      const errors: Array<{ message: string; extensions?: { code?: string } }> = result.errors ?? [];
      if (!errors.length) break;
      if (errors.every(error => error.extensions?.code === "THROTTLED") && attempt < 8) { await wait(1500 * (attempt + 1)); continue; }
      throw new Error(errors.some(error => error.extensions?.code === "THROTTLED") ? "Shopify is limiting requests right now. Try the report again in a minute." : errors.map(error => error.message).join(" "));
    }
    const connection = result.data?.discountNodes as { pageInfo?: { hasNextPage: boolean; endCursor: string | null }; nodes?: UsageNode[] } | undefined;
    for (const node of connection?.nodes ?? []) {
      const discount = node.discount;
      const uses = Number(discount?.asyncUsageCount ?? 0);
      if (!discount || !(uses > 0)) continue;
      rows.push({
        id: promotionDiscountId(node.id),
        title: String(discount.title ?? ""),
        code: String(discount.codes?.nodes?.[0]?.code ?? ""),
        kind: String(discount.__typename ?? "").startsWith("DiscountCode") ? "code" : "automatic",
        createdBy: node.events?.nodes?.[0]?.appTitle || "Unknown",
        uses,
      });
    }
    if (!connection?.pageInfo?.hasNextPage) return { rows, complete: true };
    after = connection.pageInfo.endCursor;
  }
  return { rows, complete: false };
}

// ---- How many discounts there are altogether, used or not ----

export type DiscountCounts = { all: number; used: number; neverUsed: number; codes: number; automatic: number; active: number; capped: boolean };
const COUNTS = `query ReportCounts {
  all: discountNodesCount(limit: 10000) { count precision }
  used: discountNodesCount(query: "times_used:>0", limit: 10000) { count precision }
  codes: discountNodesCount(query: "method:code", limit: 10000) { count precision }
  automatic: discountNodesCount(query: "method:automatic", limit: 10000) { count precision }
  active: discountNodesCount(query: "status:active", limit: 10000) { count precision }
}`;

/** Every discount in the store, used or not, so the page shows the whole picture beside the ones that have redemptions. Null if Shopify cannot say. */
export async function loadDiscountCounts(admin: ShopifyAdminClient): Promise<DiscountCounts | null> {
  try {
    const result = await (await admin.graphql(COUNTS)).json();
    if (result.errors?.length || !result.data) return null;
    const read = (key: string) => result.data[key] as { count?: number; precision?: string } | undefined;
    const count = (key: string) => Number(read(key)?.count ?? 0);
    const all = count("all");
    const used = count("used");
    return { all, used, neverUsed: Math.max(0, all - used), codes: count("codes"), automatic: count("automatic"), active: count("active"), capped: Object.keys(result.data).some(key => read(key)?.precision === "AT_LEAST") };
  } catch { return null; }
}

// ---- Snapshots: Shopify gives lifetime totals, so redemptions in a period come from two snapshots ----

const keepDays = 120;
const running = new Set<string>();

// One entry per used discount, as a short list to keep a snapshot small: id, title, first code, kind, creator, uses.
const pack = (rows: UsageRow[]) => JSON.stringify(rows.map(row => [row.id.split("/").pop(), row.title, row.code, row.kind === "code" ? "c" : "a", row.createdBy, row.uses]));
export function unpack(text: string): UsageRow[] {
  try {
    return (JSON.parse(text) as Array<[string, string, string, string, string, number]>).map(([id, title, code, kind, createdBy, uses]) => ({ id: `gid://shopify/DiscountNode/${id}`, title, code, kind: kind === "c" ? "code" : "automatic", createdBy, uses }));
  } catch { return []; }
}

export const isSnapshotRunning = (shop: string) => running.has(shop);

/** Reads the usage of every discount and stores it. Only one runs at a time per shop. Returns null if one was already running. */
export async function takeSnapshot(admin: ShopifyAdminClient, shop: string, database: Database = db, now = Date.now(), wait?: (ms: number) => Promise<unknown>) {
  if (running.has(shop)) return null;
  running.add(shop);
  try {
    const { rows, complete } = await loadUsage(admin, wait);
    const snapshot = await database.reportSnapshot.create({ data: { shop, takenAt: new Date(now), complete, discountCount: rows.length, rowsJson: pack(rows) } });
    await database.reportSnapshot.deleteMany({ where: { shop, takenAt: { lt: new Date(now - keepDays * 86400000) } } });
    return snapshot;
  } finally { running.delete(shop); }
}

// ---- What the page shows ----

export type ReportData = {
  groups: GroupDef[];
  report: Report | null;
  /** When the figures were read from Shopify, or null before the first reading. */
  takenAt: string | null;
  /** False if the reading stopped at the page limit. */
  complete: boolean;
  /** For a period: the snapshot it is measured from. Null when the period is all time, or there is no snapshot that old yet. */
  comparedWith: string | null;
  /** The first snapshot, so the page can say how far back the history goes. */
  historyStart: string | null;
  days: number | null;
};

export async function listReportGroups(shop: string, database: Pick<PrismaClient, "reportGroup"> = db): Promise<GroupDef[]> {
  const rows = await database.reportGroup.findMany({ where: { shop }, orderBy: [{ position: "asc" }, { id: "asc" }] });
  return rows.map(row => ({ id: row.id, name: row.name, matchOn: row.matchOn as GroupDef["matchOn"], matchType: row.matchType as GroupDef["matchType"], pattern: row.pattern }));
}

/** The latest figures, and for a period the figures from the newest snapshot at least that old. */
export async function loadReport(shop: string, days: number | null, database: Database = db, now = Date.now()): Promise<ReportData> {
  const groups = await listReportGroups(shop, database);
  const latest = await database.reportSnapshot.findFirst({ where: { shop }, orderBy: { takenAt: "desc" } });
  const first = await database.reportSnapshot.findFirst({ where: { shop }, orderBy: { takenAt: "asc" }, select: { takenAt: true } });
  const earlier = latest && days ? await database.reportSnapshot.findFirst({ where: { shop, takenAt: { lte: new Date(now - days * 86400000) } }, orderBy: { takenAt: "desc" } }) : null;
  return {
    groups,
    report: latest ? buildReport(groups, unpack(latest.rowsJson), earlier ? unpack(earlier.rowsJson) : null) : null,
    takenAt: latest?.takenAt.toISOString() ?? null,
    complete: latest?.complete ?? true,
    comparedWith: earlier?.takenAt.toISOString() ?? null,
    historyStart: first?.takenAt.toISOString() ?? null,
    days,
  };
}

/** True when the newest snapshot is missing or older than `hours`. */
export async function snapshotIsStale(shop: string, hours: number, database: Database = db, now = Date.now()): Promise<boolean> {
  const latest = await database.reportSnapshot.findFirst({ where: { shop }, orderBy: { takenAt: "desc" }, select: { takenAt: true } });
  return !latest || now - latest.takenAt.getTime() > hours * 3600000;
}

// ---- The merchant's groups ----

export async function saveReportGroup(shop: string, input: { id?: unknown; name?: unknown; matchOn?: unknown; matchType?: unknown; pattern?: unknown }, database: Database = db): Promise<void> {
  const values = validateGroup(input);
  const id = typeof input.id === "string" && /^\d+$/.test(input.id) ? Number(input.id) : typeof input.id === "number" ? input.id : null;
  if (id !== null) {
    const updated = await database.reportGroup.updateMany({ where: { id, shop }, data: values });
    if (!updated.count) throw new Error("That group no longer exists. Reload the page.");
    return;
  }
  const existing = await database.reportGroup.findMany({ where: { shop }, select: { position: true } });
  if (existing.length >= maxGroups) throw new Error(`You can have up to ${maxGroups} groups.`);
  await database.reportGroup.create({ data: { shop, ...values, position: Math.max(-1, ...existing.map(row => row.position)) + 1 } });
}

export async function deleteReportGroup(shop: string, id: number, database: Database = db): Promise<void> {
  await database.reportGroup.deleteMany({ where: { id, shop } });
}

/** Moves a group one place earlier or later. A discount counts in the first group it matches, so the order matters. */
export async function moveReportGroup(shop: string, id: number, direction: "up" | "down", database: Database = db): Promise<void> {
  const groups = await database.reportGroup.findMany({ where: { shop }, orderBy: [{ position: "asc" }, { id: "asc" }] });
  const index = groups.findIndex(group => group.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= groups.length) return;
  const order = groups.map(group => group.id);
  [order[index], order[target]] = [order[target], order[index]];
  for (const [position, groupId] of order.entries()) await database.reportGroup.updateMany({ where: { id: groupId, shop }, data: { position } });
}
