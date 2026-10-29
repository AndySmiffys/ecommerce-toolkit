const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { Liquid } = require("liquidjs");
const { JSDOM } = require("jsdom");

const blockSource = readFileSync("extensions/promotion-engine/blocks/discounted-price.liquid", "utf8");
const [blockTemplate, schemaPart] = blockSource.split("{% schema %}");
const schema = JSON.parse(schemaPart.split("{% endschema %}")[0]);
const script = readFileSync("extensions/promotion-engine/assets/discounted-price.js", "utf8");
const logic = (() => { const m = { exports: {} }; new Function("module", "exports", script)(m, m.exports); return m.exports; })();

// Shopify's money filter, for a shop whose money format is "£{{amount}}": minor units written with pence.
const money = minor => `£${(Number(minor) / 100).toFixed(2)}`;
const liquid = new Liquid();
liquid.registerFilter("money", money);
liquid.registerFilter("date", () => String(Date.parse("2026-10-20T12:00:00Z") / 1000));

const variants = [
  { id: 11, price: 2000, compare_at_price: null },
  { id: 12, price: 3333, compare_at_price: null },
  { id: 13, price: 1500, compare_at_price: 2500 },
  { id: 14, price: 999, compare_at_price: null },
];
const product = { id: 7, variants, collections: [{ id: 70 }], selected_or_first_available_variant: variants[0] };
const percent = (v, c = "", extra = {}) => ({ key: "p" + v + c, starts: 0, ends: 0, all: true, price: { t: "p", v, c }, ...extra });
const amount = (v, c = "", extra = {}) => ({ key: "a" + v + c, starts: 0, ends: 0, all: true, price: { t: "a", v, c, u: "GBP" }, ...extra });

async function render({ promotions = [], scopes = {}, look = null, selected = variants[0], currency = "GBP", version = 3, priceRules = 1, item = product } = {}) {
  const metafields = Object.fromEntries(Object.entries(scopes).map(([key, value]) => [`scope_${key}`, { value }]));
  return liquid.parseAndRender(blockTemplate, {
    app: { metafields: { promotion_engine: { storefront: { value: { version, priceRules, promotions } }, ...metafields }, price_display: { config: { value: look } } } },
    product: { ...item, selected_or_first_available_variant: selected },
    cart: { currency: { iso_code: currency } },
    shop: { money_format: "£{{amount}}" },
    block: { id: "b", shopify_attributes: "" },
  });
}
async function page(options = {}) {
  const html = await render(options);
  const form = `<form action="/cart/add"><input name="id" value="${(options.selected || variants[0]).id}"></form>`;
  const dom = new JSDOM(`<body><section>${html}${form}</section></body>`, { url: "https://shop.example/products/x", runScripts: "outside-only" });
  dom.window.eval(script);
  const host = dom.window.document.querySelector("discounted-price");
  const choose = id => { dom.window.document.querySelector("input[name=id]").value = String(id); dom.window.document.dispatchEvent(new dom.window.Event("change", { bubbles: true })); };
  // The input's change must come from the input itself for the element to see which one.
  const pick = id => { const input = dom.window.document.querySelector("input[name=id]"); input.value = String(id); input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); };
  const shown = () => ({
    now: host.querySelector(".dp__now")?.textContent, was: host.querySelector(".dp__was")?.textContent ?? null, save: host.querySelector(".dp__save")?.textContent ?? null,
    code: host.querySelector(".dp__code").hidden ? null : host.querySelector(".dp__code").textContent,
  });
  return { html, dom, host, pick, choose, shown, close: () => dom.window.close() };
}
const state = (variant, rules, currency = "GBP") => logic.priceState(variant, rules, currency);

test("the block is placed on the product page and has nothing to set in the theme editor", () => {
  assert.equal(schema.name, "Discounted price");
  assert.equal(schema.target, "section");
  assert.deepEqual(schema.enabled_on, { templates: ["product"] });
  assert.deepEqual(schema.settings.filter(setting => setting.id), [], "its look and wording are set in the app");
  assert.equal(schema.javascript, "discounted-price.js");
  assert.equal(schema.stylesheet, "discounted-price.css");
});

test("with no discount it shows the standard price, and the compare-at price as the old one", async () => {
  const plain = await page();
  assert.deepEqual(plain.shown(), { now: "£20.00", was: null, save: null, code: null });
  assert.doesNotMatch(plain.html, /dp__now--sale/);
  plain.close();
  const sale = await page({ selected: variants[2] });
  assert.deepEqual(sale.shown(), { now: "£15.00", was: "£25.00", save: null, code: null }, "Shopify's own compare-at price");
  sale.close();
  const old = await page({ priceRules: 0, promotions: [percent(2000)] });
  assert.equal(old.shown().now, "£20.00", "settings published before the price rules existed change nothing");
  old.close();
  const none = await page({ version: 2, promotions: [percent(2000)] });
  assert.equal(none.shown().now, "£20.00");
  none.close();
});

