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
const liquid = new Liquid({ root: "extensions/promotion-engine/snippets", extname: ".liquid" });
liquid.registerFilter("money_without_trailing_zeros", money);
liquid.registerFilter("date", () => "2026-10-20"); // the shop's own date, as 'now' | date gives it

const config = {
  version: 1, cutoffTime: "15:00", shippingDays: [false, true, true, true, true, true, false], bankHolidays: [], delayDays: 0, delayMessage: "Delayed [highlight]from[/highlight]",
  hideIfUnavailable: false, showShippingDays: true, shippingDaysPrefix: "We ship on:", noShippingText: "No dispatch", errorText: "Error", countdownPrefix: "Order in the next", countdownSuffix: "for dispatch on",
  freeShipping: { enabled: true, textUnder: "Free to {country} over {threshold}, only {threshold}", textAdd: "Add this item for free delivery", textOver: "Free delivery unlocked" },
  availability: { outOfStock: { mode: "message", message: "Out of stock right now" }, backorder: { mode: "message", message: "On back order: dispatched when it is back in stock" } },
  warning: { enabled: true, startDate: "2026-12-01", endDate: "2026-12-24", message: "<b>Last</b> orders", textColor: "#8a4b00", backgroundColor: "#fff4e5", borderColor: "#f59e0b" },
  delivery: { enabled: false, heading: "Delivery options", guaranteedText: "Delivery by {date}", estimatedText: "Delivery by {date} (Non-Guaranteed)", services: [] },
  style: { align: "center", showIcon: true, textSize: 16, fontWeight: "500", padding: "standard", margin: 16, lineGap: 8, radius: 8, border: "double", borderWidth: 6, background: "#f8f9fa", text: "#333333", accent: "#d63384", dispatch: "#28a745", muted: "#666666", icon: "#007bff" },
};
// What the app publishes from Shopify's shipping settings: a country named in a zone, or everyone else.
const delivery = {
  version: 1, currency: "GBP",
  countries: { GB: { free: true, thresholdMinor: 5000, rate: "Free delivery" }, IE: { free: true, thresholdMinor: 7500, rate: "Free delivery" }, FR: { free: false }, DE: { free: true, thresholdMinor: 0, rate: "Free" } },
  restOfWorld: { free: true, thresholdMinor: 10000, rate: "Free delivery" },
};
const uk = { iso_code: "GB", name: "United Kingdom" };
// The delivery services the app publishes from Shopify's shipping settings: by zone, with each country pointing at its zone.
const serviceTable = {
  version: 1, currency: "GBP",
  zones: {
    z0: { name: "Domestic", services: [
      { name: "DPD Next Working Day Delivery", tiers: [{ from: 0, price: 699 }, { from: 3000, price: 499 }], transit: { minDays: 1, maxDays: 1 } },
      { name: "Amazon 2 Day (Order Before 2pm) Non Guaranteed", tiers: [{ from: 0, price: 399 }, { from: 3000, price: 0 }], transit: { minDays: 2, maxDays: 2 } },
    ] },
    z1: { name: "Ireland", services: [] },
    z2: { name: "Rest of world", services: [{ name: "International", tiers: [{ from: 0, price: 1999 }], transit: { minDays: 5, maxDays: 10 } }] },
  },
  countries: { GB: "z0", IE: "z1" },
  restOfWorld: "z2",
};
const deliveryOn = (changes = {}) => ({ enabled: true, heading: "Delivery options", guaranteedText: "Delivery by {date}", estimatedText: "Delivery by {date} (Non-Guaranteed)", services: [{ name: "DPD Next Working Day Delivery", label: "DPD Next Day", guaranteed: true }], ...changes });
const variants = [
  { id: 1, price: 1000, available: true, inventory_policy: "deny", inventory_management: "shopify", inventory_quantity: 9 },
  { id: 2, price: 4600, available: true, inventory_policy: "deny", inventory_management: "shopify", inventory_quantity: 9 },
  { id: 3, price: 1000, available: false, inventory_policy: "deny", inventory_management: "shopify", inventory_quantity: 0 },
  { id: 4, price: 1000, available: true, inventory_policy: "continue", inventory_management: "shopify", inventory_quantity: 0 },
  { id: 5, price: 1000, available: true, inventory_policy: "continue", inventory_management: null, inventory_quantity: 0 },
];

