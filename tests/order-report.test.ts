import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AreaChart, BarList, Donut, niceMax, Sparkline } from "../app/modules/promotions/components/charts/Charts";
import assert from "node:assert/strict";
import { withDatabase } from "./helpers/database";
import { aggregateOrderLines, averages, buildOrderReport, dailySeries, datesBetween, emptyFilter, filterFromParams, previousRange, spanDays, type DayRow } from "../app/modules/promotions/design/orderReport";
import type { GroupDef } from "../app/modules/promotions/design/reports";
import { decimal, toCsv } from "../app/modules/promotions/design/csv";
import { driveOrderSync, exportOrderTable, firstDayToRead, linesOf, loadManualOrders, loadOrderReport, loadUngrouped, orderSyncIsDue, stepOrderSync, storeOrderDays } from "../app/modules/promotions/services/orderReport.server";

const shop = "orders-test.myshopify.com";
const money = (amount: string, currencyCode = "GBP") => ({ shopMoney: { amount, currencyCode } });
const order = (id: number, createdAt: string, total: string, current: string, discounts: string, extra: Record<string, unknown> = {}) => JSON.stringify({ id: `gid://shopify/Order/${id}`, createdAt, cancelledAt: null, totalPriceSet: money(total), currentTotalPriceSet: money(current), totalDiscountsSet: money(discounts), ...extra });
const application = (id: number, index: number, type: string, field: string, value: string) => JSON.stringify({ __parentId: `gid://shopify/Order/${id}`, __typename: type, index, [field]: value });
const line = (id: number, lineId: number, allocations: Array<[number, string]>) => JSON.stringify({ __parentId: `gid://shopify/Order/${id}`, id: `gid://shopify/LineItem/${lineId}`, discountAllocations: allocations.map(([index, amount]) => ({ allocatedAmountSet: money(amount), discountApplication: { index } })) });

const file = [
  order(1, "2026-10-10T09:00:00Z", "50.00", "50.00", "10.00"),
  application(1, 0, "DiscountCodeApplication", "code", "welcome-1A2B3C4D-9XY8ZQ"),
  line(1, 11, [[0, "6.00"]]), line(1, 12, [[0, "4.00"]]),
  order(2, "2026-10-10T12:00:00Z", "30.00", "25.00", "6.00"),
  application(2, 0, "DiscountCodeApplication", "code", "CART10-ABCD1234-QWERTY"),
  application(2, 1, "AutomaticDiscountApplication", "title", "Spring sale"),
  line(2, 21, [[0, "4.00"], [1, "1.00"]]),
  JSON.stringify({ __parentId: "gid://shopify/Order/2", id: "gid://shopify/ShippingLine/1", discountAllocations: [{ allocatedAmountSet: money("1.00"), discountApplication: { index: 1 } }] }),
  order(3, "2026-10-11T08:00:00Z", "20.00", "20.00", "0.00"),
  order(4, "2026-10-11T09:00:00Z", "99.00", "99.00", "9.00", { cancelledAt: "2026-10-11T10:00:00Z" }),
  application(4, 0, "DiscountCodeApplication", "code", "CANCELLED-AAAA1111-BBBB22"),
  order(5, "2026-10-11T10:00:00Z", "40.00", "40.00", "8.00"),
  application(5, 0, "DiscountCodeApplication", "code", "WELCOME-1A2B3C4D-9XY8ZQ"),
  application(5, 1, "ManualDiscountApplication", "title", "Staff discount"),
  line(5, 51, [[0, "5.00"], [1, "3.00"]]),
];

const signup: GroupDef = { id: 1, name: "Signup", rules: [{ matchOn: "code", matchType: "starts_with", pattern: "WELCOME-" }] };
const find = (rows: DayRow[], day: string, key: string) => rows.find(row => row.day === day && row.key === key);