test("an automatic percentage off shows the price after it, the old price, and what is saved", async () => {
  const p = await page({ promotions: [percent(2000)], look: { showSavings: true, savingsText: "Save {amount} ({percent}%)" } });
  assert.deepEqual(p.shown(), { now: "£16.00", was: "£20.00", save: "Save £4.00 (20%)", code: null });
  assert.match(p.html, /dp__now dp__now--sale/);
  assert.match(p.html, /<span class="dp__sr">Sale price <\/span>/, "which price is which, for screen readers");
  assert.match(p.html, /<span class="dp__sr">Regular price <\/span>/);
  p.close();
  const quiet = await page({ promotions: [percent(2000)] });
  assert.equal(quiet.shown().save, null, "the saving line is off until it is switched on");
  quiet.close();
});

test("the best of several automatic discounts is the one shown, and a better compare-at price is kept as the old price", async () => {
  const p = await page({ promotions: [percent(1000), percent(2500, "", { key: "best" }), amount(100)] });
  assert.equal(p.shown().now, "£15.00");
  p.close();
  const compared = await page({ selected: variants[2], promotions: [percent(1000)] });
  assert.deepEqual(compared.shown(), { now: "£13.50", was: "£25.00", save: null, code: null }, "10% off £15.00, against the £25.00 it was");
  compared.close();
});

test("an amount off each item is taken off, never below nothing, and only in its own currency", async () => {
  const p = await page({ promotions: [amount(500)] });
  assert.equal(p.shown().now, "£15.00");
  p.close();
  const free = await page({ selected: variants[3], promotions: [amount(5000)] });
  assert.equal(free.shown().now, "£0.00");
  free.close();
  const euros = await page({ currency: "EUR", promotions: [amount(500)] });
  assert.equal(euros.shown().now, "£20.00", "a fixed amount in pounds is not taken off a price in euros");
  euros.close();
  const percentage = await page({ currency: "EUR", promotions: [percent(1000)] });
  assert.equal(percentage.shown().now, "£18.00", "a percentage is the same in any currency");
  percentage.close();
});

test("a code discount is shown as the price with the code, and only when it is better than the price shown", async () => {
  const p = await page({ promotions: [percent(2500, "SAVE25")], look: { codeText: "{price} with code {code}" } });
  assert.deepEqual(p.shown(), { now: "£20.00", was: null, save: null, code: "£15.00 with code SAVE25" }, "the price itself does not change until the code is used");
  assert.equal(p.host.querySelector(".dp__code").hidden, false);
  p.close();
  const worse = await page({ promotions: [percent(3000), percent(1000, "TEN")] });
  assert.equal(worse.shown().code, null, "an automatic discount that is already better");
  assert.equal(worse.shown().now, "£14.00");
  worse.close();
  const best = await page({ promotions: [percent(1000, "TEN"), percent(2000, "TWENTY"), amount(100, "LESS")] });
  assert.equal(best.shown().code, "£16.00 with code TWENTY", "the best code");
  best.close();
  const both = await page({ promotions: [percent(1000), percent(2500, "SAVE25")] });
  assert.deepEqual(both.shown(), { now: "£18.00", was: "£20.00", save: null, code: "£15.00 with code SAVE25" });
  both.close();
});

test("only the products a discount covers get its rule: products, collections, variants, dates, and everything", async () => {
  const scoped = (key, scope, extra = {}) => ({ promotions: [{ key, starts: 0, ends: 0, all: false, price: { t: "p", v: 1000, c: "" }, ...extra }], scopes: { [key]: scope } });
  const price = async options => { const p = await page(options); const value = p.shown().now; p.close(); return value; };
  assert.equal(await price(scoped("s1", { products: ["7"] })), "£18.00", "this product");
  assert.equal(await price(scoped("s2", { products: ["8"] })), "£20.00", "another product");
  assert.equal(await price(scoped("s3", { collections: ["70"] })), "£18.00", "a collection it is in");
  assert.equal(await price(scoped("s4", { collections: ["71"] })), "£20.00", "a collection it is not in");
  assert.equal(await price(scoped("s5", { variants: [{ id: "11", product: "7" }] })), "£18.00", "this variant");
  assert.equal(await price(scoped("s6", { variants: [{ id: "12", product: "7" }] })), "£20.00", "another variant of the product");
  assert.equal(await price(scoped("s7", { variants: [{ id: "11", product: "9" }] })), "£20.00", "a variant of another product");
  assert.equal(await price(scoped("s8", { products: ["7"] }, { starts: Date.parse("2026-10-21T00:00:00Z") / 1000 })), "£20.00", "not started yet");
  assert.equal(await price(scoped("s9", { products: ["7"] }, { ends: Date.parse("2026-10-19T00:00:00Z") / 1000 })), "£20.00", "already ended");
  assert.equal(await price(scoped("s10", { products: ["7"] }, { ends: Date.parse("2026-10-21T00:00:00Z") / 1000 })), "£18.00", "still running");
  assert.equal(await price({ promotions: [{ key: "x", starts: 0, ends: 0, all: false, price: { t: "p", v: 1000, c: "" } }] }), "£20.00", "no list published for it: not claimed");
  assert.equal(await price({ promotions: [{ key: "n", starts: 0, ends: 0, all: true }] }), "£20.00", "a promotion with no price rule");
});

