const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { Liquid } = require("liquidjs");
const { JSDOM } = require("jsdom");

const blockSource = readFileSync("extensions/promotion-engine/blocks/shipping-countdown.liquid", "utf8");
const [blockTemplate, schemaPart] = blockSource.split("{% schema %}");
const schema = JSON.parse(schemaPart.split("{% endschema %}")[0]);
const script = readFileSync("extensions/promotion-engine/assets/shipping-countdown.js", "utf8");

const money = minor => `£${minor % 100 === 0 ? minor / 100 : (minor / 100).toFixed(2)}`;
const liquid = new Liquid();
liquid.registerFilter("money_without_trailing_zeros", money);
liquid.registerFilter("date", () => "2026-10-20"); // the shop's own date, as 'now' | date gives it

const config = {
  version: 1, cutoffTime: "15:00", shippingDays: [false, true, true, true, true, true, false], bankHolidays: [], delayDays: 0, delayMessage: "Delayed [highlight]from[/highlight]",
  hideIfUnavailable: false, showShippingDays: true, shippingDaysPrefix: "We ship on:", noShippingText: "No dispatch", errorText: "Error", countdownPrefix: "Order in the next", countdownSuffix: "for dispatch on",
  freeShipping: { enabled: true, textUnder: "Free to {country} over {threshold}, only {threshold}", textAdd: "Add this item for free delivery", textOver: "Free delivery unlocked" },
  availability: { outOfStock: { mode: "message", message: "Out of stock right now" }, backorder: { mode: "message", message: "On back order: dispatched when it is back in stock" } },
  warning: { enabled: true, startDate: "2026-12-01", endDate: "2026-12-24", message: "<b>Last</b> orders", textColor: "#8a4b00", backgroundColor: "#fff4e5", borderColor: "#f59e0b" },
  style: { align: "center", showIcon: true, textSize: 16, fontWeight: "500", padding: "standard", margin: 16, radius: 8, border: "double", borderWidth: 6, background: "#f8f9fa", text: "#333333", accent: "#d63384", dispatch: "#28a745", muted: "#666666", icon: "#007bff" },
};
// What the app publishes from Shopify's shipping settings: a country named in a zone, or everyone else.
const delivery = {
  version: 1, currency: "GBP",
  countries: { GB: { free: true, thresholdMinor: 5000, rate: "Free delivery" }, IE: { free: true, thresholdMinor: 7500, rate: "Free delivery" }, FR: { free: false }, DE: { free: true, thresholdMinor: 0, rate: "Free" } },
  restOfWorld: { free: true, thresholdMinor: 10000, rate: "Free delivery" },
};
const uk = { iso_code: "GB", name: "United Kingdom" };
const variants = [
  { id: 1, price: 1000, available: true, inventory_policy: "deny", inventory_management: "shopify", inventory_quantity: 9 },
  { id: 2, price: 4600, available: true, inventory_policy: "deny", inventory_management: "shopify", inventory_quantity: 9 },
  { id: 3, price: 1000, available: false, inventory_policy: "deny", inventory_management: "shopify", inventory_quantity: 0 },
  { id: 4, price: 1000, available: true, inventory_policy: "continue", inventory_management: "shopify", inventory_quantity: 0 },
  { id: 5, price: 1000, available: true, inventory_policy: "continue", inventory_management: null, inventory_quantity: 0 },
];

async function render({ cartTotal = 0, currency = "GBP", cfg = config, design = false, country = uk, table = delivery } = {}) {
  return liquid.parseAndRender(blockTemplate, {
    app: { metafields: { shipping_countdown: { config: { value: cfg }, delivery: { value: table } } } },
    localization: { country },
    block: { id: "template_abc_123", settings: {}, shopify_attributes: "" },
    cart: { total_price: cartTotal, currency: { iso_code: currency } },
    request: { design_mode: design },
    product: { selected_or_first_available_variant: variants[0], variants },
  });
}

/** A page with the block's real markup, a product form, and the script running against a fixed London clock. */
async function page(options = {}, instances = 1) {
  const html = await render(options);
  const form = `<form action="/cart/add"><input name="id" value="1"><input name="quantity" value="1"></form>`;
  const dom = new JSDOM(`<body><section class="shopify-section">${html}${instances > 1 ? html.replace(/id="shipping-countdown-[^"]*"/, 'id="second"') : ""}${form}</section></body>`, { url: "https://shop.example/products/x", runScripts: "outside-only" });
  const { window } = dom;
  const state = { now: Date.parse("2026-10-20T09:00:00Z"), requests: [] };
  window.Date.now = () => state.now;
  window.fetch = async url => { state.requests.push(String(url)); return { json: async () => ({ total_price: state.fetched ?? 0, currency: "GBP" }) }; };
  window.eval(script);
  return { window, document: window.document, state, close: () => window.close(), lines: () => [...window.document.querySelectorAll('[data-role="dispatch"]')].map(n => n.textContent), free: () => window.document.querySelector('[data-role="free"]') };
}
// The visible HTML, without the JSON the script reads (which keeps the raw {threshold} text and escapes markup itself).
const visible = html => html.replace(/<script[\s\S]*?<\/script>/g, "");
const wait = ms => new Promise(done => setTimeout(done, ms));

