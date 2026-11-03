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

// What the app publishes for each promotion the block reads (snapshot.prices). By default a discount combines with nothing, as in Shopify.
const entry = { starts: 0, ends: 0, all: true, k: "P", cp: false, co: false };
const percent = (v, c = "", extra = {}) => ({ key: `p${v}${c}`, ...entry, c, price: { t: "p", v }, ...extra });
const amount = (v, c = "", extra = {}) => ({ key: `a${v}${c}`, ...entry, c, price: { t: "a", v, u: "GBP" }, ...extra });
/** A code promotion with no price rule: it still decides which code is spoken of. */
const unpriced = (c, extra = {}) => ({ key: `n${c}`, ...entry, c, ...extra });
const together = { cp: true, co: true };
/** The rule the script reads for a published entry. */
const ruleOf = item => (item.price ? { ...item.price, c: item.c } : { t: "n", c: item.c });
const ruleWith = item => ({ ...ruleOf(item), k: item.k, cp: item.cp, co: item.co });
const autoLine = minor => `${money(minor)} with the automatic discount`;

async function render({ prices = [], scopes = {}, look = null, selected = variants[0], currency = "GBP", version = 3, priceRules = 2, item = product } = {}) {
  const metafields = Object.fromEntries(Object.entries(scopes).map(([key, value]) => [`scope_${key}`, { value }]));
  return liquid.parseAndRender(blockTemplate, {
    app: { metafields: { promotion_engine: { storefront: { value: { version, priceRules, promotions: [], prices } }, ...metafields }, price_display: { config: { value: look } } } },
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
  const pick = id => { const input = dom.window.document.querySelector("input[name=id]"); input.value = String(id); input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); };
  const line = role => { const node = host.querySelector(`[data-role="${role}"]`); return node.hidden ? null : node.textContent; };
  const shown = () => ({
    now: host.querySelector(".dp__now")?.textContent, was: host.querySelector(".dp__was")?.textContent ?? null, save: host.querySelector(".dp__save")?.textContent ?? null,
    auto: line("auto"), code: line("code"),
  });
  return { html, dom, host, pick, shown, close: () => dom.window.close() };
}
const state = (variant, rules, currency = "GBP") => logic.priceState(variant, rules, currency);
const shownPart = part => async options => { const p = await page(options); const value = p.shown()[part]; p.close(); return value; };
const shownNow = shownPart("now");
const shownAuto = shownPart("auto");
const shownCode = shownPart("code");

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
  assert.deepEqual(plain.shown(), { now: "£20.00", was: null, save: null, auto: null, code: null });
  assert.doesNotMatch(plain.html, /dp__now--sale/);
  plain.close();
  const sale = await page({ selected: variants[2] });
  assert.deepEqual(sale.shown(), { now: "£15.00", was: "£25.00", save: null, auto: null, code: null }, "Shopify's own compare-at price");
  sale.close();
  for (const options of [{ priceRules: 1 }, { priceRules: 0 }, { version: 2 }]) {
    const old = await page({ ...options, prices: [percent(2000)] });
    assert.deepEqual(old.shown(), { now: "£20.00", was: null, save: null, auto: null, code: null }, `settings published before this list existed change nothing: ${JSON.stringify(options)}`);
    old.close();
  }
});

test("a reduction made in Shopify shows the saving, in money and as a whole percentage", async () => {
  const p = await page({ selected: variants[2], look: { showSavings: true, savingsText: "Save {amount} ({percent}%)" } });
  assert.deepEqual(p.shown(), { now: "£15.00", was: "£25.00", save: "Save £10.00 (40%)", auto: null, code: null });
  assert.match(p.html, /dp__now dp__now--sale/);
  assert.match(p.html, /<span class="dp__sr">Sale price <\/span>/, "which price is which, for screen readers");
  assert.match(p.html, /<span class="dp__sr">Regular price <\/span>/);
  p.close();
  const quiet = await page({ selected: variants[2] });
  assert.equal(quiet.shown().save, null, "the saving line is off until it is switched on");
  quiet.close();
});

