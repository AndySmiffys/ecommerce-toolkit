import test from "node:test";
import assert from "node:assert/strict";
import { comparePrices, currentPriceEntries, ensurePricesCurrent, forgetPriceChecks, priceCheckEvery, publishedPriceEntries, type CurrentPrice } from "../app/modules/promotions/services/priceReport.server";
import type { PriceEntry } from "../app/modules/promotions/design/priceRule";
import type { ShopifyDiscountNode } from "../app/modules/promotions/types/discount";

const entry = (id: number, changes: Partial<PriceEntry> = {}): PriceEntry => ({ id: `gid://shopify/DiscountNode/${id}`, starts: 100, ends: 0, all: true, products: [], collections: [], variants: [], c: "", price: { t: "p", v: 1000 }, k: "P", cp: false, co: false, ...changes });
const current = (id: number, title: string, changes: Partial<PriceEntry> = {}): CurrentPrice => ({ key: String(id), routeId: String(id), title, entry: entry(id, changes) });
/** As published: the entry with its id turned into the key. */
const published = (id: number, changes: Record<string, unknown> = {}) => { const { id: _id, products, collections, variants, ...rest } = entry(id); void _id; void products; void collections; void variants; return { key: String(id), ...rest, ...changes }; };

test("a discount the storefront has right is said to match, in words", () => {
  const rows = comparePrices([current(1, "Black Friday", { c: "EXTRA10" }), current(2, "Auto", { price: { t: "a", v: 500, u: "GBP" } })], [published(1, { c: "EXTRA10" }), published(2, { price: { t: "a", v: 500, u: "GBP" } })]);
  assert.deepEqual(rows.map(row => [row.title, row.kind, row.now, row.published, row.state]), [
    ["Black Friday", "EXTRA10", "10% off", "10% off", "matches"],
    ["Auto", "Automatic", "£5.00 off each item", "£5.00 off each item", "matches"],
  ]);
});

test("a discount that was changed in Shopify shows the value now and the value the storefront still has", () => {
  const rows = comparePrices([current(1, "Auto", { price: { t: "p", v: 1000 } })], [published(1, { price: { t: "p", v: 2000 } })]);
  assert.deepEqual(rows.map(row => [row.now, row.published, row.state]), [["10% off", "20% off", "outdated"]], "the 20% the shop sees on the page, against the 10% Shopify holds");
  for (const changes of [{ c: "NEW" }, { k: "O" }, { cp: true }, { co: true }, { all: false }, { starts: 5 }, { ends: 9 }]) {
    assert.equal(comparePrices([current(1, "x")], [published(1, changes)])[0].state, "outdated", JSON.stringify(changes));
  }
});

test("a discount the storefront has nothing for is missing, and one it still has that no longer applies is stale", () => {
  const rows = comparePrices([current(1, "New")], [published(7, { c: "OLD" })]);
  assert.deepEqual(rows.map(row => [row.title, row.state, row.now, row.published]), [["New", "missing", "10% off", ""], ["Discount 7", "stale", "No longer applies", "10% off"]]);
  assert.equal(rows[1].kind, "OLD");
  assert.equal(rows[1].routeId, null);
  assert.deepEqual(comparePrices([current(1, "New")], null).map(row => row.state), ["missing"], "nothing published at all, or by an older version");
  assert.deepEqual(comparePrices([], []), []);
});

test("a code promotion with no price is described as having none, and compared like any other", () => {
  const rows = comparePrices([current(1, "Needs a spend", { c: "SPEND", price: undefined })], [published(1, { c: "SPEND", price: undefined })]);
  assert.deepEqual(rows.map(row => [row.now, row.published, row.state]), [["No price to show", "No price to show", "matches"]]);
});

test("percentages are written without trailing zeros, including part percentages", () => {
  const now = (v: number) => comparePrices([current(1, "x", { price: { t: "p", v } })], null)[0].now;
  assert.deepEqual([1000, 1250, 333, 10000, 5].map(now), ["10% off", "12.5% off", "3.33% off", "100% off", "0.05% off"]);
});

test("the published entries are read from the snapshot, and only when it has the price list", async () => {
  const api = (value: unknown) => ({ graphql: async () => Response.json({ data: { currentAppInstallation: { metafield: value === null ? null : { value: JSON.stringify(value) } } } }) });
  assert.deepEqual(await publishedPriceEntries(api({ priceRules: 2, prices: [published(1)] })), [published(1)]);
  assert.equal(await publishedPriceEntries(api({ priceRules: 1, promotions: [] })), null, "an older snapshot");
  assert.equal(await publishedPriceEntries(api({ version: 3 })), null);
  assert.equal(await publishedPriceEntries(api(null)), null, "nothing published");
  const broken = { graphql: async () => Response.json({ data: { currentAppInstallation: { metafield: { value: "{not json" } } } }) };
  assert.equal(await publishedPriceEntries(broken), null);
  await assert.rejects(publishedPriceEntries({ graphql: async () => Response.json({ errors: [{ message: "Throttled" }] }) }), /Throttled/);
});

function discount(id: number, kind: "code" | "automatic", percentage: number): ShopifyDiscountNode {
  return {
    id: `gid://shopify/DiscountNode/${id}`, events: { nodes: [] },
    discount: {
      __typename: kind === "code" ? "DiscountCodeBasic" : "DiscountAutomaticBasic", title: `Discount ${id}`, status: "ACTIVE", startsAt: "2026-10-01T00:00:00Z", endsAt: null,
      discountClasses: ["PRODUCT"], ...(kind === "code" ? { codes: { nodes: [{ code: `CODE${id}` }] } } : {}), context: { __typename: "DiscountBuyerSelectionAll", all: "ALL" },
      combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
      customerGets: { value: { __typename: "DiscountPercentage", percentage }, items: { __typename: "AllDiscountItems", allItems: true } },
    },
  } as unknown as ShopifyDiscountNode;
}

