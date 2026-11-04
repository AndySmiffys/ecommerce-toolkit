import test from "node:test";
import assert from "node:assert/strict";
import { cardPriceFor, needsCollectionProducts, priceEntryFor, priceProblem, priceRuleFor } from "../app/modules/promotions/design/priceRule";
import { isAutomaticDiscountId } from "../app/modules/promotions/design/discountIdentity";
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

// ---------------------------------------------------------------- the entries the price block reads, and why a promotion has none


function entryOf(node: ShopifyDiscountNode, enabled = true, complete = true, now = Date.parse("2026-10-20T12:00:00Z")) {
  const promotion = mapDiscountToPromotion(node);
  promotion.settings.websiteEnabled = enabled;
  return priceEntryFor(promotion, complete, now);
}
const withCombines = (node: ShopifyDiscountNode, combinesWith: unknown) => { (node.discount as unknown as Record<string, unknown>).combinesWith = combinesWith; return node; };

test("an automatic discount has an entry whether or not it is enabled for the website; a code only when it is", () => {
  assert.equal(entryOf(discount({ code: null }), false)?.c, "", "automatic: not enabled, still shown, because the cart applies it");
  assert.equal(entryOf(discount({ code: null }), true)?.c, "");
  assert.equal(entryOf(discount(), false), null, "a code that is not enabled is not advertised");
  assert.equal(entryOf(discount(), true)?.c, "SAVE20");
});

test("the entry carries the rule, the kind, the dates, the scope and what the discount combines with", () => {
  const node = withCombines(discount({ code: null, items: someProducts }), { productDiscounts: true, orderDiscounts: false, shippingDiscounts: true });
  assert.deepEqual(entryOf(node), { id: "gid://shopify/DiscountNode/1", starts: 1790812800, ends: 0, all: false, products: ["1"], collections: [], variants: [], c: "", price: { t: "p", v: 2000 }, k: "P", cp: true, co: false });
  const order = entryOf(discount({ classes: ["ORDER"], items: everything, code: null }));
  assert.equal(order?.k, "O");
  assert.equal(order?.all, true, "an order discount covers every product");
  assert.deepEqual([order?.cp, order?.co], [false, false], "combines with nothing unless Shopify says so");
  const amount = entryOf(discount({ code: null, value: { __typename: "DiscountAmount", amount: { amount: "5.0", currencyCode: "GBP" }, appliesOnEachItem: true } }));
  assert.deepEqual(amount?.price, { t: "a", v: 500, u: "GBP" });
});

test("a code promotion with no price rule still has an entry, without a price, to keep its place", () => {
  const minimum = { __typename: "DiscountMinimumSubtotal", greaterThanOrEqualToSubtotal: { amount: "30.0", currencyCode: "GBP" } };
  const code = entryOf(discount({ minimum }));
  assert.equal(code?.c, "SAVE20");
  assert.equal("price" in code!, false);
  assert.equal(entryOf(discount({ minimum, code: null })), null, "an automatic discount with no price has nothing to show");
});

test("a promotion that has ended, is for certain customers, cannot be told from the product, or has an unknown scope has no entry", () => {
  const ended = discount({ code: null }); (ended.discount as unknown as { endsAt: string }).endsAt = "2026-10-19T00:00:00Z";
  assert.equal(entryOf(ended), null);
  const future = discount({ code: null }); (future.discount as unknown as { startsAt: string }).startsAt = "2026-12-01T00:00:00Z";
  assert.ok(entryOf(future), "scheduled ones are included: the block checks the dates on the page");
  const expired = discount({ code: null }); (expired.discount as unknown as { status: string }).status = "EXPIRED";
  assert.equal(entryOf(expired), null);
  const customers = discount({ code: null }); (customers.discount as unknown as { context: unknown }).context = { __typename: "DiscountCustomers", customers: [{ id: "gid://shopify/Customer/1", displayName: "A" }] };
  assert.equal(entryOf(customers), null);
  assert.equal(entryOf(discount({ code: null, items: someProducts }), true, false), null, "a list of products Shopify could not give in full");
  assert.ok(entryOf(discount({ code: null, classes: ["ORDER"], items: everything }), true, false), "everything needs no list");
  assert.equal(entryOf(discount({ code: null, value: { __typename: "DiscountOnQuantity", quantity: { quantity: "1" }, effect: { __typename: "DiscountPercentage", percentage: 1 } } })), null, "buy X get Y");
});