test("an automatic discount is its own line under the price, and the main price is left as Shopify has it", async () => {
  const p = await page({ prices: [percent(2000)] });
  assert.deepEqual(p.shown(), { now: "£20.00", was: null, save: null, auto: "£16.00 with the automatic discount", code: null }, "the main price is not reduced, and is not marked as a sale");
  assert.doesNotMatch(p.html, /dp__now--sale/);
  assert.equal(p.host.querySelector(".dp__auto").hidden, false);
  p.close();
  // With a reduction made in Shopify as well: the main price and its saving are Shopify's alone, and the automatic discount is on top.
  const both = await page({ selected: variants[2], prices: [percent(2000)], look: { showSavings: true } });
  assert.deepEqual(both.shown(), { now: "£15.00", was: "£25.00", save: "Save £10.00", auto: "£12.00 with the automatic discount", code: null });
  both.close();
});

test("the automatic discount's words can be changed, and say what it takes off", async () => {
  const look = { autoText: "Extra {percent}% off ({amount}) at checkout: {price}" };
  const p = await page({ prices: [percent(2000)], look });
  assert.equal(p.shown().auto, "Extra 20% off (£4.00) at checkout: £16.00");
  p.pick(13);
  assert.equal(p.shown().auto, "Extra 20% off (£3.00) at checkout: £12.00", "against £15.00, the price before any discount, not the £25.00 it was");
  p.pick(12);
  assert.equal(p.shown().auto, "Extra 20% off (£6.67) at checkout: £26.66");
  p.close();
  const typed = await page({ prices: [percent(2000)], look: { autoText: "<b>Now</b> {price}" } });
  assert.equal(typed.shown().auto, "<b>Now</b> £16.00", "typed markup is only text");
  assert.equal(typed.host.querySelector("b"), null);
  typed.close();
});

test("an automatic discount counts whether or not the shop has enabled it for the website, because the cart applies it", async () => {
  // The block is handed every automatic discount; nothing about the website's settings is in what it reads.
  assert.equal(await shownAuto({ prices: [percent(1000)] }), autoLine(1800));
  assert.deepEqual(Object.keys(percent(1000)).sort(), ["all", "c", "co", "cp", "ends", "k", "key", "price", "starts"], "no marketing settings in what the block reads");
});

test("the best of several automatic discounts is the one shown on the line", async () => {
  assert.equal(await shownAuto({ prices: [percent(1000), percent(2500, "", { key: "best" }), amount(100)] }), autoLine(1500));
  const compared = await page({ selected: variants[2], prices: [percent(1000)] });
  assert.deepEqual(compared.shown(), { now: "£15.00", was: "£25.00", save: null, auto: autoLine(1350), code: null }, "10% off £15.00, on its own line beside the £15.00 and the £25.00 it was");
  compared.close();
});

test("an amount off each item is taken off, never below nothing, and only in its own currency", async () => {
  assert.equal(await shownAuto({ prices: [amount(500)] }), autoLine(1500));
  assert.equal(await shownAuto({ selected: variants[3], prices: [amount(5000)] }), autoLine(0));
  assert.equal(await shownAuto({ currency: "EUR", prices: [amount(500)] }), null, "a fixed amount in pounds is not taken off a price in euros");
  assert.equal(await shownAuto({ currency: "EUR", prices: [percent(1000)] }), autoLine(1800), "a percentage is the same in any currency");
});