test("what the storefront should have is worked out from Shopify now: enabled codes and every automatic discount, once each", async () => {
  const nodes = [discount(1, "code", 0.1), discount(2, "automatic", 0.2), discount(3, "code", 0.3)];
  const api = { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
    if (query.includes("PromotionAutomaticDiscounts")) return Response.json({ data: { automaticDiscountNodes: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [2].map(id => ({ id: `gid://shopify/DiscountAutomaticNode/${id}`, automaticDiscount: { status: "ACTIVE" } })) } } });
    if (query.includes("GetDiscount")) return Response.json({ data: { discountNode: nodes.find(item => item.id.split("/").pop() === String(options?.variables?.id).split("/").pop()) ?? null } });
    throw new Error(`unexpected query ${query.slice(0, 40)}`);
  } };
  const row = (id: number, enabled: boolean) => ({ id, shop: "s", shopifyDiscountId: `gid://shopify/DiscountNode/${id}`, priority: 5, included: true, websiteEnabled: enabled, showHeaderBanner: false, showProductPage: false, showCollectionPage: false, showProductBadge: false, showCountdown: false, headline: "", body: "", badgeText: "", countdownText: "", buttonText: "", buttonUrl: "", backgroundColour: "", textColour: "", badgeColour: "", designJson: "{}", lastSyncedAt: null, lastSyncError: null, createdAt: new Date(0), updatedAt: new Date(0) });
  const result = await currentPriceEntries(api, "s", async () => [row(1, true), row(2, true), row(3, false)]);
  assert.deepEqual(result.map(item => [item.key, item.title, item.entry.c, item.entry.price]), [
    ["1", "Discount 1", "CODE1", { t: "p", v: 1000 }],
    ["2", "Discount 2", "", { t: "p", v: 2000 }],
  ], "the enabled code, then the automatic discount once even though it is also enabled; the code that is not enabled is left out");
});

/** A pretend Shopify with one automatic discount and what the storefront has been given. */
function shopWith(publishedPrices: unknown, automaticPercent = 0.2) {
  const node = discount(2, "automatic", automaticPercent);
  return { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
    if (query.includes("PromotionAutomaticDiscounts")) return Response.json({ data: { automaticDiscountNodes: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "gid://shopify/DiscountAutomaticNode/2", automaticDiscount: { status: "ACTIVE" } }] } } });
    if (query.includes("GetDiscount")) return Response.json({ data: { discountNode: String(options?.variables?.id).endsWith("/2") ? node : null } });
    if (query.includes("PromotionPricesPublished")) return Response.json({ data: { currentAppInstallation: { metafield: { value: JSON.stringify(publishedPrices) } } } });
    throw new Error(`unexpected query ${query.slice(0, 40)}`);
  } };
}
const noRows = async () => [];

test("opening the app republishes the prices when the storefront no longer matches Shopify, and leaves them alone when it does", async () => {
  forgetPriceChecks();
  let syncs = 0;
  const sync = async () => { syncs++; };
  const right = { priceRules: 2, prices: [{ key: "2", starts: 1790812800, ends: 0, all: true, c: "", price: { t: "p", v: 2000 }, k: "P", cp: false, co: false }] };
  assert.equal(await ensurePricesCurrent(shopWith(right), "a.myshopify.com", { now: 1000, sync: sync as never, readSettings: noRows as never }), "current");
  assert.equal(syncs, 0, "nothing differs: nothing is written");
  forgetPriceChecks();
  const old = { ...right, prices: [{ ...right.prices[0], price: { t: "p", v: 1000 } }] };
  assert.equal(await ensurePricesCurrent(shopWith(old), "a.myshopify.com", { now: 1000, sync: sync as never, readSettings: noRows as never }), "updated");
  assert.equal(syncs, 1, "the storefront had an older percentage");
  forgetPriceChecks();
  assert.equal(await ensurePricesCurrent(shopWith({ priceRules: 1, promotions: [] }), "a.myshopify.com", { now: 1000, sync: sync as never, readSettings: noRows as never }), "updated", "published by an older version: nothing there for this discount");
  assert.equal(syncs, 2);
});

test("the check runs at most every ten minutes for each shop, and a failure is tried again next time", async () => {
  forgetPriceChecks();
  let syncs = 0;
  const options = (now: number) => ({ now, sync: (async () => { syncs++; }) as never, readSettings: noRows as never });
  const stale = shopWith({ priceRules: 2, prices: [] });
  assert.equal(await ensurePricesCurrent(stale, "a.myshopify.com", options(0)), "updated");
  assert.equal(await ensurePricesCurrent(stale, "a.myshopify.com", options(priceCheckEvery - 1)), "skipped", "just checked");
  assert.equal(await ensurePricesCurrent(stale, "b.myshopify.com", options(1)), "updated", "another shop is checked on its own");
  assert.equal(await ensurePricesCurrent(stale, "a.myshopify.com", options(priceCheckEvery)), "updated", "ten minutes later");
  assert.equal(syncs, 3);
  forgetPriceChecks();
  const failing = { graphql: async () => { throw new Error("Shopify is down"); } };
  await assert.rejects(ensurePricesCurrent(failing as never, "c.myshopify.com", options(0)), /Shopify is down/);
  assert.equal(await ensurePricesCurrent(stale, "c.myshopify.com", options(1)), "updated", "a failed check does not count: it is tried again at once");
});
