// What discounts return, worked out from orders: how many orders used each discount, what those orders were worth and
// what the discount gave away. Shopify's bulk export of orders is read into one row per day and per discount (see
// ReportOrderDay), and the Reports page filters and totals those rows. Nothing here identifies a customer.
import { codePrefix, matchesGroup, otherKey, type GroupDef } from "./reports";

export const allKey = "*all";
export const discountedKey = "*discounted";
/** Orders that carry a manual discount: one a person added by hand, such as on a replacement order. Kept apart from promotions. */
export const manualKey = "*manual";
export type DiscountKind = "code" | "automatic" | "manual";

/** One day's totals for one discount (or for a special key). Money is in minor units. */
export type DayRow = { day: string; key: string; kind: string; label: string; orders: number; valueCents: number; refundCents: number; discountCents: number };

type Application = { index: number; kind: DiscountKind; label: string };
type OrderRecord = { name: string; createdAt: string; valueCents: number; currentCents: number; discountCents: number; applications: Application[]; allocated: Map<number, number> };

const cents = (amount: unknown) => Math.round(Number(amount ?? 0) * 100) || 0;
const money = (set: unknown) => (set as { shopMoney?: { amount?: string } } | undefined)?.shopMoney?.amount;

/**
 * Reads Shopify's bulk export of orders (one JSON object per line; each line below an order names it in __parentId)
 * into one total per day and discount. Each discount's share of an order is the sum of what it took off that order's
 * line items and shipping. An order that used two discounts counts once under each, and once in the order's own totals.
 */
/** An order that carried a manual discount, for the list on the Manual discounts report. Nothing here identifies a customer. */
export type ManualOrder = { orderId: string; name: string; day: string; createdAt: string; reasons: string; valueCents: number; discountCents: number };