test("a code discount is shown as the price with the code, on its own line, and only when it is better than the lowest price shown", async () => {
  const p = await page({ prices: [percent(2500, "SAVE25")], look: { codeText: "{price} with code {code}" } });
  assert.deepEqual(p.shown(), { now: "£20.00", was: null, save: null, auto: null, code: "£15.00 with code SAVE25" }, "the price itself does not change until the code is used");
  assert.equal(p.host.querySelector(".dp__code").hidden, false);
  p.close();
  assert.equal(await shownCode({ prices: [percent(3000, "", together), percent(1000, "TEN", together)] }), null, "an automatic discount that is already better");
  assert.equal(await shownAuto({ prices: [percent(3000, "", together), percent(1000, "TEN", together)] }), autoLine(1400));
  const both = await page({ prices: [percent(1000, "", together), percent(2500, "SAVE25", together)] });
  assert.deepEqual(both.shown(), { now: "£20.00", was: null, save: null, auto: autoLine(1800), code: "£15.00 with code SAVE25" }, "each on its own line");
  both.close();
});

test("the {code} in the code message is a button that copies the code, from the first paint and after a variant change", async () => {
  const p = await page({ prices: [percent(2500, "SAVE25")] });
  const copied = [];
  Object.defineProperty(p.dom.window.navigator, "clipboard", { value: { writeText: text => { copied.push(text); return Promise.resolve(); } } });
  const first = p.host.querySelector(".dp__code .dp__copy");
  assert.equal(first.textContent, "SAVE25");
  assert.equal(first.type, "button");
  first.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(copied, ["SAVE25"]);
  assert.equal(first.textContent, "Copied", "says so for a moment");
  p.pick(variants[1].id);
  const again = p.host.querySelector(".dp__code .dp__copy");
  assert.equal(again.dataset.code, "SAVE25", "rebuilt by the script too");
  p.close();
  const hostile = await page({ prices: [percent(2500, '"><b>X</b>')] });
  assert.equal(hostile.host.querySelector(".dp__code b"), null, "a code cannot become markup");
  hostile.close();
  const plain = await page({ prices: [percent(2500, "SAVE25")], look: { codeText: "{price} off with your code" } });
  assert.equal(plain.host.querySelector(".dp__copy"), null, "no {code}, no button");
  plain.close();
});

test("the code spoken of is the first one that covers the product, in the banners' order, never a different one that is cheaper", async () => {
  const codes = [percent(1000, "EXTRA10"), percent(2000, "GFDGDTTG"), amount(100, "LESS")];
  assert.equal(await shownCode({ prices: codes }), "£18.00 with code EXTRA10", "the highest priority promotion's code, though another takes more off");
  assert.equal(await shownCode({ prices: [codes[1], codes[0]] }), "£16.00 with code GFDGDTTG", "the order decides, not the price");
  const skipped = [percent(1000, "FIRST", { all: false }), percent(2000, "SECOND")];
  assert.equal(await shownCode({ prices: skipped, scopes: { p1000FIRST: { products: ["8"] } } }), "£16.00 with code SECOND", "one that does not cover this product is passed over");
  assert.equal(await shownCode({ prices: [unpriced("NOPRICE"), percent(2000, "SECOND")] }), null, "when the first promotion's code has no price to show, nothing is shown in its place");
  assert.equal(await shownCode({ prices: [percent(1000, "TEN", { ends: Date.parse("2026-10-19T00:00:00Z") / 1000 }), percent(2000, "TWENTY")] }), "£16.00 with code TWENTY", "one that has ended is passed over");
});

