import test from "node:test";
import assert from "node:assert/strict";
import type { DeliveryProfile, DeliveryRate, DeliveryZone, RateCondition, ShippingSnapshot, Transit } from "../app/modules/shipping/delivery/deliveryModel";
import { deliveryServicesTable, serviceCatalogue, servicesFor, zoneServices } from "../app/modules/shipping/delivery/deliveryServices";

const gbp = (amount: number) => ({ amount, currency: "GBP" });
const atLeast = (minor: number): RateCondition => ({ field: "TOTAL_PRICE", operator: "GREATER_THAN_OR_EQUAL_TO", money: gbp(minor) });
const atMost = (minor: number): RateCondition => ({ field: "TOTAL_PRICE", operator: "LESS_THAN_OR_EQUAL_TO", money: gbp(minor) });
const heavy: RateCondition = { field: "TOTAL_WEIGHT", operator: "GREATER_THAN_OR_EQUAL_TO", weight: { unit: "KILOGRAMS", value: 10 } };
let n = 0;
const rate = (name: string, price: number | null, conditions: RateCondition[] = [], transit?: Transit, active = true): DeliveryRate => ({ id: `r${++n}`, name, active, kind: price === null ? "carrier" : "fixed", price: price === null ? null : gbp(price), conditions, ...(transit ? { transit } : {}) });
const zone = (name: string, countries: string[], rates: DeliveryRate[], restOfWorld = false): DeliveryZone => ({ id: `gid://shopify/DeliveryZone/${name}`, name, countries, restOfWorld, rates });
const profile = (zones: DeliveryZone[], extra: Partial<DeliveryProfile> = {}): DeliveryProfile => ({ id: "p", name: "General", isDefault: true, variantCount: 10, zones, ...extra });
const snapshot = (profiles: DeliveryProfile[]): ShippingSnapshot => ({ shopCurrency: "GBP", shipsTo: ["GB"], profiles, markets: null });
const one: Transit = { minDays: 1, maxDays: 1 };
const two: Transit = { minDays: 2, maxDays: 2 };

// The services as they appear in the Shipping zones screen: one option name, several price bands.
const domestic = () => zone("Domestic", ["GB"], [
  rate("Amazon 2 Day (Order Before 2pm) Non Guaranteed", 399, [], two),
  rate("Amazon 2 Day (Order Before 2pm) Non Guaranteed", 0, [atLeast(3000)], two),
  rate("Amazon Next Day (Order Before 2pm) Non Guaranteed", 499, [atMost(2999)], one),
  rate("Amazon Next Day (Order Before 2pm) Non Guaranteed", 299, [atLeast(3000)], one),
  rate("DPD Next Working Day Delivery", 699, [atMost(2999)], one),
  rate("DPD Next Working Day Delivery", 499, [atLeast(3000)], one),
]);

test("price bands of one option name are one service, with its delivery time", () => {
  const services = zoneServices(domestic());
  assert.deepEqual(services.map(service => service.name), ["Amazon 2 Day (Order Before 2pm) Non Guaranteed", "Amazon Next Day (Order Before 2pm) Non Guaranteed", "DPD Next Working Day Delivery"], "in the order Shopify lists them");
  assert.deepEqual(services[0], { name: "Amazon 2 Day (Order Before 2pm) Non Guaranteed", tiers: [{ from: 0, price: 399 }, { from: 3000, price: 0 }], transit: two });
  assert.deepEqual(services[1].tiers, [{ from: 0, price: 499 }, { from: 3000, price: 299 }]);
  assert.deepEqual(services[2].transit, one);
});

test("only options a shopper can choose are services, and what Shopify cannot say is left out", () => {
  const services = zoneServices(zone("Zone", ["GB"], [
    rate("Standard", 499, [], two),
    rate("Switched off", 999, [], one, false),
    rate("Courier", null),
    rate("No time", 599),
    rate("By weight", 899, [heavy], one),
  ]));
  assert.deepEqual(services.map(service => service.name), ["Standard", "No time", "By weight"], "a switched-off option and a carrier-calculated one are not offered");
  assert.equal(services[1].transit, undefined, "no delivery time, none claimed");
  assert.equal(services[1].complex, undefined);
  assert.equal(services[2].complex, true, "the price depends on weight, so only the lowest can be said");
  assert.equal("transit" in services[0], true);
});

