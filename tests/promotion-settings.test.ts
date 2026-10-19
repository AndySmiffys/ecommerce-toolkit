import { getPriorityPosition, loadPromotionPriorities, savePromotionPriorities } from "../app/modules/promotions/services/promotionPriorities.server";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrismaClient } from "@prisma/client";
import { defaultDesign, readWebsite, websiteStorage, websiteFromSettings, promotionBlock, setPromotionBlock, type WebsiteDraft } from "../app/modules/promotions/design/design";
import { promotionDiscountId } from "../app/modules/promotions/design/discountIdentity";
import { createShopifyPromotion, type CreateDiscountDraft } from "../app/modules/promotions/services/createPromotion.server";
import { getDiscount } from "../app/modules/promotions/services/discount.server";
import { getDiscountsPage } from "../app/modules/promotions/services/discounts.server";
import { buildUpdateDiscountMutation } from "../app/modules/promotions/services/updatePromotion.server";
import { attachPromotionSettings, priorityForSave, updatePromotionWebsiteSettings, getStorefrontPromotionSettings } from "../app/modules/promotions/services/promotionSettings.server";
import { mapDiscountToPromotion } from "../app/modules/promotions/mappers/promotionMapper";
import type { ShopifyDiscountNode } from "../app/modules/promotions/types/discount";

