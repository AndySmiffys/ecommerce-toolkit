import test from "node:test";
import assert from "node:assert/strict";
import { withDatabase } from "./helpers/database";
import { aggregateOrderLines, averages, buildOrderReport, emptyFilter, filterFromParams, type DayRow } from "../app/modules/promotions/design/orderReport";
import type { GroupDef } from "../app/modules/promotions/design/reports";
import { driveOrderSync, firstDayToRead, linesOf, loadOrderReport, orderSyncIsDue, stepOrderSync } from "../app/modules/promotions/services/orderReport.server";

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

const signup = { id: 1, name: "Signup", matchOn: "code", matchType: "starts_with", pattern: "WELCOME-" } as GroupDef;
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
  assert.deepEqual(names, { Signup: 2, "Other discounts": 3 }, "WELCOME x2; CART10, Spring sale and Staff discount are others");
  const prefix = buildOrderReport(rows, [signup], { ...base, prefix: "WELCOME" });
  assert.equal(prefix.selected.orders, 2);
  assert.equal(prefix.exact, false);
  assert.equal(prefix.discounts[0].orders, 2, "the same code on two days is one line");
  assert.equal(buildOrderReport(rows, [signup], { ...base, group: "group-1" }).selected.discountCents, 1500);
  assert.equal(buildOrderReport(rows, [signup], { ...base, kind: "automatic" }).discounts[0].label, "Spring sale");
  assert.equal(buildOrderReport(rows, [signup], { ...base, search: "staff" }).discountCount, 1);
  assert.equal(buildOrderReport(rows, [signup], { ...base, from: "2026-10-11" }).all.orders, 2, "a shorter period");
  assert.equal(buildOrderReport(rows, [signup], base, 1).discounts.length, 1, "the list is capped but the count is not");
  assert.equal(buildOrderReport(rows, [signup], base, 1).discountCount, 4);
});

test("averages are worked out from the totals and are empty when there is nothing to divide", () => {
  assert.deepEqual(averages({ orders: 2, valueCents: 9000, refundCents: 900, discountCents: 1000 }), { orderValueCents: 4500, discountPerOrderCents: 500, discountRate: 0.1, refundRate: 0.1 });
  assert.deepEqual(averages({ orders: 0, valueCents: 0, refundCents: 0, discountCents: 0 }), { orderValueCents: null, discountPerOrderCents: null, discountRate: null, refundRate: null });
});

test("filters come from the address and stay inside the 60 days that are held", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  assert.deepEqual(filterFromParams(new URLSearchParams(""), now), emptyFilter("2026-09-20", "2026-10-20"), "the last 30 days by default");
  assert.equal(filterFromParams(new URLSearchParams("days=7"), now).from, "2026-10-13");
  assert.equal(filterFromParams(new URLSearchParams("from=2026-01-01&to=2026-12-31"), now).from, "2026-08-21", "no earlier than 60 days");
  assert.equal(filterFromParams(new URLSearchParams("from=2026-01-01&to=2026-12-31"), now).to, "2026-10-20", "and not in the future");
  assert.equal(filterFromParams(new URLSearchParams("from=nonsense&to=2026-10-01"), now).from, "2026-09-20");
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
