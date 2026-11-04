import test from "node:test";
import assert from "node:assert/strict";
import type { DeliveryProfile, DeliveryRate, DeliveryZone, RateCondition, ShippingSnapshot, Transit } from "../app/modules/shipping/delivery/deliveryModel";
import { cleanName, deliveryServicesTable, serviceCatalogue, serviceKey, servicesFor, zoneServices } from "../app/modules/shipping/delivery/deliveryServices";
import { freeDeliveryTable, primaryZone, regionsCovered, zoneForCountry } from "../app/modules/shipping/delivery/freeService";
import { reviewShipping } from "../app/modules/shipping/delivery/shippingReview";
import { parseZone, type RawRate, type RawZone } from "../app/modules/shipping/delivery/shippingReader.server";

const gbp = (amount: number) => ({ amount, currency: "GBP" });
const atLeast = (minor: number): RateCondition => ({ field: "TOTAL_PRICE", operator: "GREATER_THAN_OR_EQUAL_TO", money: gbp(minor) });
const atMost = (minor: number): RateCondition => ({ field: "TOTAL_PRICE", operator: "LESS_THAN_OR_EQUAL_TO", money: gbp(minor) });
let n = 0;
const rate = (name: string, price: number, conditions: RateCondition[] = [], transit?: Transit): DeliveryRate => ({ id: `r${++n}`, name, active: true, kind: "fixed", price: gbp(price), conditions, ...(transit ? { transit } : {}) });
const zone = (name: string, regions: string[] | undefined, rates: DeliveryRate[], extra: Partial<DeliveryZone> = {}): DeliveryZone => ({ id: `gid://shopify/DeliveryZone/${name}`, name, countries: ["GB"], restOfWorld: false, rates, ...(regions ? { regions: { GB: regions } } : {}), ...extra });
const profile = (zones: DeliveryZone[], extra: Partial<DeliveryProfile> = {}): DeliveryProfile => ({ id: "p", name: "General profile", isDefault: true, variantCount: 500, zones, ...extra });
const snapshot = (profiles: DeliveryProfile[]): ShippingSnapshot => ({ shopCurrency: "GBP", shipsTo: ["GB"], profiles, markets: null });
const one: Transit = { minDays: 1, maxDays: 1 };
const two: Transit = { minDays: 2, maxDays: 2 };

const AMAZON2 = "Amazon 2 Day (Order Before 2pm) Non Guaranteed";
const AMAZON1 = "Amazon Next Day (Order Before 2pm) Non Guaranteed";
const DPD = "DPD Next Working Day Delivery (Order Before 2pm for Delivery Mon - Fri by 6pm)";

// The live shipping setup, as the Shipping zones screen shows it: Domestic covers three regions of the UK and Northern Ireland has its own zone.
// Shopify needs a line for each price band, and a free threshold can only go on one option, so every service is two lines with one name.
const domestic = () => zone("Domestic", ["England", "Scotland", "Wales"], [
  rate(AMAZON2, 399, [], two), rate(AMAZON2, 0, [atLeast(3000)], two),
  rate(AMAZON1, 499, [atMost(2999)], one), rate(AMAZON1, 299, [atLeast(3000)], one),
  rate(DPD, 699, [atMost(2999)], one), rate(DPD, 499, [atLeast(3000)], one),
]);
const northernIreland = () => zone("Northern Ireland", ["Northern Ireland"], [
  rate("Amazon 4-5 Day (Order Before 2pm) Non Guaranteed", 399, [], { minDays: 4, maxDays: 5 }),
  rate("Amazon 4-5 Day (Order Before 2pm) Non Guaranteed", 0, [atLeast(3000)], { minDays: 4, maxDays: 5 }),
]);
const oversized = () => profile([zone("United Kingdom", undefined, [rate(DPD, 699, [atMost(2999)], one), rate(DPD, 0, [atLeast(3000)], one)])], { id: "p2", name: "Oversized Product", isDefault: false, variantCount: 1 });
const live = () => snapshot([profile([domestic(), northernIreland()]), oversized()]);