test("an order export is totalled per day and discount: orders, value, refunds and what each discount took off", async () => {
  const { rows, currency, orders } = await aggregateOrderLines(file);
  assert.equal(orders, 4, "the cancelled order is left out");
  assert.equal(currency, "GBP");
  assert.deepEqual(find(rows, "2026-10-10", "*all"), { day: "2026-10-10", key: "*all", kind: "all", label: "All orders", orders: 2, valueCents: 8000, refundCents: 500, discountCents: 1600 });
  assert.equal(find(rows, "2026-10-11", "*all")!.orders, 2);
  assert.equal(find(rows, "2026-10-11", "*discounted")!.orders, 1, "the order with no discount is not discounted");
  const welcome = find(rows, "2026-10-10", "c:WELCOME-1A2B3C4D-9XY8ZQ")!;
  assert.deepEqual([welcome.orders, welcome.valueCents, welcome.discountCents, welcome.label], [1, 5000, 1000, "welcome-1A2B3C4D-9XY8ZQ"], "the discount's own share is what it took off the lines");
  const cart = find(rows, "2026-10-10", "c:CART10-ABCD1234-QWERTY")!;
  const spring = find(rows, "2026-10-10", "a:Spring sale")!;
  assert.equal(cart.discountCents, 400);
  assert.equal(spring.discountCents, 200, "its share on the lines and on shipping");
  assert.equal(cart.refundCents, 500);
  assert.equal(cart.orders + spring.orders, 2, "an order with two discounts counts under each");
  assert.equal(find(rows, "2026-10-10", "*discounted")!.orders, 2, "but once in the discounted total");
  assert.equal(find(rows, "2026-10-11", "m:Staff discount")!.kind, "manual");
  assert.equal(rows.some(row => row.label.includes("CANCELLED")), false);
});

test("the report filters by period, group, prefix, type and search, and totals what is left", async () => {
  const { rows } = await aggregateOrderLines(file);
  const base = emptyFilter("2026-10-10", "2026-10-11");
  const everything = buildOrderReport(rows, [signup], base);
  assert.equal(everything.all.orders, 4);
  assert.equal(everything.selected.orders, 3, "unfiltered, the orders that used a discount, each once");
  assert.equal(everything.exact, true);
  assert.equal(Math.round(everything.discountedShare * 100), 75);
  assert.deepEqual(everything.days.map(day => [day.day, day.orders]), [["2026-10-10", 2], ["2026-10-11", 1]]);
  assert.deepEqual(everything.prefixChoices, ["CART10", "WELCOME"]);
  const names = Object.fromEntries(everything.groups.map(item => [item.name, item.orders]));
  assert.deepEqual(names, { Signup: 2, "Other discounts": 2 }, "WELCOME x2; CART10 and Spring sale are others, and the manual Staff discount is kept out of promotions");
  const prefix = buildOrderReport(rows, [signup], { ...base, prefix: "WELCOME" });
  assert.equal(prefix.selected.orders, 2);
  assert.equal(prefix.exact, false);
  assert.equal(prefix.discounts[0].orders, 2, "the same code on two days is one line");
  assert.equal(buildOrderReport(rows, [signup], { ...base, group: "group-1" }).selected.discountCents, 1500);
  assert.equal(buildOrderReport(rows, [signup], { ...base, kind: "automatic" }).discounts[0].label, "Spring sale");
  assert.equal(buildOrderReport(rows, [signup], { ...base, search: "spring" }).discountCount, 1);
  assert.equal(buildOrderReport(rows, [signup], { ...base, from: "2026-10-11" }).all.orders, 2, "a shorter period");
  assert.equal(buildOrderReport(rows, [signup], base, 1).discounts.length, 1, "the list is capped but the count is not");
  assert.equal(buildOrderReport(rows, [signup], base, 1).discountCount, 3);
});

test("averages are worked out from the totals and are empty when there is nothing to divide", () => {
  assert.deepEqual(averages({ orders: 2, valueCents: 9000, refundCents: 900, discountCents: 1000 }), { orderValueCents: 4500, discountPerOrderCents: 500, discountRate: 0.1, refundRate: 0.1 });
  assert.deepEqual(averages({ orders: 0, valueCents: 0, refundCents: 0, discountCents: 0 }), { orderValueCents: null, discountPerOrderCents: null, discountRate: null, refundRate: null });
});

