import test from "node:test";
import assert from "node:assert/strict";
import { withDatabase } from "./helpers/database";
import { checkGooglePromotion, googleColumns, googleDraftIssues, googleFeed, googleLimits, googlePromotionId, scopeOf, type GoogleRow } from "../app/modules/promotions/design/googlePromotion";
import { buildGoogleFeed, ensureFeed, feedByToken, googleFeedIsDue, googleStatuses, isSentToGoogle, loadGooglePage, regenerateFeedToken, saveGoogleChoice, setGoogleSelection, setGoogleTitle, skusFor } from "../app/modules/promotions/services/googleFeed.server";
import { bulkGoogle } from "../app/modules/promotions/services/bulkPromotions.server";
import type { ShopifyDiscountNode } from "../app/modules/promotions/types/discount";

const shop = "google-test.myshopify.com";
const now = new Date("2026-10-21T09:00:00Z");

type Discount = ShopifyDiscountNode["discount"];
const node = (id: number, change: Partial<Discount> = {}): ShopifyDiscountNode => ({
  id: `gid://shopify/DiscountNode/${id}`,
  events: { nodes: [] },
  discount: {
    __typename: "DiscountCodeBasic", title: "Halloween 15%", status: "ACTIVE",
    startsAt: "2026-10-20T00:00:00Z", endsAt: "2026-11-02T23:59:00Z",
    codesCount: { count: 1 }, codes: { nodes: [{ code: "HALLOWEEN15" }] },
    context: { __typename: "DiscountBuyerSelectionAll" },
    customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.15 }, items: { __typename: "AllDiscountItems", allItems: true } },
    minimumRequirement: null,
    ...change,
  },
});
const check = (change: Partial<Discount>, options: { title?: string; skus?: { skus: string[]; tooMany: boolean } | null } = {}) => checkGooglePromotion(node(1, change), { title: options.title, skus: options.skus ?? null, now });

test("a percentage code for everything becomes a line of the Google file", () => {
  const { row, issues } = check({});
  assert.deepEqual(issues, []);
  assert.deepEqual(row, { promotion_id: "shopify-1", product_applicability: "all_products", offer_type: "generic_code", long_title: "Halloween 15%", promotion_effective_dates: "2026-10-20T00:00:00+00:00/2026-11-02T23:59:00+00:00", redemption_channel: "online", generic_redemption_code: "HALLOWEEN15", coupon_value_type: "percent_off", percent_off: "15", money_off_amount: "", minimum_purchase_amount: "", buy_this_quantity: "", item_id: "" });
  assert.equal(googlePromotionId("gid://shopify/DiscountCodeNode/42"), "shopify-42");
  assert.throws(() => googlePromotionId("nonsense"));
});

test("amount off, minimum spend, minimum quantity, automatic and free shipping are described the way Google expects", () => {
  const amount = check({ customerGets: { value: { __typename: "DiscountAmount", amount: { amount: "5", currencyCode: "GBP" } }, items: { __typename: "AllDiscountItems", allItems: true } }, minimumRequirement: { __typename: "DiscountMinimumSubtotal", greaterThanOrEqualToSubtotal: { amount: "30", currencyCode: "GBP" } } });
  assert.deepEqual([amount.row?.coupon_value_type, amount.row?.money_off_amount, amount.row?.minimum_purchase_amount], ["money_off", "5.00 GBP", "30.00 GBP"]);
  const quantity = check({ minimumRequirement: { __typename: "DiscountMinimumQuantity", greaterThanOrEqualToQuantity: "3" } });
  assert.equal(quantity.row?.buy_this_quantity, "3");
  const automatic = check({ __typename: "DiscountAutomaticBasic", codes: undefined, codesCount: undefined });
  assert.deepEqual([automatic.row?.offer_type, automatic.row?.generic_redemption_code], ["no_code", ""]);
  const shipping = check({ __typename: "DiscountCodeFreeShipping", customerGets: undefined });
  assert.deepEqual([shipping.row?.coupon_value_type, shipping.row?.offer_type, shipping.row?.product_applicability], ["free_shipping_standard", "generic_code", "all_products"]);
  assert.match(check({ __typename: "DiscountAutomaticFreeShipping", customerGets: undefined, codes: undefined, codesCount: undefined }).issues.join(" "), /needs a code/);
});