test("a code is left out when the automatic discount that applies cannot be combined with it", async () => {
  const code = (extra = {}) => percent(2500, "SAVE25", extra);
  const auto = (extra = {}) => percent(1000, "", extra);
  assert.equal(await shownCode({ prices: [auto(together), code(together)] }), "£15.00 with code SAVE25", "both allow it");
  assert.equal(await shownCode({ prices: [auto(), code(together)] }), null, "the automatic discount combines with nothing");
  assert.equal(await shownCode({ prices: [auto(together), code()] }), null, "the code combines with nothing");
  assert.equal(await shownCode({ prices: [auto({ cp: true }), code({ cp: true })] }), "£15.00 with code SAVE25", "product discounts combine with product discounts");
  assert.equal(await shownCode({ prices: [auto({ co: true }), code({ co: true })] }), null, "both only allow order discounts, and both are product discounts");
  assert.equal(await shownCode({ prices: [auto({ co: true }), code({ k: "O", cp: true })] }), "£15.00 with code SAVE25", "an order code with an automatic product discount that allows order discounts, and the code allowing product ones");
  assert.equal(await shownCode({ prices: [auto({ cp: true }), code({ k: "O", cp: true })] }), null, "the automatic discount does not allow an order discount");
  assert.equal(await shownCode({ prices: [auto({ k: "O", co: true }), code({ k: "O", co: true })] }), "£15.00 with code SAVE25", "two order discounts that allow each other");
  // An automatic discount that does not cover this product is not in the way.
  const other = auto({ all: false, key: "elsewhere" });
  assert.equal(await shownCode({ prices: [other, code()], scopes: { elsewhere: { products: ["8"] } } }), "£15.00 with code SAVE25", "an automatic discount on another product does not stop the code");
  // Nor one that does not lower the price: a code can still be used.
  assert.equal(await shownCode({ prices: [percent(0, "", { price: { t: "p", v: 0 } }), code()] }), "£15.00 with code SAVE25");
});

test("the same rules apply in the script when another variant is chosen", () => {
  const rules = items => items.map(ruleWith);
  const v = variants[0];
  const auto = percent(1000), code = percent(2500, "SAVE25");
  assert.equal(state(v, rules([auto, code]), "GBP").code, null, "cannot be combined");
  assert.deepEqual(state(v, rules([{ ...auto, ...together }, { ...code, ...together }]), "GBP").code, { price: 1500, name: "SAVE25", saving: 500, percent: 25 });
  assert.deepEqual(state(v, rules([auto]), "GBP").auto, { price: 1800, saving: 200, percent: 10 });
  assert.equal(state(v, rules([auto]), "GBP").now, 2000, "the main price is never reduced by it");
  assert.equal(state(v, rules([unpriced("X"), percent(2000, "Y")]), "GBP").code, null, "a code without a price takes the place of lower ones");
  assert.equal(state(v, rules([percent(1000, "A"), percent(2000, "B")]), "GBP").code.name, "A", "the first");
  assert.equal(state(v, [{ t: "p", v: 2000, c: "ONLY" }], "GBP").code.name, "ONLY", "rules with no combine information still work when nothing automatic applies");
  assert.equal(state(v, [{ t: "p", v: 1000, c: "" }, { t: "p", v: 2000, c: "ONLY" }], "GBP").code, null, "and are treated as combining with nothing when one does");
  assert.equal(state(v, [], "GBP").auto, null);
});

test("only the products a discount covers get its rule: products, collections, variants, dates, and everything", async () => {
  const scoped = (key, scope, extra = {}) => ({ prices: [{ key, ...entry, all: false, c: "", price: { t: "p", v: 1000 }, ...extra }], scopes: { [key]: scope } });
  const yes = autoLine(1800);
  assert.equal(await shownAuto(scoped("s1", { products: ["7"] })), yes, "this product");
  assert.equal(await shownAuto(scoped("s2", { products: ["8"] })), null, "another product");
  assert.equal(await shownAuto(scoped("s3", { collections: ["70"] })), yes, "a collection it is in");
  assert.equal(await shownAuto(scoped("s4", { collections: ["71"] })), null, "a collection it is not in");
  assert.equal(await shownAuto(scoped("s5", { variants: [{ id: "11", product: "7" }] })), yes, "this variant");
  assert.equal(await shownAuto(scoped("s6", { variants: [{ id: "12", product: "7" }] })), null, "another variant of the product");
  assert.equal(await shownAuto(scoped("s7", { variants: [{ id: "11", product: "9" }] })), null, "a variant of another product");
  assert.equal(await shownAuto(scoped("s8", { products: ["7"] }, { starts: Date.parse("2026-10-21T00:00:00Z") / 1000 })), null, "not started yet");
  assert.equal(await shownAuto(scoped("s9", { products: ["7"] }, { ends: Date.parse("2026-10-19T00:00:00Z") / 1000 })), null, "already ended");
  assert.equal(await shownAuto(scoped("s10", { products: ["7"] }, { ends: Date.parse("2026-10-21T00:00:00Z") / 1000 })), yes, "still running");
  assert.equal(await shownAuto({ prices: [{ key: "x", ...entry, all: false, c: "", price: { t: "p", v: 1000 } }] }), null, "no list published for it: not claimed");
  assert.equal(await shownNow(scoped("s1", { products: ["7"] })), "£20.00", "and the main price is the same either way");
});