test("filters come from the address and stay inside the 60 days that are held", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  assert.deepEqual(filterFromParams(new URLSearchParams(""), now), emptyFilter("2026-09-21", "2026-10-20"), "the last 30 days by default: 30 days, today included");
  assert.equal(filterFromParams(new URLSearchParams("days=7"), now).from, "2026-10-14");
  for (const days of [7, 14, 30, 60]) assert.equal(spanDays(filterFromParams(new URLSearchParams(`days=${days}`), now)), days, `${days} days is exactly ${days} days, so the page can show the choice that was made`);
  for (const [days, comparable] of [[7, true], [14, true], [30, true], [60, false]] as const) assert.equal(previousRange(filterFromParams(new URLSearchParams(`days=${days}`), now), now) !== null, comparable, `${days} days compared with the period before`);
  assert.equal(filterFromParams(new URLSearchParams("from=2026-01-01&to=2026-12-31"), now).from, "2026-08-21", "no earlier than 60 days");
  assert.equal(filterFromParams(new URLSearchParams("from=2026-01-01&to=2026-12-31"), now).to, "2026-10-20", "and not in the future");
  assert.equal(filterFromParams(new URLSearchParams("from=nonsense&to=2026-10-01"), now).from, "2026-09-21");
  const chosen = filterFromParams(new URLSearchParams("group=other&prefix=welcome&kind=code&q=abc"), now);
  assert.deepEqual([chosen.group, chosen.prefix, chosen.kind, chosen.search], ["other", "WELCOME", "code", "abc"]);
  assert.equal(filterFromParams(new URLSearchParams("kind=evil"), now).kind, "");
});

test("a file is read line by line however it is cut up", async () => {
  const text = "one\ntwo\nthree";
  const stream = new ReadableStream({ start(controller) { for (const part of ["on", "e\ntw", "o\nth", "ree"]) controller.enqueue(new TextEncoder().encode(part)); controller.close(); } });
  const lines = [];
  for await (const item of linesOf(new Response(stream))) lines.push(item);
  assert.deepEqual(lines, text.split("\n"));
});

// A stand-in for Shopify: starts one export, reports a status, and serves the file.
function fakeShopify(statuses: string[], url: string | null = "https://files.example/orders.jsonl") {
  const started: string[] = [];
  let checks = 0;
  const admin = { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
    if (query.includes("bulkOperationRunQuery")) { started.push(String(options!.variables!.query)); return Response.json({ data: { bulkOperationRunQuery: { bulkOperation: { id: "gid://shopify/BulkOperation/1", status: "CREATED" }, userErrors: [] } } }); }
    const status = statuses[Math.min(checks++, statuses.length - 1)];
    return Response.json({ data: { node: { id: "gid://shopify/BulkOperation/1", status, errorCode: status === "FAILED" ? "ACCESS_DENIED" : null, url: status === "COMPLETED" ? url : null } } });
  } };
  return { admin, started };
}
const download = async () => new Response(file.join("\n"));

test("reading orders starts one export, waits for Shopify, then stores the totals and replaces them on the next read", async () => withDatabase(async database => {
  const t0 = Date.parse("2026-10-12T08:00:00Z");
  assert.equal(await orderSyncIsDue(shop, 23, database, t0), true);
  const shopify = fakeShopify(["RUNNING", "COMPLETED"]);
  assert.equal(await stepOrderSync(shopify.admin, shop, database, t0, download), "running", "started");
  assert.match(shopify.started[0], /created_at:>=2026-08-13 test:false/, "the first read goes back the whole 60 days");
  assert.doesNotMatch(shopify.started[0], /customer|email|address/i, "no customer details are asked for");
  assert.equal(await orderSyncIsDue(shop, 23, database, t0 + 3600000), false, "not due while one is running");
  assert.equal(await stepOrderSync(shopify.admin, shop, database, t0, download), "running", "Shopify is still preparing it");
  assert.equal(await stepOrderSync(shopify.admin, shop, database, t0 + 60000, download), "idle", "done: the file is totalled");
  const loaded = await loadOrderReport(shop, emptyFilter("2026-10-10", "2026-10-11"), database);
  assert.equal(loaded.report.selected.orders, 3);
  assert.equal(loaded.syncing, false);
  assert.equal(loaded.error, null);
  assert.equal(loaded.currency, "GBP");
  assert.equal(await orderSyncIsDue(shop, 23, database, t0 + 3600000), false, "read recently");
  assert.equal(await orderSyncIsDue(shop, 23, database, t0 + 25 * 3600000), true, "a day later");
  // The next read starts two days before the day the last one finished, and what it returns replaces those days.
  assert.equal(firstDayToRead("2026-10-12", t0), "2026-10-10");
  const second = fakeShopify(["COMPLETED"]);
  await stepOrderSync(second.admin, shop, database, t0 + 25 * 3600000, download);
  assert.match(second.started[0], /created_at:>=2026-10-10 /, "two days before the day the last read finished");
  const smaller = async () => new Response([order(9, "2026-10-12T09:00:00Z", "10.00", "10.00", "0.00")].join("\n"));
  await stepOrderSync(second.admin, shop, database, t0 + 25 * 3600000, smaller);
  const after = await loadOrderReport(shop, emptyFilter("2026-10-10", "2026-10-13"), database);
  assert.equal(after.report.all.orders, 1, "the days it covered were replaced by what Shopify now says, not added to");
}));

