import test from "node:test";
import assert from "node:assert/strict";
import type { DeliveryProfile, DeliveryRate, DeliveryZone, Market, RateCondition, ShippingSnapshot } from "../app/modules/shipping/delivery/deliveryModel";
import { describeFree, freeDeliveryTable, freeOption, priceRange, zoneFree, zoneForCountry } from "../app/modules/shipping/delivery/freeService";
import { priceGaps, reviewShipping, summarise, usualThreshold, type Finding } from "../app/modules/shipping/delivery/shippingReview";
import { formatMinor } from "../app/modules/shipping/delivery/deliveryModel";
import { loadShippingSnapshot, parseMarket, parseRate, parseZone, ShippingAccessError, type RawMarket, type RawRate, type RawZone } from "../app/modules/shipping/delivery/shippingReader.server";

// ---- builders
const gbp = (amount: number) => ({ amount, currency: "GBP" });
const atLeast = (minor: number): RateCondition => ({ field: "TOTAL_PRICE", operator: "GREATER_THAN_OR_EQUAL_TO", money: gbp(minor) });
const atMost = (minor: number): RateCondition => ({ field: "TOTAL_PRICE", operator: "LESS_THAN_OR_EQUAL_TO", money: gbp(minor) });
const heavy: RateCondition = { field: "TOTAL_WEIGHT", operator: "GREATER_THAN_OR_EQUAL_TO", weight: { unit: "KILOGRAMS", value: 10 } };
let counter = 0;
const rate = (name: string, price: number | null, conditions: RateCondition[] = [], active = true): DeliveryRate => ({ id: `rate${++counter}`, name, active, kind: price === null ? "carrier" : "fixed", price: price === null ? null : gbp(price), conditions });
const standard = (max = 4999) => rate("Standard", 499, [atMost(max)]);
const free = (min = 5000, active = true) => rate("Free delivery", 0, [atLeast(min)], active);
const zone = (name: string, countries: string[], rates: DeliveryRate[], restOfWorld = false): DeliveryZone => ({ id: `zone-${name}`, name, countries, restOfWorld, rates });
const profile = (zones: DeliveryZone[], extra: Partial<DeliveryProfile> = {}): DeliveryProfile => ({ id: "profile-general", name: "General", isDefault: true, variantCount: 1000, zones, ...extra });
const market = (name: string, countries: string[], extra: Partial<Market> = {}): Market => ({ id: `market-${name}`, name, active: true, countries, truncated: false, ...extra });
const snapshot = (profiles: DeliveryProfile[], markets: Market[] | null = null): ShippingSnapshot => ({ shopCurrency: "GBP", shipsTo: ["GB", "IE", "FR"], profiles, markets });
const healthy = () => profile([zone("United Kingdom", ["GB"], [standard(), free()]), zone("Ireland", ["IE"], [rate("Standard", 999, [atMost(7499)]), free(7500)]), zone("Rest of world", [], [rate("International", 1999)], true)]);
const ids = (findings: Finding[]) => findings.map(f => f.id.split(":")[0]);
const only = (findings: Finding[], id: string) => findings.filter(f => f.id.split(":")[0] === id);

// ---- the free service
test("a free service is a zero-price rate: always free, free from an order total, or free by something else", () => {
  assert.equal(freeOption(rate("Standard", 499)), null, "it costs something");
  assert.equal(freeOption(rate("Carrier", null)), null, "a carrier rate has no price here");
  assert.equal(freeOption(rate("Free", 0))?.kind, "always");
  assert.equal(freeOption(rate("Free", 0, [atLeast(0)]))?.kind, "always", "a minimum of nothing is no minimum");
  const threshold = freeOption(free(5000));
  assert.equal(threshold?.kind === "threshold" && threshold.thresholdMinor, 5000);
  assert.equal(threshold?.kind === "threshold" && threshold.currency, "GBP");
  assert.equal(freeOption(rate("Heavy", 0, [heavy]))?.kind, "other");
  assert.equal(freeOption(rate("Odd", 0, [{ field: "ITEM_COUNT", operator: "EQUALS" }]))?.kind, "other");
  assert.equal(freeOption(rate("Capped", 0, [atLeast(5000), atMost(20000)]))?.kind, "threshold", "a free band still has its start as the threshold");
});