test("a rule for some variants is sent to the script with those variants named, and the kind and combine settings", async () => {
  const p = await page({ prices: [{ key: "v", ...entry, ...together, all: false, c: "", price: { t: "p", v: 1000 } }], scopes: { v: { variants: [{ id: "12", product: "7" }, { id: "14", product: "7" }, { id: "99", product: "8" }] } } });
  const rules = JSON.parse(p.host.querySelector("script[data-rules]").textContent);
  assert.deepEqual(rules, [{ t: "p", v: 1000, c: "", k: "P", cp: 1, co: 1, vs: ["12", "14"] }]);
  assert.equal(p.shown().auto, null, "the first variant is not one of them");
  p.pick(12);
  assert.equal(p.shown().auto, autoLine(3000), "the variant that is: 10% off £33.33");
  p.pick(11);
  assert.equal(p.shown().auto, null);
  p.pick(14);
  assert.equal(p.shown().auto, autoLine(899), "10% off £9.99");
  p.close();
});

test("a code promotion with no price is sent to the script as a place-holder, and speaks of nothing", async () => {
  const p = await page({ prices: [unpriced("NOPRICE", { k: "O", co: true }), percent(2000, "NEXT", together)] });
  const rules = JSON.parse(p.host.querySelector("script[data-rules]").textContent);
  assert.deepEqual(rules, [{ t: "n", c: "NOPRICE", k: "O", co: 1 }, { t: "p", v: 2000, c: "NEXT", k: "P", cp: 1, co: 1 }]);
  assert.equal(p.shown().code, null);
  p.pick(13);
  assert.equal(p.shown().code, null, "nor after another variant is chosen");
  p.close();
});

test("choosing another variant rewrites every line, and going back writes the first one again", async () => {
  const p = await page({ prices: [percent(2000, "", together), percent(5000, "HALF", together)], look: { showSavings: true } });
  assert.deepEqual(p.shown(), { now: "£20.00", was: null, save: null, auto: autoLine(1600), code: "£10.00 with code HALF" });
  p.pick(13);
  assert.deepEqual(p.shown(), { now: "£15.00", was: "£25.00", save: "Save £10.00", auto: autoLine(1200), code: "£7.50 with code HALF" }, "20% off £15.00 beside the £25.00 compare-at");
  p.pick(14);
  assert.deepEqual(p.shown(), { now: "£9.99", was: null, save: null, auto: autoLine(799), code: "£4.99 with code HALF" });
  p.pick(11);
  assert.deepEqual(p.shown(), { now: "£20.00", was: null, save: null, auto: autoLine(1600), code: "£10.00 with code HALF" });
  p.close();
});

test("with nothing discounted the lines are gone again after a variant change", async () => {
  const p = await page({ prices: [percent(2000, "", { all: false })], scopes: {} });
  p.pick(12);
  assert.deepEqual(p.shown(), { now: "£33.33", was: null, save: null, auto: null, code: null });
  assert.equal(p.host.querySelector(".dp__now--sale"), null);
  assert.equal(p.host.querySelector(".dp__sr"), null);
  p.close();
});