test("the theme editor has nothing to set: the look comes from the app's settings", async () => {
  assert.deepEqual(schema.settings.filter(setting => setting.id), [], "no settings of its own");
  assert.equal(schema.target, "section");
  assert.deepEqual(schema.enabled_on, { templates: ["product"] });
  const html = visible(await render());
  assert.match(html, /data-align="center"/);
  assert.match(html, /data-padding="standard"/);
  assert.match(html, /data-border="double"/);
  assert.match(html, /--sc-size:16px/);
  assert.match(html, /--sc-dispatch:#28a745/);
  assert.match(html, /<svg class="sc__icon"/);
});

test("the look follows the saved appearance, including no icon", async () => {
  const html = visible(await render({ cfg: { ...config, style: { ...config.style, align: "left", padding: "roomy", border: "none", textSize: 20, showIcon: false, accent: "#112233" } } }));
  assert.match(html, /data-align="left"/);
  assert.match(html, /data-padding="roomy"/);
  assert.match(html, /data-border="none"/);
  assert.match(html, /--sc-size:20px/);
  assert.match(html, /--sc-accent:#112233/);
  assert.doesNotMatch(html, /sc__icon/);
});

test("settings saved before the appearance existed still render, with the stylesheet's own defaults", async () => {
  const { style, ...old } = config;
  const html = visible(await render({ cfg: old }));
  assert.match(html, /class="sc__content"/);
  assert.doesNotMatch(html, /--sc-size/);
  assert.match(html, /<svg class="sc__icon"/, "the icon is on by default");
});

test("the server writes the free-shipping message for the shopper's country, with every placeholder replaced, text escaped, and the days listed", async () => {
  const html = await render();
  assert.match(html, /Free to United Kingdom over £50, only £50/);
  assert.doesNotMatch(visible(html), /\{threshold\}|\{country\}/);
  assert.match(html, /We ship on: Monday, Tuesday, Wednesday, Thursday, Friday</);
  assert.match(html, /data-currency="GBP"/);
  assert.match(html, /data-free-threshold="5000"/);
  assert.match(html, /data-free-currency="GBP"/);
  assert.match(html, /data-country="United Kingdom"/);
  assert.match(html, /aria-live="polite"[^>]*>Free to/, "only the free-shipping line is announced");
  assert.equal((html.match(/aria-live/g) || []).length, 1);
  const pence = { ...delivery, countries: { ...delivery.countries, GB: { free: true, thresholdMinor: 4950, rate: "Free" } } };
  assert.match(await render({ table: pence }), /over £49\.50, only £49\.50/, "pence are kept");
  assert.match(await render({ cartTotal: 4500 }), /Add this item for free delivery/);
  assert.match(await render({ cartTotal: 6000 }), /Free delivery unlocked/);
  assert.match(await render({ country: { iso_code: "<b>", name: "<b>Land</b>" } }), /Free to &lt;b&gt;Land&lt;\/b&gt; over £100/, "a country name cannot inject markup");
});

test("each shopper sees the threshold for their own country: a different one, none, always free, or the rest of the world's", async () => {
  assert.match(await render({ country: { iso_code: "IE", name: "Ireland" } }), /Free to Ireland over £75, only £75/);
  const france = await render({ country: { iso_code: "FR", name: "France" } });
  assert.match(france, /data-role="free"[^>]*hidden/, "a zone with no free rate shows nothing, and does not borrow the rest of the world's");
  const germany = await render({ country: { iso_code: "DE", name: "Germany" } });
  assert.match(germany, /Free delivery unlocked/, "where delivery is always free there is nothing to spend");
  assert.doesNotMatch(germany, /data-role="free"[^>]*hidden/);
  assert.match(await render({ country: { iso_code: "US", name: "United States" } }), /Free to United States over £100, only £100/, "a country in no zone uses the rest of the world");
  assert.match(await render({ currency: "EUR" }), /data-role="free"[^>]*hidden/, "a cart in another currency gets no message, nothing is converted");
  assert.match(await render({ table: null }), /data-role="free"[^>]*hidden/, "before shipping has been read there is nothing to say");
  assert.match(await render({ table: { ...delivery, restOfWorld: null }, country: { iso_code: "US", name: "United States" } }), /data-role="free"[^>]*hidden/, "no zone for them at all");
  const off = await render({ cfg: { ...config, freeShipping: { ...config.freeShipping, enabled: false } } });
  assert.doesNotMatch(off, /data-role="free"/);
});

test("the warning notice is decided on the server by the shop's date, and its text cannot inject markup", async () => {
  const out = await render();
  assert.match(out, /data-role="warning"[^>]*hidden/, "20 Oct is outside 1-24 Dec");
  assert.doesNotMatch(visible(out), /<b>Last<\/b>/);
  assert.match(out, /&lt;b&gt;Last&lt;\/b&gt; orders/);
  const inside = await render({ cfg: { ...config, warning: { ...config.warning, startDate: "2026-10-20", endDate: "2026-10-20" } } });
  assert.doesNotMatch(inside, /data-role="warning"[^>]*hidden/, "both ends are included");
  assert.doesNotMatch(await render({ cfg: { ...config, warning: { ...config.warning, enabled: false } } }), /data-role="warning"/);
});

test("with no saved settings the block says nothing, except to the theme editor", async () => {
  assert.doesNotMatch(await render({ cfg: null }), /shipping-countdown/);
  assert.match(await render({ cfg: null, design: true }), /open the eCommerce Toolkit app/);
});

test("the script fills the dispatch line from London's clock, with no markup from settings", async () => {
  const p = await page();
  assert.deepEqual(p.lines(), ["Order in the next 5 hours for dispatch on Tuesday 20 Oct"]);
  assert.equal(p.document.querySelector(".sc__countdown").textContent, "5 hours");
  assert.equal(p.document.querySelector("shipping-countdown").hidden, false);
  p.close();
});

test("the dispatch line rolls over to the next day after the cut-off without a reload", async () => {
  const p = await page();
  p.state.now = Date.parse("2026-10-20T14:00:30Z");
  Object.defineProperty(p.document, "hidden", { value: false }); // jsdom reports a page nobody is looking at
  p.document.dispatchEvent(new p.window.Event("visibilitychange"));
  assert.deepEqual(p.lines(), ["Order in the next 23 hours 59 minutes for dispatch on Wednesday 21 Oct"]);
  p.close();
});

test("out of stock and zero stock with continue selling each show their own message, and going back restores the date", async () => {
  const p = await page();
  const id = p.document.querySelector('input[name="id"]');
  const pick = value => { id.value = value; id.dispatchEvent(new p.window.Event("change", { bubbles: true })); };
  pick("3");
  assert.deepEqual(p.lines(), ["Out of stock right now"]);
  pick("4");
  assert.deepEqual(p.lines(), ["On back order: dispatched when it is back in stock"]);
  pick("5");
  assert.match(p.lines()[0], /Tuesday 20 Oct/, "stock that is not tracked is never reported as zero");
  pick("1");
  assert.match(p.lines()[0], /Tuesday 20 Oct/);
  p.close();
});

test("either case can be hidden instead, separately", async () => {
  const hideOut = await page({ cfg: { ...config, availability: { ...config.availability, outOfStock: { mode: "hide", message: "" } } } });
  const id = hideOut.document.querySelector('input[name="id"]');
  id.value = "3"; id.dispatchEvent(new hideOut.window.Event("change", { bubbles: true }));
  assert.equal(hideOut.document.querySelector("shipping-countdown").hidden, true);
  id.value = "4"; id.dispatchEvent(new hideOut.window.Event("change", { bubbles: true }));
  assert.equal(hideOut.document.querySelector("shipping-countdown").hidden, false, "the back-order message still shows");
  assert.deepEqual(hideOut.lines(), ["On back order: dispatched when it is back in stock"]);
  hideOut.close();
  const hideBack = await page({ cfg: { ...config, availability: { ...config.availability, backorder: { mode: "hide", message: "" } } } });
  const field = hideBack.document.querySelector('input[name="id"]');
  field.value = "4"; field.dispatchEvent(new hideBack.window.Event("change", { bubbles: true }));
  assert.equal(hideBack.document.querySelector("shipping-countdown").hidden, true);
  hideBack.close();
});

test("an out of stock item never counts towards free delivery, but a back-order item does", async () => {
  const p = await page();
  const id = p.document.querySelector('input[name="id"]');
  p.document.dispatchEvent(new p.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 4500, currency: "GBP" } } }));
  id.value = "3"; id.dispatchEvent(new p.window.Event("change", { bubbles: true }));
  assert.equal(p.free().textContent, "Free to United Kingdom over £50, only £50", "an item that cannot be bought cannot take £45 to £55");
  id.value = "4"; id.dispatchEvent(new p.window.Event("change", { bubbles: true }));
  assert.equal(p.free().textContent, "Add this item for free delivery");
  p.close();
});

