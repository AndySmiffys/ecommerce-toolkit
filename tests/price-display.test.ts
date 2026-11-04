import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Liquid } from "liquidjs";
import { autoPlaceholders, codePlaceholders, defaultPriceDisplay, savingsPlaceholders, validatePriceDisplay } from "../app/modules/price/config";
import { loadPriceDisplay, priceNamespace, savePriceDisplay } from "../app/modules/price/config.server";
import { priceVars } from "../app/modules/price/appearance";

const valid = (changes: Record<string, unknown> = {}) => ({ ...defaultPriceDisplay, ...changes });
const errorsOf = (input: unknown) => { const check = validatePriceDisplay(input); assert.equal(check.ok, false); return check.ok ? [] : check.errors; };

test("the defaults are valid, readable, and stay as they are", () => {
  const check = validatePriceDisplay(defaultPriceDisplay);
  assert.equal(check.ok, true);
  assert.deepEqual(check.ok && check.config, defaultPriceDisplay);
  assert.equal(defaultPriceDisplay.showSavings, false, "nothing extra appears until it is turned on");
  assert.equal(defaultPriceDisplay.size, 0, "the theme's own text size");
  assert.equal(defaultPriceDisplay.textColour, "", "the theme's own text colour");
  assert.deepEqual(savingsPlaceholders.map(item => item.name), ["amount", "percent"]);
  assert.deepEqual(codePlaceholders.map(item => item.name), ["price", "code", "amount", "percent"]);
  assert.deepEqual(autoPlaceholders.map(item => item.name), ["price", "amount", "percent"]);
  assert.equal(defaultPriceDisplay.autoText, "{price} with the automatic discount");
  assert.equal(validatePriceDisplay(undefined).ok, true, "nothing saved yet: the defaults");
  const empty = validatePriceDisplay({});
  assert.deepEqual(empty.ok && empty.config, defaultPriceDisplay);
});

test("the messages must be words with only their own placeholders, and the code message must say the price and the code", () => {
  assert.equal(validatePriceDisplay(valid({ savingsText: "{percent}% off" })).ok, true);
  assert.equal(validatePriceDisplay(valid({ savingsText: "You save {amount}, that is {percent}%" })).ok, true);
  assert.equal(validatePriceDisplay(valid({ savingsText: "Sale" })).ok, true, "the saving message needs no placeholder");
  assert.equal(validatePriceDisplay(valid({ codeText: "Use {code} to pay {price}" })).ok, true);
  assert.equal(validatePriceDisplay(valid({ codeText: "{percent}% off with {code}: {price}, you save {amount}" })).ok, true, "what the code takes off can be said");
  assert.equal(validatePriceDisplay(valid({ codeText: "{percent}% off" })).ok, false, "but the price and the code are still needed");
  assert.match(errorsOf(valid({ savingsText: "Save {amont}" })).join(" "), /Saving message uses \{amont\}, which is not a placeholder\. You can use \{amount\}, \{percent\}\./);
  assert.match(errorsOf(valid({ codeText: "{price} with code {cod}" })).join(" "), /Code message uses \{cod\}/);
  assert.match(errorsOf(valid({ codeText: "{price} with a code" })).join(" "), /Code message must include \{code\}/);
  assert.match(errorsOf(valid({ codeText: "With code {code}" })).join(" "), /Code message must include \{price\}/);
  assert.match(errorsOf(valid({ savingsText: "" })).join(" "), /Saving message cannot be empty/);
  assert.match(errorsOf(valid({ codeText: "   " })).join(" "), /Code message cannot be empty/);
  assert.match(errorsOf(valid({ savingsText: "x".repeat(101) })).join(" "), /Saving message must be 100 characters or fewer/);
  const trimmed = validatePriceDisplay(valid({ savingsText: "  Save {amount}  " }));
  assert.equal(trimmed.ok && trimmed.config.savingsText, "Save {amount}");
});

