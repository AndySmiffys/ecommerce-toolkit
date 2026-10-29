import test from "node:test";
import assert from "node:assert/strict";
import { priceRuleFor } from "../app/modules/promotions/design/priceRule";
import { mapDiscountToPromotion } from "../app/modules/promotions/mappers/promotionMapper";
import type { ShopifyDiscountNode } from "../app/modules/promotions/types/discount";

type Items = NonNullable<ShopifyDiscountNode["discount"]["customerGets"]>["items"];
const everything: Items = { __typename: "AllDiscountItems", allItems: true };
const someProducts: Items = { __typename: "DiscountProducts", products: { nodes: [{ id: "gid://shopify/Product/1", title: "Cape" }] } };

function discount(changes: { value?: unknown; items?: Items; classes?: string[]; code?: string | null; minimum?: unknown } = {}): ShopifyDiscountNode {
  const automatic = changes.code === null;
  return {
    id: `gid://shopify/Discount${automatic ? "Automatic" : "Code"}Node/1`, events: { nodes: [] },
    discount: {
      __typename: automatic ? "DiscountAutomaticBasic" : "DiscountCodeBasic", title: "Offer", status: "ACTIVE", startsAt: "2026-10-01T00:00:00Z", endsAt: null,
      discountClasses: changes.classes ?? ["PRODUCT"],
      ...(automatic ? {} : { codes: { nodes: [{ code: changes.code ?? "SAVE20" }] } }),
      context: { __typename: "DiscountBuyerSelectionAll", all: "ALL" },
      customerGets: { value: changes.value ?? { __typename: "DiscountPercentage", percentage: 0.2 }, items: changes.items ?? someProducts },
      ...(changes.minimum ? { minimumRequirement: changes.minimum } : {}),
    },
  } as ShopifyDiscountNode;
}
const rule = (node: ShopifyDiscountNode) => priceRuleFor(mapDiscountToPromotion(node));

test("a percentage off products becomes a rule in hundredths of a percent, with the code if there is one", () => {
  assert.deepEqual(rule(discount()), { t: "p", v: 2000, c: "SAVE20" });
  assert.deepEqual(rule(discount({ code: null })), { t: "p", v: 2000, c: "" }, "automatic: no code");
  assert.deepEqual(rule(discount({ value: { __typename: "DiscountPercentage", percentage: 0.125 } })), { t: "p", v: 1250, c: "SAVE20" });
  assert.deepEqual(rule(discount({ value: { __typename: "DiscountPercentage", percentage: 0.333 } }))?.v, 3330);
  assert.equal(rule(discount({ value: { __typename: "DiscountPercentage", percentage: 0 } })), null, "nothing off is not a rule");
  assert.equal(rule(discount({ value: { __typename: "DiscountPercentage", percentage: 1.5 } })), null, "more than all of it is not a rule");
});

test("a percentage off the whole order is the same percentage off every product", () => {
  assert.deepEqual(rule(discount({ classes: ["ORDER"], items: everything, code: null })), { t: "p", v: 2000, c: "" });
});

test("an amount off each item becomes a rule in minor units; an amount off the whole order does not", () => {
  const each = { __typename: "DiscountAmount", amount: { amount: "5.0", currencyCode: "GBP" }, appliesOnEachItem: true };
  assert.deepEqual(rule(discount({ value: each })), { t: "a", v: 500, c: "SAVE20", u: "GBP" });
  assert.deepEqual(rule(discount({ value: { ...each, amount: { amount: "2.49", currencyCode: "GBP" } }, code: null })), { t: "a", v: 249, c: "", u: "GBP" });
  assert.equal(rule(discount({ value: { ...each, appliesOnEachItem: false } })), null, "a total off the products is shared out in the cart");
  assert.equal(rule(discount({ value: each, classes: ["ORDER"], items: everything })), null, "an amount off the order is spread over what is in the cart");
  assert.equal(rule(discount({ value: { ...each, amount: { amount: "0", currencyCode: "GBP" } } })), null);
});

test("discounts whose price depends on the cart, or that are not a plain amount off, have no rule", () => {
  assert.equal(rule(discount({ minimum: { __typename: "DiscountMinimumSubtotal", greaterThanOrEqualToSubtotal: { amount: "30.0", currencyCode: "GBP" } } })), null, "a minimum spend");
  assert.equal(rule(discount({ minimum: { __typename: "DiscountMinimumQuantity", greaterThanOrEqualToQuantity: "2" } })), null, "a minimum quantity");
  assert.equal(rule(discount({ value: { __typename: "DiscountOnQuantity", quantity: { quantity: "1" }, effect: { __typename: "DiscountPercentage", percentage: 1 } } })), null, "buy X get Y");
});
