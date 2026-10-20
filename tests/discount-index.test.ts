import test from "node:test";
import assert from "node:assert/strict";
import { withDatabase } from "./helpers/database";
import { discountStatusAt, isOtherApp, sourceFromParam } from "../app/modules/promotions/design/discountSource";
import { buildIndex, creatorOf, creatorsOf, forgetDiscounts, indexIsDue, indexState, listFromIndex, madeByOtherApps, otherApps } from "../app/modules/promotions/services/discountIndex.server";
import { bulkDiscountAction } from "../app/modules/promotions/services/bulkPromotions.server";

const shop = "index-test.myshopify.com";
const none = { source: "" as const, app: "", status: "", text: "", after: null, before: null };

test("only a creator that is clearly another app counts as one", () => {
  for (const mine of ["Shopify Web", "Shopify Flow", "Shopify Email", "eCommerce Toolkit", "eCommerce Toolkit (Test)", "Smiffys Promotion Engine", "Unknown", "", null, undefined]) assert.equal(isOtherApp(mine), false, String(mine));
  for (const other of ["Dotdigital", "Klaviyo", "Smile: Loyalty"]) assert.equal(isOtherApp(other), true, other);
  assert.equal(sourceFromParam(null), "");
  assert.equal(sourceFromParam("other"), "other");
  assert.equal(sourceFromParam("all"), "all");
  assert.equal(sourceFromParam("junk"), "");
  const now = new Date("2026-10-20T12:00:00Z");
  assert.equal(discountStatusAt(null, null, now), "active");
  assert.equal(discountStatusAt(new Date("2026-11-01T00:00:00Z"), null, now), "scheduled");
  assert.equal(discountStatusAt(null, new Date("2026-10-01T00:00:00Z"), now), "expired");
});

test("who made a discount comes from the code when an app made it, else from the create event", () => {
  const code = (createdBy: { title: string | null } | null, events: string[] = []) => ({ id: "gid://shopify/DiscountCodeNode/1", events: { nodes: events.map(appTitle => ({ appTitle })) }, discount: { __typename: "DiscountCodeBasic", title: "x", codes: { nodes: [{ code: "C", createdBy }] } } });
  assert.equal(creatorOf(code({ title: "Dotdigital" })), "Dotdigital", "the code records the app, even when the event does not");
  assert.equal(creatorOf(code({ title: null })), "Another app", "an app with no name is still an app");
  assert.equal(creatorOf(code(null, ["Shopify Web"])), "Shopify Web", "made by hand: no app on the code");
  assert.equal(creatorOf(code(null)), "Unknown");
  assert.equal(creatorOf(code({ title: "Loox" }, ["Shopify Web"])), "Loox", "the code wins over the event");
  assert.equal(isOtherApp(creatorOf(code({ title: null }))), true);
});

const node = (id: number, type: string, title: string, code: string | null, createdBy: string | null, startsAt: string | null = null, endsAt: string | null = null) => ({
  id: `gid://shopify/DiscountCodeNode/${id}`,
  events: { nodes: createdBy ? [{ appTitle: createdBy }] : [] },
  discount: { __typename: type, title, startsAt, endsAt, ...(code ? { codes: { nodes: [{ code }] } } : {}) },
});

/** A stand-in for Shopify serving the nodes in pages of `size`, oldest first, and recording each request. */
function fakeShopify(nodes: ReturnType<typeof node>[], size = 100) {
  const requests: Array<{ after: string | null; query: string | null }> = [];
  const admin = { graphql: async (_query: string, options?: { variables?: Record<string, unknown> }) => {
    const variables = options?.variables ?? {};
    requests.push({ after: (variables.after as string | null) ?? null, query: (variables.query as string | null) ?? null });
    const start = variables.after ? Number(variables.after) : 0;
    const filtered = nodes;
    const page = filtered.slice(start, start + size);
    const next = start + size;
    return Response.json({ data: { discountNodes: { pageInfo: { hasNextPage: next < filtered.length, endCursor: String(next) }, nodes: page } } });
  } };
  return { admin, requests };
}