test("the server's sums and the script's sums agree, to the penny, for any price and discount", async () => {
  const prices = [1, 99, 100, 101, 999, 1234, 3333, 4999, 12345, 99999];
  const rules = [percent(1), percent(333), percent(1250), percent(3330), percent(5000), percent(9999), percent(10000), amount(1), amount(250), amount(100000)];
  const look = { showSavings: true, autoText: "{price}|{amount}|{percent}" };
  for (const price of prices) {
    const item = { id: 90, price, compare_at_price: price + 700 };
    for (const rule of rules) {
      const server = await page({ selected: item, item: { ...product, variants: [item] }, prices: [rule], look });
      const expected = state(item, [ruleOf(rule)]);
      const shown = server.shown();
      assert.equal(shown.now, money(expected.now), `${price} with ${JSON.stringify(rule.price)}`);
      assert.equal(shown.was, expected.was ? money(expected.was) : null, `was: ${price} with ${JSON.stringify(rule.price)}`);
      assert.equal(shown.save, expected.was ? `Save ${money(expected.saving)}` : null, "the saving");
      const text = expected.auto ? `${money(expected.auto.price)}|${money(expected.auto.saving)}|${expected.auto.percent}` : null;
      assert.equal(shown.auto, text, `auto: ${price} with ${JSON.stringify(rule.price)}`);
      server.close();
    }
  }
  assert.equal(logic.discounted(1999, { t: "p", v: 1500 }, "GBP"), 1999 - 300, "15% of £19.99 is £2.9985, which is 300p");
  assert.equal(logic.discounted(1000, { t: "p", v: 3333 }, "GBP"), 1000 - 333, "33.33% of £10.00 is 333.3p");
  assert.equal(logic.discounted(1000, { t: "p", v: 3350 }, "GBP"), 1000 - 335, "a half penny rounds up, as Shopify does");
  assert.equal(logic.discounted(5, { t: "a", v: 10, u: "GBP" }, "GBP"), 0);
  assert.equal(logic.discounted(1000, { t: "a", v: 10, u: "GBP" }, "EUR"), null);
  assert.equal(logic.discounted(1000, { t: "n", c: "X" }, "GBP"), null, "a place-holder takes nothing off");
});

test("the server and the script agree on which code is spoken of and whether it can be shown, for any order and any combine settings", async () => {
  const flags = [{}, { cp: true }, { co: true }, together];
  const kinds = ["P", "O"];
  for (const autoKind of kinds) for (const autoFlags of flags) for (const codeKind of kinds) for (const codeFlags of flags) {
    const auto = percent(1000, "", { k: autoKind, ...autoFlags });
    const code = percent(2500, "SAVE25", { k: codeKind, ...codeFlags });
    const look = { codeText: "{percent}|{amount}|{price}|{code}" };
    const server = await page({ prices: [auto, code], look });
    const expected = state(variants[0], [auto, code].map(ruleWith));
    const text = expected.code ? `${expected.code.percent}|${money(expected.code.saving)}|${money(expected.code.price)}|SAVE25` : null;
    assert.equal(server.shown().code, text, JSON.stringify({ autoKind, autoFlags, codeKind, codeFlags }));
    server.close();
  }
});