async function render({ cartTotal = 0, currency = "GBP", cfg = config, design = false, country = uk, table = delivery, services = serviceTable } = {}) {
  return liquid.parseAndRender(blockTemplate, {
    app: { metafields: { shipping_countdown: { config: { value: cfg }, delivery: { value: table }, delivery_services: { value: services } } } },
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

test("the space between lines follows the setting, and appearance saved before it existed still renders", async () => {
  const wide = visible(await render({ cfg: { ...config, style: { ...config.style, lineGap: 14 } } }));
  assert.match(wide, /--sc-gap:14px/);
  const { lineGap, ...older } = config.style;
  const html = visible(await render({ cfg: { ...config, style: older } }));
  assert.doesNotMatch(html, /--sc-gap/, "left to the stylesheet's own default, not an empty value that would collapse the spacing");
  assert.match(html, /--sc-size:16px/);
  assert.match(html, /class="sc__content"/);
  assert.equal(lineGap, 8);
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

test("the delivery option's name from Shopify's shipping settings can be used in a message, on the server and in the browser", async () => {
  const named = { ...config, freeShipping: { ...config.freeShipping, textUnder: "Spend {threshold} to get {rate}", textAdd: "Add this to get {rate}", textOver: "You have {rate}, {country}!" } };
  const html = await render({ cfg: named });
  assert.match(html, /Spend £50 to get Free delivery/);
  assert.match(html, /data-free-rate="Free delivery"/, "the script is given the name too");
  assert.doesNotMatch(visible(html), /\{rate\}/);
  assert.match(await render({ cfg: named, cartTotal: 4500 }), /Add this to get Free delivery/);
  assert.match(await render({ cfg: named, cartTotal: 6000 }), /You have Free delivery, United Kingdom!/);
  const ireland = { ...delivery, countries: { ...delivery.countries, IE: { free: true, thresholdMinor: 7500, rate: "Free Irish delivery" } } };
  assert.match(await render({ cfg: named, table: ireland, country: { iso_code: "IE", name: "Ireland" } }), /Spend £75 to get Free Irish delivery/, "each country's own free option");
  const markup = { ...delivery, countries: { ...delivery.countries, GB: { free: true, thresholdMinor: 5000, rate: "<b>Free</b> & fast" } } };
  const escaped = await render({ cfg: named, table: markup });
  assert.match(visible(escaped), /Spend £50 to get &lt;b&gt;Free&lt;\/b&gt; &amp; fast/, "a name from Shopify cannot inject markup");
  assert.match(visible(escaped), /data-free-rate="&lt;b&gt;Free&lt;\/b&gt; &amp; fast"/);
  // And in the browser, after the cart changes.
  const p = await page({ cfg: named });
  p.document.dispatchEvent(new p.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 4500, currency: "GBP" } } }));
  assert.equal(p.free().textContent, "Add this to get Free delivery");
  p.document.dispatchEvent(new p.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 6000, currency: "GBP" } } }));
  assert.equal(p.free().textContent, "You have Free delivery, United Kingdom!");
  p.close();
});

test("{rate} is the name given to the service in the app, matched forgivingly, and Shopify's name when there is none", async () => {
  const named = (services, extra = {}) => ({ ...config, freeShipping: { ...config.freeShipping, textUnder: "Spend {threshold} to get {rate}", textAdd: "Add this to get {rate}", textOver: "You have {rate}" }, delivery: { ...config.delivery, services }, ...extra });
  const service = (name, label) => ({ name, label, show: true, guaranteed: false, cutoffTime: "", days: [false, true, true, true, true, true, false], onBankHolidays: false, transitMin: null, transitMax: null });
  const labelled = await render({ cfg: named([service("Free delivery", "Free standard delivery")]) });
  assert.match(labelled, /Spend £50 to get Free standard delivery/);
  assert.match(labelled, /data-free-rate="Free standard delivery"/, "the script is given the same name");
  assert.match(await render({ cfg: named([service("Free delivery", "Free standard delivery")]), cartTotal: 4500 }), /Add this to get Free standard delivery/);
  assert.match(await render({ cfg: named([service("Free delivery", "Free standard delivery")]), cartTotal: 6000 }), /You have Free standard delivery/);
  for (const name of ["free delivery", "  FREE   DELIVERY ", "Free  delivery"]) assert.match(await render({ cfg: named([service(name, "Our free delivery")]) }), /Spend £50 to get Our free delivery/, `matched "${name}"`);
  for (const none of [[], [service("Free delivery", "")], [service("Free delivery", "   ")], [service("Something else", "Not this one")]]) {
    assert.match(await render({ cfg: named(none) }), /Spend £50 to get Free delivery/, "no name given to this service: Shopify's own");
  }
  const old = { ...named([]), delivery: undefined };
  assert.match(await render({ cfg: old }), /Spend £50 to get Free delivery/, "settings saved before delivery options existed");
  const markup = visible(await render({ cfg: named([service("Free delivery", "<b>Fast</b> & free")]) }));
  assert.match(markup, /Spend £50 to get &lt;b&gt;Fast&lt;\/b&gt; &amp; free/, "a name typed in the app cannot inject markup either");
  const ireland = { ...delivery, countries: { ...delivery.countries, IE: { free: true, thresholdMinor: 7500, rate: "Free Irish delivery" } } };
  assert.match(await render({ cfg: named([service("Free delivery", "UK free"), service("Free Irish delivery", "Irish free")]), table: ireland, country: { iso_code: "IE", name: "Ireland" } }), /Spend £75 to get Irish free/, "each country's own free option, with its own name");
  assert.match(await render({ cfg: named([service("Free delivery", "UK free"), service("Free Irish delivery", "Irish free")]), table: ireland }), /Spend £50 to get UK free/);
  const p = await page({ cfg: named([service("Free delivery", "Free standard delivery")]) });
  p.document.dispatchEvent(new p.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 4500, currency: "GBP" } } }));
  assert.equal(p.free().textContent, "Add this to get Free standard delivery", "and in the browser after the cart changes");
  p.document.dispatchEvent(new p.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 6000, currency: "GBP" } } }));
  assert.equal(p.free().textContent, "You have Free standard delivery");
  p.close();
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