test("what a zone offers: always free beats a threshold, the lowest threshold wins, and switched-off rates do not count", () => {
  const both = zoneFree(zone("UK", ["GB"], [free(7500), free(5000)]));
  assert.equal(both.effective?.kind === "threshold" && both.effective.thresholdMinor, 5000);
  assert.equal(zoneFree(zone("UK", ["GB"], [free(5000), rate("Free", 0)])).effective?.kind, "always");
  const off = zoneFree(zone("UK", ["GB"], [standard(), free(5000, false)]));
  assert.equal(off.effective, null);
  assert.equal(off.options.length, 1, "the switched-off rate is still known about");
  assert.equal(zoneFree(zone("UK", ["GB"], [standard()])).options.length, 0);
  assert.equal(zoneFree(zone("UK", ["GB"], [rate("Heavy", 0, [heavy])])).effective?.kind, "other");
});

test("zones are described in plain words", () => {
  const say = (z: DeliveryZone) => describeFree(zoneFree(z), formatMinor);
  assert.equal(say(zone("UK", ["GB"], [standard(), free(5000)])), "Free over £50");
  assert.equal(say(zone("UK", ["GB"], [standard(), free(4950)])), "Free over £49.50");
  assert.equal(say(zone("UK", ["GB"], [rate("Free", 0)])), "Always free");
  assert.equal(say(zone("UK", ["GB"], [standard()])), "No free option");
  assert.equal(say(zone("UK", ["GB"], [free(5000, false)])), "Free rate is switched off");
  assert.match(say(zone("UK", ["GB"], [rate("H", 0, [heavy])])), /other than the order total/);
});

test("price ranges read the minimum and maximum order total, and give up on anything else", () => {
  assert.deepEqual(priceRange(standard(4999)), { min: 0, max: 4999 });
  assert.deepEqual(priceRange(free(5000)), { min: 5000, max: Infinity });
  assert.deepEqual(priceRange(rate("Any", 100)), { min: 0, max: Infinity });
  assert.deepEqual(priceRange(rate("Band", 100, [atLeast(1000), atMost(2000)])), { min: 1000, max: 2000 });
  assert.equal(priceRange(rate("Heavy", 100, [heavy])), null);
});

test("order totals that match no rate are found, and a penny between rates is not a gap", () => {
  assert.deepEqual(priceGaps(zone("UK", ["GB"], [standard(4999), free(5000)])), [], "up to £49.99 and from £50 meet");
  assert.deepEqual(priceGaps(zone("UK", ["GB"], [standard(4950), free(5000)])), [{ from: 4951, to: 4999 }]);
  assert.deepEqual(priceGaps(zone("UK", ["GB"], [free(5000)])), [{ from: 0, to: 4999 }], "only a free rate leaves small baskets with nothing");
  assert.deepEqual(priceGaps(zone("UK", ["GB"], [rate("Any", 499)])), []);
  assert.deepEqual(priceGaps(zone("UK", ["GB"], [rate("Over", 499, [atMost(1000)])])), [{ from: 1001, to: Infinity }]);
  assert.deepEqual(priceGaps(zone("UK", ["GB"], [standard(6000), free(5000)])), [], "overlapping is not a gap");
  assert.equal(priceGaps(zone("UK", ["GB"], [rate("Heavy", 100, [heavy])])), null, "weight cannot be judged");
  assert.equal(priceGaps(zone("UK", ["GB"], [rate("Carrier", null)])), null);
  assert.equal(priceGaps(zone("UK", ["GB"], [])), null, "no rates is a different finding");
  assert.deepEqual(priceGaps(zone("UK", ["GB"], [standard(1000), free(5000, false)])), [{ from: 1001, to: Infinity }], "a switched-off rate covers nothing");
});

test("a country uses the zone that names it, and only otherwise the rest-of-world zone", () => {
  const p = healthy();
  assert.equal(zoneForCountry(p, "GB")?.name, "United Kingdom");
  assert.equal(zoneForCountry(p, "US")?.name, "Rest of world");
  assert.equal(zoneForCountry(profile([zone("UK", ["GB"], [standard()])]), "US"), null);
});

test("the usual threshold is the one most zones use, the lowest on a tie", () => {
  assert.deepEqual(usualThreshold(profile([zone("A", ["GB"], [free(5000)]), zone("B", ["IE"], [free(5000)]), zone("C", ["FR"], [free(7500)])])), { thresholdMinor: 5000, currency: "GBP" });
  assert.deepEqual(usualThreshold(profile([zone("A", ["GB"], [free(7500)]), zone("B", ["IE"], [free(5000)])])), { thresholdMinor: 5000, currency: "GBP" });
  assert.equal(usualThreshold(profile([zone("A", ["GB"], [standard()])])), null);
});