test("a rule for some variants is sent to the script with those variants named", async () => {
  const p = await page({ promotions: [{ key: "v", starts: 0, ends: 0, all: false, price: { t: "p", v: 1000, c: "" } }], scopes: { v: { variants: [{ id: "12", product: "7" }, { id: "14", product: "7" }, { id: "99", product: "8" }] } } });
  const rules = JSON.parse(p.host.querySelector("script[data-rules]").textContent);
  assert.deepEqual(rules, [{ t: "p", v: 1000, c: "", vs: ["12", "14"] }]);
  assert.equal(p.shown().now, "£20.00", "the first variant is not one of them");
  p.pick(12);
  assert.equal(p.shown().now, "£30.00", "the variant that is: 10% off £33.33");
  p.pick(11);
  assert.equal(p.shown().now, "£20.00");
  p.pick(14);
  assert.equal(p.shown().now, "£8.99", "10% off £9.99");
  p.close();
});

test("choosing another variant rewrites the prices, and going back writes the first one again", async () => {
  const p = await page({ promotions: [percent(2000), percent(5000, "HALF")], look: { showSavings: true } });
  assert.deepEqual(p.shown(), { now: "£16.00", was: "£20.00", save: "Save £4.00", code: "£10.00 with code HALF" });
  p.pick(13);
  assert.deepEqual(p.shown(), { now: "£12.00", was: "£25.00", save: "Save £13.00", code: "£7.50 with code HALF" }, "20% off £15.00 against the £25.00 compare-at");
  p.pick(14);
  assert.deepEqual(p.shown(), { now: "£7.99", was: "£9.99", save: "Save £2.00", code: "£4.99 with code HALF" });
  p.pick(11);
  assert.deepEqual(p.shown(), { now: "£16.00", was: "£20.00", save: "Save £4.00", code: "£10.00 with code HALF" });
  p.close();
});

test("with nothing discounted the line is the plain price again after a variant change", async () => {
  const p = await page({ promotions: [percent(2000, "", { all: false })], scopes: {} });
  p.pick(12);
  assert.deepEqual(p.shown(), { now: "£33.33", was: null, save: null, code: null });
  assert.equal(p.host.querySelector(".dp__now--sale"), null);
  assert.equal(p.host.querySelector(".dp__sr"), null);
  p.close();
});

test("the server's sums and the script's sums agree, to the penny, for any price and discount", async () => {
  const prices = [1, 99, 100, 101, 999, 1234, 3333, 4999, 12345, 99999];
  const rules = [percent(1), percent(333), percent(1250), percent(3330), percent(5000), percent(9999), percent(10000), amount(1), amount(250), amount(100000)];
  for (const price of prices) {
    const item = { id: 90, price, compare_at_price: null };
    for (const rule of rules) {
      const server = await page({ selected: item, item: { ...product, variants: [item] }, promotions: [rule], look: { showSavings: true } });
      const expected = state(item, [rule.price]);
      const shown = server.shown();
      assert.equal(shown.now, money(expected.now), `${price} with ${JSON.stringify(rule.price)}`);
      assert.equal(shown.was, expected.was ? money(expected.was) : null, `was: ${price} with ${JSON.stringify(rule.price)}`);
      if (expected.was) assert.equal(shown.save, `Save ${money(expected.saving)}`, "the saving");
      server.close();
    }
  }
  assert.equal(logic.discounted(1999, { t: "p", v: 1500 }, "GBP"), 1999 - 300, "15% of £19.99 is £2.9985, which is 300p");
  assert.equal(logic.discounted(1000, { t: "p", v: 3333 }, "GBP"), 1000 - 333, "33.33% of £10.00 is 333.3p");
  assert.equal(logic.discounted(1000, { t: "p", v: 3350 }, "GBP"), 1000 - 335, "a half penny rounds up, as Shopify does");
  assert.equal(logic.discounted(5, { t: "a", v: 10, u: "GBP" }, "GBP"), 0);
  assert.equal(logic.discounted(1000, { t: "a", v: 10, u: "GBP" }, "EUR"), null);
});