const shop = "design-test.myshopify.com";
function website(): WebsiteDraft {
  return {
    websiteEnabled: true, showProductPage: true, showCollectionPage: true, showProductBadge: true, showCountdown: true, showHeaderBanner: true,
    headline: "Halloween campaign", body: "Costumes for the whole family", badgeText: "20% OFF", countdownText: "Hurry, ends in", buttonText: "Shop costumes", buttonUrl: "/collections/halloween",
    backgroundColour: "#123456", textColour: "#fedcba", badgeColour: "#abcd12", priority: 17,
    design: {
      ...defaultDesign(), preset: "campaign", desktopImage: "https://cdn.shopify.com/desktop.jpg", desktopImageId: "gid://shopify/MediaImage/111", mobileImage: "https://cdn.shopify.com/mobile.jpg", mobileImageId: "gid://shopify/MediaImage/222", imageAlt: "Halloween costumes",
      imageLayout: "full", focalX: 33, focalY: 66, overlay: 60, alignment: "center", bannerHeight: 400, spacing: 36, radius: 14, headingSize: 38, bodySize: 19,
      productOfferStyle: "double", productBorderColour: "#789abc", productBorderWidth: 6, copyCodeEnabled: true, copyCodeBackground: "#321fed", copyCodeColour: "#fabcde", buttonBackground: "#987654", buttonColour: "#fefefe", badgeTextColour: "#345678",
      overrides: { header: { headline: "Header offer", body: "Header body", buttonText: "Header CTA" }, collection: { headline: "Collection offer", body: "Collection body", buttonText: "Collection CTA" }, product: { headline: "Product offer", body: "Product body", buttonText: "Product CTA" }, badge: { headline: "BADGE", body: "Badge body", buttonText: "Badge CTA" } },
    },
  };
}
function draft(): CreateDiscountDraft {
  return { discountType: "order", method: "code", discountCode: "TEST20", automaticTitle: "Test offer", valueType: "percentage", discountValue: "20", appliesTo: "products", selectedProducts: [{ id: "gid://shopify/Product/1" }], selectedCollections: [], buyRequirement: "quantity", buyQuantity: "2", buyAmount: "", buyAppliesTo: "products", buySelection: [{ id: "gid://shopify/Product/1" }], getQuantity: "1", getAppliesTo: "products", getSelection: [{ id: "gid://shopify/Product/2" }], rewardType: "free", rewardValue: "", maxUsesPerOrder: false, usesPerOrder: "1", minimumRequirement: "none", minimumPurchaseAmount: "", minimumQuantity: "", limitTotalUses: false, totalUsageLimit: "", limitOncePerCustomer: false, combineProductDiscounts: false, combineOrderDiscounts: false, combineShippingDiscounts: false, productCombinationMode: "best", selectedCombinationTags: [], startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-31T23:59:00Z", eligibility: "all", selectedEligibility: [], countryMode: "all", countries: [], excludeShippingPrice: false, maximumShippingPrice: "" };
}
function node(id: string, method: "code" | "automatic" = "code"): ShopifyDiscountNode {
  return { id, events: { nodes: [] }, discount: { __typename: method === "code" ? "DiscountCodeBasic" : "DiscountAutomaticBasic", title: "Test offer", status: "ACTIVE", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-31T23:59:00Z", discountClasses: ["ORDER"], codes: method === "code" ? { nodes: [{ code: "TEST20" }] } : undefined, context: { __typename: "DiscountBuyerSelectionAll", all: "ALL" }, customerGets: { value: { __typename: "DiscountPercentage", percentage: .2 }, items: { __typename: "AllDiscountItems", allItems: true } } } };
}
async function withDatabase(run: (database: PrismaClient) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "promotion-settings-"));
  const database = new PrismaClient({ datasources: { db: { url: `file:${join(directory, "settings.sqlite")}` } } });
  try {
    for (const path of ["prisma/migrations/20260722120204_add_promotion_settings/migration.sql", "prisma/migrations/20261008093000_promotion_design/migration.sql"]) {
      for (const statement of readFileSync(path, "utf8").split(";").filter(s => s.trim())) await database.$executeRawUnsafe(statement);
    }
    await run(database);
  } finally { await database.$disconnect(); rmSync(directory, { recursive: true, force: true }); }
}

test("all create discount types retain every website field when reopened and listed with Shopify typed IDs", async () => withDatabase(async database => {
  let sequence = 100;
  for (const method of ["code", "automatic"] as const) for (const discountType of ["product", "order", "bxgy", "shipping"] as const) {
    const rules = { ...draft(), method, discountType };
    const typedId = `gid://shopify/${method === "code" ? "DiscountCodeNode" : "DiscountAutomaticNode"}/${sequence++}`;
    const rawNode = node(typedId, method);
    const savedId = await createShopifyPromotion({ graphql: async () => Response.json({ data: { result: { [method === "code" ? "codeDiscountNode" : "automaticDiscountNode"]: { id: typedId }, userErrors: [] } } }) }, rules);
    const design = readWebsite(website());
    await updatePromotionWebsiteSettings(shop, savedId, websiteStorage(design), database);
    const loaded = await getDiscount({ graphql: async () => Response.json({ data: { discountNode: rawNode } }) }, savedId);
    assert.equal(loaded?.id, savedId);
    const [detail] = await attachPromotionSettings(shop, [mapDiscountToPromotion(loaded!)], database);
    assert.deepEqual(websiteFromSettings(detail.settings), design);
    const listed = (await getDiscountsPage({ graphql: async () => Response.json({ data: { discountNodes: { nodes: [rawNode] } } }) })).nodes;
    const [listPromotion] = await attachPromotionSettings(shop, listed.map(mapDiscountToPromotion), database);
    assert.deepEqual(websiteFromSettings(listPromotion.settings), design);
    // The mapper is safe even when fed a raw Shopify response directly.
    assert.equal(mapDiscountToPromotion(rawNode).id, savedId);
  }
}));

test("older typed-ID saves reload, edits use one key, and other shops or discounts never inherit them", async () => withDatabase(async database => {
  const typedId = "gid://shopify/DiscountCodeNode/42";
  const canonical = promotionDiscountId(typedId);
  const initial = website();
  await database.promotionSettings.create({ data: { shop, shopifyDiscountId: typedId, ...websiteStorage(initial), updatedAt: new Date("2026-10-01") } });
  const promotion = mapDiscountToPromotion(node(typedId));
  const [legacy] = await attachPromotionSettings(shop, [promotion], database);
  assert.deepEqual(websiteFromSettings(legacy.settings), initial);
  const changed = { ...initial, websiteEnabled: false, headline: "Edited offer", design: { ...initial.design, desktopImage: "", desktopImageId: "", radius: 0 } };
  await updatePromotionWebsiteSettings(shop, typedId, websiteStorage(changed), database);
  assert.ok(await database.promotionSettings.findUnique({ where: { shop_shopifyDiscountId: { shop, shopifyDiscountId: canonical } } }));
  const [edited] = await attachPromotionSettings(shop, [promotion], database);
  assert.deepEqual(websiteFromSettings(edited.settings), changed);
  await updatePromotionWebsiteSettings(shop, canonical, websiteStorage(initial), database);
  assert.equal(await database.promotionSettings.count({ where: { shopifyDiscountId: canonical } }), 1);
  const [foreign] = await attachPromotionSettings("another.myshopify.com", [promotion], database);
  assert.equal(foreign.settings.headline, null);
  const [different] = await attachPromotionSettings(shop, [mapDiscountToPromotion(node("gid://shopify/DiscountCodeNode/43"))], database);
  assert.equal(different.settings.designJson, undefined);
}));

test("reopened code and automatic discounts still build valid native updates", async () => {
  for (const method of ["code", "automatic"] as const) {
    const typedId = `gid://shopify/${method === "code" ? "DiscountCodeNode" : "DiscountAutomaticNode"}/42`;
    const loaded = await getDiscount({ graphql: async () => Response.json({ data: { discountNode: node(typedId, method) } }) }, typedId);
    assert.equal(buildUpdateDiscountMutation(loaded!, { ...draft(), method }).variables.id, typedId);
  }
  assert.throws(() => promotionDiscountId("gid://shopify/Product/42"), /Invalid discount ID/);
});


test("independent block controls survive SQLite save, reopen and a second edit", async () => withDatabase(async database => {
  let value = website();
  for (const placement of ["header", "collection", "product", "badge"] as const) {
    const block = promotionBlock(value, placement);
    value = setPromotionBlock(value, placement, { ...block, headline: placement + " text", buttonUrl: "/collections/" + placement, backgroundColour: placement === "header" ? "#abcdef" : "#123456", style: { ...block.style, radius: placement === "product" ? 0 : 12, desktopImage: "https://cdn.shopify.com/" + placement + ".jpg" }, visibility: { ...block.visibility, countdown: placement === "product", body: placement !== "header", button: placement !== "header" } });
  }
  await updatePromotionWebsiteSettings(shop, "gid://shopify/DiscountNode/42", websiteStorage(readWebsite(value)), database);
  const [saved] = await attachPromotionSettings(shop, [mapDiscountToPromotion(node("gid://shopify/DiscountCodeNode/42"))], database);
  const reopened = websiteFromSettings(saved.settings);
  assert.deepEqual(reopened, value);
  const edited = setPromotionBlock(reopened, "product", { ...promotionBlock(reopened, "product"), headline: "Edited product text" });
  await updatePromotionWebsiteSettings(shop, "gid://shopify/DiscountNode/42", websiteStorage(edited), database);
  const [updated] = await attachPromotionSettings(shop, [mapDiscountToPromotion(node("gid://shopify/DiscountCodeNode/42"))], database);
  assert.deepEqual(websiteFromSettings(updated.settings).design.blocks?.header, value.design.blocks?.header);
  assert.equal(websiteFromSettings(updated.settings).design.blocks?.product?.headline, "Edited product text");
}));


test("storefront uses saved priority ahead of creation order and ignores historical aliases", async () => withDatabase(async database => {
  const first = "gid://shopify/DiscountCodeNode/201";
  const latest = "gid://shopify/DiscountNode/202";
  await updatePromotionWebsiteSettings(shop, first, websiteStorage({ ...website(), priority: 0 }), database);
  await updatePromotionWebsiteSettings(shop, latest, websiteStorage({ ...website(), priority: 0 }), database);
  assert.equal((await getStorefrontPromotionSettings(shop, "showHeaderBanner", database))[0].shopifyDiscountId, latest);
  await updatePromotionWebsiteSettings(shop, first, websiteStorage({ ...website(), priority: 100 }), database);
  for (const flag of ["showHeaderBanner", "showCollectionPage", "showProductPage", "showProductBadge"] as const) {
    const ranked = await getStorefrontPromotionSettings(shop, flag, database);
    assert.equal(ranked[0].shopifyDiscountId, promotionDiscountId(first));
    assert.equal(ranked[0].priority, 100);
  }
  await database.promotionSettings.create({ data: { shop, shopifyDiscountId: first, ...websiteStorage({ ...website(), priority: 9999 }), updatedAt: new Date("2020-01-01") } });
  const ranked = await getStorefrontPromotionSettings(shop, "showHeaderBanner", database);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].priority, 100);
  await updatePromotionWebsiteSettings(shop, first, websiteStorage({ ...website(), priority: 100, websiteEnabled: false }), database);
  assert.deepEqual((await getStorefrontPromotionSettings(shop, "showHeaderBanner", database)).map(row => row.shopifyDiscountId), [latest]);
  await updatePromotionWebsiteSettings(shop, latest, websiteStorage({ ...website(), showHeaderBanner: false }), database);
  assert.equal((await getStorefrontPromotionSettings(shop, "showHeaderBanner", database)).length, 0);
  assert.equal((await getStorefrontPromotionSettings("another.myshopify.com", "showProductPage", database)).length, 0);
}));