test("a country split into zones by region shows its biggest zone's services, and lines with one name are one service", () => {
  const table = deliveryServicesTable(live());
  assert.equal(table.countries.GB, "z0", "Domestic, not Northern Ireland, which comes later and used to replace it");
  assert.deepEqual(table.zones.z1.services.map(service => service.name), ["Amazon 4-5 Day (Order Before 2pm) Non Guaranteed"], "Northern Ireland's own services are still published");
  const services = servicesFor(table, "GB");
  assert.deepEqual(services.map(service => service.name), [AMAZON2, AMAZON1, DPD]);
  assert.deepEqual(services.map(service => service.tiers), [
    [{ from: 0, price: 399 }, { from: 3000, price: 0 }],
    [{ from: 0, price: 499 }, { from: 3000, price: 299 }],
    [{ from: 0, price: 699 }, { from: 3000, price: 499 }],
  ], "two lines, one service, with the price break");
  assert.deepEqual(services.map(service => service.transit), [two, one, one]);
});

test("the order the zones are listed in does not decide which one a product page shows", () => {
  const reversed = deliveryServicesTable(snapshot([profile([northernIreland(), domestic()])]));
  assert.equal(reversed.countries.GB, "z1", "still Domestic");
  assert.equal(servicesFor(reversed, "GB").length, 3);
  const wholeCountry = deliveryServicesTable(snapshot([profile([northernIreland(), zone("Everywhere", undefined, [rate("Standard", 499, [], two)])])]));
  assert.deepEqual(servicesFor(wholeCountry, "GB").map(service => service.name), ["Standard"], "a zone covering the whole country beats one covering part of it");
});

test("the free-delivery table uses the same zone", () => {
  const free = freeDeliveryTable(snapshot([profile([domestic(), zone("Northern Ireland", ["Northern Ireland"], [rate("Standard", 899, [], two)])])]));
  assert.deepEqual(free.countries.GB, { free: true, thresholdMinor: 3000, rate: AMAZON2 }, "Domestic's free rate, not Northern Ireland's lack of one");
  const reversed = freeDeliveryTable(snapshot([profile([zone("Northern Ireland", ["Northern Ireland"], [rate("Standard", 899, [], two)]), domestic()])]));
  assert.equal(reversed.countries.GB.free, true);
});

test("how much of a country a zone covers decides, then the order listed", () => {
  const three = zone("Three", ["England", "Scotland", "Wales"], []);
  const oneRegion = zone("One", ["Northern Ireland"], []);
  const whole = zone("Whole", undefined, []);
  const other = zone("Other three", ["A", "B", "C"], []);
  assert.deepEqual([regionsCovered(three, "GB"), regionsCovered(oneRegion, "GB"), regionsCovered(whole, "GB"), regionsCovered(zone("Empty", [], []), "GB")], [3, 1, Infinity, Infinity]);
  assert.equal(primaryZone([oneRegion, three], "GB")?.name, "Three");
  assert.equal(primaryZone([three, whole, oneRegion], "GB")?.name, "Whole");
  assert.equal(primaryZone([three, other], "GB")?.name, "Three", "equal: the first listed");
  assert.equal(primaryZone([], "GB"), null);
  assert.equal(zoneForCountry(profile([oneRegion, three]), "GB")?.name, "Three");
  const world = zone("World", undefined, [], { countries: [], restOfWorld: true });
  assert.equal(zoneForCountry(profile([oneRegion, world]), "US")?.name, "World", "other countries still use rest of world");
  assert.equal(zoneForCountry(profile([oneRegion, world]), "GB")?.name, "One");
});