export async function aggregateOrderLines(lines: Iterable<string> | AsyncIterable<string>): Promise<{ rows: DayRow[]; currency: string | null; orders: number; manualOrders: ManualOrder[] }> {
  const orders = new Map<string, OrderRecord>();
  let currency: string | null = null;
  for await (const line of lines) {
    if (!line.trim()) continue;
    let item: Record<string, unknown>;
    try { item = JSON.parse(line); } catch { continue; }
    const parent = typeof item.__parentId === "string" ? item.__parentId : null;
    if (!parent) {
      if (typeof item.id !== "string" || typeof item.createdAt !== "string" || item.cancelledAt) continue;
      const total = (item.totalPriceSet as { shopMoney?: { currencyCode?: string } } | undefined)?.shopMoney;
      currency = currency ?? total?.currencyCode ?? null;
      orders.set(item.id, { name: String(item.name ?? ""), createdAt: item.createdAt, valueCents: cents(money(item.totalPriceSet)), currentCents: cents(money(item.currentTotalPriceSet) ?? money(item.totalPriceSet)), discountCents: cents(money(item.totalDiscountsSet)), applications: [], allocated: new Map() });
      continue;
    }
    const order = orders.get(parent);
    if (!order) continue;
    const type = String(item.__typename ?? "");
    if (type.endsWith("Application") && type.includes("Discount")) {
      const label = String(item.code ?? item.title ?? item.description ?? "").trim();
      if (!label) continue;
      order.applications.push({ index: typeof item.index === "number" ? item.index : order.applications.length, kind: type === "DiscountCodeApplication" ? "code" : type === "ManualDiscountApplication" ? "manual" : "automatic", label });
    } else if (Array.isArray(item.discountAllocations)) {
      for (const allocation of item.discountAllocations as Array<{ allocatedAmountSet?: unknown; discountApplication?: { index?: number } }>) {
        const index = allocation.discountApplication?.index;
        if (typeof index === "number") order.allocated.set(index, (order.allocated.get(index) ?? 0) + cents(money(allocation.allocatedAmountSet)));
      }
    }
  }
  const rows = new Map<string, DayRow>();
  const add = (day: string, key: string, kind: string, label: string, order: OrderRecord, discountCents: number) => {
    const id = `${day}\u0000${key}`;
    const row = rows.get(id) ?? { day, key, kind, label, orders: 0, valueCents: 0, refundCents: 0, discountCents: 0 };
    row.orders++; row.valueCents += order.valueCents; row.refundCents += Math.max(0, order.valueCents - order.currentCents); row.discountCents += discountCents;
    rows.set(id, row);
  };
  const manualOrders: ManualOrder[] = [];
  for (const [orderId, order] of orders) {
    const day = order.createdAt.slice(0, 10);
    add(day, allKey, "all", "All orders", order, order.discountCents);
    if (!order.applications.length) continue;
    const mine = new Map<string, { kind: DiscountKind; label: string; cents: number }>();
    for (const application of order.applications) {
      const key = `${application.kind === "code" ? "c" : application.kind === "manual" ? "m" : "a"}:${application.kind === "code" ? application.label.toUpperCase() : application.label}`;
      const entry = mine.get(key) ?? { kind: application.kind, label: application.label, cents: 0 };
      entry.cents += order.allocated.get(application.index) ?? 0;
      mine.set(key, entry);
    }
    const promotions = [...mine.values()].filter(entry => entry.kind !== "manual");
    const manual = [...mine.values()].filter(entry => entry.kind === "manual");
    // What each side took off: the whole discount when the order has only that side, else what its lines allocated.
    const share = (entries: typeof promotions) => entries.reduce((sum, entry) => sum + entry.cents, 0);
    // An order counts as a promotion order only if a promotion or code was used. Replacement orders (manual only) are kept apart.
    if (promotions.length) add(day, discountedKey, "all", "Orders with a discount", order, manual.length ? share(promotions) : order.discountCents);
    if (manual.length) {
      const given = promotions.length ? share(manual) : order.discountCents;
      add(day, manualKey, "all", "Orders with a manual discount", order, given);
      manualOrders.push({ orderId, name: order.name, day, createdAt: order.createdAt, reasons: manual.map(entry => entry.label).join(", "), valueCents: order.valueCents, discountCents: given });
    }
    for (const [key, entry] of mine) add(day, key, entry.kind, entry.label, order, entry.cents);
  }
  return { rows: [...rows.values()], currency, orders: orders.size, manualOrders };
}

// ---- Filtering and totalling ----

export type OrderFilter = { from: string; to: string; group: string; prefix: string; kind: string; search: string };
export type Totals = { orders: number; valueCents: number; refundCents: number; discountCents: number };
export type OrderLine = Totals & { key: string; name: string; description: string };
export type OrderDiscount = Totals & { key: string; label: string; kind: string };
export type OrderReport = {
  /** Every order in the period, with or without a discount. */
  all: Totals;
  /** What the filters leave: the orders that used a matching discount. Exact (each order once) only when no filter narrows it. */
  selected: Totals;
  exact: boolean;
  /** Share of all orders in the period that used a discount, 0 to 1. */
  discountedShare: number;
  groups: OrderLine[];
  prefixes: OrderLine[];
  days: Array<Totals & { day: string }>;
  discounts: OrderDiscount[];
  discountCount: number;
  /** The prefixes found in the period, for the filter. */
  prefixChoices: string[];
  /** Orders with a manual discount, such as replacements. They are not in any figure above. */
  manual: ManualReport;
};
export type ManualReport = { totals: Totals; days: Array<Totals & { day: string }>; reasons: OrderDiscount[]; /** Share of all orders in the period, 0 to 1. */ share: number };

const zero = (): Totals => ({ orders: 0, valueCents: 0, refundCents: 0, discountCents: 0 });
const plus = (into: Totals, row: Totals) => { into.orders += row.orders; into.valueCents += row.valueCents; into.refundCents += row.refundCents; into.discountCents += row.discountCents; };
export const emptyFilter = (from: string, to: string): OrderFilter => ({ from, to, group: "", prefix: "", kind: "", search: "" });