test("every way a promotion fails Google's rules is said in plain words, and no line is made for it", () => {
  const cases: Array<[string, Partial<Discount>, RegExp]> = [
    ["buy X get Y", { __typename: "DiscountCodeBxgy" }, /Buy X get Y/],
    ["no start", { startsAt: null }, /no start date/],
    ["no end", { endsAt: null }, /no end date/],
    ["over 183 days", { endsAt: "2027-06-01T00:00:00Z" }, /more than 183 days/],
    ["ended", { startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" }, /has ended/],
    ["certain customers", { context: { __typename: "DiscountCustomerSegments" } }, /certain customers/],
    ["individual codes", { codesCount: { count: 500 } }, /individual codes/],
    ["code too long", { codes: { nodes: [{ code: "A".repeat(21) }] } }, /Its code is 21 characters/],
    ["title too long", { title: "T".repeat(61) }, /title is 61 characters/],
    ["fractional percentage", { customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.155 }, items: { __typename: "AllDiscountItems", allItems: true } } }, /whole number/],
    ["100 percent", { customerGets: { value: { __typename: "DiscountPercentage", percentage: 1 }, items: { __typename: "AllDiscountItems", allItems: true } } }, /1 to 99/],
  ];
  for (const [name, change, message] of cases) {
    const result = check(change);
    assert.equal(result.row, null, name);
    assert.match(result.issues.join(" "), message, name);
  }
  assert.equal(check({}, { title: "Halloween: 15% off costumes" }).row?.long_title, "Halloween: 15% off costumes", "a Google title replaces the discount's");
  assert.equal(check({ title: "T".repeat(61) }, { title: "Short" }).row?.long_title, "Short", "a shorter Google title fixes a long one");
  assert.equal(check({ startsAt: null, endsAt: null, context: { __typename: "DiscountCustomers" } }).issues.length, 3, "all of the reasons, not just the first");
});

test("a promotion on specific products lists their SKUs, up to Google's limit", () => {
  const items = { __typename: "DiscountProducts", products: { nodes: [{ id: "gid://shopify/Product/1", title: "A" }] }, productVariants: { nodes: [{ id: "gid://shopify/ProductVariant/2", title: "M", product: { id: "gid://shopify/Product/3", title: "B" } }] }, collections: { nodes: [{ id: "gid://shopify/Collection/4", title: "C" }], pageInfo: { hasNextPage: true } } };
  const specific = node(1, { customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.1 }, items } });
  assert.deepEqual(scopeOf(specific), { allItems: false, productIds: ["gid://shopify/Product/1"], variantIds: ["gid://shopify/ProductVariant/2"], collectionIds: ["gid://shopify/Collection/4"], complete: false });
  assert.equal(scopeOf(node(1)).allItems, true);
  const listed = checkGooglePromotion(specific, { skus: { skus: ["SKU-1", "SKU-2"], tooMany: false }, now });
  assert.deepEqual([listed.row?.product_applicability, listed.row?.item_id], ["specific_products", "SKU-1,SKU-2"]);
  assert.match(checkGooglePromotion(specific, { skus: { skus: [], tooMany: true }, now }).issues.join(" "), /more than 1000 products/);
  assert.match(checkGooglePromotion(specific, { skus: { skus: [], tooMany: false }, now }).issues.join(" "), /None of its products have a SKU/);
});

test("the file has a header and one tab-separated line per promotion, with stray tabs and line breaks made safe", () => {
  const row = check({ title: "Two\tcolumns\nand a break" }).row as GoogleRow;
  const lines = googleFeed([row]).split("\n");
  assert.equal(lines[0], googleColumns.join("\t"));
  assert.equal(lines.length, 3, "header, one promotion, and the closing line break");
  assert.equal(lines[1].split("\t").length, googleColumns.length);
  assert.match(lines[1], /Two columns and a break/);
  assert.equal(googleFeed([]), googleColumns.join("\t") + "\n", "with nothing chosen it is just the header");
});

