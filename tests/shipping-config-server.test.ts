import test from "node:test";
import assert from "node:assert/strict";
import { defaultDeliverySettings, defaultServiceSetting, defaultShippingConfig, type DeliveryServiceSetting } from "../app/modules/shipping/config";
import { loadShippingConfig, saveDeliveryServices, saveShippingConfig } from "../app/modules/shipping/config.server";

/** A pretend Shopify holding the app's metafields. */
function fakeShopify() {
  const stored = new Map<string, string>();
  const admin = { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
    if (query.includes("ShippingMetafieldOwner")) return Response.json({ data: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } } });
    if (query.includes("ShippingMetafieldWrite")) {
      for (const field of options!.variables!.metafields as Array<{ key: string; value: string }>) stored.set(field.key, field.value);
      return Response.json({ data: { metafieldsSet: { metafields: [{ id: "m" }], userErrors: [] } } });
    }
    if (query.includes("ShippingMetafieldRead")) {
      const key = /key: "(\w+)"/.exec(query)![1];
      return Response.json({ data: { currentAppInstallation: { metafield: stored.has(key) ? { value: stored.get(key) } : null } } });
    }
    throw new Error(`unexpected query: ${query.slice(0, 40)}`);
  } };
  return { admin, stored };
}
const dpd: DeliveryServiceSetting = { ...defaultServiceSetting("DPD Next Day"), guaranteed: true, cutoffTime: "16:00" };
const withServices = (services: DeliveryServiceSetting[], changes: Record<string, unknown> = {}) => ({ ...defaultShippingConfig, ...changes, delivery: { ...defaultDeliverySettings, ...(changes.delivery as object | undefined), services } });

test("the delivery services are saved on their own, into the latest saved settings, leaving everything else as it is", async () => {
  const { admin, stored } = fakeShopify();
  await saveShippingConfig(admin, { ...defaultShippingConfig, cutoffTime: "13:30", delivery: { ...defaultDeliverySettings, enabled: true } });
  const result = await saveDeliveryServices(admin, [dpd]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.services, [dpd]);
  const saved = JSON.parse(stored.get("config")!);
  assert.deepEqual(saved.delivery.services, [dpd]);
  assert.equal(saved.cutoffTime, "13:30", "the rest of the settings are untouched");
  assert.equal(saved.delivery.enabled, true);
  const loaded = await loadShippingConfig(admin);
  assert.deepEqual(loaded.config.delivery.services, [dpd]);
});

test("services that are not valid are refused with the reason, and nothing is saved", async () => {
  const { admin, stored } = fakeShopify();
  await saveShippingConfig(admin, defaultShippingConfig);
  const before = stored.get("config");
  const result = await saveDeliveryServices(admin, [{ ...dpd, cutoffTime: "25:00" }, { ...dpd, name: "Two", transitMin: 3, transitMax: 1 }]);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.errors.join(" ") : "", /cut-off time for "DPD Next Day"/);
  assert.match(!result.ok ? result.errors.join(" ") : "", /shortest delivery time for "Two"/);
  assert.equal(stored.get("config"), before, "unchanged");
});

test("saving Shipping countdown keeps the services saved on the Shipping page, whatever it last saw", async () => {
  const { admin, stored } = fakeShopify();
  await saveShippingConfig(admin, defaultShippingConfig);
  await saveDeliveryServices(admin, [dpd]);
  // The countdown page was opened before the services were saved, so it still holds none.
  const stale = withServices([], { cutoffTime: "14:15" });
  const result = await saveShippingConfig(admin, stale, { keepServices: true });
  assert.equal(result.ok, true);
  const saved = JSON.parse(stored.get("config")!);
  assert.equal(saved.cutoffTime, "14:15", "its own settings are saved");
  assert.deepEqual(saved.delivery.services, [dpd], "the services saved elsewhere are not overwritten");
  // Without keepServices, what is posted is what is saved.
  await saveShippingConfig(admin, withServices([]));
  assert.deepEqual(JSON.parse(stored.get("config")!).delivery.services, []);
});

test("keeping the services works for a first save, and for input with no delivery section", async () => {
  const { admin, stored } = fakeShopify();
  const first = await saveShippingConfig(admin, withServices([dpd]), { keepServices: true });
  assert.equal(first.ok, true);
  assert.deepEqual(JSON.parse(stored.get("config")!).delivery.services, [], "nothing was saved before, so there is nothing to keep");
  await saveDeliveryServices(admin, [dpd]);
  const withoutDelivery = Object.fromEntries(Object.entries(defaultShippingConfig).filter(([key]) => key !== "delivery"));
  const result = await saveShippingConfig(admin, withoutDelivery, { keepServices: true });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(stored.get("config")!).delivery.services, [dpd]);
  const bad = await saveShippingConfig(admin, "not an object", { keepServices: true });
  assert.equal(bad.ok, true, "nonsense is treated as the defaults, as everywhere else");
});

test("a failure to save is reported, not hidden", async () => {
  const admin = { graphql: async (query: string) => {
    if (query.includes("ShippingMetafieldOwner")) return Response.json({ data: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } } });
    if (query.includes("ShippingMetafieldRead")) return Response.json({ data: { currentAppInstallation: { metafield: null } } });
    return Response.json({ data: { metafieldsSet: { metafields: [], userErrors: [{ message: "Value is too large" }] } } });
  } };
  const result = await saveDeliveryServices(admin, [dpd]);
  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.errors, ["Value is too large"]);
});

test("the order the options are shown in is saved with the services, and kept when Shipping countdown saves", async () => {
  const { admin, stored } = fakeShopify();
  await saveShippingConfig(admin, defaultShippingConfig);
  const result = await saveDeliveryServices(admin, [dpd, { ...defaultServiceSetting("Amazon 2 Day") }], "manual");
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.sort, "manual");
  assert.deepEqual(JSON.parse(stored.get("config")!).delivery.services.map((service: { name: string }) => service.name), ["DPD Next Day", "Amazon 2 Day"], "the order is the order of the list");
  assert.equal(JSON.parse(stored.get("config")!).delivery.sort, "manual");
  // Shipping countdown was opened before the order was set, so it still thinks the order is soonest first.
  const stale = withServices([], { cutoffTime: "14:15", delivery: { ...defaultDeliverySettings, sort: "soonest" } });
  await saveShippingConfig(admin, stale, { keepServices: true });
  const saved = JSON.parse(stored.get("config")!);
  assert.equal(saved.delivery.sort, "manual", "the order set on the Shipping page is not undone");
  assert.deepEqual(saved.delivery.services.map((service: { name: string }) => service.name), ["DPD Next Day", "Amazon 2 Day"]);
  assert.equal(saved.cutoffTime, "14:15");
  // Saving the services without saying which order leaves the order as it is.
  await saveDeliveryServices(admin, [dpd]);
  assert.equal(JSON.parse(stored.get("config")!).delivery.sort, "manual");
  const back = await saveDeliveryServices(admin, [dpd], "soonest");
  assert.equal(back.ok && back.sort, "soonest");
  const bad = await saveDeliveryServices(admin, [dpd], "random");
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.errors.join(" ") : "", /Delivery options order is not one of the choices/);
});