test("the reason a promotion has no price rule is said in words, and is empty when it has one", () => {
  const reason = (node: ShopifyDiscountNode) => priceProblem(mapDiscountToPromotion(node));
  assert.equal(reason(discount()), null);
  assert.match(reason(discount({ minimum: { __typename: "DiscountMinimumSubtotal", greaterThanOrEqualToSubtotal: { amount: "30.0", currencyCode: "GBP" } } }))!, /minimum spend or quantity/);
  const customers = discount(); (customers.discount as unknown as { context: unknown }).context = { __typename: "DiscountCustomerSegments", segments: [{ id: "gid://shopify/Segment/1", name: "VIP" }] };
  assert.match(reason(customers)!, /certain customers/);
  assert.match(reason(discount({ value: { __typename: "DiscountAmount", amount: { amount: "5.0", currencyCode: "GBP" }, appliesOnEachItem: false } }))!, /whole order/);
  assert.match(reason(discount({ value: { __typename: "DiscountOnQuantity", quantity: { quantity: "1" }, effect: { __typename: "DiscountPercentage", percentage: 1 } } }))!, /Buy X get Y|could not be read/);
  assert.equal(reason(discount({ value: { __typename: "DiscountPercentage", percentage: 1.5 } })), "Its percentage is not between 0 and 100.");
});

test("the combination settings are read from Shopify, and a discount with none set combines with nothing", () => {
  const read = (combinesWith: unknown) => mapDiscountToPromotion(withCombines(discount(), combinesWith)).shopify.combinations;
  assert.deepEqual(read({ productDiscounts: true, orderDiscounts: false, shippingDiscounts: true }), { productDiscounts: true, orderDiscounts: false, shippingDiscounts: true });
  assert.deepEqual(read(undefined), { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false });
});

test("an automatic discount's id is told from a code discount's, so its changes reach the prices on the product page", () => {
  assert.equal(isAutomaticDiscountId("gid://shopify/DiscountAutomaticNode/123"), true);
  assert.equal(isAutomaticDiscountId("gid://shopify/DiscountCodeNode/123"), false);
  assert.equal(isAutomaticDiscountId("gid://shopify/DiscountNode/123"), false, "the app's own canonical id does not say which kind");
  assert.equal(isAutomaticDiscountId("gid://shopify/DiscountAutomaticNode/abc"), false);
  assert.equal(isAutomaticDiscountId(""), false);
});

const entry = (node: ShopifyDiscountNode) => entryOf(node)!;
const encode = (ids: string[]) => ids.join("+");

test("a product card is given an automatic discount for everything, or for products, and never a code", () => {
  assert.deepEqual(cardPriceFor(entry(discount({ code: null, classes: ["ORDER"], items: everything })), null, encode), { k: "1", s: entry(discount({ code: null })).starts, e: 0, t: "p", v: 2000, a: 1, i: "" });
  assert.deepEqual(cardPriceFor(entry(discount({ code: null })), null, encode), { k: "1", s: entry(discount({ code: null })).starts, e: 0, t: "p", v: 2000, a: 0, i: "1" });
  assert.equal(cardPriceFor({ ...entry(discount({ code: null })), c: "SAVE20" }, null, encode), null, "the shopper has not entered a code on a card");
  const amountOff = cardPriceFor(entry(discount({ code: null, value: { __typename: "DiscountAmount", amount: { amount: "5.0", currencyCode: "GBP" }, appliesOnEachItem: true } })), null, encode);
  assert.deepEqual(amountOff && [amountOff.t, amountOff.v, amountOff.u], ["a", 500, "GBP"]);
});

test("a discount limited to certain variants, or to products nobody could list, is left off the cards rather than claimed", () => {
  const base = entry(discount({ code: null }));
  assert.equal(cardPriceFor({ ...base, products: [], variants: [{ id: "5", product: "1" }] }, null, encode), null);
  assert.equal(cardPriceFor({ ...base, products: [] }, null, encode), null, "nothing to match a card against");
  assert.equal(cardPriceFor({ ...base, products: [], collections: ["9"] }, null, encode), null, "a collection that was not read");
  assert.equal(cardPriceFor({ ...base, products: [], collections: ["9"] }, ["7", "8"], encode)?.i, "7+8", "the products found in the collection");
});

test("only a discount that reaches its products through collections needs the collections read", () => {
  assert.equal(needsCollectionProducts({ ...entry(discount({ code: null })), products: [], collections: ["9"] }), true);
  assert.equal(needsCollectionProducts(entry(discount({ code: null }))), false, "it lists products");
  assert.equal(needsCollectionProducts({ ...entry(discount({ code: null })), products: [], collections: ["9"], c: "SAVE" }), false, "codes are not on cards");
});