test("sizes, weights and colours are checked, and the price colour may be left to the theme", () => {
  assert.match(errorsOf(valid({ size: 60 })).join(" "), /Text size must be a whole number from 0 to 48/);
  assert.match(errorsOf(valid({ size: "big" })).join(" "), /Text size must be a whole number/);
  assert.match(errorsOf(valid({ margin: -1 })).join(" "), /Space above and below must be a whole number from 0 to 40/);
  assert.match(errorsOf(valid({ weight: "900" })).join(" "), /Font weight is not one of the choices/);
  for (const field of ["saleColour", "wasColour", "saveBackground", "saveText", "codeColour"]) assert.match(errorsOf(valid({ [field]: "red" })).join(" "), /must be a colour such as #b12704/, field);
  assert.match(errorsOf(valid({ textColour: "blue" })).join(" "), /Price colour must be a colour/);
  const theme = validatePriceDisplay(valid({ textColour: "" }));
  assert.equal(theme.ok && theme.config.textColour, "", "empty is the theme's own colour");
  const kept = validatePriceDisplay(valid({ saleColour: "#ABCDEF", size: "18", margin: "4", textColour: "#111111" }));
  assert.deepEqual(kept.ok && [kept.config.saleColour, kept.config.size, kept.config.margin, kept.config.textColour], ["#abcdef", 18, 4, "#111111"], "lower-cased, and numbers read as numbers");
  const all = errorsOf({ savingsText: "{x}", codeText: "{y}", size: 99, saleColour: "z" });
  assert.ok(all.length >= 4, "every problem is reported, not only the first");
});

/** A pretend Shopify holding the app's metafields, noting the namespace each was written under. */
function fakeShopify() {
  const stored = new Map<string, string>();
  const namespaces: string[] = [];
  const admin = { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
    if (query.includes("ShippingMetafieldOwner")) return Response.json({ data: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } } });
    if (query.includes("ShippingMetafieldWrite")) {
      for (const field of options!.variables!.metafields as Array<{ key: string; value: string; namespace: string }>) { stored.set(field.key, field.value); namespaces.push(field.namespace); }
      return Response.json({ data: { metafieldsSet: { metafields: [{ id: "m" }], userErrors: [] } } });
    }
    if (query.includes("ShippingMetafieldRead")) {
      namespaces.push(/namespace: "(\w+)"/.exec(query)![1]);
      const key = /key: "(\w+)"/.exec(query)![1];
      return Response.json({ data: { currentAppInstallation: { metafield: stored.has(key) ? { value: stored.get(key) } : null } } });
    }
    throw new Error(`unexpected query: ${query.slice(0, 40)}`);
  } };
  return { admin, stored, namespaces };
}

test("the settings are saved to the price_display app metafield, read back, and never saved when they are wrong", async () => {
  const { admin, stored, namespaces } = fakeShopify();
  assert.deepEqual(await loadPriceDisplay(admin), { config: defaultPriceDisplay, saved: false }, "nothing saved yet");
  const result = await savePriceDisplay(admin, valid({ showSavings: true, size: "18" }));
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(stored.get("config")!).size, 18);
  assert.ok(namespaces.every(name => name === priceNamespace), "its own namespace, apart from the shipping countdown's");
  assert.equal(priceNamespace, "price_display");
  const loaded = await loadPriceDisplay(admin);
  assert.equal(loaded.saved, true);
  assert.equal(loaded.config.showSavings, true);
  const bad = await savePriceDisplay(admin, valid({ codeText: "nothing" }));
  assert.equal(bad.ok, false);
  assert.equal(JSON.parse(stored.get("config")!).codeText, defaultPriceDisplay.codeText, "the earlier settings are untouched");
  stored.set("config", "{not json");
  assert.deepEqual(await loadPriceDisplay(admin), { config: defaultPriceDisplay, saved: false }, "data that cannot be read is not trusted");
  stored.set("config", JSON.stringify({ ...defaultPriceDisplay, saleColour: "nope" }));
  assert.equal((await loadPriceDisplay(admin)).saved, false, "nor data that no longer validates");
});

test("the shipping countdown's settings are still read and written in its own namespace", async () => {
  const { readAppMetafield, writeAppMetafield, metafieldNamespace } = await import("../app/modules/shipping/appMetafield.server");
  const { admin, namespaces } = fakeShopify();
  await writeAppMetafield(admin, "config", "{}");
  await readAppMetafield(admin, "config");
  assert.deepEqual(namespaces, [metafieldNamespace, metafieldNamespace]);
  assert.equal(metafieldNamespace, "shipping_countdown");
});