/** A stand-in for Shopify: the discounts, the SKUs of products and variants, and a collection's products. */
function fakeShopify(nodes: ShopifyDiscountNode[], extra: { products?: Record<string, Array<string | null>>; variants?: Record<string, string>; collection?: string[]; hasMoreVariants?: string[] } = {}) {
  const asked: string[] = [];
  const admin = { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
    const variables = options?.variables ?? {};
    if (query.includes("GoogleProductSkus")) {
      asked.push("products");
      return Response.json({ data: { nodes: (variables.ids as string[]).map(id => ({ variants: { pageInfo: { hasNextPage: extra.hasMoreVariants?.includes(id) ?? false }, nodes: (extra.products?.[id] ?? []).map(sku => ({ sku })) } })) } });
    }
    if (query.includes("GoogleVariantSkus")) { asked.push("variants"); return Response.json({ data: { nodes: (variables.ids as string[]).map(id => ({ sku: extra.variants?.[id] ?? null })) } }); }
    if (query.includes("CollectionProductIds")) return Response.json({ data: { collection: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: (extra.collection ?? []).map(id => ({ id: `gid://shopify/Product/${id}` })) } } } });
    return Response.json({ data: { discountNode: nodes.find(item => item.id === variables.id) ?? null } });
  } };
  return { admin, asked };
}

test("SKUs are found for products, variants and collections, and a list that is too big or cannot be read is said to be too many", async () => {
  const shopify = fakeShopify([], { products: { "gid://shopify/Product/1": ["A-S", "A-M", null, " "], "gid://shopify/Product/2": ["B-1,B-2", "B-3"], "gid://shopify/Product/9": ["C-1"] }, variants: { "gid://shopify/ProductVariant/7": "V-7" }, collection: ["9"] });
  const found = await skusFor(shopify.admin, { productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"], variantIds: ["gid://shopify/ProductVariant/7"], collectionIds: ["gid://shopify/Collection/1"] }, async () => {});
  assert.deepEqual([...found.skus].sort(), ["A-M", "A-S", "B-3", "C-1", "V-7"], "empty SKUs and a SKU with a comma are left out");
  assert.equal(found.tooMany, false);
  const many = Array.from({ length: 1001 }, (_, index) => `gid://shopify/Product/${index + 100}`);
  assert.equal((await skusFor(fakeShopify([]).admin, { productIds: many, variantIds: [], collectionIds: [] }, async () => {})).tooMany, true, "more products than the limit");
  const wide = fakeShopify([], { products: { "gid://shopify/Product/1": ["X"] }, hasMoreVariants: ["gid://shopify/Product/1"] });
  assert.equal((await skusFor(wide.admin, { productIds: ["gid://shopify/Product/1"], variantIds: [], collectionIds: [] }, async () => {})).tooMany, true, "a product with more variants than one read lists");
});

test("promotions chosen for Google are checked, each result is kept, and the file holds only the ones that pass", async () => withDatabase(async database => {
  const good = node(1);
  const noEnd = node(2, { endsAt: null, title: "No end" });
  const products = node(3, { title: "Costumes", customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.2 }, items: { __typename: "DiscountProducts", products: { nodes: [{ id: "gid://shopify/Product/5", title: "Witch" }] } } } });
  const shopify = fakeShopify([good, noEnd, products], { products: { "gid://shopify/Product/5": ["WITCH-S", "WITCH-M"] } });
  assert.equal(await setGoogleSelection(shop, ["gid://shopify/DiscountCodeNode/1", "gid://shopify/DiscountNode/2", "gid://shopify/DiscountNode/3", "gid://shopify/DiscountNode/404"], true, database), 4);
  assert.equal(await setGoogleSelection(shop, ["gid://shopify/DiscountNode/1"], true, database), 4, "choosing one twice is not two");
  assert.equal(await googleFeedIsDue(shop, 60, database, now.getTime()), true, "nothing built yet");
  assert.deepEqual(await buildGoogleFeed(shopify.admin, shop, database, now, async () => {}), { count: 2 });
  const page = await loadGooglePage(shop, database);
  const byId = Object.fromEntries(page.promotions.map(item => [item.routeId, item]));
  assert.equal(byId["1"].status, "ready");
  assert.equal(byId["1"].label, "Halloween 15%");
  assert.deepEqual([byId["2"].status, byId["2"].issues.length], ["issues", 1]);
  assert.match(byId["2"].issues[0], /no end date/);
  assert.equal(byId["3"].status, "ready");
  assert.match(byId["404"].issues[0], /no longer exists in Shopify/);
  const feed = await feedByToken(page.token, database);
  const lines = feed!.feedText.trim().split("\n");
  assert.equal(lines.length, 3, "the header and the two that pass");
  assert.ok(lines[2].endsWith("WITCH-S,WITCH-M"), "the product promotion lists its SKUs");
  assert.equal(page.count, 2);
  assert.equal(await googleFeedIsDue(shop, 60, database, now.getTime() + 30 * 60000), false);
  assert.equal(await googleFeedIsDue(shop, 60, database, now.getTime() + 90 * 60000), true, "an hour later");
  assert.deepEqual(await googleStatuses(shop, ["gid://shopify/DiscountCodeNode/1", "gid://shopify/DiscountNode/2", "gid://shopify/DiscountNode/77"], database), { "gid://shopify/DiscountNode/1": "ready", "gid://shopify/DiscountNode/2": "issues" });
  assert.equal(await isSentToGoogle(shop, "gid://shopify/DiscountNode/3", database), true);
  assert.equal(await isSentToGoogle("other.myshopify.com", "gid://shopify/DiscountNode/3", database), false);

  // A shorter Google title is kept and used on the next check; taking a promotion off removes it from the file.
  await setGoogleTitle(shop, "gid://shopify/DiscountNode/1", "  Halloween:   15% off  ", database);
  assert.equal((await loadGooglePage(shop, database)).promotions.find(item => item.routeId === "1")!.title, "Halloween: 15% off");
  await assert.rejects(setGoogleTitle(shop, "gid://shopify/DiscountNode/55", "x", database), /not being sent/);
  await setGoogleSelection(shop, ["gid://shopify/DiscountNode/3", "gid://shopify/DiscountNode/2", "gid://shopify/DiscountNode/404"], false, database);
  await buildGoogleFeed(shopify.admin, shop, database, now, async () => {});
  assert.match((await feedByToken(page.token, database))!.feedText, /Halloween: 15% off/);
  assert.equal((await feedByToken(page.token, database))!.feedText.trim().split("\n").length, 2);
}));

