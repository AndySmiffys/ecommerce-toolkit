import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import type { DeliveryRate, DeliveryZone, Market, RateCondition, ShippingSnapshot } from "../app/modules/shipping/delivery/deliveryModel";
import { reviewShipping } from "../app/modules/shipping/delivery/shippingReview";
import { ShippingReviewPage, type ShippingReviewData } from "../app/modules/shipping/ShippingReviewPage";

const gbp = (amount: number) => ({ amount, currency: "GBP" });
const atLeast = (minor: number): RateCondition => ({ field: "TOTAL_PRICE", operator: "GREATER_THAN_OR_EQUAL_TO", money: gbp(minor) });
const atMost = (minor: number): RateCondition => ({ field: "TOTAL_PRICE", operator: "LESS_THAN_OR_EQUAL_TO", money: gbp(minor) });
let n = 0;
const rate = (name: string, price: number, conditions: RateCondition[] = [], active = true): DeliveryRate => ({ id: `r${++n}`, name, active, kind: "fixed", price: gbp(price), conditions });
const zone = (name: string, countries: string[], rates: DeliveryRate[], restOfWorld = false): DeliveryZone => ({ id: `z-${name}`, name, countries, restOfWorld, rates });
const market = (name: string, countries: string[], active = true): Market => ({ id: `m-${name}`, name, active, countries, truncated: false });
const snapshot = (zones: DeliveryZone[], markets: Market[] | null): ShippingSnapshot => ({ shopCurrency: "GBP", shipsTo: ["GB"], profiles: [{ id: "p", name: "General profile", isDefault: true, variantCount: 500, zones }], markets });
const dataFor = (s: ShippingSnapshot): ShippingReviewData => ({ ok: true, snapshot: s, findings: reviewShipping(s), checkedAt: "2026-10-27T10:30:00Z" });

async function render(data: ShippingReviewData, checking = false) {
  const handler = createStaticHandler([{ path: "/app/shipping", Component: () => <ShippingReviewPage data={data} checking={checking} onCheck={() => undefined} /> }]);
  const context = await handler.query(new Request("https://app.example/app/shipping"));
  assert.ok(!(context instanceof Response));
  return renderToStaticMarkup(<StaticRouterProvider router={createStaticRouter(handler.dataRoutes, context as Exclude<typeof context, Response>)} context={context as Exclude<typeof context, Response>} hydrate={false} />);
}

test("a healthy setup is reported as good, with the free service and every rate shown", async () => {
  const html = await render(dataFor(snapshot([zone("United Kingdom", ["GB"], [rate("Standard", 499, [atMost(4999)]), rate("Free delivery", 0, [atLeast(5000)])])], [market("UK", ["GB"])])));
  assert.match(html, /Your shipping setup looks good/);
  assert.match(html, /Free over £50/);
  assert.match(html, /Standard: £4\.99 \(up to £49\.99\)/);
  assert.match(html, /Free delivery: free \(from £50\)/);
  assert.match(html, /United Kingdom/);
  assert.match(html, /Covered/);
  assert.doesNotMatch(html, /What to fix/);
  assert.match(html, /href="shopify:\/\/admin\/settings\/shipping"/, "a way into Shopify's own shipping settings");
  assert.match(html, /Check again/);
});

test("problems come first with what is wrong, what to do, and where to do it", async () => {
  const html = await render(dataFor(snapshot([zone("United Kingdom", ["GB"], [rate("Standard", 499, [atMost(4950)]), rate("Free delivery", 0, [atLeast(5000)])]), zone("France", ["FR"], [rate("Old", 999, [], false)])], [market("Europe", ["GB", "FR", "DE"])])));
  assert.match(html, /problems need fixing/);
  assert.match(html, /Some order totals get no rate in United Kingdom zone/);
  assert.match(html, /£49\.51 to £49\.99/);
  assert.match(html, /No rates are switched on in France zone/);
  assert.match(html, /No rates/, "the table says so too");
  assert.match(html, /No shipping to France, Germany/);
  assert.match(html, /Open shipping settings in Shopify/);
  assert.match(html, /What to fix/);
  assert.match(html, /Old: £9\.99 \(switched off\)/);
});

test("a shop with no free delivery is recommended to add it, and the page says what it reads", async () => {
  const html = await render(dataFor(snapshot([zone("United Kingdom", ["GB"], [rate("Standard", 499)])], [market("UK", ["GB"])])));
  assert.match(html, /suggestion to improve shipping|suggestions to improve shipping/);
  assert.match(html, /No free option/);
  assert.match(html, /free rate with a minimum order total/);
  assert.match(html, /General profile/, "it names the profile the product page follows");
});

test("without access to Markets the page says so and still works", async () => {
  const html = await render(dataFor(snapshot([zone("United Kingdom", ["GB"], [rate("Standard", 499, [atMost(4999)]), rate("Free delivery", 0, [atLeast(5000)])])], null)));
  assert.match(html, /The app cannot see your Markets yet/);
  assert.match(html, /Free over £50/);
  assert.equal((html.match(/cannot see your Markets yet/g) ?? []).length, 1, "said once, not repeated in the notes");
});

test("names from Shopify cannot inject markup", async () => {
  const html = await render(dataFor(snapshot([zone("<img src=x onerror=alert(1)>", ["GB"], [rate("<b>Bold</b>", 499)])], [])));
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<b>Bold<\/b>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("when Shopify cannot be read, the page says why instead of showing an empty review", async () => {
  const access = await render({ ok: false, access: true, error: "Allow the app to read Shopify shipping settings, then reopen this page." });
  assert.match(access, /The app cannot read your shipping settings/);
  assert.match(access, /Allow the app to read Shopify shipping settings/);
  assert.doesNotMatch(access, /Free delivery by zone/);
  const failed = await render({ ok: false, access: false, error: "Shipping settings could not be loaded. Refresh the page and try again." });
  assert.match(failed, /Shipping settings could not be loaded/);
});

test("several profiles are told apart, with how many products use the custom ones", async () => {
  const s = snapshot([zone("United Kingdom", ["GB"], [rate("Standard", 499, [atMost(4999)]), rate("Free delivery", 0, [atLeast(5000)])])], [market("UK", ["GB"])]);
  s.profiles.push({ id: "p2", name: "Bulky items", isDefault: false, variantCount: 12, zones: [zone("UK bulky", ["GB"], [rate("Bulky", 1999)])] });
  const html = await render(dataFor(s));
  assert.match(html, /Bulky items · 12 variants/);
  assert.match(html, /UK bulky/);
});