test("priority page saves only priorities atomically, preserves designs, and rejects stale or foreign changes", async () => withDatabase(async database => {
  const first = "gid://shopify/DiscountNode/501";
  const second = "gid://shopify/DiscountNode/502";
  const foreign = "gid://shopify/DiscountNode/503";
  const design = websiteStorage(website());
  await updatePromotionWebsiteSettings(shop, first, design, database);
  await updatePromotionWebsiteSettings(shop, second, design, database);
  await updatePromotionWebsiteSettings("other.myshopify.com", foreign, design, database);
  await savePromotionPriorities(shop, [{ id: first, priority: 100, expectedPriority: 17 }, { id: second, priority: 0, expectedPriority: 17 }], database);
  const saved = await database.promotionSettings.findUniqueOrThrow({ where: { shop_shopifyDiscountId: { shop, shopifyDiscountId: first } } });
  assert.deepEqual(websiteFromSettings(saved), { ...website(), priority: 100 });
  await assert.rejects(savePromotionPriorities(shop, [{ id: first, priority: 200, expectedPriority: 100 }, { id: second, priority: 40, expectedPriority: 17 }], database), /changed elsewhere/);
  assert.equal((await database.promotionSettings.findUniqueOrThrow({ where: { id: saved.id } })).priority, 100);
  await assert.rejects(savePromotionPriorities(shop, [{ id: foreign, priority: 100, expectedPriority: 17 }], database), /no longer available/);
  for (const priority of [-1, 10000, 1.5, "10"]) await assert.rejects(savePromotionPriorities(shop, [{ id: first, priority, expectedPriority: 100 }], database), /whole numbers/);
  await assert.rejects(savePromotionPriorities(shop, [{ id: first, priority: 200, expectedPriority: 100 }, { id: "gid://shopify/DiscountCodeNode/501", priority: 300, expectedPriority: 100 }], database), /only have one/);
}));