test("the file's private address can be replaced, only a well-formed one is looked up, and one build runs at a time", async () => withDatabase(async database => {
  const first = await ensureFeed(shop, database);
  assert.match(first.token, /^[a-f0-9]{48}$/);
  assert.equal((await ensureFeed(shop, database)).token, first.token, "the same address each time");
  const second = await regenerateFeedToken(shop, database);
  assert.notEqual(second.token, first.token);
  assert.equal(await feedByToken(first.token, database), null, "the old address stops working");
  assert.equal((await feedByToken(second.token, database))?.shop, shop);
  for (const bad of ["", "short", "'; drop table", "g".repeat(48)]) assert.equal(await feedByToken(bad, database), null, bad);
  const slow = { graphql: async () => { await new Promise(resolve => setTimeout(resolve, 30)); return Response.json({ data: { discountNode: null } }); } };
  await setGoogleSelection(shop, ["gid://shopify/DiscountNode/1"], true, database);
  const [one, two] = await Promise.all([buildGoogleFeed(slow, shop, database, now, async () => {}), buildGoogleFeed(slow, shop, database, now, async () => {})]);
  assert.equal([one, two].filter(result => result === null).length, 1, "the second call while one runs does nothing");
}));

test("choosing promotions for Google is limited, and another app's discounts are never sent", async () => withDatabase(async database => {
  const many = Array.from({ length: 200 }, (_, index) => `gid://shopify/DiscountNode/${index + 1}`);
  assert.equal(await setGoogleSelection(shop, many, true, database), 200);
  await assert.rejects(setGoogleSelection(shop, ["gid://shopify/DiscountNode/9999"], true, database), /Up to 200/);
  assert.equal(await setGoogleSelection(shop, ["gid://shopify/DiscountNode/1"], true, database), 200, "one already chosen does not count again");
  await database.googlePromotion.deleteMany({});
  await database.discountIndex.create({ data: { shop, discountId: "gid://shopify/DiscountNode/50", numericId: BigInt(50), kind: "code", title: "Welcome", code: "WELCOME-AAAA-BBBB", createdBy: "Dotdigital", other: true } });
  const outcome = await bulkGoogle(shop, true, ["gid://shopify/DiscountNode/50", "gid://shopify/DiscountNode/51"], database as never);
  assert.deepEqual(outcome.done, ["gid://shopify/DiscountNode/51"]);
  assert.match(outcome.failed[0].message, /Dotdigital made this discount/);
  assert.equal((await bulkGoogle(shop, false, ["gid://shopify/DiscountNode/51"], database as never)).done.length, 1);
  assert.equal(googleLimits.skus, 1000);
}));

