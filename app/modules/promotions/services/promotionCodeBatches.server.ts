import { randomUUID } from "node:crypto";
import type { PromotionCodeBatch, PrismaClient } from "@prisma/client";
import db from "../../../db.server";
import { validateCodeOptions, type CodeBatchSummary } from "../design/codeGeneration";
import type { WebsiteDraft } from "../design/design";
import { buildDiscountMutation, createShopifyPromotion, type CreateDiscountDraft } from "./createPromotion.server";
import { CodeJobNotFoundError, addDiscountCodeChunk, codeGraphql, generateDiscountCodes, getDiscountCodeJob, getDiscountCodePage } from "./discountCodes.server";
import type { ShopifyAdminClient } from "./discount.server";

export function summarizeCodeBatch(batch: PromotionCodeBatch): CodeBatchSummary {
  const configuration = JSON.parse(batch.configurationJson) as { discount: CreateDiscountDraft };
  const { prefix, suffix, title } = validateCodeOptions(configuration.discount);
  return { id: batch.id, reconciling: batch.reconciliationCursor !== null, total: JSON.parse(batch.codesJson).length, confirmed: JSON.parse(batch.confirmedJson).length, status: batch.status, error: batch.error, prefix, suffix, title };
}
export async function getPromotionCodeBatch(shop: string, discountId: string, database: PrismaClient = db) {
  const batch = await database.promotionCodeBatch.findFirst({ where: { shop, shopifyDiscountId: discountId }, orderBy: { createdAt: "desc" } });
  return batch ? summarizeCodeBatch(batch) : null;
}
async function lock(batch: PromotionCodeBatch, database: PrismaClient) {
  const token = randomUUID();
  const claimed = await database.promotionCodeBatch.updateMany({ where: { id: batch.id, shop: batch.shop, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { leaseToken: token, leaseUntil: new Date(Date.now() + 120000) } });
  if (!claimed.count) return null;
  return token;
}
export async function createPromotionCodeBatch(admin: ShopifyAdminClient, shop: string, requestKey: string, discount: CreateDiscountDraft, website: WebsiteDraft, database: PrismaClient = db) {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestKey)) throw new Error("Invalid code list request. Refresh the form and try again.");
  if (discount.method !== "code" || discount.codeMode !== "bulk") throw new Error("Code lists require the discount code method.");
  validateCodeOptions(discount);
  if (website.websiteEnabled) throw new Error("Keep code lists in website Draft status. Distribute the individual codes using the CSV download.");
  let batch = await database.promotionCodeBatch.findUnique({ where: { shop_requestKey: { shop, requestKey } } });
  if (!batch) {
    const codes = generateDiscountCodes(discount);
    // Validate every discount rule before persisting or writing to Shopify.
    buildDiscountMutation({ ...discount, discountCode: codes[0] });
    batch = await database.promotionCodeBatch.upsert({ where: { shop_requestKey: { shop, requestKey } }, update: {}, create: { shop, requestKey, configurationJson: JSON.stringify({ discount, website }), codesJson: JSON.stringify(codes) } });
  }
  const storedConfiguration = JSON.parse(batch.configurationJson);
  if (JSON.stringify(storedConfiguration.discount) !== JSON.stringify(discount)) throw new Error("This code list has already started. Restore its original discount settings to retry, or open the saved promotion to edit its rules.");
  if (batch.shopifyDiscountId) return batch;
  const token = await lock(batch, database);
  if (!token) throw new Error("This code list is already being created. Wait a moment and retry.");
  try {
    batch = await database.promotionCodeBatch.findUniqueOrThrow({ where: { id: batch.id } });
    if (batch.shopifyDiscountId) return batch;
    const codes: string[] = JSON.parse(batch.codesJson);
    const stored: { discount: CreateDiscountDraft; website: WebsiteDraft } = JSON.parse(batch.configurationJson);
    let discountId: string | undefined;
    // On retry, recover a creation that reached Shopify before its response was lost.
    if (batch.status !== "NEW") {
      const data = await codeGraphql<{ codeDiscountNodeByCode: { id: string } | null }>(admin, `query RecoverPromotionCode($code: String!) { codeDiscountNodeByCode(code: $code) { id } }`, { code: codes[0] });
      if (data.codeDiscountNodeByCode) discountId = `gid://shopify/DiscountNode/${data.codeDiscountNodeByCode.id.split("/").pop()}`;
    }
    await database.promotionCodeBatch.update({ where: { id: batch.id }, data: { status: "CREATING", error: null } });
    discountId ??= await createShopifyPromotion(admin, { ...stored.discount, discountCode: codes[0] });
    return await database.promotionCodeBatch.update({ where: { id: batch.id }, data: { shopifyDiscountId: discountId, confirmedJson: JSON.stringify([codes[0]]), status: codes.length === 1 ? "COMPLETE" : "RUNNING" } });
  } catch (error) {
    await database.promotionCodeBatch.update({ where: { id: batch.id }, data: { status: "ERROR", error: error instanceof Error ? error.message : "The code list could not be created." } });
    throw error;
  } finally {
    await database.promotionCodeBatch.updateMany({ where: { id: batch.id, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } });
  }
}
export async function advancePromotionCodeBatch(admin: ShopifyAdminClient, shop: string, id: string, retry = false, database: PrismaClient = db): Promise<CodeBatchSummary> {
  let batch = await database.promotionCodeBatch.findFirst({ where: { id, shop } });
  if (!batch?.shopifyDiscountId) throw new Error("This code list could not be found.");
  if (batch.status === "COMPLETE" || (batch.status === "ERROR" && !retry)) return summarizeCodeBatch(batch);
  const token = await lock(batch, database);
  if (!token) return summarizeCodeBatch(batch);
  try {
    batch = await database.promotionCodeBatch.findUniqueOrThrow({ where: { id } });
    if (batch.status === "COMPLETE" || (batch.status === "ERROR" && !retry)) return summarizeCodeBatch(batch);
    const discountId = batch.shopifyDiscountId!;
    const codes: string[] = JSON.parse(batch.codesJson);
    let confirmed: string[] = JSON.parse(batch.confirmedJson);
    if (retry && batch.status === "ERROR") {
      batch = await database.promotionCodeBatch.update({ where: { id }, data: { status: "RUNNING", error: null, ...(!batch.activeJobId && batch.reconciliationCursor === null ? { reconciliationCursor: "", reconciliationJson: "[]" } : {}) } });
    }
    if (batch.reconciliationCursor !== null) {
      const page = await getDiscountCodePage(admin, discountId, batch.reconciliationCursor || null);
      const planned = new Set(codes);
      const checked: string[] = [...new Set([...(JSON.parse(batch.reconciliationJson) as string[]), ...page.nodes.map(code => code.code.toUpperCase()).filter(code => planned.has(code))])];
      batch = await database.promotionCodeBatch.update({ where: { id }, data: page.pageInfo.hasNextPage
        ? { reconciliationCursor: page.pageInfo.endCursor, reconciliationJson: JSON.stringify(checked), status: "RUNNING" }
        : { reconciliationCursor: null, reconciliationJson: "[]", confirmedJson: JSON.stringify(checked), pendingJson: "[]", status: checked.length === codes.length ? "COMPLETE" : "RUNNING" }
      });
      return summarizeCodeBatch(batch);
    }
    if (batch.activeJobId) {
      const job = await getDiscountCodeJob(admin, batch.activeJobId);
      if (!job.done) return summarizeCodeBatch(batch);
      const pending: string[] = JSON.parse(batch.pendingJson);
      if (job.failedCount || job.importedCount !== pending.length || job.codesCount !== pending.length) {
        batch = await database.promotionCodeBatch.update({ where: { id }, data: { activeJobId: null, status: "ERROR", error: "Some codes were not created. Retry to check existing codes and continue with the same list." } });
      } else {
        confirmed = [...new Set([...confirmed, ...pending])];
        batch = await database.promotionCodeBatch.update({ where: { id }, data: { confirmedJson: JSON.stringify(confirmed), activeJobId: null, pendingJson: "[]", status: confirmed.length === codes.length ? "COMPLETE" : "RUNNING", error: null } });
      }
      return summarizeCodeBatch(batch);
    }
    const confirmedSet = new Set(confirmed);
    const pending = codes.filter(code => !confirmedSet.has(code)).slice(0, 250);
    if (!pending.length) return summarizeCodeBatch(await database.promotionCodeBatch.update({ where: { id }, data: { status: "COMPLETE", error: null } }));
    // Persist exact codes before submission so an uncertain response never generates replacements.
    await database.promotionCodeBatch.update({ where: { id }, data: { pendingJson: JSON.stringify(pending), status: "RUNNING", error: null } });
    const activeJobId = await addDiscountCodeChunk(admin, discountId, pending);
    batch = await database.promotionCodeBatch.update({ where: { id }, data: { activeJobId } });
    return summarizeCodeBatch(batch);
  } catch (error) {
    batch = await database.promotionCodeBatch.update({ where: { id }, data: { status: "ERROR", ...(error instanceof CodeJobNotFoundError ? { activeJobId: null } : {}), error: error instanceof Error ? error.message : "The code list could not be completed." } });
    return summarizeCodeBatch(batch);
  } finally {
    await database.promotionCodeBatch.updateMany({ where: { id, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } });
  }
}