/** The group a discount belongs to: the first the merchant defined that matches, else Other discounts. */
export function groupOf(groups: GroupDef[], row: Pick<DayRow, "kind" | "label">): string {
  const input = row.kind === "code" ? { code: row.label, title: "" } : { code: "", title: row.label };
  const hit = groups.find(group => matchesGroup(group, input));
  return hit ? `group-${hit.id}` : otherKey;
}

export function buildOrderReport(rows: DayRow[], groups: GroupDef[], filter: OrderFilter, limit = 200): OrderReport {
  const all = zero();
  const discounted = zero();
  const selected = zero();
  const byDiscount = new Map<string, OrderDiscount>();
  const byGroup = new Map<string, OrderLine>(groups.map(group => [`group-${group.id}`, { key: `group-${group.id}`, name: group.name, description: "", orders: 0, valueCents: 0, refundCents: 0, discountCents: 0 }]));
  byGroup.set(otherKey, { key: otherKey, name: "Other discounts", description: "", ...zero() });
  const byPrefix = new Map<string, OrderLine>();
  const byDay = new Map<string, Totals & { day: string }>();
  const discountedByDay = new Map<string, Totals & { day: string }>();
  const prefixes = new Set<string>();
  const manualTotals = zero();
  const manualByDay = new Map<string, Totals & { day: string }>();
  const byReason = new Map<string, OrderDiscount>();
  const search = filter.search.trim().toLowerCase();
  const narrowed = Boolean(filter.group || filter.prefix || filter.kind || search);
  const bump = (map: Map<string, Totals & { day: string }>, row: DayRow) => { const entry = map.get(row.day) ?? { day: row.day, ...zero() }; plus(entry, row); map.set(row.day, entry); };
  for (const row of rows) {
    if (row.day < filter.from || row.day > filter.to) continue;
    if (row.key === allKey) { plus(all, row); continue; }
    if (row.key === discountedKey) { plus(discounted, row); bump(discountedByDay, row); continue; }
    if (row.key === manualKey) { plus(manualTotals, row); bump(manualByDay, row); continue; }
    if (row.kind === "manual") {
      const reason = byReason.get(row.key) ?? { key: row.key, label: row.label, kind: row.kind, ...zero() };
      plus(reason, row);
      byReason.set(row.key, reason);
      continue;
    }
    const prefix = row.kind === "code" ? codePrefix(row.label) : null;
    if (prefix) prefixes.add(prefix);
    if (filter.kind && row.kind !== filter.kind) continue;
    if (filter.prefix && prefix !== filter.prefix) continue;
    if (search && !row.label.toLowerCase().includes(search)) continue;
    const group = groupOf(groups, row);
    if (filter.group && group !== filter.group) continue;
    plus(selected, row);
    bump(byDay, row);
    plus(byGroup.get(group)!, row);
    if (prefix) plus(byPrefix.get(prefix) ?? (byPrefix.set(prefix, { key: prefix, name: `${prefix}-`, description: "", ...zero() }), byPrefix.get(prefix)!), row);
    const entry = byDiscount.get(row.key) ?? { key: row.key, label: row.label, kind: row.kind, ...zero() };
    plus(entry, row);
    byDiscount.set(row.key, entry);
  }
  const byOrders = (a: Totals, b: Totals) => b.orders - a.orders || b.valueCents - a.valueCents;
  const discounts = [...byDiscount.values()].sort(byOrders);
  return {
    all,
    selected: narrowed ? selected : discounted,
    exact: !narrowed,
    discountedShare: all.orders ? discounted.orders / all.orders : 0,
    groups: [...byGroup.values()].filter(line => line.orders > 0 || line.key !== otherKey),
    prefixes: [...byPrefix.values()].sort(byOrders),
    days: [...(narrowed ? byDay : discountedByDay).values()].sort((a, b) => a.day.localeCompare(b.day)),
    discounts: discounts.slice(0, limit),
    discountCount: discounts.length,
    prefixChoices: [...prefixes].sort(),
    manual: { totals: manualTotals, days: [...manualByDay.values()].sort((a, b) => a.day.localeCompare(b.day)), reasons: [...byReason.values()].sort((a, b) => b.orders - a.orders || b.discountCents - a.discountCents), share: all.orders ? manualTotals.orders / all.orders : 0 },
  };
}