// ---- the review
test("a healthy setup has nothing to fix", () => {
  const findings = reviewShipping(snapshot([healthy()], [market("UK and Ireland", ["GB", "IE"])]));
  assert.deepEqual(findings.filter(f => f.severity !== "info").map(f => f.id), []);
  assert.deepEqual(ids(findings), ["no-free", "thresholds-differ"], "no free rate for the rest of the world, and different thresholds for UK and Ireland, are only mentioned");
});

test("no shipping at all is the first problem", () => {
  assert.deepEqual(ids(reviewShipping(snapshot([]))), ["no-rates"]);
  assert.deepEqual(ids(reviewShipping(snapshot([profile([zone("UK", ["GB"], [rate("Old", 499, [], false)])])]))), ["no-rates"]);
});

test("a zone with no switched-on rates stops shoppers there checking out", () => {
  const findings = reviewShipping(snapshot([profile([zone("UK", ["GB"], [standard(), free()]), zone("Ireland", ["IE"], [rate("Old", 999, [], false)])])]));
  const found = only(findings, "zone-no-rates");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "problem");
  assert.match(found[0].detail, /Ireland/);
});

test("a zone without free delivery is only a note when other zones have it, naming the threshold they use", () => {
  const findings = reviewShipping(snapshot([profile([zone("UK", ["GB"], [standard(), free()]), zone("France", ["FR"], [rate("Standard", 1299)])])]));
  const found = only(findings, "no-free");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "info");
  assert.match(found[0].recommendation ?? "", /£50/);
  assert.match(found[0].detail, /Other zones do offer it/);
  assert.equal(found[0].fix, "shipping");
});

test("a shop with no free delivery anywhere is recommended to add the free service", () => {
  const findings = reviewShipping(snapshot([profile([zone("UK", ["GB"], [rate("Standard", 499)]), zone("France", ["FR"], [rate("Standard", 1299)])])]));
  const found = only(findings, "no-free");
  assert.equal(found.length, 2);
  assert.ok(found.every(f => f.severity === "suggestion"));
  assert.match(found[0].recommendation ?? "", /free rate with a minimum order total/);
  assert.match(found[0].detail, /Nothing in this profile/);
});

test("a free rate that is switched off is a different suggestion from having none", () => {
  const findings = reviewShipping(snapshot([profile([zone("UK", ["GB"], [standard(), free(5000, false)])])]));
  assert.deepEqual(ids(findings), ["price-gap", "free-off", "markets-access"], "the gap is a problem, so it comes first, and Markets are not readable here");
  assert.match(only(findings, "free-off")[0].detail, /Free delivery/);
});

test("always-free delivery is questioned only when other zones need a minimum", () => {
  const mixed = reviewShipping(snapshot([profile([zone("UK", ["GB"], [standard(), free()]), zone("Ireland", ["IE"], [rate("Free", 0)])])]));
  assert.equal(only(mixed, "always-free").length, 1);
  const alone = reviewShipping(snapshot([profile([zone("UK", ["GB"], [rate("Free", 0)])])]));
  assert.equal(only(alone, "always-free").length, 0);
});

test("gaps between the paid and free rates are problems with the amounts spelled out", () => {
  const found = only(reviewShipping(snapshot([profile([zone("UK", ["GB"], [standard(4950), free(5000)])])])), "price-gap");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "problem");
  assert.match(found[0].detail, /£49\.51 to £49\.99/);
  assert.equal(only(reviewShipping(snapshot([profile([zone("UK", ["GB"], [standard(4999), free(5000)])])])), "price-gap").length, 0);
});

test("free delivery by weight is explained, since no 'spend' message is possible", () => {
  const found = only(reviewShipping(snapshot([profile([zone("UK", ["GB"], [standard(), rate("Free heavy", 0, [heavy])])])])), "free-not-by-total");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "info");
});