test("price bands that disagree about the delivery time keep the widest span, and repeats are not listed twice", () => {
  const services = zoneServices(zone("Zone", ["GB"], [
    rate("Standard", 499, [atMost(2999)], { minDays: 2, maxDays: 3 }),
    rate("Standard", 299, [atLeast(3000)], { minDays: 3, maxDays: 5 }),
    rate("Standard", 299, [atLeast(3000)], { minDays: 3, maxDays: 5 }),
  ]));
  assert.deepEqual(services[0].transit, { minDays: 2, maxDays: 5 });
  assert.deepEqual(services[0].tiers, [{ from: 0, price: 499 }, { from: 3000, price: 299 }]);
});

test("the table is by zone, with each country pointing at its zone and rest of world at its own", () => {
  const table = deliveryServicesTable(snapshot([profile([
    domestic(),
    zone("Northern Ireland", ["GB-NIR", "XI"], [rate("Standard", 899, [], { minDays: 3, maxDays: 5 })]),
    zone("Ireland", ["IE"], []),
    zone("Rest of world", [], [rate("International", 1999, [], { minDays: 5, maxDays: 10 })], true),
  ])]));
  assert.equal(table.version, 1);
  assert.equal(table.currency, "GBP");
  assert.deepEqual(Object.keys(table.zones), ["z0", "z1", "z2", "z3"]);
  assert.equal(table.zones.z0.name, "Domestic");
  assert.deepEqual(table.countries, { GB: "z0", "GB-NIR": "z1", XI: "z1", IE: "z2" });
  assert.equal(table.restOfWorld, "z3");
  assert.deepEqual(servicesFor(table, "GB").map(service => service.tiers[0].price), [399, 499, 699]);
  assert.deepEqual(servicesFor(table, "XI").map(service => service.name), ["Standard"]);
  assert.deepEqual(servicesFor(table, "IE"), [], "a named zone with nothing to offer does not borrow rest of world's");
  assert.deepEqual(servicesFor(table, "US").map(service => service.name), ["International"], "a country in no zone uses rest of world");
  const noRest = deliveryServicesTable(snapshot([profile([domestic()])]));
  assert.deepEqual(servicesFor(noRest, "US"), [], "and gets nothing when there is no such zone");
  assert.deepEqual(deliveryServicesTable(snapshot([])), { version: 1, currency: "GBP", zones: {}, countries: {}, restOfWorld: null });
});

test("the table follows the general profile, not a custom one", () => {
  const general = profile([zone("Domestic", ["GB"], [rate("Standard", 499, [], two)])]);
  const custom = profile([zone("Domestic", ["GB"], [rate("Bulky", 1999, [], { minDays: 5, maxDays: 7 })])], { id: "p2", name: "Bulky", isDefault: false });
  const table = deliveryServicesTable(snapshot([custom, general]));
  assert.deepEqual(servicesFor(table, "GB").map(service => service.name), ["Standard"]);
});

test("the catalogue lists each service once, with every zone it is offered in", () => {
  const table = deliveryServicesTable(snapshot([profile([
    zone("Domestic", ["GB"], [rate("Standard", 499, [], two), rate("Next day", 699, [], one)]),
    zone("Northern Ireland", ["XI"], [rate("Standard", 899, [], { minDays: 3, maxDays: 4 })]),
  ])]));
  const catalogue = serviceCatalogue(table);
  assert.deepEqual(catalogue.map(item => [item.name, item.zones]), [["Standard", ["Domestic", "Northern Ireland"]], ["Next day", ["Domestic"]]]);
  assert.deepEqual(catalogue[0].service.transit, two, "shown as it is in the first zone it appears in");
  assert.deepEqual(serviceCatalogue({ version: 1, currency: "GBP", zones: {}, countries: {}, restOfWorld: null }), []);
});