test("a code that is no better than the automatic discount is left out even when they can be combined", async () => {
  assert.equal(await shownCode({ prices: [percent(3000, "", together), percent(2000, "TWENTY", together)] }), null, "30% automatic against a 20% code");
  assert.equal(await shownCode({ prices: [percent(2000, "", together), percent(2000, "SAME", together)] }), null, "the same price: nothing to gain");
  assert.equal(await shownCode({ prices: [percent(1000, "", together), percent(2000, "TWENTY", together)] }), "£16.00 with code TWENTY");
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

test("a code message can say what the code takes off, as an amount and a percentage of the price before any discount", async () => {
  const look = { codeText: "{percent}% off ({amount}) with {code}: {price}" };
  const p = await page({ prices: [percent(2500, "SAVE25")], look });
  assert.equal(p.shown().code, "25% off (£5.00) with SAVE25: £15.00");
  p.pick(13);
  assert.equal(p.shown().code, "25% off (£3.75) with SAVE25: £11.25", "against £15.00, not the £25.00 it was");
  p.pick(12);
  assert.equal(p.shown().code, "25% off (£8.33) with SAVE25: £25.00", "25% of £33.33 is £8.3325, 833p after rounding half a penny up");
  p.close();
  const each = await page({ prices: [amount(100, "LESS")], look });
  assert.equal(each.shown().code, "5% off (£1.00) with LESS: £19.00", "an amount, as a percentage of the price");
  each.close();
  const auto = await page({ prices: [percent(1000, "", together), percent(2500, "SAVE25", together)], look });
  assert.equal(auto.shown().auto, autoLine(1800));
  assert.equal(auto.shown().code, "25% off (£5.00) with SAVE25: £15.00", "against the price before the automatic discount, which codes are not added to");
  auto.close();
  const rounded = await page({ selected: variants[1], prices: [percent(1000, "TEN")], look });
  assert.equal(rounded.shown().code, "10% off (£3.33) with TEN: £30.00");
  rounded.close();
});

test("the code message says the same on the server and in the script, to the penny, for any price and code", async () => {
  const look = { codeText: "{percent}|{amount}|{price}|{code}" };
  for (const price of [1, 99, 101, 999, 1234, 3333, 12345]) {
    const item = { id: 95, price, compare_at_price: null };
    for (const rule of [percent(1, "C"), percent(333, "C"), percent(1250, "C"), percent(5000, "C"), amount(1, "C"), amount(250, "C")]) {
      const p = await page({ selected: item, item: { ...product, variants: [item] }, prices: [rule], look });
      const expected = state(item, [ruleOf(rule)]);
      const code = expected.code;
      const text = code ? `${code.percent}|${money(code.saving)}|${money(code.price)}|C` : null;
      assert.equal(p.shown().code, text, `${price} with ${JSON.stringify(rule.price)}`);
      p.close();
    }
  }
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
  const p = await page({ selected: variants[2], prices: [percent(2000, "", together), percent(5000, "<b>HALF</b>", together)], look: { showSavings: true, savingsText: "<i>Save</i> {amount}", codeText: "{code} → {price}" } });
  assert.equal(p.host.querySelector(".dp__save").textContent, "<i>Save</i> £10.00");
  assert.equal(p.host.querySelector("i"), null);
  assert.equal(p.host.querySelector(".dp__code").textContent, "<b>HALF</b> → £7.50");
  p.pick(11);
  assert.equal(p.host.querySelector(".dp__save"), null, "and after a change");
  assert.equal(p.host.querySelector(".dp__code").textContent, "<b>HALF</b> → £10.00");
  p.pick(13);
  assert.equal(p.host.querySelector(".dp__save").textContent, "<i>Save</i> £10.00");
  assert.equal(p.host.querySelector("b"), null);
  p.close();
});

test("the look is written as variables on the element, and what is not set is left to the theme", async () => {
  const bare = await page();
  assert.equal(bare.host.getAttribute("style"), null, "no settings saved: the stylesheet's own defaults");
  bare.close();
  const set = await page({ look: { margin: 8, size: 20, weight: "700", textColour: "#111111", saleColour: "#aa0000", wasColour: "#888888", autoColour: "#0000aa", saveBackground: "#aa0000", saveText: "#ffffff", codeColour: "#006600", showSavings: false } });
  const style = set.host.style;
  assert.deepEqual(["--dp-margin", "--dp-size", "--dp-weight", "--dp-text", "--dp-sale", "--dp-was", "--dp-save-bg", "--dp-save-text", "--dp-auto", "--dp-code"].map(name => style.getPropertyValue(name)), ["8px", "20px", "700", "#111111", "#aa0000", "#888888", "#aa0000", "#ffffff", "#0000aa", "#006600"]);
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
  assert.equal(p.host.dataset.autoText, "{price} with the automatic discount", "the words for the script, as they are for the server");
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