test("a custom profile is flagged when its threshold differs from the general profile, and ignored when empty", () => {
  const general = healthy();
  const same = profile([zone("UK", ["GB"], [standard(), free(5000)])], { id: "p2", name: "Bulky", isDefault: false, variantCount: 12 });
  const different = profile([zone("UK", ["GB"], [standard(7499), free(7500)])], { id: "p3", name: "Pre-orders", isDefault: false, variantCount: 3 });
  const unused = profile([zone("UK", ["GB"], [standard(7499), free(7500)])], { id: "p4", name: "Old", isDefault: false, variantCount: 0 });
  const findings = reviewShipping(snapshot([general, same, different, unused]));
  assert.equal(findings.find(f => f.id === "custom-profile:p2")?.severity, "info");
  assert.equal(findings.find(f => f.id === "custom-profile:p3")?.severity, "suggestion");
  assert.match(findings.find(f => f.id === "custom-profile:p3")?.title ?? "", /3 product variants/);
  assert.equal(findings.some(f => f.id.endsWith(":p4")), false, "a profile with no products is left out");
});

test("rates worked out by a carrier are mentioned, and cannot be checked", () => {
  const findings = reviewShipping(snapshot([profile([zone("UK", ["GB"], [standard(), free(), rate("Courier", null)])])]));
  assert.equal(only(findings, "carrier").length, 1);
  assert.equal(only(findings, "price-gap").length, 0, "a carrier rate makes the total ranges unknowable");
});

test("Markets: countries you sell to without shipping are a problem, rest of world covers the rest, and no access is only a note", () => {
  const p = profile([zone("UK", ["GB"], [standard(), free()])]);
  const withMarkets = reviewShipping(snapshot([p], [market("Europe", ["GB", "FR", "DE"])]));
  const found = only(withMarkets, "market-no-shipping");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "problem");
  assert.match(found[0].title, /^2 countries/);
  assert.match(found[0].detail, /France, Germany/);
  const covered = reviewShipping(snapshot([healthy()], [market("World", ["GB", "FR", "DE", "US"])]));
  assert.equal(only(covered, "market-no-shipping").length, 0);
  const noAccess = reviewShipping(snapshot([p], null));
  assert.equal(only(noAccess, "markets-access")[0].fix, "app");
  assert.equal(only(noAccess, "market-no-shipping").length, 0);
  const inactive = reviewShipping(snapshot([p], [market("Draft", ["FR"], { active: false })]));
  assert.equal(only(inactive, "market-no-shipping").length, 0, "a market that is not live does not count");
  const named = reviewShipping(snapshot([profile([zone("UK", ["GB"], [standard(), free()]), zone("Spain", ["ES"], [])])], [market("UK", ["GB"])]));
  assert.equal(only(named, "market-no-shipping").length, 0);
});

test("Markets: a zone to a country nobody sells to, and a market too big to read", () => {
  const p = profile([zone("UK", ["GB"], [standard(), free()]), zone("Norway", ["NO"], [rate("Standard", 1999)])]);
  const findings = reviewShipping(snapshot([p], [market("UK", ["GB"], { truncated: true })]));
  assert.equal(only(findings, "zone-not-sold").length, 1);
  assert.match(only(findings, "zone-not-sold")[0].detail, /Norway/);
  assert.equal(only(findings, "markets-truncated").length, 1);
});