const catalogue = () => [
  node(1, "DiscountCodeBasic", "Halloween", "HALLOWEEN", "Shopify Web"),
  node(2, "DiscountAutomaticBasic", "Spring sale", null, "eCommerce Toolkit"),
  node(3, "DiscountCodeBasic", "WELCOME-COUPON || a", "WELCOME-1A2B3C4D-9XY8ZQ", "Dotdigital"),
  node(4, "DiscountCodeBasic", "WELCOME-COUPON || b", "WELCOME-5E6F7G8H-ABC123", "Dotdigital"),
  node(5, "DiscountCodeBasic", "CART10-COUPON || c", "CART10-ABCD1234-QWERTY", "Dotdigital", "2026-12-01T00:00:00Z"),
  node(6, "DiscountCodeBasic", "Old sale", "OLDSALE", "Shopify Web", null, "2026-01-01T00:00:00Z"),
  node(7, "DiscountCodeBasic", "No creator recorded", "MYSTERY", null),
];

test("the index is built page by page, keeps its place, and the list pages from it by source, status and search", async () => withDatabase(async database => {
  const t0 = Date.parse("2026-10-20T12:00:00Z");
  assert.equal(await indexIsDue(shop, 60, database, t0), true);
  const shopify = fakeShopify(catalogue(), 3);
  let calls = 0;
  const failOnce = { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => { if (++calls === 2) return Response.json({ errors: [{ message: "Boom" }] }); return shopify.admin.graphql(query, options); } };
  await buildIndex(async () => failOnce, shop, database, t0, async () => {});
  let state = await indexState(shop, database);
  assert.equal(state.ready, false, "the scan stopped partway");
  assert.match(state.error ?? "", /Boom/);
  await buildIndex(async () => shopify.admin, shop, database, t0 + 1000, async () => {});
  assert.equal(shopify.requests[shopify.requests.length - 2].after, "3", "it carried on from the page it had reached, not from the start");
  state = await indexState(shop, database);
  assert.equal(state.ready, true);
  assert.equal(state.count, 7);
  assert.equal(state.error, null);
  assert.equal(await indexIsDue(shop, 60, database, t0 + 30000), false);
  assert.equal(await indexIsDue(shop, 60, database, t0 + 120000), true);

  const now = new Date(t0);
  const mine = await listFromIndex(shop, none, database, now);
  assert.deepEqual(mine.ids.map(id => id.split("/").pop()), ["7", "6", "2", "1"], "newest first, without the other app's discounts; a discount with no recorded creator stays");
  assert.equal(mine.total, 4);
  const other = await listFromIndex(shop, { ...none, source: "other" }, database, now);
  assert.deepEqual(other.ids.map(id => id.split("/").pop()), ["5", "4", "3"]);
  assert.equal((await listFromIndex(shop, { ...none, source: "all" }, database, now)).total, 7);
  assert.deepEqual((await listFromIndex(shop, { ...none, source: "other", app: "Klaviyo" }, database, now)).ids, []);
  assert.deepEqual((await listFromIndex(shop, { ...none, source: "other", app: "Dotdigital", status: "scheduled" }, database, now)).ids.map(id => id.split("/").pop()), ["5"]);
  assert.deepEqual((await listFromIndex(shop, { ...none, status: "expired" }, database, now)).ids.map(id => id.split("/").pop()), ["6"]);
  assert.deepEqual((await listFromIndex(shop, { ...none, status: "active" }, database, now)).ids.map(id => id.split("/").pop()), ["7", "2", "1"]);
  assert.deepEqual((await listFromIndex(shop, { ...none, source: "all", text: "welcome-5e" }, database, now)).ids.map(id => id.split("/").pop()), ["4"], "search looks at the code and the title, ignoring case");
  assert.deepEqual((await listFromIndex(shop, { ...none, text: "spring" }, database, now)).ids.map(id => id.split("/").pop()), ["2"]);
  assert.deepEqual(await otherApps(shop, database), [{ name: "Dotdigital", count: 3 }]);
  assert.deepEqual(await creatorsOf(shop, ["gid://shopify/DiscountNode/3", "gid://shopify/DiscountCodeNode/1", "gid://shopify/DiscountNode/99"], database), { "gid://shopify/DiscountNode/3": "Dotdigital", "gid://shopify/DiscountNode/1": "Shopify Web" });
  assert.deepEqual(await madeByOtherApps(shop, ["gid://shopify/DiscountNode/3", "gid://shopify/DiscountNode/1"], database), { "gid://shopify/DiscountNode/3": "Dotdigital" });
  await forgetDiscounts(shop, ["gid://shopify/DiscountNode/3"], database);
  assert.equal((await listFromIndex(shop, { ...none, source: "other" }, database, now)).total, 2);
}));

