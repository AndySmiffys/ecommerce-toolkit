import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Liquid } from "liquidjs";
import { defaultShippingConfig, defaultShippingStyle } from "../app/modules/shipping/config";
import { styleAttributes, styleText } from "../app/modules/shipping/appearance";

const template = readFileSync("extensions/promotion-engine/blocks/shipping-countdown.liquid", "utf8").split("{% schema %}")[0];
const liquid = new Liquid();
liquid.registerFilter("money_without_trailing_zeros", (value: number) => `£${value / 100}`);
liquid.registerFilter("date", () => "2026-10-20");
const render = (style: unknown) => liquid.parseAndRender(template, {
  app: { metafields: { shipping_countdown: { config: { value: { ...defaultShippingConfig, style } } } } },
  block: { id: "b", settings: {}, shopify_attributes: "" }, cart: { total_price: 0, currency: { iso_code: "GBP" } }, request: { design_mode: false },
  product: { selected_or_first_available_variant: { id: 1, price: 1000 }, variants: [] },
});
const attribute = (html: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(html)?.[1];

// The block's Liquid and the app's preview build the look separately. They must say the same thing.
for (const [name, style] of [
  ["the original look", defaultShippingStyle],
  ["a custom look", { align: "right", showIcon: false, textSize: 21, fontWeight: "700", padding: "roomy", margin: 4, radius: 0, border: "solid", borderWidth: 2, background: "#101820", text: "#ffffff", accent: "#ffcc00", dispatch: "#00aa88", muted: "#cccccc", icon: "#ffffff" }],
] as const) {
  test(`the block and the app's preview agree on ${name}`, async () => {
    const html = await render(style);
    const { data } = styleAttributes(style);
    assert.equal(attribute(html, "style"), styleText(style).split(";").join(";"), "same CSS variables, same order");
    for (const [key, value] of Object.entries(data)) assert.equal(attribute(html, key), value, key);
  });
}

test("the stylesheet reads every variable the app sets, and nothing else is needed", () => {
  const css = readFileSync("extensions/promotion-engine/assets/shipping-countdown.css", "utf8");
  for (const name of Object.keys(styleAttributes(defaultShippingStyle).vars)) assert.ok(css.includes(`var(${name}`), `${name} is used by the stylesheet`);
  for (const value of ["compact", "roomy"]) assert.ok(css.includes(`data-padding="${value}"`), value);
  for (const value of ["solid", "none"]) assert.ok(css.includes(`data-border="${value}"`), value);
  for (const value of ["left", "right"]) assert.ok(css.includes(`data-align="${value}"`), value);
});