test("a failed or empty export is recorded for the page to show, and does not stop the next try", async () => withDatabase(async database => {
  const t0 = Date.parse("2026-10-12T08:00:00Z");
  const failing = fakeShopify(["FAILED"]);
  await stepOrderSync(failing.admin, shop, database, t0, download);
  assert.equal(await stepOrderSync(failing.admin, shop, database, t0, download), "idle");
  const loaded = await loadOrderReport(shop, emptyFilter("2026-10-10", "2026-10-11"), database);
  assert.match(loaded.error ?? "", /ACCESS_DENIED/);
  assert.equal(loaded.syncing, false);
  // An export with no orders has no file at all.
  const empty = fakeShopify(["COMPLETED"], null);
  await stepOrderSync(empty.admin, shop, database, t0 + 1000, download);
  await stepOrderSync(empty.admin, shop, database, t0 + 2000, download);
  assert.equal((await loadOrderReport(shop, emptyFilter("2026-10-10", "2026-10-11"), database)).error, null);
  // Without the permission Shopify answers with an error, which is kept as the message.
  const denied = { graphql: async () => Response.json({ errors: [{ message: "Access denied for bulkOperationRunQuery field." }] }) };
  await driveOrderSync(async () => denied, "denied.myshopify.com", database, async () => {});
  assert.match((await loadOrderReport("denied.myshopify.com", emptyFilter("2026-10-10", "2026-10-11"), database)).error ?? "", /Access denied/);
}));

test("driving a read checks until Shopify is done, one at a time per shop", async () => withDatabase(async database => {
  const shopify = fakeShopify(["RUNNING", "RUNNING", "COMPLETED"]);
  let waits = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => download()) as typeof fetch;
  try {
    const first = driveOrderSync(async () => shopify.admin, shop, database, async () => { waits++; });
    await driveOrderSync(async () => shopify.admin, shop, database, async () => { waits += 100; });
    await first;
  } finally { globalThis.fetch = realFetch; }
  assert.equal(waits, 3, "a wait after starting and after each check while Shopify was still preparing it; the second caller did nothing");
  assert.equal((await loadOrderReport(shop, emptyFilter("2026-10-10", "2026-10-11"), database)).report.selected.orders, 3);
}));

test("charts get a value for every day and a comparison only when the orders held reach back that far", () => {
  assert.deepEqual(datesBetween("2026-10-09", "2026-10-12"), ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]);
  const series = dailySeries([{ day: "2026-10-10", orders: 2, valueCents: 500, refundCents: 0, discountCents: 50 }], "2026-10-09", "2026-10-11");
  assert.deepEqual(series.map(item => [item.day, item.orders]), [["2026-10-09", 0], ["2026-10-10", 2], ["2026-10-11", 0]], "a quiet day is a zero, not a gap");
  const now = Date.parse("2026-10-20T12:00:00Z");
  assert.deepEqual(previousRange({ from: "2026-10-14", to: "2026-10-20" }, now), { from: "2026-10-07", to: "2026-10-13" }, "the same number of days straight before");
  assert.deepEqual(previousRange({ from: "2026-09-21", to: "2026-10-20" }, now), { from: "2026-08-22", to: "2026-09-20" });
  assert.equal(previousRange({ from: "2026-08-22", to: "2026-10-20" }, now), null, "60 days has nothing before it that is held");
});