test("bold and highlighted words in a message are written as formatting on the server, and nothing else in it can become markup", async () => {
  const rich = {
    ...config,
    shippingDaysPrefix: "We [bold]ship[/bold] on:",
    freeShipping: { ...config.freeShipping, textUnder: "[highlight]Free[/highlight] over {threshold} with [bold]{rate}[/bold]" },
    warning: { ...config.warning, startDate: "2026-10-20", endDate: "2026-10-20", message: "[bold]Last[/bold] orders <img src=x onerror=alert(1)> [highlight]soon[/highlight]" },
  };
  const html = visible(await render({ cfg: rich }));
  assert.match(html, /<span class="sc__countdown">Free<\/span> over £50 with <strong>Free delivery<\/strong>/, "the free delivery line, with the placeholder filled in inside the bold");
  assert.match(html, /We <strong>ship<\/strong> on: Monday/, "the days line");
  assert.match(html, /<strong>Last<\/strong> orders &lt;img src=x onerror=alert\(1\)&gt; <span class="sc__countdown">soon<\/span>/, "the warning: formatting becomes markup, anything else is escaped");
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /\[bold\]|\[highlight\]|\[\/bold\]|\[\/highlight\]/, "no tag is left showing");
  const nested = visible(await render({ cfg: { ...rich, warning: { ...rich.warning, message: "[bold]a [highlight]b[/highlight][/bold]" } } }));
  assert.match(nested, /<strong>a <span class="sc__countdown">b<\/span><\/strong>/);
});

test("in the browser every message is written with its formatting, and what is typed cannot become markup", async () => {
  const rich = {
    ...config,
    countdownPrefix: "Order [bold]in[/bold] the next",
    countdownSuffix: "for [highlight]dispatch[/highlight] on",
    noShippingText: "[bold]Closed[/bold] <img src=x onerror=alert(1)>",
    errorText: "[bold]Oops[/bold]",
    freeShipping: { ...config.freeShipping, textAdd: "Add this for [bold]{rate}[/bold]" },
    availability: { outOfStock: { mode: "message", message: "[bold]Sold[/bold] out" }, backorder: { mode: "message", message: "Back [highlight]soon[/highlight]" } },
  };
  const p = await page({ cfg: rich });
  const line = () => p.document.querySelector('[data-role="dispatch"]');
  assert.equal(line().innerHTML.replace(/<span class="sc__(countdown|dispatch)">/g, "<s>").replace(/<\/span>/g, "</s>"), "Order <strong>in</strong> the next <s>5 hours</s> for <s>dispatch</s> on <s>Tuesday 20 Oct</s>");
  const id = p.document.querySelector('input[name="id"]');
  const pick = value => { id.value = value; id.dispatchEvent(new p.window.Event("change", { bubbles: true })); };
  pick("3");
  assert.equal(line().innerHTML, "<strong>Sold</strong> out");
  pick("4");
  assert.equal(line().innerHTML, 'Back <span class="sc__countdown">soon</span>');
  p.document.dispatchEvent(new p.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 4500, currency: "GBP" } } }));
  assert.equal(p.free().innerHTML, "Add this for <strong>Free delivery</strong>");
  const closed = await page({ cfg: { ...rich, shippingDays: [false, false, false, false, false, false, false] } });
  const none = closed.document.querySelector('[data-role="dispatch"] .sc__expired');
  assert.equal(none.querySelector("strong").textContent, "Closed");
  assert.equal(none.querySelector("img"), null, "typed text is never turned into elements");
  assert.match(none.textContent, /<img src=x onerror=alert\(1\)>/, "it stays visible as the text it is");
  const broken = await page({ cfg: { ...rich, cutoffTime: "" } });
  assert.equal(broken.document.querySelector('[data-role="dispatch"]').innerHTML, "<strong>Oops</strong>");
  p.close(); closed.close(); broken.close();
});

test("delay messages keep working with the formatting written by hand before there was an editor", async () => {
  const p = await page({ cfg: { ...config, delayDays: 2, delayMessage: "Delayed [highlight]from[/highlight] and [bold]slow[/bold]" } });
  assert.equal(p.document.querySelector('[data-role="dispatch"]').innerHTML, 'Delayed <span class="sc__countdown">from</span> and <strong>slow</strong> <span class="sc__dispatch">Thursday 22 Oct</span>');
  p.close();
});

const withDelivery = (changes = {}) => ({ ...config, delivery: deliveryOn(changes) });