/** Averages for a set of totals; null where there is nothing to divide by. */
export function averages(totals: Totals) {
  const gross = totals.valueCents + totals.discountCents;
  return {
    orderValueCents: totals.orders ? Math.round(totals.valueCents / totals.orders) : null,
    discountPerOrderCents: totals.orders ? Math.round(totals.discountCents / totals.orders) : null,
    discountRate: gross > 0 ? totals.discountCents / gross : null,
    refundRate: totals.valueCents > 0 ? totals.refundCents / totals.valueCents : null,
  };
}

// ---- Series for charts ----

/** Every day from `from` to `to`, inclusive, as YYYY-MM-DD. */
export function datesBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let time = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); time <= end && days.length < 400; time += 86400000) days.push(new Date(time).toISOString().slice(0, 10));
  return days;
}

/** The totals for each day in the range, with a zero for a day nothing happened, so a chart has no gaps. */
export function dailySeries(days: Array<Totals & { day: string }>, from: string, to: string): Array<Totals & { day: string }> {
  const byDay = new Map(days.map(item => [item.day, item]));
  return datesBetween(from, to).map(day => byDay.get(day) ?? { day, ...zero() });
}

/** The same number of days straight before a range, or null when the orders held do not reach back that far. */
export function previousRange(range: { from: string; to: string }, now = Date.now()): { from: string; to: string } | null {
  const length = datesBetween(range.from, range.to).length;
  const to = new Date(Date.parse(`${range.from}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (length - 1) * 86400000).toISOString().slice(0, 10);
  return from < daysAgo(orderHistoryDays, now) ? null : { from, to };
}

// ---- Dates ----

export const orderHistoryDays = 60;
const dayOf = (date: Date) => date.toISOString().slice(0, 10);
export const today = (now = Date.now()) => dayOf(new Date(now));
export const daysAgo = (days: number, now = Date.now()) => dayOf(new Date(now - days * 86400000));
/** The last N days including today, as a range. "Last 30 days" is 30 days, today and the 29 before. */
export const lastDays = (days: number, now = Date.now()) => ({ from: daysAgo(days - 1, now), to: today(now) });
/** How many days a range covers, counting both ends. */
export const spanDays = (range: { from: string; to: string }) => datesBetween(range.from, range.to).length;
export const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

/** Reads the filters from the address. The period is the last 30 days unless it names valid days; it is kept inside the 60 days held. */
export function filterFromParams(params: URLSearchParams, now = Date.now()): OrderFilter {
  const earliest = daysAgo(orderHistoryDays, now);
  const latest = today(now);
  const preset = Number(params.get("days"));
  let from = lastDays(30, now).from;
  let to = latest;
  if ([7, 14, 30, 60].includes(preset)) from = lastDays(preset, now).from;
  else if (isDay(params.get("from")) && isDay(params.get("to"))) { from = params.get("from")!; to = params.get("to")!; }
  if (from < earliest) from = earliest;
  if (to > latest) to = latest;
  if (from > to) from = to;
  const kind = params.get("kind") ?? "";
  return { from, to, group: params.get("group") ?? "", prefix: (params.get("prefix") ?? "").toUpperCase(), kind: ["code", "automatic"].includes(kind) ? kind : "", search: (params.get("q") ?? "").slice(0, 60) };
}
