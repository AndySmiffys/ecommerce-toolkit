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
  freeShipping: { enabled: true, thresholds: { GBP: 5000, EUR: 6000 }, textUnder: "Free over {threshold}, only {threshold}", textAdd: "Add this item for free delivery", textOver: "Free delivery unlocked" },
  availability: { preorderMode: "message", preorderMessage: "Pre-order: date at checkout" },
  warning: { enabled: true, startDate: "2026-12-01", endDate: "2026-12-24", message: "<b>Last</b> orders", textColor: "#8a4b00", backgroundColor: "#fff4e5", borderColor: "#f59e0b" },
};
const variants = [
  { id: 1, price: 1000, available: true, inventory_policy: "deny", inventory_management: "shopify", inventory_quantity: 9 },
  { id: 2, price: 4600, available: true, inventory_policy: "deny", inventory_management: "shopify", inventory_quantity: 9 },
  { id: 3, price: 1000, available: false, inventory_policy: "deny", inventory_management: "shopify", inventory_quantity: 0 },
];
const defaults = Object.fromEntries(schema.settings.filter(s => s.id).map(s => [s.id, s.default]));

async function render({ cartTotal = 0, currency = "GBP", cfg = config, design = false } = {}) {
  return liquid.parseAndRender(blockTemplate, {
    app: { metafields: { shipping_countdown: { config: { value: cfg } } } },
    block: { id: "template_abc_123", settings: defaults, shopify_attributes: "" },
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

test("the block keeps the same presentation settings as the old theme block", () => {
  assert.deepEqual(Object.keys(defaults).sort(), ["background_color", "border_radius", "dispatch_color", "expired_text_color", "font_size", "font_weight", "highlight_color", "icon_color", "icon_size", "margin_vertical", "padding_horizontal", "padding_vertical", "secondary_font_size", "secondary_text_color", "show_icon", "text_alignment", "text_color"]);
  assert.deepEqual(defaults, { text_alignment: "center", show_icon: true, icon_size: 24, font_size: 16, secondary_font_size: 14, font_weight: "500", background_color: "#f8f9fa", text_color: "#333333", highlight_color: "#d63384", dispatch_color: "#28a745", secondary_text_color: "#666666", icon_color: "#007bff", expired_text_color: "#999999", padding_vertical: 16, padding_horizontal: 24, margin_vertical: 16, border_radius: 8 });
  assert.equal(schema.target, "section");
  assert.deepEqual(schema.enabled_on, { templates: ["product"] });
});

test("the server writes the free-shipping message with every {threshold} replaced, text escaped, and the days listed", async () => {
  const html = await render();
  assert.match(html, /Free over £50, only £50/);
  assert.doesNotMatch(visible(html), /\{threshold\}/);
  assert.match(html, /We ship on: Monday, Tuesday, Wednesday, Thursday, Friday</);
  assert.match(html, /data-currency="GBP"/);
  assert.match(html, /aria-live="polite"[^>]*>Free over/, "only the free-shipping line is announced");
  assert.equal((html.match(/aria-live/g) || []).length, 1);
  assert.equal(await render({ cfg: { ...config, freeShipping: { ...config.freeShipping, thresholds: { GBP: 4950 } } } }).then(h => /over £49\.50, only £49\.50/.test(h)), true, "pence are kept");
  assert.match(await render({ cartTotal: 4500 }), /Add this item for free delivery/);
  assert.match(await render({ cartTotal: 6000 }), /Free delivery unlocked/);
  assert.match(await render({ currency: "EUR" }), /Free over €?60|Free over £60/, "the EUR threshold is used for a EUR cart");
  const none = await render({ currency: "USD" });
  assert.match(none, /data-role="free"[^>]*hidden/, "a currency with no threshold gets no message");
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

test("a sold-out variant shows the pre-order message instead of a date, and going back restores the date", async () => {
  const p = await page();
  const id = p.document.querySelector('input[name="id"]');
  id.value = "3";
  id.dispatchEvent(new p.window.Event("change", { bubbles: true }));
  assert.deepEqual(p.lines(), ["Pre-order: date at checkout"]);
  id.value = "1";
  id.dispatchEvent(new p.window.Event("change", { bubbles: true }));
  assert.match(p.lines()[0], /Tuesday 20 Oct/);
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
  assert.equal(p.free().textContent, "Free over £50, only £50");
  qty.value = "1"; qty.dispatchEvent(new p.window.Event("input", { bubbles: true }));
  assert.equal(p.free().textContent, "Free over £50, only £50", "£30 + £10 is not enough");
  qty.value = "2"; qty.dispatchEvent(new p.window.Event("input", { bubbles: true }));
  assert.equal(p.free().textContent, "Add this item for free delivery", "£30 + 2 x £10 is exactly £50, which reaches it");
  id.value = "2"; qty.value = "1"; id.dispatchEvent(new p.window.Event("change", { bubbles: true }));
  assert.equal(p.free().textContent, "Add this item for free delivery", "the £46 variant takes £30 to £76");
  p.document.dispatchEvent(new p.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 5000, currency: "GBP" } } }));
  assert.equal(p.free().textContent, "Free delivery unlocked");
  assert.deepEqual(p.state.requests, [], "nothing was fetched");
  p.close();
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
