import test from "node:test";
import assert from "node:assert/strict";
import type { ShippingSnapshot } from "../app/modules/shipping/delivery/deliveryModel";
import { ensureFreeDelivery, loadPublishedFreeDelivery, loadPublishedServices, publishFreeDelivery, syncFreeDelivery } from "../app/modules/shipping/delivery/freeDeliverySync.server";

const gbp = (amount: number) => ({ amount, currency: "GBP" });
const snapshot = (threshold: number): ShippingSnapshot => ({
  shopCurrency: "GBP", shipsTo: ["GB"], markets: null,
  profiles: [{ id: "p", name: "General", isDefault: true, variantCount: 10, zones: [{ id: "z", name: "UK", countries: ["GB"], restOfWorld: false, rates: [
    { id: "r1", name: "Free delivery", active: true, kind: "fixed", price: gbp(0), conditions: [{ field: "TOTAL_PRICE", operator: "GREATER_THAN_OR_EQUAL_TO", money: gbp(threshold) }] },
  ] }] }],
});

/** A pretend Shopify holding app metafields, counting how often they are written. */
function fakeShopify() {
  const stored = new Map<string, string>();
  const state = { writes: 0, reads: 0 };
  const admin = { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
    if (query.includes("ShippingMetafieldOwner")) return Response.json({ data: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } } });
    if (query.includes("ShippingMetafieldWrite")) {
      state.writes++;
      for (const field of options!.variables!.metafields as Array<{ key: string; value: string }>) stored.set(field.key, field.value);
      return Response.json({ data: { metafieldsSet: { metafields: [{ id: "m" }], userErrors: [] } } });
    }
    if (query.includes("ShippingMetafieldRead")) {
      state.reads++;
      const key = /key: "(\w+)"/.exec(query)![1];
      return Response.json({ data: { currentAppInstallation: { metafield: stored.has(key) ? { value: stored.get(key) } : null } } });
    }
    throw new Error(`unexpected query: ${query.slice(0, 40)}`);
  } };
  return { admin, stored, state };
}

test("the free-delivery table is published, and published again only when it has changed", async () => {
  const { admin, stored, state } = fakeShopify();
  const first = await publishFreeDelivery(admin, snapshot(5000));
  assert.equal(first.changed, true);
  assert.deepEqual(JSON.parse(stored.get("delivery")!).countries.GB, { free: true, thresholdMinor: 5000, rate: "Free delivery" });
  assert.equal(state.writes, 2, "the free-delivery table and the delivery services");
  assert.deepEqual(JSON.parse(stored.get("delivery_services")!).zones.z0.services.map((service: { name: string }) => service.name), ["Free delivery"]);
  const again = await publishFreeDelivery(admin, snapshot(5000));
  assert.equal(again.changed, false, "nothing differs, so nothing is written");
  assert.equal(state.writes, 2);
  const changed = await publishFreeDelivery(admin, snapshot(7500));
  assert.equal(changed.changed, true);
  assert.equal(state.writes, 4, "the threshold is in both");
  assert.equal(JSON.parse(stored.get("delivery")!).countries.GB.thresholdMinor, 7500);
  assert.deepEqual(JSON.parse(stored.get("delivery_services")!).zones.z0.services[0].tiers, [{ from: 7500, price: 0 }]);
});

test("only the table that changed is written again", async () => {
  const { admin, state } = fakeShopify();
  await publishFreeDelivery(admin, snapshot(5000));
  const renamed = snapshot(5000);
  renamed.profiles[0].zones[0].name = "United Kingdom";
  const result = await publishFreeDelivery(admin, renamed);
  assert.equal(result.changed, true, "the zone's name is only in the services table");
  assert.equal(state.writes, 3, "so only that one was written");
});

test("what was published can be read back, and anything unreadable counts as nothing published", async () => {
  const { admin, stored } = fakeShopify();
  assert.equal(await loadPublishedFreeDelivery(admin), null);
  await publishFreeDelivery(admin, snapshot(5000));
  assert.equal((await loadPublishedFreeDelivery(admin))?.countries.GB.free, true);
  assert.equal((await loadPublishedServices(admin))?.countries.GB, "z0");
  assert.equal(await loadPublishedServices(fakeShopify().admin), null);
  stored.set("delivery_services", "not json");
  assert.equal(await loadPublishedServices(admin), null);
  stored.set("delivery", "not json");
  assert.equal(await loadPublishedFreeDelivery(admin), null);
  stored.set("delivery", JSON.stringify({ version: 2, countries: {} }));
  assert.equal(await loadPublishedFreeDelivery(admin), null, "a version this app does not know");
});

test("a shop that has never published gets its table made the first time the app is used, and not again", async () => {
  const shopify = fakeShopify();
  const calls: string[] = [];
  const admin = { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
    calls.push(query.match(/(?:query|mutation) (\w+)/)?.[1] ?? "?");
    if (query.includes("ShippingReviewProfiles")) return Response.json({ data: { shop: { currencyCode: "GBP", shipsToCountries: ["GB"] }, deliveryProfiles: { nodes: [{ id: "p", name: "General", default: true, productVariantsCount: { count: 5 }, profileLocationGroups: [{ locationGroup: { id: "g" } }] }], pageInfo: { hasNextPage: false, endCursor: null } } } });
    if (query.includes("ShippingReviewZone")) return Response.json({ data: { deliveryProfile: { profileLocationGroups: [{ locationGroupZones: { nodes: [{ zone: { id: "z", name: "UK", countries: [{ name: "United Kingdom", code: { countryCode: "GB", restOfWorld: false } }] }, methodDefinitions: { nodes: [{ id: "r", name: "Free", active: true, rateProvider: { __typename: "DeliveryRateDefinition", price: { amount: "0.0", currencyCode: "GBP" } }, methodConditions: [{ field: "TOTAL_PRICE", operator: "GREATER_THAN_OR_EQUAL_TO", conditionCriteria: { __typename: "MoneyV2", amount: "50.0", currencyCode: "GBP" } }] }], pageInfo: { hasNextPage: false, endCursor: null } } }], pageInfo: { hasNextPage: false, endCursor: null } } }] } } });
    if (query.includes("ShippingReviewMarkets")) return Response.json({ errors: [{ message: "Access denied for markets field." }] });
    return shopify.admin.graphql(query, options);
  } };
  await ensureFreeDelivery(admin);
  assert.deepEqual(JSON.parse(shopify.stored.get("delivery")!).countries.GB, { free: true, thresholdMinor: 5000, rate: "Free" });
  const before = calls.length;
  await ensureFreeDelivery(admin);
  assert.equal(calls.length, before + 2, "the second time it only looks, and finds both tables");
  assert.equal(shopify.state.writes, 2);
  shopify.stored.delete("delivery_services");
  await ensureFreeDelivery(admin);
  assert.ok(shopify.stored.has("delivery_services"), "a shop that had only the first table gets the second");
  const refreshed = await syncFreeDelivery(admin);
  assert.equal(refreshed.changed, false, "a refresh with no change in Shopify writes nothing");
});