test("lines of one service are joined however the name was typed", () => {
  assert.equal(cleanName("  Standard   Delivery "), "Standard Delivery");
  assert.equal(serviceKey("Standard  Delivery"), serviceKey(" standard delivery "));
  assert.notEqual(serviceKey("Standard Delivery"), serviceKey("Standard Delivery 2"));
  const services = zoneServices(zone("Zone", undefined, [
    rate("Next Day  Delivery", 499, [atMost(2999)], one),
    rate("next day delivery ", 299, [atLeast(3000)], one),
    rate(" Next Day Delivery", 0, [atLeast(10000)], one),
    rate("Next Day Express", 999, [], one),
  ]));
  assert.deepEqual(services.map(service => service.name), ["Next Day Delivery", "Next Day Express"], "the first spelling, tidied");
  assert.deepEqual(services[0].tiers, [{ from: 0, price: 499 }, { from: 3000, price: 299 }, { from: 10000, price: 0 }]);
  const table = deliveryServicesTable(snapshot([profile([zone("A", ["England"], [rate("standard", 399, [], two)]), zone("B", ["Wales"], [rate("Standard ", 499, [], two)])])]));
  assert.deepEqual(serviceCatalogue(table).map(item => [item.name, item.zones]), [["standard", ["A", "B"]]], "one service in the settings, whatever the zones call it");
});

test("regions come from Shopify's provinces, and a zone with none covers the whole country", () => {
  const raw = (countries: RawZone["zone"]["countries"]): RawZone => ({ zone: { id: "gid://shopify/DeliveryZone/1", name: "Domestic", countries }, methodDefinitions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
  const rates: RawRate[] = [];
  const partial = parseZone(raw([{ name: "United Kingdom", code: { countryCode: "GB", restOfWorld: false }, provinces: [{ name: "England", code: "ENG" }, { name: "Scotland", code: "SCT" }, { name: "Wales", code: "WLS" }] }]), rates);
  assert.deepEqual(partial.regions, { GB: ["England", "Scotland", "Wales"] });
  assert.deepEqual(partial.countries, ["GB"]);
  const whole = parseZone(raw([{ name: "Ireland", code: { countryCode: "IE", restOfWorld: false }, provinces: [] }, { name: "France", code: { countryCode: "FR", restOfWorld: false } }]), rates);
  assert.equal("regions" in whole, false);
  const mixed = parseZone(raw([{ name: "UK", code: { countryCode: "GB", restOfWorld: false }, provinces: [{ name: "England", code: "ENG" }] }, { name: "Ireland", code: { countryCode: "IE", restOfWorld: false }, provinces: [] }]), rates);
  assert.deepEqual(mixed.regions, { GB: ["England"] }, "only a country that lists regions is partial");
});

test("the review explains a country split by region when the zones offer different things, and not otherwise", () => {
  const findings = reviewShipping(live());
  const split = findings.find(finding => finding.id === "split-country:GB");
  assert.ok(split);
  assert.equal(split.severity, "info");
  assert.match(split.title, /United Kingdom is split into zones by region/);
  assert.match(split.detail, /Domestic \(England, Scotland, Wales\); Northern Ireland \(Northern Ireland\)/);
  assert.match(split.detail, /shows the options for Domestic, which covers the most/);
  assert.match(split.detail, /at checkout they are offered the right ones/);
  const same = reviewShipping(snapshot([profile([zone("England", ["England"], [rate("Standard", 499, [], two)]), zone("Wales", ["Wales"], [rate("standard", 499, [], two)])])]));
  assert.equal(same.some(finding => finding.id.startsWith("split-country")), false, "the same options everywhere: nothing to explain");
  assert.equal(reviewShipping(snapshot([profile([domestic()])])).some(finding => finding.id.startsWith("split-country")), false, "one zone");
  const different = reviewShipping(snapshot([profile([zone("England", ["England"], [rate("Standard", 499, [], two)]), zone("Wales", ["Wales"], [rate("Standard", 499, [], { minDays: 3, maxDays: 4 })])])]));
  assert.equal(different.some(finding => finding.id === "split-country:GB"), true, "a different delivery time is a difference");
  const free = reviewShipping(snapshot([profile([zone("England", ["England"], [rate("Standard", 499, [atMost(2999)], two), rate("Standard", 0, [atLeast(3000)], two)]), zone("Wales", ["Wales"], [rate("Standard", 499, [atMost(4999)], two), rate("Standard", 0, [atLeast(5000)], two)])])]));
  assert.equal(free.some(finding => finding.id === "split-country:GB"), true, "and so is a different price band");
});