const draft = (change: Partial<Parameters<typeof googleDraftIssues>[0]> = {}) => googleDraftIssues({ discountType: "order", isCode: true, isCodeList: false, code: "HALLOWEEN15", title: "HALLOWEEN15", googleTitle: "", valueType: "percentage", value: "15", startsAt: "2026-10-20T00:00:00Z", endsAt: "2026-11-02T00:00:00Z", eligibility: "all", now, ...change });

test("the editor says what Google would reject while the promotion is still being written", () => {
  assert.deepEqual(draft(), [], "a code for everyone with whole percentage and dates in range");
  const cases: Array<[string, Parameters<typeof draft>[0], RegExp]> = [
    ["buy X get Y", { discountType: "bxgy" }, /Buy X get Y/],
    ["no dates", { startsAt: null, endsAt: null }, /start date/],
    ["no end", { endsAt: null }, /end date/],
    ["over 183 days", { endsAt: "2027-06-01T00:00:00Z" }, /more than 183 days/],
    ["ended", { startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" }, /has passed/],
    ["segments", { eligibility: "segments" }, /certain customers/],
    ["no code", { code: " " }, /Add a discount code/],
    ["long code", { code: "A".repeat(21) }, /21 characters/],
    ["long title", { title: "T".repeat(61) }, /61 characters/],
    ["fractional percentage", { value: "12.5" }, /whole number/],
    ["100 percent", { value: "100" }, /1 to 99/],
    ["automatic free shipping", { discountType: "shipping", isCode: false }, /needs a code/],
  ];
  for (const [name, change, message] of cases) assert.match(draft(change).join(" "), message, name);
  assert.deepEqual(draft({ title: "T".repeat(61), googleTitle: "Short" }), [], "a shorter title for Google fixes a long one");
  assert.match(draft({ isCodeList: true }).join(" "), /list of individual codes/);
  assert.equal(draft({ valueType: "fixed", value: "12.5" }).length, 0, "an amount off can have pence");
  assert.equal(draft({ discountType: "shipping", valueType: "percentage", value: "" }).length, 0, "free shipping has no percentage to check");
});

test("the choice made in the editor is saved with the promotion: sent with its own title, or taken off, and left alone when none was made", async () => withDatabase(async database => {
  const id = "gid://shopify/DiscountNode/12";
  assert.equal(await saveGoogleChoice(shop, id, undefined, database), false, "no choice: nothing changes");
  assert.equal(await saveGoogleChoice(shop, id, { enabled: "yes" }, database), false, "a choice that is not a yes or no is ignored");
  assert.equal(await isSentToGoogle(shop, id, database), false);
  assert.equal(await saveGoogleChoice(shop, id, { enabled: true, title: "  Halloween:   15% off  " }, database), true);
  assert.equal(await isSentToGoogle(shop, id, database), true);
  const row = (await loadGooglePage(shop, database)).promotions[0];
  assert.deepEqual([row.title, row.status], ["Halloween: 15% off", "pending"], "the title is cleaned and the promotion waits for its check");
  assert.equal(await saveGoogleChoice(shop, id, { enabled: true, title: "" }, database), true);
  assert.equal((await loadGooglePage(shop, database)).promotions[0].title, "", "an empty title goes back to the promotion's own");
  assert.equal(await saveGoogleChoice(shop, id, { enabled: false }, database), true);
  assert.equal(await isSentToGoogle(shop, id, database), false, "taken off");
}));