test("the free-shipping line follows the chosen variant and quantity, and uses a cart sent with an event without fetching", async () => {
  const p = await page();
  const qty = p.document.querySelector('input[name="quantity"]');
  const id = p.document.querySelector('input[name="id"]');
  p.document.dispatchEvent(new p.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 4500, currency: "GBP" } } }));
  assert.equal(p.free().textContent, "Add this item for free delivery", "a £10 item takes £45 to £55");
  qty.value = "1"; id.value = "1";
  p.document.dispatchEvent(new p.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 3000, currency: "GBP" } } }));
  assert.equal(p.free().textContent, "Free to United Kingdom over £50, only £50");
  qty.value = "1"; qty.dispatchEvent(new p.window.Event("input", { bubbles: true }));
  assert.equal(p.free().textContent, "Free to United Kingdom over £50, only £50", "£30 + £10 is not enough");
  qty.value = "2"; qty.dispatchEvent(new p.window.Event("input", { bubbles: true }));
  assert.equal(p.free().textContent, "Add this item for free delivery", "£30 + 2 x £10 is exactly £50, which reaches it");
  id.value = "2"; qty.value = "1"; id.dispatchEvent(new p.window.Event("change", { bubbles: true }));
  assert.equal(p.free().textContent, "Add this item for free delivery", "the £46 variant takes £30 to £76");
  p.document.dispatchEvent(new p.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 5000, currency: "GBP" } } }));
  assert.equal(p.free().textContent, "Free delivery unlocked");
  assert.deepEqual(p.state.requests, [], "nothing was fetched");
  p.close();
});

