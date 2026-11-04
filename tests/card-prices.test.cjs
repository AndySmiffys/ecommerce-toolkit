const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { Liquid } = require("liquidjs");
const { JSDOM } = require("jsdom");

const priceScript = readFileSync("extensions/promotion-engine/assets/discounted-price.js", "utf8");
const cardScript = readFileSync("extensions/promotion-engine/assets/card-prices.js", "utf8");
const loaderSource = readFileSync("extensions/promotion-engine/blocks/promotion-loader.liquid", "utf8").split("{% schema %}")[0];
const logic = (() => { const m = { exports: {} }; new Function("module", "exports", priceScript)(m, m.exports); return m.exports; })();
const cards = (() => { const m = { exports: {} }; new Function("module", "exports", cardScript)(m, m.exports); return m.exports; })();
const encode = ids => { let previous = 0; return [...ids].sort((a, b) => a - b).map(id => { const delta = id - previous; previous = id; return delta.toString(36); }).join(","); };

const percent = (v, extra = {}) => ({ k: "9", s: 0, e: 0, t: "p", v, a: 1, i: "", ...extra });
const listed = (v, ids, extra = {}) => ({ k: "10", s: 0, e: 0, t: "p", v, a: 0, i: encode(ids), ...extra });

/** A product card as Horizon writes it: the product's id on the card, and its price in the price container. */
function horizonCard(id, { price = "£25.00", compare = null, extra = "" } = {}) {
  const prices = compare
    ? `<span class="price-item__group price-item--regular compare-at-price"><span class="visually-hidden">Regular price&nbsp;</span><bdi>${compare}</bdi></span><span class="price-item__group price"><span class="visually-hidden">Sale price&nbsp;</span><bdi>${price}</bdi></span>`
    : `<span class="price"><bdi>${price}</bdi></span>`;
  return `<product-card class="product-card" data-product-id="${id}"><a href="/products/p${id}">Product ${id}</a><product-price><div ref="priceContainer">${prices}</div></product-price>${extra}</product-card>`;
}