test("the delivery options box is written by the server with the shopper's services, and only when there is something to offer", async () => {
  const html = visible(await render({ cfg: withDelivery() }));
  assert.match(html, /<details class="sc__delivery" data-role="delivery">\s*<summary class="sc__delivery-heading">Delivery options<\/summary>\s*<ul class="sc__delivery-list" data-role="delivery-list"><\/ul>\s*<\/details>/);
  assert.match(html, /data-delivery-currency="GBP"/);
  const json = JSON.parse(/<script type="application\/json" data-services>([\s\S]*?)<\/script>/.exec(await render({ cfg: withDelivery() }))[1]);
  assert.deepEqual(json.map(service => service.name), ["DPD Next Working Day Delivery", "Amazon 2 Day (Order Before 2pm) Non Guaranteed"], "this shopper's own country's services");
  assert.deepEqual(json[0].tiers, serviceTable.zones.z0.services[0].tiers);
  const ireland = await render({ cfg: withDelivery(), country: { iso_code: "IE", name: "Ireland" } });
  assert.doesNotMatch(ireland, /sc__delivery|data-services/, "a named zone with nothing to offer does not borrow rest of world's");
  const elsewhere = await render({ cfg: withDelivery(), country: { iso_code: "US", name: "United States" } });
  assert.deepEqual(JSON.parse(/data-services>([\s\S]*?)<\/script>/.exec(elsewhere)[1]).map(service => service.name), ["International"], "a country in no zone uses rest of world");
  assert.doesNotMatch(await render({ cfg: withDelivery({ enabled: false }) }), /sc__delivery|data-services/, "switched off");
  assert.doesNotMatch(await render({ cfg: config }), /sc__delivery|data-services/, "settings saved before delivery options existed");
  assert.doesNotMatch(await render({ cfg: withDelivery(), services: null }), /sc__delivery/, "before shipping has been read");
  assert.doesNotMatch(await render({ cfg: withDelivery(), currency: "EUR" }), /sc__delivery/, "a cart in another currency: prices are not converted");
  assert.doesNotMatch(await render({ cfg: withDelivery(), services: { ...serviceTable, restOfWorld: null }, country: { iso_code: "US", name: "United States" } }), /sc__delivery/, "no zone for them at all");
});

test("the button's position and size are written on the box, and settings saved before they existed still work", async () => {
  const html = visible(await render({ cfg: withDelivery({ buttonAlign: "center", buttonSize: 20 }) }));
  assert.match(html, /<details class="sc__delivery" data-role="delivery" data-button-align="center" style="--sc-delivery-size:20px">/);
  const left = visible(await render({ cfg: withDelivery({ buttonAlign: "left", buttonSize: 16 }) }));
  assert.match(left, /data-button-align="left" style="--sc-delivery-size:16px"/);
  const old = visible(await render({ cfg: withDelivery() }));
  assert.match(old, /<details class="sc__delivery" data-role="delivery">/, "nothing written when it was never set, so the stylesheet's defaults apply");
  assert.doesNotMatch(old, /data-button-align|--sc-delivery-size/);
});

test("the heading can be formatted, and nothing else in it can become markup", async () => {
  const html = visible(await render({ cfg: withDelivery({ heading: "[bold]Delivery[/bold] <img src=x onerror=alert(1)>" }) }));
  assert.match(html, /<summary class="sc__delivery-heading"><strong>Delivery<\/strong> &lt;img src=x onerror=alert\(1\)&gt;<\/summary>/);
  assert.doesNotMatch(html, /<img/);
});

test("in the browser the box lists each service with its price and when it arrives, soonest first", async () => {
  // Tuesday 20 October, 10:00 London, before the 15:00 cut-off.
  const p = await page({ cfg: withDelivery() });
  const rows = () => [...p.document.querySelectorAll(".sc__option")].map(row => [...row.children].map(child => child.textContent));
  assert.deepEqual(rows(), [
    ["DPD Next Day", "£6.99, or £4.99 on orders of £30 or more", "Delivery by Wed 21st Oct"],
    ["Amazon 2 Day (Order Before 2pm) Non Guaranteed", "£3.99, or free on orders of £30 or more", "Delivery by Thu 22nd Oct (Non-Guaranteed)"],
  ]);
  assert.equal(p.document.querySelector('[data-role="delivery"]').hidden, false);
  assert.equal(p.document.querySelector(".sc__option-name").tagName, "SPAN");
  p.close();
});