test("a country with no free delivery stays silent in the browser too, and an always-free one needs no spending", async () => {
  const france = await page({ country: { iso_code: "FR", name: "France" } });
  france.document.dispatchEvent(new france.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 4500, currency: "GBP" } } }));
  assert.equal(france.free().hidden, true);
  france.close();
  const germany = await page({ country: { iso_code: "DE", name: "Germany" } });
  germany.document.dispatchEvent(new germany.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 0, currency: "GBP" } } }));
  assert.equal(germany.free().textContent, "Free delivery unlocked");
  germany.close();
  const euro = await page();
  euro.document.dispatchEvent(new euro.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 4500, currency: "EUR" } } }));
  assert.equal(euro.free().hidden, true, "a cart in a currency the threshold is not in");
  euro.close();
});

test("cart events without a cart cause one debounced fetch, and the answer updates the line", async () => {
  const p = await page();
  p.state.fetched = 6000;
  for (let i = 0; i < 4; i++) p.document.dispatchEvent(new p.window.CustomEvent("cart:change"));
  p.document.querySelector("form").dispatchEvent(new p.window.Event("submit", { bubbles: true }));
  await wait(450);
  assert.deepEqual(p.state.requests, ["/cart.js"]);
  assert.equal(p.free().textContent, "Free delivery unlocked");
  p.close();
});

test("two blocks on one page work independently, and a removed block stops listening", async () => {
  const p = await page({}, 2);
  assert.equal(p.lines().length, 2);
  assert.deepEqual(new Set(p.lines()).size, 1);
  p.state.fetched = 100;
  const blocks = p.document.querySelectorAll("shipping-countdown");
  blocks[1].remove();
  p.document.dispatchEvent(new p.window.CustomEvent("cart:change"));
  await wait(450);
  assert.equal(p.state.requests.length, 1, "only the block still on the page asked");
  blocks[0].remove();
  p.document.dispatchEvent(new p.window.CustomEvent("cart:change"));
  await wait(450);
  assert.equal(p.state.requests.length, 1, "none left, none asked");
  p.close();
});

test("loading the script twice does not try to define the element twice", async () => {
  const p = await page();
  assert.doesNotThrow(() => p.window.eval(script));
  p.close();
});

test("delay mode shows the highlighted message and the date", async () => {
  const p = await page({ cfg: { ...config, delayDays: 2 } });
  assert.deepEqual(p.lines(), ["Delayed from Thursday 22 Oct"]);
  assert.equal(p.document.querySelector(".sc__countdown").textContent, "from");
  p.close();
});