test("priority lists skip missing Shopify discounts without deleting their designs and retain real API errors", async () => withDatabase(async database => {
  for (const id of [601, 602, 603]) await updatePromotionWebsiteSettings(shop, `gid://shopify/DiscountNode/${id}`, websiteStorage(website()), database);
  const response = await loadPromotionPriorities({ graphql: async (_query, options) => {
    const id = String(options?.variables?.id);
    if (id.endsWith("601")) return Response.json({ data: { discountNode: node(id) } });
    if (id.endsWith("602")) return Response.json({ data: { discountNode: null } });
    return Response.json({ errors: [{ message: "Shopify temporarily unavailable" }] });
  } }, shop, database);
  assert.equal(response.errors.length, 1);
  assert.match(response.errors[0], /temporarily unavailable/);
  assert.deepEqual(response.rows.map(row => row.routeId), ["601"]);
  assert.deepEqual(response.hidden, []);
  assert.equal(await database.promotionSettings.count({ where: { shop } }), 3);
}));

test("a save keeps a promotion's place, and a promotion entering the order starts above every other", async () => withDatabase(async database => {
  const settings = (priority: number) => ({ ...websiteStorage(website()), priority });
  await updatePromotionWebsiteSettings(shop, "gid://shopify/DiscountNode/801", settings(17), database);
  await updatePromotionWebsiteSettings(shop, "gid://shopify/DiscountNode/802", settings(5), database);
  await updatePromotionWebsiteSettings("other.myshopify.com", "gid://shopify/DiscountNode/803", settings(900), database);
  assert.equal(await priorityForSave(shop, "gid://shopify/DiscountNode/802", false, database), 5, "an edit does not move a promotion");
  assert.equal(await priorityForSave(shop, "gid://shopify/DiscountCodeNode/802", false, database), 5, "typed ids find the same promotion");
  assert.equal(await priorityForSave(shop, "gid://shopify/DiscountNode/899", false, database), 0, "a new promotion that is not ranked has no priority");
  assert.equal(await priorityForSave(shop, "gid://shopify/DiscountNode/899", true, database), 18, "entering the order means the top of this shop's order");
  assert.equal(await priorityForSave(shop, "gid://shopify/DiscountNode/801", true, database), 18, "a promotion that rejoins the order goes to the top too");
  await updatePromotionWebsiteSettings(shop, "gid://shopify/DiscountNode/804", settings(9999), database);
  assert.equal(await priorityForSave(shop, "gid://shopify/DiscountNode/899", true, database), 9999, "the top is capped at the largest priority");
}));