test("the percentage saved is rounded to a whole number, the same on the server and in the script", async () => {
  const item = { id: 91, price: 3000, compare_at_price: 4500 };
  const p = await page({ selected: item, item: { ...product, variants: [item] }, look: { showSavings: true, savingsText: "{percent}% off" } });
  assert.equal(p.shown().save, "33% off", "£15.00 off £45.00 is 33.3%");
  p.close();
  assert.equal(state(item, []).percent, 33);
  assert.equal(state({ id: 1, price: 1000, compare_at_price: 1500 }, []).percent, 33);
  assert.equal(state({ id: 1, price: 1000, compare_at_price: 1600 }, []).percent, 38, "37.5% rounds up");
  assert.equal(state({ id: 1, price: 1000, compare_at_price: 0 }, []).percent, 0);
});

test("money is written the way the shop's format says, as Shopify's own code does", () => {
  const format = (minor, text) => logic.formatMoney(minor, text);
  assert.equal(format(123456, "£{{amount}}"), "£1,234.56");
  assert.equal(format(123456, "£{{amount_no_decimals}}"), "£1,235");
  assert.equal(format(123456, "{{amount_with_comma_separator}} €"), "1.234,56 €");
  assert.equal(format(123456, "{{amount_no_decimals_with_comma_separator}} €"), "1.235 €");
  assert.equal(format(123456, "{{amount_with_apostrophe_separator}} CHF"), "1'234.56 CHF");
  assert.equal(format(123456, "{{amount_no_decimals_with_space_separator}} kr"), "1 235 kr");
  assert.equal(format(99, "£{{ amount }}"), "£0.99", "spaces inside the braces");
  assert.equal(format(5, ""), "£0.05", "no format given: pounds");
});

test("typed words are filled in without becoming markup, and the lines never contain what the shopper cannot trust", async () => {
  const p = await page({ promotions: [percent(2000), percent(5000, "<b>HALF</b>")], look: { showSavings: true, savingsText: "<i>Save</i> {amount}", codeText: "{code} → {price}" } });
  assert.equal(p.host.querySelector(".dp__save").textContent, "<i>Save</i> £4.00");
  assert.equal(p.host.querySelector("i"), null);
  assert.equal(p.host.querySelector(".dp__code").textContent, "<b>HALF</b> → £10.00");
  p.pick(13);
  assert.equal(p.host.querySelector(".dp__save").textContent, "<i>Save</i> £13.00", "and after a change");
  assert.equal(p.host.querySelector(".dp__code").textContent, "<b>HALF</b> → £7.50");
  assert.equal(p.host.querySelector("b"), null);
  p.close();
});

test("the look is written as variables on the element, and what is not set is left to the theme", async () => {
  const bare = await page();
  assert.equal(bare.host.getAttribute("style"), null, "no settings saved: the stylesheet's own defaults");
  bare.close();
  const set = await page({ look: { margin: 8, size: 20, weight: "700", textColour: "#111111", saleColour: "#aa0000", wasColour: "#888888", saveBackground: "#aa0000", saveText: "#ffffff", codeColour: "#006600", showSavings: false } });
  const style = set.host.style;
  assert.deepEqual(["--dp-margin", "--dp-size", "--dp-weight", "--dp-text", "--dp-sale", "--dp-was", "--dp-save-bg", "--dp-save-text", "--dp-code"].map(name => style.getPropertyValue(name)), ["8px", "20px", "700", "#111111", "#aa0000", "#888888", "#aa0000", "#ffffff", "#006600"]);
  set.close();
  const inherit = await page({ look: { margin: 0, size: 0, weight: "600" } });
  assert.equal(inherit.host.style.getPropertyValue("--dp-size"), "", "size 0 is the theme's own size");
  inherit.close();
});

test("the money format and currency are handed to the script, so it writes prices as the server did", async () => {
  const p = await page({ currency: "GBP" });
  assert.equal(p.host.dataset.moneyFormat, "£{{amount}}");
  assert.equal(p.host.dataset.currency, "GBP");
  assert.equal(p.host.dataset.variantId, "11");
  const data = JSON.parse(p.host.querySelector("script[data-variants]").textContent);
  assert.deepEqual(data.map(item => [item.id, item.price, item.compare_at_price]), [[11, 2000, 0], [12, 3333, 0], [13, 1500, 2500], [14, 999, 0]]);
  p.close();
});

test("the block keeps braces out of {{ }} outputs, which Shopify's own Liquid parser refuses", () => {
  for (const output of blockTemplate.match(/\{\{-?[\s\S]*?-?\}\}/g) ?? []) {
    const inner = output.replace(/^\{\{-?/, "").replace(/-?\}\}$/, "");
    assert.doesNotMatch(inner, /[{}]/, output.slice(0, 80));
  }
});