test("a table is downloaded as CSV with every row, escaped, and text that looks like a formula is made safe", () => {
  const csv = toCsv(["Name", "Orders"], [["Plain", 3], ["A, \"quoted\" name", 2], ["=HYPERLINK(\"x\")", 1], ["-5 off", 4], [null, 0]]);
  assert.equal(csv.charCodeAt(0), 0xfeff, "a byte-order mark so Excel reads it as UTF-8");
  assert.deepEqual(csv.slice(1).split("\r\n"), ["Name,Orders", "Plain,3", "\"A, \"\"quoted\"\" name\",2", "\"'=HYPERLINK(\"\"x\"\")\",1", "'-5 off,4", ",0", ""]);
  assert.equal(decimal(123456), "1234.56");
});

test("the overview compares with the period before, and downloads cover every discount, not only the ones shown", async () => withDatabase(async database => {
  const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
  for (const [index, day] of days.entries()) {
    await database.reportOrderDay.createMany({ data: [
      { shop, day, key: "*all", kind: "all", label: "All orders", orders: 10, valueCents: 10000, refundCents: 0, discountCents: 0 },
      { shop, day, key: "*discounted", kind: "all", label: "Orders with a discount", orders: index < 2 ? 2 : 4, valueCents: index < 2 ? 2000 : 4000, refundCents: 0, discountCents: index < 2 ? 200 : 400 },
      ...Array.from({ length: 3 }, (_, code) => ({ shop, day, key: `c:WELCOME-AAAA-BBBB${code}`, kind: "code", label: `WELCOME-AAAA-BBBB${code}`, orders: 1, valueCents: 1000, refundCents: 0, discountCents: 100 })),
    ] });
  }
  const now = Date.parse("2026-10-04T12:00:00Z");
  const loaded = await loadOrderReport(shop, emptyFilter("2026-10-03", "2026-10-04"), database, { compare: true, now });
  assert.equal(loaded.report.selected.orders, 8);
  assert.equal(loaded.previous?.selected.orders, 4, "the two days before");
  assert.deepEqual(loaded.previousRange, { from: "2026-10-01", to: "2026-10-02" });
  assert.equal((await loadOrderReport(shop, emptyFilter("2026-10-03", "2026-10-04"), database, { now })).previous, null, "no comparison unless asked for");
  const all = await exportOrderTable(shop, "discounts", emptyFilter("2026-10-01", "2026-10-04"), database);
  assert.equal(all.rows.length, 3, "one line per discount");
  assert.deepEqual(all.headers.slice(0, 3), ["Discount", "Type", "Orders"]);
  assert.equal(all.rows[0][2], 4, "its orders across the days");
  assert.equal((await exportOrderTable(shop, "days", emptyFilter("2026-10-01", "2026-10-04"), database)).rows.length, 4);
  assert.equal((await exportOrderTable(shop, "prefixes", emptyFilter("2026-10-01", "2026-10-04"), database)).rows[0][0], "WELCOME-");
}));

test("the charts draw for normal, single-day, empty and all-zero data without breaking", () => {
  const money = (value: number) => `£${value}`;
  const area = (values: number[], previous: number[] | null = null) => renderToStaticMarkup(createElement(AreaChart, { values, previous, labels: values.map((_, index) => `${index + 1} Oct`), format: money, label: "Orders" }));
  assert.match(area([1, 5, 3, 8]), /<path/);
  assert.match(area([4, 6, 2], [1, 2, 3]), /stroke-dasharray/, "the previous period is dotted behind");
  for (const odd of [[], [3], [0, 0, 0]]) assert.doesNotMatch(area(odd), /NaN|Infinity/, JSON.stringify(odd));
  assert.doesNotMatch(renderToStaticMarkup(createElement(Sparkline, { values: [0, 0], label: "x" })), /NaN/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(Sparkline, { values: [5], label: "x" })), /NaN/);
  const donut = renderToStaticMarkup(createElement(Donut, { slices: [{ label: "Signup", value: 300 }, { label: "Other", value: 100 }], centreLabel: "Given", centreValue: "£4", format: money, label: "x" }));
  assert.match(donut, /75%/);
  assert.match(donut, /25%/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(Donut, { slices: [], centreLabel: "Given", centreValue: "£0", format: money, label: "x" })), /NaN/);
  const bars = renderToStaticMarkup(createElement(BarList, { items: [{ label: "WELCOME-", value: 40, note: "£4 off" }, { label: "CART10-", value: 10 }], format: value => String(value), empty: "None" }));
  assert.match(bars, /WELCOME-/);
  assert.match(renderToStaticMarkup(createElement(BarList, { items: [], format: String, empty: "None here" })), /None here/);
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(130), 200);
  assert.equal(niceMax(2400), 5000);
});