// The block's look as the theme writes it (Liquid) and as the preview writes it (priceVars) must be the same variables.
const template = readFileSync("extensions/promotion-engine/blocks/discounted-price.liquid", "utf8").split("{% schema %}")[0];
const liquid = new Liquid();
liquid.registerFilter("money", (value: number) => `£${value / 100}`);
liquid.registerFilter("date", () => "1");
const renderLook = (look: unknown) => liquid.parseAndRender(template, {
  app: { metafields: { promotion_engine: { storefront: { value: null } }, price_display: { config: { value: look } } } },
  product: { id: 1, variants: [], collections: [], selected_or_first_available_variant: { id: 2, price: 1000, compare_at_price: null } },
  cart: { currency: { iso_code: "GBP" } }, shop: { money_format: "£{{amount}}" }, block: { id: "b", shopify_attributes: "" },
});
const styleOf = (html: string) => /<discounted-price[^>]*?style="([^"]*)"/.exec(html)?.[1] ?? null;

test("the preview and the theme block write the same look, variable for variable", async () => {
  for (const config of [defaultPriceDisplay, { ...defaultPriceDisplay, size: 18, weight: "700" as const, margin: 6, textColour: "#111111", saleColour: "#aa0000" }]) {
    const html = await renderLook(config);
    const written = Object.fromEntries((styleOf(html) ?? "").split(";").filter(Boolean).map(part => [part.slice(0, part.indexOf(":")), part.slice(part.indexOf(":") + 1)]));
    assert.deepEqual(written, priceVars(config), `size ${config.size}`);
  }
  assert.equal(styleOf(await renderLook(null)), null, "nothing saved: the stylesheet's own defaults");
  assert.equal("--dp-size" in priceVars(defaultPriceDisplay), false, "the theme's own size is left alone");
});

test("the automatic discount's message must say the price, and uses only its own placeholders", () => {
  assert.equal(validatePriceDisplay(valid({ autoText: "Extra {percent}% off: {price} (save {amount})" })).ok, true);
  assert.equal(validatePriceDisplay(valid({ autoText: "{price} automatically" })).ok, true);
  assert.match(errorsOf(valid({ autoText: "An automatic discount" })).join(" "), /Automatic discount message must include \{price\}/);
  assert.match(errorsOf(valid({ autoText: "{price} with {code}" })).join(" "), /Automatic discount message uses \{code\}, which is not a placeholder\. You can use \{price\}, \{amount\}, \{percent\}\./);
  assert.match(errorsOf(valid({ autoText: "" })).join(" "), /Automatic discount message cannot be empty/);
  assert.match(errorsOf(valid({ autoText: "x{price}".repeat(60) })).join(" "), /Automatic discount message must be 100 characters or fewer/);
  assert.match(errorsOf(valid({ autoColour: "red" })).join(" "), /Automatic discount colour must be a colour/);
  const old = validatePriceDisplay({ ...defaultPriceDisplay, autoText: undefined, autoColour: undefined });
  assert.equal(old.ok && old.config.autoText, defaultPriceDisplay.autoText, "settings saved before this get the defaults");
  assert.equal(old.ok && old.config.autoColour, defaultPriceDisplay.autoColour);
});

test("product cards are off until turned on, and their saving message is checked like the others", () => {
  assert.equal(defaultPriceDisplay.cardsEnabled, false);
  assert.equal(defaultPriceDisplay.cardSavingsText, "Save {amount} ({percent}%)");
  const earlier = validatePriceDisplay({ version: 1, showSavings: true });
  assert.equal(earlier.ok && earlier.config.cardsEnabled, false, "settings saved before cards existed stay valid");
  const on = validatePriceDisplay(valid({ cardsEnabled: true, cardSavingsText: "{percent}% off" }));
  assert.deepEqual(on.ok && [on.config.cardsEnabled, on.config.cardSavingsText], [true, "{percent}% off"]);
  assert.match(errorsOf(valid({ cardSavingsText: "Save {amont}" })).join(" "), /Product card saving message uses \{amont\}/);
  assert.match(errorsOf(valid({ cardSavingsText: " " })).join(" "), /Product card saving message cannot be empty/);
});