function page(body, promos, cfg = {}) {
  const data = { v: 1, cfg: { format: "£{{amount}}", currency: "GBP", weight: "600", sale: "#b12704", was: "#6b6b6b", saveBg: "#b12704", saveText: "#ffffff", text: "Save {amount} ({percent}%)", ...cfg }, promos };
  const dom = new JSDOM(`<body><script type="application/json" id="promotion-engine-card-prices">${JSON.stringify(data)}</script>${body}</body>`, { url: "https://shop.example/collections/all", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(priceScript);
  dom.window.eval(cardScript);
  const document = dom.window.document;
  const shown = id => {
    const card = document.querySelector(`product-card[data-product-id="${id}"]`);
    if (!card) return null;
    const ours = card.querySelector("[data-pe-card-price]");
    return ours ? { text: ours.textContent, now: ours.querySelector(".pe-cp__now").textContent, was: ours.querySelector(".pe-cp__was").textContent, save: ours.querySelector(".pe-cp__save").textContent, themeHidden: card.querySelector("[data-pe-card-hidden]") !== null } : null;
  };
  return { dom, document, shown, close: () => dom.window.close() };
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("the money a theme wrote is read back in each of Shopify's money formats, and anything that is not one plain price is not read", () => {
  const read = (text, format) => cards.parseMoney(text, format);
  assert.equal(read("£25.00", "£{{amount}}"), 2500);
  assert.equal(read("£1,299.50", "£{{amount}}"), 129950);
  assert.equal(read("$1,299", "${{amount_no_decimals}}"), 129900);
  assert.equal(read("1.299,50 €", "{{amount_with_comma_separator}} €"), 129950);
  assert.equal(read("1.299 €", "{{amount_no_decimals_with_comma_separator}} €"), 129900);
  assert.equal(read("1 299,50 kr", "{{amount_with_space_separator}} kr"), 129950);
  assert.equal(read("CHF 1'299.50", "CHF {{amount_with_apostrophe_separator}}"), 129950);
  assert.equal(read("£25.00 GBP", "£{{amount}}"), 2500, "a currency code after the price");
  assert.equal(read("£5.00 - £10.00", "£{{amount}}"), null, "a range");
  assert.equal(read("From £5.00", "£{{amount}}"), null);
  assert.equal(read("", "£{{amount}}"), null);
  assert.equal(read("Sold out", "£{{amount}}"), null);
});

test("a card gets the discounted price with the old price struck through and what is saved, worked out like the product page", () => {
  const p = page(horizonCard(1), [percent(2000)]);
  assert.deepEqual(p.shown(1), { text: "Sale price £20.00Regular price £25.00Save £5.00 (20%)", now: "£20.00", was: "£25.00", save: "Save £5.00 (20%)", themeHidden: true });
  const priceCard = logic.priceState({ id: 1, price: 2500 }, [{ t: "p", v: 2000, c: "" }], "GBP");
  assert.equal(p.shown(1).now, "£" + (priceCard.auto.price / 100).toFixed(2), "the same price as the Discounted price block gives");
  p.close();
});

test("a half penny rounds up as it does on the product page, and the percentage is a whole number", () => {
  const p = page(horizonCard(1, { price: "£9.99" }), [percent(1000)]);
  assert.equal(p.shown(1).now, "£8.99", "£9.99 less 10% is £8.991");
  assert.equal(p.shown(1).save, "Save £1.00 (10%)");
  p.close();
});

test("an old price made in Shopify stays the struck price, and the discount comes off the price being shown", () => {
  const p = page(horizonCard(1, { price: "£15.00", compare: "£25.00" }), [percent(2000)]);
  assert.deepEqual([p.shown(1).now, p.shown(1).was, p.shown(1).save], ["£12.00", "£25.00", "Save £13.00 (52%)"]);
  p.close();
});

test("only the products a discount covers are changed, and a discount for products ignores the others", () => {
  const p = page(horizonCard(1) + horizonCard(2) + horizonCard(3), [listed(5000, [2])]);
  assert.equal(p.shown(1), null);
  assert.equal(p.shown(2).now, "£12.50");
  assert.equal(p.shown(3), null);
  assert.equal(p.document.querySelectorAll("[data-pe-card-hidden]").length, 1, "the other cards keep the theme's price showing");
  p.close();
});

test("the best of several automatic discounts wins, and one that is not running yet or has ended is ignored", () => {
  const now = Date.now() / 1000;
  const p = page(horizonCard(1), [percent(1000, { k: "a" }), percent(3000, { k: "b" }), percent(5000, { k: "c", s: now + 3600 }), percent(6000, { k: "d", e: now - 60 })]);
  assert.equal(p.shown(1).now, "£17.50", "30% off is the best that is running");
  p.close();
});

test("an amount off each item is only taken off prices in its own currency", () => {
  const amount = { k: "9", s: 0, e: 0, t: "a", v: 500, u: "GBP", a: 1, i: "" };
  const here = page(horizonCard(1), [amount]);
  assert.equal(here.shown(1).now, "£20.00");
  assert.equal(here.shown(1).save, "Save £5.00 (20%)");
  here.close();
  const elsewhere = page(horizonCard(1, { price: "$25.00" }), [amount], { currency: "USD", format: "${{amount}}" });
  assert.equal(elsewhere.shown(1), null, "a £5 rule is not $5");
  elsewhere.close();
});

test("a card whose price cannot be read, a range, or a card with no product id keeps the theme's own price untouched", () => {
  const p = page(horizonCard(1, { price: "£5.00 - £10.00" }) + horizonCard(2, { price: "Sold out" }) + horizonCard(3).replace(' data-product-id="3"', ""), [percent(2000)]);
  for (const id of [1, 2, 3]) assert.equal(p.shown(id), null, `card ${id}`);
  assert.equal(p.document.querySelectorAll("[data-pe-card-hidden]").length, 0);
  assert.equal(p.document.querySelectorAll("[data-pe-card-price]").length, 0);
  p.close();
});

test("a price the theme writes with the currency code keeps it", () => {
  const p = page(horizonCard(1, { price: "£25.00 GBP" }), [percent(2000)]);
  assert.deepEqual([p.shown(1).now, p.shown(1).was], ["£20.00 GBP", "£25.00 GBP"]);
  p.close();
});

test("the saving message is the one set in the app, and nothing in it can become markup", () => {
  const p = page(horizonCard(1), [percent(2000)], { text: "<b>{percent}% off</b>" });
  assert.equal(p.shown(1).save, "<b>20% off</b>", "shown as text");
  assert.equal(p.document.querySelector(".pe-cp__save b"), null);
  p.close();
});

test("cards the theme adds later, and a card whose price the theme changes, are handled; one that stops being discounted gets the theme's price back", async () => {
  const p = page(horizonCard(1), [percent(2000)]);
  p.document.body.insertAdjacentHTML("beforeend", horizonCard(2, { price: "£10.00" }));
  await wait(150);
  assert.equal(p.shown(2).now, "£8.00");
  p.document.querySelector('product-card[data-product-id="1"] bdi').textContent = "£50.00";
  await wait(150);
  assert.equal(p.shown(1).now, "£40.00", "a new variant's price is discounted afresh");
  assert.equal(p.document.querySelectorAll('product-card[data-product-id="1"] [data-pe-card-price]').length, 1, "one price line, not a pile of them");
  p.document.querySelector('product-card[data-product-id="1"] bdi').textContent = "Sold out";
  await wait(150);
  assert.equal(p.shown(1), null);
  assert.equal(p.document.querySelectorAll('product-card[data-product-id="1"] [data-pe-card-hidden]').length, 0, "the theme's own price is visible again");
  p.close();
});

test("without data in the page, or with no discount, the script does nothing", () => {
  const dom = new JSDOM(`<body>${horizonCard(1)}</body>`, { url: "https://shop.example/", runScripts: "outside-only" });
  dom.window.eval(priceScript);
  dom.window.eval(cardScript);
  assert.equal(dom.window.document.querySelector("[data-pe-card-price]"), null);
  dom.window.close();
  const none = page(horizonCard(1), []);
  assert.equal(none.shown(1), null);
  none.close();
});

// ---- the loader embed's markup ----
const liquid = new Liquid();
const render = (look, index, extra = {}) => liquid.parseAndRender(loaderSource, {
  app: { metafields: { promotion_engine: { cardprice_index: { value: index }, cardprice_9: { value: JSON.stringify(percent(2000)) }, cardprice_10: { value: JSON.stringify(listed(5000, [5])) } }, price_display: { config: { value: look } } } },
  shop: { money_format: "£{{amount}}" }, cart: { currency: { iso_code: "GBP" } }, request: { page_type: "collection" }, block: { settings: {} }, routes: { root_url: "/" }, collection: {}, ...extra,
});
const filters = () => { liquid.registerFilter("asset_url", name => `/cdn/${name}`); liquid.registerFilter("stylesheet_tag", url => `<link rel="stylesheet" href="${url}">`); };
filters();

test("the loader puts the card data and scripts in the page only when cards are on and a discount can be shown", async () => {
  const on = await render({ cardsEnabled: true, saleColour: "#111111", cardSavingsText: "{percent}% off" }, { v: 1, keys: ["9", "10"] });
  const dom = new JSDOM(on);
  const data = JSON.parse(dom.window.document.getElementById("promotion-engine-card-prices").textContent);
  assert.deepEqual([data.v, data.cfg.format, data.cfg.currency, data.cfg.sale, data.cfg.text], [1, "£{{amount}}", "GBP", "#111111", "{percent}% off"]);
  assert.deepEqual(data.promos.map(promo => promo.k), ["9", "10"]);
  assert.match(on, /card-prices\.css/);
  assert.ok(on.indexOf("discounted-price.js") < on.indexOf("card-prices.js"), "the sums are loaded first");
  dom.window.close();

  for (const [name, look, index, extra] of [["off", { cardsEnabled: false }, { v: 1, keys: ["9"] }, {}], ["no settings", null, { v: 1, keys: ["9"] }, {}], ["nothing to show", { cardsEnabled: true }, { v: 1, keys: [] }, {}], ["never published", { cardsEnabled: true }, null, {}], ["cart", { cardsEnabled: true }, { v: 1, keys: ["9"] }, { request: { page_type: "cart" } }]]) {
    const html = await render(look, index, extra);
    assert.doesNotMatch(html, /promotion-engine-card-prices|card-prices\.js|discounted-price\.js/, name);
  }
});

test("no output tag in the loader has braces inside a quoted word: Shopify's own Liquid reads the first closing braces as the end of the tag", () => {
  for (const tag of loaderSource.match(/\{\{[\s\S]*?\}\}/g) || []) assert.doesNotMatch(tag, /'[^']*[{}][^']*'/, tag);
});

test("the data a shop's loader writes is what the script reads, end to end", async () => {
  const html = await render({ cardsEnabled: true }, { v: 1, keys: ["9", "10"] });
  const dom = new JSDOM(html.replace(/<script src[^>]*><\/script>/g, "").replace("<promotion-engine-embed", "<promotion-engine-embed") + horizonCard(5) + horizonCard(6), { url: "https://shop.example/", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(priceScript);
  dom.window.eval(cardScript);
  const price = id => dom.window.document.querySelector(`product-card[data-product-id="${id}"] .pe-cp__now`)?.textContent ?? null;
  assert.equal(price(5), "£12.50", "50% from the list beats 20% from the everything rule");
  assert.equal(price(6), "£20.00");
  dom.window.close();
});