test("a promotion's position comes from the shop's ranked promotions only", async () => withDatabase(async database => {
  const ranked = (id: number, priority: number) => updatePromotionWebsiteSettings(shop, `gid://shopify/DiscountNode/${id}`, { ...websiteStorage(website()), priority }, database);
  await ranked(701, 10); await ranked(702, 30); await ranked(703, 20); await ranked(704, 40); await ranked(705, 50);
  await updatePromotionWebsiteSettings(shop, "gid://shopify/DiscountNode/706", { ...websiteStorage({ ...website(), websiteEnabled: false }), priority: 60 }, database);
  const status = (id: number, value: string) => { const base = node(`gid://shopify/DiscountNode/${id}`); return { ...base, discount: { ...base.discount, status: value } }; };
  const all = [status(701, "ACTIVE"), status(702, "SCHEDULED"), status(703, "ACTIVE"), status(704, "EXPIRED"), status(705, "ACTIVE"), status(706, "ACTIVE"), status(707, "ACTIVE")];
  const asked: string[][] = [];
  // Shopify answers for the ids it is asked about. The shop has a seventh discount with no saved settings.
  const api = { graphql: async (_query: string, options?: { variables?: Record<string, unknown> }) => { const ids = options!.variables!.ids as string[]; asked.push(ids); return Response.json({ data: { nodes: all.filter(item => ids.includes(item.id)) } }); } };
  assert.deepEqual(await getPriorityPosition(api, shop, "gid://shopify/DiscountNode/705", database), { position: 1, total: 4 });
  assert.deepEqual([...asked[0]].sort(), [701, 702, 703, 704, 705, 706].map(id => `gid://shopify/DiscountNode/${id}`), "only the promotions with saved settings are looked up, however many discounts the shop has");
  assert.deepEqual(await getPriorityPosition(api, shop, "gid://shopify/DiscountNode/702", database), { position: 2, total: 4 });
  assert.deepEqual(await getPriorityPosition(api, shop, "gid://shopify/DiscountNode/701", database), { position: 4, total: 4 });
  assert.equal(await getPriorityPosition(api, shop, "gid://shopify/DiscountNode/704", database), null, "an ended promotion has no position");
  assert.equal(await getPriorityPosition(api, shop, "gid://shopify/DiscountNode/706", database), null, "a Draft promotion has no position");
}));

test("an enabled promotion syncs: an old excluded flag no longer hides it or keeps it out of the order", async () => withDatabase(async database => {
  const id = "gid://shopify/DiscountNode/901";
  await updatePromotionWebsiteSettings(shop, id, websiteStorage(website()), database);
  await database.promotionSettings.updateMany({ where: { shop }, data: { included: false } });
  assert.equal((await getStorefrontPromotionSettings(shop, "showHeaderBanner", database)).length, 1, "the storefront still gets it");
  const response = await loadPromotionPriorities({ graphql: async () => Response.json({ data: { discountNode: node(id) } }) }, shop, database);
  assert.deepEqual(response.rows.map(row => row.routeId), ["901"], "and it is in the priority order");
  await updatePromotionWebsiteSettings(shop, id, websiteStorage(website()), database);
  assert.equal((await database.promotionSettings.findFirstOrThrow({ where: { shop } })).included, true, "saving it again clears the old flag");
}));