test("a service says Non-Guaranteed unless it was set as guaranteed, and uses its own days, cut-off and delivery time", async () => {
  const settings = [
    { name: "DPD Next Working Day Delivery", label: "DPD Next Day", guaranteed: true, cutoffTime: "16:00" },
    { name: "Amazon 2 Day (Order Before 2pm) Non Guaranteed", transitMin: 3, transitMax: 3, days: [false, true, true, true, true, true, true] },
  ];
  const p = await page({ cfg: withDelivery({ services: settings }) });
  const texts = () => [...p.document.querySelectorAll(".sc__option-date")].map(item => item.textContent);
  assert.deepEqual(texts(), ["Delivery by Wed 21st Oct", "Delivery by Fri 23rd Oct (Non-Guaranteed)"], "three business days typed in, instead of Shopify's two");
  // 15:30 London: the shop's 15:00 has passed, but this service's own 16:00 has not.
  p.state.now = Date.parse("2026-10-20T14:30:00Z");
  Object.defineProperty(p.document, "hidden", { value: false });
  p.document.dispatchEvent(new p.window.Event("visibilitychange"));
  assert.deepEqual(texts(), ["Delivery by Wed 21st Oct", "Delivery by Sat 24th Oct (Non-Guaranteed)"], "the guaranteed one goes today; the other waits for tomorrow, three delivery days on, and a Saturday carrier delivers on Saturday");
  p.close();
});

test("the delivery options follow the chosen variant: none for out of stock or zero stock with continue selling, and they come back", async () => {
  const p = await page({ cfg: withDelivery() });
  const box = () => p.document.querySelector('[data-role="delivery"]');
  const id = p.document.querySelector('input[name="id"]');
  const pick = value => { id.value = value; id.dispatchEvent(new p.window.Event("change", { bubbles: true })); };
  assert.equal(box().hidden, false);
  pick("3");
  assert.equal(box().hidden, true, "out of stock");
  assert.equal(p.document.querySelectorAll(".sc__option").length, 0);
  pick("4");
  assert.equal(box().hidden, true, "zero stock, continue selling");
  pick("5");
  assert.equal(box().hidden, false, "stock that is not tracked is never zero");
  pick("1");
  assert.equal(p.document.querySelectorAll(".sc__option").length, 2);
  p.close();
});

test("the box stays open while the list inside it is refreshed", async () => {
  const p = await page({ cfg: withDelivery() });
  const box = p.document.querySelector('[data-role="delivery"]');
  box.open = true;
  const id = p.document.querySelector('input[name="id"]');
  id.value = "2"; id.dispatchEvent(new p.window.Event("change", { bubbles: true }));
  assert.equal(p.document.querySelector('[data-role="delivery"]'), box, "the same box");
  assert.equal(box.open, true, "still open");
  p.state.now = Date.parse("2026-10-20T15:00:00Z");
  Object.defineProperty(p.document, "hidden", { value: false });
  p.document.dispatchEvent(new p.window.Event("visibilitychange"));
  assert.equal(box.open, true);
  assert.match(p.document.querySelector(".sc__option-date").textContent, /Thu 22nd Oct/, "after the cut-off, a day later");
  p.close();
});

test("every delivery date is written in the dispatch day's colour, and the words round it are not", async () => {
  const p = await page({ cfg: withDelivery({ services: [{ name: "DPD Next Working Day Delivery", label: "DPD Next Day", guaranteed: true }] }) });
  const rows = [...p.document.querySelectorAll(".sc__option-date")];
  assert.equal(rows[0].innerHTML, 'Delivery by <span class="sc__dispatch">Wed 21st Oct</span>', "guaranteed: the date only");
  assert.equal(rows[1].innerHTML, 'Delivery by <span class="sc__dispatch">Thu 22nd Oct</span> (Non-Guaranteed)', "(Non-Guaranteed) is not coloured, so it never looks like good news");
  assert.deepEqual(rows.map(row => [...row.querySelectorAll(".sc__dispatch")].map(item => item.textContent)), [["Wed 21st Oct"], ["Thu 22nd Oct"]]);
  p.close();
  const both = await page({ cfg: withDelivery({ estimatedText: "Arrives {from} to {date}, or {from} again", services: [] }) });
  assert.deepEqual([...both.document.querySelector(".sc__option-date").querySelectorAll(".sc__dispatch")].map(item => item.textContent), ["Wed 21st Oct", "Wed 21st Oct", "Wed 21st Oct"], "{from} and {date} alike, every time they are used");
  both.close();
  const none = await page({ cfg: withDelivery({ estimatedText: "Arrives soon, {service}", services: [] }) });
  assert.equal(none.document.querySelector(".sc__option-date").querySelectorAll(".sc__dispatch").length, 0, "no date, nothing coloured");
  assert.equal(none.document.querySelector(".sc__option-date").textContent, "Arrives soon, DPD Next Working Day Delivery");
  none.close();
  const typed = await page({ cfg: withDelivery({ estimatedText: "Typed [date]Wed[/date] by {date}", services: [] }) });
  assert.equal(typed.document.querySelector(".sc__option-date").textContent, "Typed [date]Wed[/date] by Wed 21st Oct", "a [date] typed in a message is only text: the marks are not something that can be typed");
  assert.equal(typed.document.querySelector(".sc__option-date").querySelectorAll(".sc__dispatch").length, 1);
  typed.close();
});