test("discounts in no group are listed by revenue with a status wherever the app can match them", async () => withDatabase(async database => {
  const day = "2026-10-10";
  const row = (key: string, kind: string, label: string, orders: number, valueCents: number) => ({ shop, day, key, kind, label, orders, valueCents, refundCents: 0, discountCents: Math.round(valueCents / 10) });
  await database.reportGroup.create({ data: { shop, name: "Signup", rules: JSON.stringify(signup.rules), position: 0 } });
  await database.reportOrderDay.createMany({ data: [
    row("c:WELCOME-AAAA-BBBB", "code", "WELCOME-AAAA-BBBB", 5, 9000),
    row("c:LXZ-CNQ23GT", "code", "LXZ-CNQ23GT", 2, 3000),
    row("a:Spring sale", "automatic", "Spring sale", 4, 8000),
    row("c:MYSTERY", "code", "mystery", 1, 500),
    row("m:Staff discount", "manual", "Staff discount", 1, 100),
  ] });
  const stamp = (offsetDays: number) => new Date(Date.parse("2026-10-20T12:00:00Z") + offsetDays * 86400000);
  const index = (id: number, kind: string, title: string, code: string, startsAt: Date | null, endsAt: Date | null) => ({ shop, discountId: `gid://shopify/DiscountNode/${id}`, numericId: BigInt(id), kind, title, code, createdBy: "Loox", other: true, startsAt, endsAt });
  await database.discountIndex.createMany({ data: [
    index(1, "code", "Loox Referrals - LXZ-CNQ23GT", "LXZ-CNQ23GT", null, stamp(-30)),
    index(2, "automatic", "Spring sale", "", null, null),
    index(3, "code", "Later", "mystery".toUpperCase(), stamp(5), null),
  ] });
  const result = await loadUngrouped(shop, emptyFilter("2026-10-01", "2026-10-20"), database, stamp(0));
  assert.deepEqual(result.rows.map(item => [item.label, item.status]), [["Spring sale", "active"], ["LXZ-CNQ23GT", "expired"], ["mystery", "scheduled"]], "most revenue first; a code is matched whatever its case; a manual discount is not a promotion so it is not listed");
  assert.equal(result.count, 3);
  assert.equal(result.rows.some(item => item.label.startsWith("WELCOME")), false, "a discount a group catches is not listed");
  assert.equal(result.rows[0].valueCents, 8000);
}));

const manualFile = [
  order(1, "2026-10-12T09:00:00Z", "8.00", "8.00", "40.00", { name: "#1001" }),
  application(1, 0, "ManualDiscountApplication", "title", "Replacement: dispatch error"),
  line(1, 11, [[0, "40.00"]]),
  order(2, "2026-10-12T10:00:00Z", "30.00", "30.00", "8.00", { name: "#1002" }),
  application(2, 0, "DiscountCodeApplication", "code", "WELCOME-1A2B3C4D-9XY8ZQ"),
  application(2, 1, "ManualDiscountApplication", "title", "Goodwill"),
  line(2, 21, [[0, "5.00"], [1, "3.00"]]),
  order(3, "2026-10-12T11:00:00Z", "20.00", "20.00", "2.00", { name: "#1003" }),
  application(3, 0, "AutomaticDiscountApplication", "title", "Spring sale"),
  line(3, 31, [[0, "2.00"]]),
  order(4, "2026-10-12T12:00:00Z", "15.00", "15.00", "0.00", { name: "#1004" }),
];