test("paging walks the list newest first in both directions, and a later read only fetches what changed", async () => withDatabase(async database => {
  const t0 = Date.parse("2026-10-20T12:00:00Z");
  const many = Array.from({ length: 120 }, (_, index) => node(index + 1, "DiscountCodeBasic", `Promo ${index + 1}`, `P${index + 1}`, "Shopify Web"));
  await buildIndex(async () => fakeShopify(many).admin, shop, database, t0, async () => {});
  const now = new Date(t0);
  const first = await listFromIndex(shop, none, database, now);
  assert.equal(first.ids.length, 50);
  assert.deepEqual([first.pageInfo.hasNextPage, first.pageInfo.hasPreviousPage], [true, false]);
  assert.equal(first.ids[0].split("/").pop(), "120");
  const second = await listFromIndex(shop, { ...none, after: first.pageInfo.endCursor }, database, now);
  assert.equal(second.ids[0].split("/").pop(), "70", "the next page carries on where the last ended");
  assert.deepEqual([second.pageInfo.hasNextPage, second.pageInfo.hasPreviousPage], [true, true]);
  const third = await listFromIndex(shop, { ...none, after: second.pageInfo.endCursor }, database, now);
  assert.equal(third.ids.length, 20);
  assert.deepEqual([third.pageInfo.hasNextPage, third.pageInfo.hasPreviousPage], [false, true]);
  const back = await listFromIndex(shop, { ...none, before: third.pageInfo.startCursor }, database, now);
  assert.deepEqual(back.ids, second.ids, "going back returns the page just left, in the same order");
  assert.equal((await listFromIndex(shop, { ...none, after: "not a number" }, database, now)).ids[0].split("/").pop(), "120", "a cursor that is not ours starts again from the newest");
  // A later read asks only for what changed since the last one.
  const again = fakeShopify([node(121, "DiscountCodeBasic", "New one", "NEW", "Dotdigital")]);
  await buildIndex(async () => again.admin, shop, database, t0 + 3600000, async () => {});
  assert.match(again.requests[0].query ?? "", /^updated_at:>=2026-10-20T11:55:00\.000Z$/, "from a few minutes before the last read");
  assert.equal((await listFromIndex(shop, { ...none, source: "other" }, database, now)).total, 1);
  assert.equal((await listFromIndex(shop, none, database, now)).total, 120);
}));

test("a discount another app made is left alone by activate, deactivate and delete, and the rest still go through", async () => withDatabase(async database => {
  await buildIndex(async () => fakeShopify(catalogue()).admin, shop, database, Date.now(), async () => {});
  const calls: string[] = [];
  const admin = { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
    calls.push(String(options?.variables?.id ?? ""));
    if (query.includes("codeDiscountNode(") || query.includes("discountNode(")) return Response.json({ data: { codeDiscountNode: { id: String(options?.variables?.id) }, automaticDiscountNode: null } });
    return Response.json({ data: { discountCodeDeactivate: { codeDiscountNode: { id: "x" }, userErrors: [] }, discountAutomaticDeactivate: { automaticDiscountNode: { id: "x" }, userErrors: [] } } });
  } };
  const outcome = await bulkDiscountAction(admin, shop, "deactivate", ["gid://shopify/DiscountNode/3", "gid://shopify/DiscountNode/1"], database, async () => {});
  const refused = outcome.failed.find(item => item.id === "gid://shopify/DiscountNode/3");
  assert.match(refused?.message ?? "", /Dotdigital made this discount/);
  assert.equal(calls.some(id => id.endsWith("/3")), false, "Shopify was never asked to change it");
}));