test("in a set order the dropdown lists the services as the app lists them", async () => {
  const listed = name => ({ name, label: "", show: true, guaranteed: false, cutoffTime: "", days: [false, true, true, true, true, true, false], onBankHolidays: false, transitMin: null, transitMax: null });
  const names = async sort => {
    const p = await page({ cfg: withDelivery({ sort, services: [listed("Amazon 2 Day (Order Before 2pm) Non Guaranteed"), listed("DPD Next Working Day Delivery")] }) });
    const found = [...p.document.querySelectorAll(".sc__option-name")].map(item => item.textContent);
    p.close();
    return found;
  };
  assert.deepEqual(await names("soonest"), ["DPD Next Working Day Delivery", "Amazon 2 Day (Order Before 2pm) Non Guaranteed"], "soonest first");
  assert.deepEqual(await names("manual"), ["Amazon 2 Day (Order Before 2pm) Non Guaranteed", "DPD Next Working Day Delivery"], "the order set");
});

test("the delivery messages can be formatted and use the service's name, and dates always carry the month", async () => {
  const p = await page({ cfg: withDelivery({ guaranteedText: "[bold]{service}[/bold]: arrives [highlight]{date}[/highlight]", estimatedText: "Arrives {from} to {date}" }) });
  const rows = [...p.document.querySelectorAll(".sc__option-date")];
  assert.equal(rows[0].innerHTML, '<strong>DPD Next Day</strong>: arrives <span class="sc__dispatch"><span class="sc__countdown">Wed 21st Oct</span></span>');
  assert.equal(rows[1].textContent, "Arrives Thu 22nd Oct to Thu 22nd Oct");
  p.close();
});

test("a cart in another currency hides the delivery options, and a service name from Shopify cannot inject markup", async () => {
  const table = { ...serviceTable, zones: { ...serviceTable.zones, z0: { name: "Domestic", services: [{ name: "<img src=x onerror=alert(1)>Fast", tiers: [{ from: 0, price: 100 }], transit: { minDays: 1, maxDays: 1 } }] } } };
  const p = await page({ cfg: withDelivery({ services: [] }), services: table });
  const name = p.document.querySelector(".sc__option-name");
  assert.equal(name.textContent, "<img src=x onerror=alert(1)>Fast");
  assert.equal(p.document.querySelector(".sc__option img"), null);
  p.document.dispatchEvent(new p.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 0, currency: "EUR" } } }));
  assert.equal(p.document.querySelector('[data-role="delivery"]').hidden, true, "at once, when the cart's currency changes");
  p.document.dispatchEvent(new p.window.CustomEvent("cart:updated", { detail: { resource: { total_price: 0, currency: "GBP" } } }));
  assert.equal(p.document.querySelector('[data-role="delivery"]').hidden, false, "and back again");
  p.close();
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

// ---------------------------------------------------------------- the header banner

const bannerSource = readFileSync("extensions/promotion-engine/blocks/shipping-countdown-banner.liquid", "utf8");
const [bannerTemplate, bannerSchemaPart] = bannerSource.split("{% schema %}");
const bannerSchema = JSON.parse(bannerSchemaPart.split("{% endschema %}")[0]);
const bannerSettings = (changes = {}) => ({ enabled: true, message: "Order in the next {time} for dispatch on {date}", textSize: 14, align: "center", background: "#009edb", text: "#ffffff", highlight: "#ff3d8b", dispatch: "#ffc83d", ...changes });

async function bannerPage({ banner = bannerSettings(), now = "2026-10-20T09:00:00Z", cfg = {}, design = false } = {}) {
  const html = await liquid.parseAndRender(bannerTemplate, {
    app: { metafields: { shipping_countdown: { config: { value: { ...config, ...cfg, banner } } } } },
    block: { id: "template_abc_123", settings: {}, shopify_attributes: "" },
    request: { design_mode: design },
  });
  const dom = new JSDOM(`<body><header>${html}</header></body>`, { url: "https://shop.example/", runScripts: "outside-only" });
  const { window } = dom;
  const state = { now: Date.parse(now) };
  window.Date.now = () => state.now;
  window.eval(script);
  return { html, window, document: window.document, state, close: () => window.close(), banner: () => window.document.querySelector("shipping-countdown-banner") };
}
const said = node => node.querySelector(".scb__line").textContent.replace(/\s+/g, " ").trim();

test("the banner block is placed in the theme's header and has nothing to set in the theme editor", () => {
  assert.equal(bannerSchema.name, "Shipping countdown banner");
  assert.equal(bannerSchema.target, "section");
  assert.equal(bannerSchema.enabled_on, undefined, "any page: it is a header announcement");
  assert.deepEqual(bannerSchema.settings.filter(setting => setting.id), [], "everything is set in the app");
  assert.equal(bannerSchema.javascript, "shipping-countdown.js", "the same script as the product block, so the two never disagree");
  assert.equal(bannerSchema.stylesheet, "shipping-countdown.css");
});