test("findings come worst first, and the summary counts them", () => {
  const findings = reviewShipping(snapshot([profile([zone("UK", ["GB"], [standard(4950), free(5000)]), zone("Ireland", ["IE"], [standard(), free(5000, false)]), zone("France", ["FR"], [rate("Standard", 1299)])])], []));
  const order = ["problem", "suggestion", "info"];
  assert.deepEqual(findings.map(f => f.severity), [...findings.map(f => f.severity)].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  const counts = summarise(findings);
  assert.equal(counts.problems, 2, "the gap in the UK, and Ireland where the capped standard rate leaves orders over £50 with no rate once the free rate is off");
  assert.ok(counts.suggestions >= 1, "the switched-off free rate in Ireland");
  assert.equal(counts.problems + counts.suggestions + counts.info, findings.length);
});

test("the free-delivery table the product page reads comes from the general profile", () => {
  const table = freeDeliveryTable(snapshot([healthy(), profile([zone("UK", ["GB"], [free(9900)])], { id: "p2", isDefault: false, name: "Other" })]));
  assert.deepEqual(table.countries.GB, { thresholdMinor: 5000, rate: "Free delivery" });
  assert.deepEqual(table.countries.IE, { thresholdMinor: 7500, rate: "Free delivery" });
  assert.equal(table.restOfWorld, null, "the rest-of-world zone has no free rate");
  assert.equal(table.currency, "GBP");
  const mixed = freeDeliveryTable(snapshot([profile([zone("UK", ["GB"], [rate("Free", 0)]), zone("France", ["FR"], [standard()]), zone("World", [], [free(10000)], true)])]));
  assert.deepEqual(mixed.countries.GB, { thresholdMinor: 0, rate: "Free" }, "always free is a threshold of nothing");
  assert.equal(mixed.countries.FR, null, "a named zone with no free rate does not borrow the rest of world's");
  assert.deepEqual(mixed.restOfWorld, { thresholdMinor: 10000, rate: "Free delivery" });
  assert.deepEqual(freeDeliveryTable(snapshot([])).countries, {});
  assert.equal(freeDeliveryTable(snapshot([profile([zone("UK", ["GB"], [rate("H", 0, [heavy])])])])).countries.GB, null, "weight-based free delivery gives no figure");
});

// ---- reading Shopify
const rawRate = (extra: Partial<RawRate> = {}): RawRate => ({ id: "gid://shopify/DeliveryMethodDefinition/1", name: "Free delivery", active: true, rateProvider: { __typename: "DeliveryRateDefinition", price: { amount: "0.0", currencyCode: "GBP" } }, methodConditions: [{ field: "TOTAL_PRICE", operator: "GREATER_THAN_OR_EQUAL_TO", conditionCriteria: { __typename: "MoneyV2", amount: "50.0", currencyCode: "GBP" } }], ...extra });

test("Shopify's rates are read into pence, with conditions of every kind", () => {
  const free = parseRate(rawRate());
  assert.deepEqual({ kind: free.kind, price: free.price, active: free.active }, { kind: "fixed", price: { amount: 0, currency: "GBP" }, active: true });
  assert.deepEqual(free.conditions, [atLeast(5000)]);
  assert.deepEqual(parseRate(rawRate({ rateProvider: { __typename: "DeliveryRateDefinition", price: { amount: "4.99", currencyCode: "GBP" } }, methodConditions: [{ field: "TOTAL_PRICE", operator: "LESS_THAN_OR_EQUAL_TO", conditionCriteria: { __typename: "MoneyV2", amount: "49.99", currencyCode: "GBP" } }] })).conditions, [atMost(4999)]);
  assert.equal(parseRate(rawRate({ rateProvider: { __typename: "DeliveryRateDefinition", price: { amount: "19.99", currencyCode: "GBP" } } })).price?.amount, 1999, "no floating-point pennies");
  const weight = parseRate(rawRate({ methodConditions: [{ field: "TOTAL_WEIGHT", operator: "GREATER_THAN_OR_EQUAL_TO", conditionCriteria: { __typename: "Weight", unit: "KILOGRAMS", value: 10 } }] }));
  assert.deepEqual(weight.conditions, [heavy]);
  const carrier = parseRate(rawRate({ rateProvider: { __typename: "DeliveryParticipant" }, methodConditions: [] }));
  assert.deepEqual({ kind: carrier.kind, price: carrier.price }, { kind: "carrier", price: null });
  assert.deepEqual(parseRate(rawRate({ methodConditions: [{ field: "TOTAL_PRICE", operator: "EQUAL_TO", conditionCriteria: { __typename: "MoneyV2", amount: "5", currencyCode: "GBP" } }] })).conditions, [{ field: "TOTAL_PRICE", operator: "EQUAL_TO" }], "what cannot be understood is kept, not guessed at");
});

test("zones and markets are read, with rest of world, provinces and non-country regions handled", () => {
  const raw: RawZone = { zone: { id: "gid://shopify/DeliveryZone/9", name: "Everywhere else", countries: [{ name: "Rest of world", code: { countryCode: null, restOfWorld: true } }, { name: "Canada", code: { countryCode: "CA", restOfWorld: false } }] }, methodDefinitions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
  const parsed = parseZone(raw, [rawRate()]);
  assert.deepEqual({ countries: parsed.countries, restOfWorld: parsed.restOfWorld, rates: parsed.rates.length }, { countries: ["CA"], restOfWorld: true, rates: 1 });
  const rawMarket: RawMarket = { id: "m1", name: "Europe", status: "ACTIVE", conditions: { regionsCondition: { regions: { nodes: [{ name: "France", code: "FR" }, { name: "A region" }], pageInfo: { hasNextPage: true } } } } };
  assert.deepEqual(parseMarket(rawMarket), { id: "m1", name: "Europe", active: true, countries: ["FR"], truncated: true });
  assert.deepEqual(parseMarket({ id: "m2", name: "Retail", status: "DRAFT", conditions: null }), { id: "m2", name: "Retail", active: false, countries: [], truncated: false });
});

/** A pretend Shopify: two profiles, one zone each, with the general profile's rates arriving over two pages. */
function fakeAdmin(options: { marketsError?: string; profilesError?: string } = {}) {
  const calls: string[] = [];
  const page = (nodes: RawRate[], next: string | null) => ({ nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } });
  const respond = (query: string, variables: Record<string, unknown> = {}) => {
    calls.push(query.match(/query (\w+)/)![1]);
    if (query.includes("ShippingReviewProfiles")) {
      if (options.profilesError) return { errors: [{ message: options.profilesError }] };
      return { data: { shop: { currencyCode: "GBP", shipsToCountries: ["GB"] }, deliveryProfiles: { nodes: [
        { id: "p1", name: "General", default: true, productVariantsCount: { count: 100 }, profileLocationGroups: [{ locationGroup: { id: "g1" } }] },
        { id: "p2", name: "Bulky", default: false, productVariantsCount: { count: 4 }, profileLocationGroups: [{ locationGroup: { id: "g2" } }] },
      ], pageInfo: { hasNextPage: false, endCursor: null } } } };
    }
    if (query.includes("ShippingReviewZone")) {
      const general = variables.profile === "p1";
      const zoneNode = { zone: { id: general ? "z1" : "z2", name: general ? "UK" : "UK bulky", countries: [{ name: "United Kingdom", code: { countryCode: "GB", restOfWorld: false } }] } };
      const methods = general
        ? (variables.methodsAfter ? page([rawRate({ id: "r2", name: "Free delivery" })], null) : page([rawRate({ id: "r1", name: "Standard", rateProvider: { __typename: "DeliveryRateDefinition", price: { amount: "4.99", currencyCode: "GBP" } }, methodConditions: [{ field: "TOTAL_PRICE", operator: "LESS_THAN_OR_EQUAL_TO", conditionCriteria: { __typename: "MoneyV2", amount: "49.99", currencyCode: "GBP" } }] })], "cursor-1"))
        : page([], null);
      return { data: { deliveryProfile: { profileLocationGroups: [{ locationGroupZones: { nodes: [{ ...zoneNode, methodDefinitions: methods }], pageInfo: { hasNextPage: false, endCursor: null } } }] } } };
    }
    if (options.marketsError) return { errors: [{ message: options.marketsError }] };
    return { data: { markets: { nodes: [{ id: "m1", name: "UK", status: "ACTIVE", conditions: { regionsCondition: { regions: { nodes: [{ name: "United Kingdom", code: "GB" }], pageInfo: { hasNextPage: false } } } } }], pageInfo: { hasNextPage: false, endCursor: null } } } };
  };
  return { calls, admin: { graphql: async (query: string, opts?: { variables?: Record<string, unknown> }) => Response.json(respond(query, opts?.variables)) } };
}

test("the whole setup is read from Shopify, following every page, and a clean setup reviews clean", async () => {
  const { admin, calls } = fakeAdmin();
  const result = await loadShippingSnapshot(admin);
  assert.equal(result.shopCurrency, "GBP");
  assert.deepEqual(result.profiles.map(p => [p.name, p.isDefault, p.variantCount, p.zones.length]), [["General", true, 100, 1], ["Bulky", false, 4, 1]]);
  assert.deepEqual(result.profiles[0].zones[0].rates.map(r => r.name), ["Standard", "Free delivery"], "the second page of rates is read too");
  assert.deepEqual(result.markets, [{ id: "m1", name: "UK", active: true, countries: ["GB"], truncated: false }]);
  assert.equal(calls.filter(call => call === "ShippingReviewProfiles").length, 1);
  assert.equal(calls.filter(call => call === "ShippingReviewZone").length, 3, "two pages for the first zone, one for the other");
  assert.deepEqual(reviewShipping(result).filter(f => f.severity === "problem"), []);
});

test("without access to Markets the review still works, and without access to shipping it says so", async () => {
  assert.equal((await loadShippingSnapshot(fakeAdmin({ marketsError: "Access denied for markets field. Required access: `read_markets` access scope." }).admin)).markets, null);
  await assert.rejects(loadShippingSnapshot(fakeAdmin({ profilesError: "Access denied for deliveryProfiles field." }).admin), ShippingAccessError);
  await assert.rejects(loadShippingSnapshot(fakeAdmin({ marketsError: "Internal server error" }).admin), /Internal server error|Shopify/, "other failures are not hidden");
});
