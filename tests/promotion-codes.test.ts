import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrismaClient } from "@prisma/client";
import { generateDiscountCodes, addDiscountCodeChunk, codeGraphql } from "../app/modules/promotions/services/discountCodes.server";
import { createPromotionCodeBatch, advancePromotionCodeBatch, getPromotionCodeBatch } from "../app/modules/promotions/services/promotionCodeBatches.server";
import { buildDiscountMutation, type CreateDiscountDraft } from "../app/modules/promotions/services/createPromotion.server";
import { validateCodeOptions, normalizeSharedCode, codesCsv } from "../app/modules/promotions/design/codeGeneration";
import { defaultDesign, type WebsiteDraft } from "../app/modules/promotions/design/design";
import { getDiscountCode, type ShopifyDiscountNode } from "../app/modules/promotions/types/discount";
import type { ShopifyAdminClient } from "../app/modules/promotions/services/discount.server";

const shop = "test.myshopify.com";
const discount = (): CreateDiscountDraft => ({ codeMode: "bulk", codeCount: "10000", codePrefix: "HALLOWEEN-", codeSuffix: "-2026", codeListTitle: "Halloween codes", discountType: "order", method: "code", discountCode: "", automaticTitle: "", valueType: "percentage", discountValue: "20", appliesTo: "collections", selectedProducts: [], selectedCollections: [], buyRequirement: "quantity", buyQuantity: "1", buyAmount: "", buyAppliesTo: "products", buySelection: [], getQuantity: "1", getAppliesTo: "products", getSelection: [], rewardType: "free", rewardValue: "", maxUsesPerOrder: false, usesPerOrder: "1", minimumRequirement: "none", minimumPurchaseAmount: "", minimumQuantity: "", limitTotalUses: true, totalUsageLimit: "1", limitOncePerCustomer: false, combineProductDiscounts: false, combineOrderDiscounts: false, combineShippingDiscounts: false, productCombinationMode: "best", selectedCombinationTags: [], startsAt: "2026-10-08T12:00:00Z", endsAt: null, eligibility: "all", selectedEligibility: [], countries: [], maximumShippingPrice: "" });
const website = (): WebsiteDraft => ({ websiteEnabled: false, showProductPage: false, showCollectionPage: false, showProductBadge: false, showCountdown: false, showHeaderBanner: false, headline: "", body: "", badgeText: "", countdownText: "", buttonText: "", buttonUrl: "", backgroundColour: "#ffffff", textColour: "#202223", badgeColour: "#d72c0d", priority: 0, design: defaultDesign() });
async function withDatabase(run: (database: PrismaClient) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "promotion-codes-"));
  const database = new PrismaClient({ datasources: { db: { url: `file:${join(directory, "codes.sqlite")}` } } });
  try {
    const migration = readFileSync("prisma/migrations/20261008153000_promotion_code_batches/migration.sql", "utf8");
    for (const statement of migration.split(";").filter(s => s.trim())) await database.$executeRawUnsafe(statement);
    await run(database);
  } finally { await database.$disconnect(); rmSync(directory, { recursive: true, force: true }); }
}
function shopifySimulator() {
  const codes = new Set<string>();
  const chunks: string[][] = [];
  const jobs = new Map<string, string[]>();
  let creations = 0;
  let loseCreateResponse = false, loseAddResponse = false, failNextJob = false, waitForJob = false, failPage = false, expireJob = false;
  const admin: ShopifyAdminClient = { graphql: async (query, options) => {
    const variables = options?.variables ?? {};
    if (query.includes("mutation CreatePromotion")) {
      creations++; const input = variables.input as { code: string }; codes.add(input.code);
      if (loseCreateResponse) { loseCreateResponse = false; throw new Error("Connection lost after creation"); }
      return Response.json({ data: { result: { codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/42" }, userErrors: [] } } });
    }
    if (query.includes("RecoverPromotionCode")) return Response.json({ data: { codeDiscountNodeByCode: codes.has(String(variables.code)) ? { id: "gid://shopify/DiscountCodeNode/42" } : null } });
    if (query.includes("mutation AddPromotionCodes")) {
      const chunk = (variables.codes as Array<{ code: string }>).map(c => c.code); assert.ok(chunk.length <= 250);
      chunks.push(chunk); const id = `gid://shopify/DiscountRedeemCodeBulkCreation/${chunks.length}`; jobs.set(id, chunk);
      if (loseAddResponse) { loseAddResponse = false; chunk.forEach(code => codes.add(code)); throw new Error("Connection lost after queueing"); }
      return Response.json({ data: { result: { bulkCreation: { id }, userErrors: [] } } });
    }
    if (query.includes("query PromotionCodeJob")) {
      const chunk = jobs.get(String(variables.id))!;
      if (expireJob) { expireJob = false; chunk.forEach(code => codes.add(code)); return Response.json({ data: { job: null } }); }
      if (waitForJob) { waitForJob = false; return Response.json({ data: { job: { done: false, codesCount: chunk.length, importedCount: 0, failedCount: 0 } } }); }
      const failed = failNextJob ? 1 : 0; failNextJob = false;
      chunk.slice(0, chunk.length - failed).forEach(code => codes.add(code));
      return Response.json({ data: { job: { done: true, codesCount: chunk.length, importedCount: chunk.length - failed, failedCount: failed } } });
    }
    if (query.includes("ExistingPromotionCodes")) {
      if (failPage) { failPage = false; throw new Error("Temporary code page failure"); }
      const all = [...codes], offset = Number(variables.after ?? 0), next = offset + 250;
      return Response.json({ data: { codeDiscountNode: { codeDiscount: { codes: { nodes: all.slice(offset, next).map(code => ({ code })), pageInfo: { hasNextPage: next < all.length, endCursor: String(next) } } } } } });
    }
    throw new Error(`Unexpected query: ${query}`);
  } };
  return { admin, codes, chunks, get creations() { return creations; }, loseCreate() { loseCreateResponse = true; }, loseAdd() { loseAddResponse = true; }, failJob() { failNextJob = true; }, waitForJob() { waitForJob = true; }, failPage() { failPage = true; }, expireJob() { expireJob = true; } };
}

test("shared codes have a consistent code/title and no implicit usage or customer limit", () => {
  for (const type of ["product", "order", "bxgy", "shipping"] as const) {
    const d = { ...discount(), discountType: type, codeMode: "single" as const, discountCode: " test-discount ", limitTotalUses: false, totalUsageLimit: "", selectedCollections: [{ id: "gid://shopify/Collection/1" }], buySelection: [{ id: "gid://shopify/Product/1" }], getSelection: [{ id: "gid://shopify/Product/2" }] };
    const input = buildDiscountMutation(d).variables.input as Record<string, unknown>;
    assert.equal(input.code, "TEST-DISCOUNT"); assert.equal(input.title, input.code); assert.equal(input.usageLimit, null); assert.equal(input.appliesOncePerCustomer, false);
  }
  assert.throws(() => normalizeSharedCode("TEST CODE")); assert.throws(() => normalizeSharedCode("TEST\u0000"));
});
test("code generation validates bounds and affixes, creates 10,000 distinct codes and refuses collisions", () => {
  const codes = generateDiscountCodes(discount());
  assert.equal(codes.length, 10000); assert.equal(new Set(codes).size, 10000); assert.ok(codes.every(c => /^HALLOWEEN-[A-Z2-9]{12}-2026$/.test(c)));
  for (const change of [{ codeCount: "0" }, { codeCount: "10001" }, { codeCount: "2.5" }, { codeCount: "NaN" }, { codePrefix: "a b" }, { codeSuffix: "X".repeat(33) }, { codeListTitle: "" }]) assert.throws(() => validateCodeOptions({ ...discount(), ...change }));
  assert.throws(() => generateDiscountCodes({ ...discount(), codeCount: "2" }, () => 0), /unique/);
  assert.deepEqual(validateCodeOptions({ ...discount(), codePrefix: "offer-", codeSuffix: "-vip" }), { count: 10000, prefix: "OFFER-", suffix: "-VIP", title: "Halloween codes" });
});
test("10,000 codes resume from persistent storage, use 250-code requests and export only a complete list", async () => withDatabase(async database => {
  const sim = shopifySimulator();
  const created = await createPromotionCodeBatch(sim.admin, shop, "request-complete-10000", discount(), website(), database);
  assert.equal(created.shopifyDiscountId, "gid://shopify/DiscountNode/42");
  for (let step = 0; step < 85; step++) {
    const state = await advancePromotionCodeBatch(sim.admin, shop, created.id, false, database);
    if (state.status === "COMPLETE") break;
    assert.equal(state.status, "RUNNING");
  }
  const state = await getPromotionCodeBatch(shop, created.shopifyDiscountId!, database);
  assert.equal(state?.confirmed, 10000); assert.equal(state?.status, "COMPLETE"); assert.equal(sim.codes.size, 10000); assert.equal(sim.chunks.length, 40); assert.equal(sim.chunks.at(-1)?.length, 249); assert.equal(sim.creations, 1);
  const saved = await database.promotionCodeBatch.findUniqueOrThrow({ where: { id: created.id } });
  const csv = codesCsv(JSON.parse(saved.confirmedJson)); assert.equal(csv.split("\r\n").filter(Boolean).length, 10001); assert.ok(csv.startsWith("Code\r\n"));
  await assert.rejects(() => advancePromotionCodeBatch(sim.admin, "other.myshopify.com", created.id, false, database), /found/);
}));
test("an uncertain native creation is recovered with the same seed, not recreated", async () => withDatabase(async database => {
  const sim = shopifySimulator(); sim.loseCreate(); const d = { ...discount(), codeCount: "2" };
  await assert.rejects(() => createPromotionCodeBatch(sim.admin, shop, "request-lost-creation", d, website(), database), /Connection lost/);
  const batch = await createPromotionCodeBatch(sim.admin, shop, "request-lost-creation", d, website(), database);
  assert.equal(sim.creations, 1); assert.equal(batch.shopifyDiscountId, "gid://shopify/DiscountNode/42");
  await assert.rejects(() => createPromotionCodeBatch(sim.admin, shop, "request-lost-creation", { ...d, discountValue: "30" }, website(), database), /original discount settings/);
}));
test("concurrent advances queue once, failed imports reconcile and retries keep their original codes", async () => withDatabase(async database => {
  const sim = shopifySimulator(); const d = { ...discount(), codeCount: "260" };
  const batch = await createPromotionCodeBatch(sim.admin, shop, "request-failed-import", d, website(), database);
  sim.failJob();
  await Promise.all([advancePromotionCodeBatch(sim.admin, shop, batch.id, false, database), advancePromotionCodeBatch(sim.admin, shop, batch.id, false, database)]);
  assert.equal(sim.chunks.length, 1);
  const failed = await advancePromotionCodeBatch(sim.admin, shop, batch.id, false, database);
  assert.equal(failed.status, "ERROR");
  const checked = await advancePromotionCodeBatch(sim.admin, shop, batch.id, true, database);
  assert.equal(checked.confirmed, 250);
  await advancePromotionCodeBatch(sim.admin, shop, batch.id, false, database);
  assert.equal(sim.chunks[1].length, 10);
  const done = await advancePromotionCodeBatch(sim.admin, shop, batch.id, false, database);
  assert.equal(done.status, "COMPLETE"); assert.equal(sim.codes.size, 260); assert.equal(sim.creations, 1);
}));
test("a lost bulk submission response reconciles accepted codes before retrying", async () => withDatabase(async database => {
  const sim = shopifySimulator(); const d = { ...discount(), codeCount: "260" };
  const batch = await createPromotionCodeBatch(sim.admin, shop, "request-lost-bulk-add", d, website(), database);
  sim.loseAdd(); const failed = await advancePromotionCodeBatch(sim.admin, shop, batch.id, false, database);
  assert.equal(failed.status, "ERROR");
  const firstPage = await advancePromotionCodeBatch(sim.admin, shop, batch.id, true, database);
  assert.equal(firstPage.reconciling, true);
  sim.failPage();
  const interrupted = await advancePromotionCodeBatch(sim.admin, shop, batch.id, false, database);
  assert.equal(interrupted.status, "ERROR");
  assert.equal((await database.promotionCodeBatch.findUniqueOrThrow({ where: { id: batch.id } })).reconciliationCursor, "250");
  const secondPage = await advancePromotionCodeBatch(sim.admin, shop, batch.id, true, database);
  assert.equal(secondPage.reconciling, false); assert.equal(secondPage.confirmed, 251);
  await advancePromotionCodeBatch(sim.admin, shop, batch.id, false, database);
  assert.equal(sim.chunks[1].length, 9); assert.ok(sim.chunks[1].every(code => !sim.chunks[0].includes(code)));
  assert.equal((await advancePromotionCodeBatch(sim.admin, shop, batch.id, false, database)).status, "COMPLETE");
}));
test("unsafe code-list publication and invalid quantities make no Shopify writes", async () => withDatabase(async database => {
  const sim = shopifySimulator();
  await assert.rejects(() => createPromotionCodeBatch(sim.admin, shop, "request-invalid-count", { ...discount(), codeCount: "10001" }, website(), database), /10,000/);
  await assert.rejects(() => createPromotionCodeBatch(sim.admin, shop, "request-public-codes", discount(), { ...website(), websiteEnabled: true }, database), /Draft/);
  await assert.rejects(() => addDiscountCodeChunk(sim.admin, "gid://shopify/DiscountNode/42", Array(251).fill("CODE")), /250/);
  assert.equal(sim.creations, 0); assert.equal(await database.promotionCodeBatch.count(), 0);
  const node = { discount: { codesCount: { count: 10000 }, codes: { nodes: [{ code: "PRIVATE" }] } } } as ShopifyDiscountNode;
  assert.equal(getDiscountCode(node), null);
}));

test("queued Shopify jobs never count as imported before completion", async () => withDatabase(async database => {
  const sim = shopifySimulator(); const batch = await createPromotionCodeBatch(sim.admin, shop, "request-wait-for-job", { ...discount(), codeCount: "2" }, website(), database);
  await advancePromotionCodeBatch(sim.admin, shop, batch.id, false, database); sim.waitForJob();
  const pending = await advancePromotionCodeBatch(sim.admin, shop, batch.id, false, database);
  assert.equal(pending.status, "RUNNING"); assert.equal(pending.confirmed, 1); assert.equal(sim.codes.size, 1);
  const done = await advancePromotionCodeBatch(sim.admin, shop, batch.id, false, database);
  assert.equal(done.status, "COMPLETE"); assert.equal(done.confirmed, 2); assert.equal(sim.chunks.length, 1);
}));

test("Shopify throttling is retried without treating other errors as successful code writes", async () => {
  let calls = 0;
  const admin: ShopifyAdminClient = { graphql: async () => { calls++; return calls === 1 ? Response.json({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }], extensions: { cost: { requestedQueryCost: 1, throttleStatus: { currentlyAvailable: 0, restoreRate: 1000 } } } }) : Response.json({ data: { accepted: true } }); } };
  assert.deepEqual(await codeGraphql(admin, "query Fixture", {}), { accepted: true }); assert.equal(calls, 2);
  let failures = 0;
  await assert.rejects(() => codeGraphql({ graphql: async () => { failures++; return Response.json({ errors: [{ message: "Invalid discount" }] }); } }, "query Fixture", {}), /Invalid discount/);
  assert.equal(failures, 1);
});

test("an unavailable historical job is recovered from actual Shopify codes", async () => withDatabase(async database => {
  const sim = shopifySimulator(); const batch = await createPromotionCodeBatch(sim.admin, shop, "request-expired-job", { ...discount(), codeCount: "2" }, website(), database);
  await advancePromotionCodeBatch(sim.admin, shop, batch.id, false, database); sim.expireJob();
  assert.equal((await advancePromotionCodeBatch(sim.admin, shop, batch.id, false, database)).status, "ERROR");
  const recovered = await advancePromotionCodeBatch(sim.admin, shop, batch.id, true, database);
  assert.equal(recovered.status, "COMPLETE"); assert.equal(recovered.confirmed, 2); assert.equal(sim.chunks.length, 1);
}));