test("the banner shows the time left and the dispatch day, in its own colours, and carries no more than it needs", async () => {
  const p = await bannerPage();
  const banner = p.banner();
  assert.equal(banner.hidden, false);
  assert.equal(said(banner), "Order in the next 5 hours for dispatch on Tuesday 20 Oct");
  assert.equal(banner.querySelector(".sc__countdown").textContent, "5 hours");
  assert.equal(banner.querySelector(".sc__dispatch").textContent, "Tuesday 20 Oct");
  assert.equal(banner.getAttribute("data-align"), "center");
  assert.equal(banner.style.getPropertyValue("--scb-size"), "14px");
  assert.equal(banner.style.getPropertyValue("--scb-bg"), "#009edb");
  assert.equal(banner.style.getPropertyValue("--scb-text"), "#ffffff");
  assert.equal(banner.style.getPropertyValue("--scb-highlight"), "#ff3d8b");
  assert.equal(banner.style.getPropertyValue("--scb-dispatch"), "#ffc83d");
  const data = JSON.parse(banner.querySelector("script[data-config]").textContent);
  assert.deepEqual(Object.keys(data).sort(), ["bankHolidays", "banner", "cutoffTime", "delayDays", "delayMessage", "shippingDays"], "no free delivery, services or warning in the header on every page");
  p.close();
});

test("the banner uses the shop's cut-off, shipping days, bank holidays and delay, like the product page", async () => {
  const after = await bannerPage({ now: "2026-10-20T15:00:00Z" });
  assert.equal(said(after.banner()), "Order in the next 23 hours for dispatch on Wednesday 21 Oct", "after the 15:00 BST cut-off");
  after.close();
  const holiday = await bannerPage({ now: "2026-10-20T15:00:00Z", cfg: { bankHolidays: ["2026-10-21"] } });
  assert.match(holiday.banner().textContent, /Thursday 22 Oct/, "a bank holiday is skipped");
  holiday.close();
  const delayed = await bannerPage({ cfg: { delayDays: 2 } });
  assert.equal(said(delayed.banner()), "Delayed from Thursday 22 Oct", "the delay message, with the date");
  assert.equal(delayed.banner().querySelector(".sc__countdown").textContent, "from", "highlighted words take the highlight colour");
  delayed.close();
});

test("the banner is hidden when there is nothing true to say, and nothing is written when it is off", async () => {
  const none = await bannerPage({ cfg: { shippingDays: [false, false, false, false, false, false, false] } });
  assert.equal(none.banner().hidden, true, "no dispatch day: no banner on every page");
  none.close();
  const off = await bannerPage({ banner: bannerSettings({ enabled: false }) });
  assert.equal(off.banner(), null);
  assert.equal(off.html.trim(), "");
  off.close();
  const design = await bannerPage({ banner: bannerSettings({ enabled: false }), design: true });
  assert.match(design.html, /Header banner step/, "in the theme editor, a note says how to switch it on");
  design.close();
  const old = await bannerPage({ banner: null });
  assert.equal(old.banner(), null, "settings saved before the banner existed");
  old.close();
});

test("the banner's message is formatted and written without becoming markup, and is kept right by the clock", async () => {
  const p = await bannerPage({ banner: bannerSettings({ message: "<b>Order</b> [bold]now[/bold], {time} left, ships {date}" }) });
  const line = p.document.querySelector(".scb__line");
  assert.equal(line.querySelector("b"), null, "typed markup is only text");
  assert.equal(line.querySelector("strong").textContent, "now");
  assert.equal(line.textContent, "<b>Order</b> now, 5 hours left, ships Tuesday 20 Oct");
  Object.defineProperty(p.document, "hidden", { configurable: true, value: false });
  p.state.now = Date.parse("2026-10-20T13:59:00Z");
  p.window.document.dispatchEvent(new p.window.Event("visibilitychange"));
  assert.match(line.textContent, /1 minute left, ships Tuesday 20 Oct/, "the time is brought up to date when the tab comes back");
  p.state.now = Date.parse("2026-10-20T14:01:00Z");
  p.window.document.dispatchEvent(new p.window.Event("visibilitychange"));
  assert.match(line.textContent, /23 hours 59 minutes left, ships Wednesday 21 Oct/, "and it rolls to the next day");
  p.close();
});

test("the product block and the banner can be on one page", async () => {
  const product = await render();
  const banner = await liquid.parseAndRender(bannerTemplate, { app: { metafields: { shipping_countdown: { config: { value: { ...config, banner: bannerSettings() } } } } }, block: { id: "b", settings: {}, shopify_attributes: "" }, request: { design_mode: false } });
  const dom = new JSDOM(`<body><header>${banner}</header><section class="shopify-section">${product}<form action="/cart/add"><input name="id" value="1"></form></section></body>`, { url: "https://shop.example/", runScripts: "outside-only" });
  dom.window.Date.now = () => Date.parse("2026-10-20T09:00:00Z");
  dom.window.eval(script);
  assert.match(dom.window.document.querySelector("shipping-countdown-banner").textContent, /5 hours/);
  assert.match(dom.window.document.querySelector("shipping-countdown [data-role=dispatch]").textContent, /5 hours/);
  dom.window.close();
});