test("manual discounts, such as replacement orders, are counted apart from promotions", async () => {
  const { rows, manualOrders } = await aggregateOrderLines(manualFile);
  const key = (name: string) => find(rows, "2026-10-12", name);
  assert.equal(key("*all")!.orders, 4);
  assert.deepEqual([key("*discounted")!.orders, key("*discounted")!.discountCents], [2, 700], "a replacement order is not a promotion order; one that also used a code counts, with only the code's and the automatic discount's share");
  assert.deepEqual([key("*manual")!.orders, key("*manual")!.discountCents], [2, 4300], "both orders with a manual discount, with what the manual discounts took off");
  assert.deepEqual(manualOrders.map(item => [item.name, item.reasons, item.valueCents, item.discountCents]), [["#1001", "Replacement: dispatch error", 800, 4000], ["#1002", "Goodwill", 3000, 300]]);

  const report = buildOrderReport(rows, [signup], emptyFilter("2026-10-12", "2026-10-12"));
  assert.equal(report.selected.orders, 2, "promotions only");
  assert.equal(report.selected.discountCents, 700);
  assert.equal(report.discountedShare, 0.5);
  assert.equal(report.discounts.some(item => item.kind === "manual"), false, "not among the discounts");
  assert.equal(report.groups.reduce((sum, line) => sum + line.orders, 0), 2, "not in any group, not even Other discounts");
  assert.equal(report.days.reduce((sum, item) => sum + item.orders, 0), 2);
  assert.deepEqual([report.manual.totals.orders, report.manual.totals.discountCents, report.manual.share], [2, 4300, 0.5]);
  assert.deepEqual(report.manual.reasons.map(item => [item.label, item.orders, item.discountCents]), [["Replacement: dispatch error", 1, 4000], ["Goodwill", 1, 300]], "by the reason typed, most orders first and then the most given away");
  assert.deepEqual(report.manual.days.map(item => [item.day, item.orders]), [["2026-10-12", 2]]);
  assert.equal(buildOrderReport(rows, [signup], emptyFilter("2026-10-01", "2026-10-11")).manual.totals.orders, 0, "outside the period");
});

test("manual orders are stored, replaced on a re-read, listed newest first and downloadable", async () => withDatabase(async database => {
  const { rows, manualOrders } = await aggregateOrderLines(manualFile);
  const t0 = Date.parse("2026-10-13T08:00:00Z");
  await storeOrderDays(shop, rows, "2026-10-01", database, t0, manualOrders);
  const filter = emptyFilter("2026-10-01", "2026-10-13");
  const listed = await loadManualOrders(shop, filter, database);
  assert.deepEqual(listed.orders.map(item => item.name), ["#1002", "#1001"], "newest first");
  assert.equal(listed.count, 2);
  assert.equal((await loadManualOrders(shop, emptyFilter("2026-10-13", "2026-10-13"), database)).count, 0, "only the period asked for");
  // Reading the same days again replaces them rather than adding to them.
  await storeOrderDays(shop, rows, "2026-10-12", database, t0, manualOrders);
  assert.equal((await loadManualOrders(shop, filter, database)).count, 2);
  await storeOrderDays(shop, [], "2026-10-12", database, t0, []);
  assert.equal((await loadManualOrders(shop, filter, database)).count, 0, "a discount removed in Shopify disappears");
  await storeOrderDays(shop, rows, "2026-10-01", database, t0, manualOrders);
  const reasons = await exportOrderTable(shop, "manual", filter, database);
  assert.deepEqual(reasons.headers.slice(0, 2), ["Reason", "Orders"]);
  assert.equal(reasons.rows.length, 2);
  const orders = await exportOrderTable(shop, "manual-orders", filter, database);
  assert.deepEqual(orders.headers, ["Order", "Date", "Reason", "Order total", "Discount given"]);
  assert.deepEqual(orders.rows.map(row => [row[0], row[3], row[4]]).sort(), [["#1001", "8.00", "40.00"], ["#1002", "30.00", "3.00"]]);
}));