test("the banner stretches the wrapper Shopify puts round an app block, so a centred flex section cannot shrink it", async () => {
  const html = await liquid.parseAndRender(bannerTemplate, { app: { metafields: { shipping_countdown: { config: { value: { ...config, banner: bannerSettings() } } } } }, block: { id: "b", settings: {}, shopify_attributes: "" }, request: { design_mode: false } });
  const dom = new JSDOM(`<body><div class="shopify-section"><div id="shopify-block-AB" class="shopify-block shopify-app-block">${html}</div><div id="other" class="shopify-block">${html}<p>another thing</p></div></div></body>`, { url: "https://shop.example/", runScripts: "outside-only" });
  dom.window.Date.now = () => Date.parse("2026-10-20T09:00:00Z");
  dom.window.eval(script);
  const wrapper = dom.window.document.getElementById("shopify-block-AB");
  assert.deepEqual(["width", "flex", "alignSelf", "minWidth"].map(name => wrapper.style[name]), ["100%", "1 1 100%", "stretch", "0"]);
  const section = dom.window.document.querySelector(".shopify-section");
  assert.equal(section.style.width, "", "only the block's own wrapper is touched");
  dom.window.close();
  const bare = await bannerPage();
  assert.equal(bare.document.querySelector("header").style.width, "", "no wrapper, nothing to change");
  bare.close();
});

test("before the script runs the banner holds the room its longest message needs, invisibly, so a phone does not shift when it arrives", async () => {
  const html = await liquid.parseAndRender(bannerTemplate, { app: { metafields: { shipping_countdown: { config: { value: { ...config, banner: bannerSettings({ message: "<i>Order</i> [bold]within[/bold] {time} for {date}" }) } } } } }, block: { id: "b", settings: {}, shopify_attributes: "" }, request: { design_mode: false } });
  const line = html.match(/<p class="scb__line"[^>]*>([\s\S]*?)<\/p>/)[1];
  assert.match(line, /^<span class="scb__hold" aria-hidden="true">/, "hidden from the page and from screen readers");
  const text = line.replace(/<[^>]*>/g, "");
  assert.match(text, /23 hours 59 minutes/, "the longest time left");
  assert.match(text, /Wednesday 28 Oct/, "the longest day");
  assert.doesNotMatch(text, /\{time\}|\{date\}|\[bold\]/, "placeholders and tags are filled and removed");
  assert.match(text, /&lt;i&gt;Order&lt;\/i&gt;/, "typed markup is escaped, never written out");
  // The script then replaces the held text with the real message.
  const p = await bannerPage({ banner: bannerSettings({ message: "<i>Order</i> [bold]within[/bold] {time} for {date}" }) });
  assert.equal(p.document.querySelector(".scb__hold"), null);
  assert.equal(p.document.querySelector(".scb__line").textContent, "<i>Order</i> within 5 hours for Tuesday 20 Oct");
  p.close();
});

test("the theme blocks keep braces out of {{ }} outputs, which Shopify's own Liquid parser refuses (the local one is more forgiving)", () => {
  for (const file of ["shipping-countdown.liquid", "shipping-countdown-banner.liquid"]) {
    const source = readFileSync(`extensions/promotion-engine/blocks/${file}`, "utf8").split("{% schema %}")[0];
    for (const output of source.match(/\{\{-?[\s\S]*?-?\}\}/g) ?? []) {
      const inner = output.replace(/^\{\{-?/, "").replace(/-?\}\}$/, "");
      assert.doesNotMatch(inner, /[{}]/, `${file}: ${output.slice(0, 80)}`);
    }
  }
});

test("always open: the delivery options are listed with no button, and with the button they open from one", async () => {
  const closed = await page({ cfg: withDelivery({ alwaysOpen: false }) });
  assert.ok(closed.document.querySelector("details.sc__delivery summary"), "a button by default");
  closed.close();
  const open = await page({ cfg: withDelivery({ alwaysOpen: true, heading: "" }) });
  const box = open.document.querySelector("[data-role=delivery]");
  assert.equal(box.tagName, "DIV", "not a disclosure");
  assert.equal(box.classList.contains("sc__delivery--open"), true);
  assert.equal(open.document.querySelector("summary"), null, "no button, nothing to click");
  assert.equal(box.hidden, false);
  assert.deepEqual([...open.document.querySelectorAll(".sc__option-name")].map(item => item.textContent), ["DPD Next Day", "Amazon 2 Day (Order Before 2pm) Non Guaranteed"], "the same options, listed straight away");
  open.state.now = Date.parse("2026-10-20T09:00:00Z");
  open.close();
  const none = await page({ cfg: withDelivery({ alwaysOpen: true, services: [{ name: "x", show: false }] }), country: { iso_code: "IE", name: "Ireland" } });
  assert.equal(none.document.querySelector("[data-role=delivery]"), null, "and nothing at all where the country has no services to list, as with the button");
  none.close();
});
