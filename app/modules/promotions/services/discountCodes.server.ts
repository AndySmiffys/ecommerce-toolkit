import { setTimeout as delay } from "node:timers/promises";
import { randomInt } from "node:crypto";
import { validateCodeOptions, type CodeOptions } from "../design/codeGeneration";
import type { ShopifyAdminClient } from "./discount.server";
export class CodeJobNotFoundError extends Error {}
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateDiscountCodes(options: CodeOptions, random = () => randomInt(alphabet.length)): string[] {
  const { count, prefix, suffix } = validateCodeOptions(options);
  const codes = new Set<string>();
  for (let attempt = 0; codes.size < count; attempt++) {
    if (attempt > count * 20) throw new Error("Could not generate enough unique codes. Try again.");
    codes.add(prefix + Array.from({ length: 12 }, () => alphabet[random()]).join("") + suffix);
  }
  return [...codes];
}
export async function codeGraphql<T>(admin: ShopifyAdminClient, query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await (await admin.graphql(query, { variables })).json();
    if (result.errors?.length) {
      if (!result.data && attempt < 2 && result.errors.every((e: { extensions?: { code?: string } }) => e.extensions?.code === "THROTTLED")) {
        const cost = result.extensions?.cost;
        const throttle = cost?.throttleStatus;
        const wait = throttle?.restoreRate ? ((cost.requestedQueryCost - throttle.currentlyAvailable) / throttle.restoreRate) * 1000 + 250 : 2000;
        await delay(Number.isFinite(wait) ? Math.min(5000, Math.max(500, wait)) : 2000);
        continue;
      }
      throw new Error(result.errors.map((e: { message: string }) => e.message).join(" "));
    }
    if (!result.data) throw new Error("Shopify returned no discount code data.");
    return result.data;
  }
  throw new Error("Shopify is temporarily limiting code requests. Retry in a moment.");
}

export function codeNodeId(id: string) {
  if (!/^gid:\/\/shopify\/(DiscountNode|DiscountCodeNode)\/\d+$/.test(id)) throw new Error("Invalid code discount ID.");
  return `gid://shopify/DiscountCodeNode/${id.split("/").pop()}`;
}
export async function addDiscountCodeChunk(admin: ShopifyAdminClient, discountId: string, codes: string[]) {
  if (!codes.length || codes.length > 250) throw new Error("A code batch must contain 1–250 codes.");
  const data = await codeGraphql<{ result: { bulkCreation?: { id: string }; userErrors: Array<{ message: string }> } }>(admin, `mutation AddPromotionCodes($id: ID!, $codes: [DiscountRedeemCodeInput!]!) {
    result: discountRedeemCodeBulkAdd(discountId: $id, codes: $codes) { bulkCreation { id } userErrors { message } }
  }`, { id: codeNodeId(discountId), codes: codes.map(code => ({ code })) });
  if (data.result.userErrors.length) throw new Error(data.result.userErrors.map(e => e.message).join(" "));
  if (!data.result.bulkCreation?.id) throw new Error("Shopify did not confirm the code batch.");
  return data.result.bulkCreation.id;
}
export async function getDiscountCodeJob(admin: ShopifyAdminClient, id: string) {
  const data = await codeGraphql<{ job: { done: boolean; codesCount: number; importedCount: number; failedCount: number } | null }>(admin, `query PromotionCodeJob($id: ID!) { job: discountRedeemCodeBulkCreation(id: $id) { done codesCount importedCount failedCount } }`, { id });
  if (!data.job) throw new CodeJobNotFoundError("Shopify could not find the original code generation job. Retry to check the codes already created.");
  return data.job;
}
export async function getDiscountCodePage(admin: ShopifyAdminClient, discountId: string, after: string | null) {
  const data: { codeDiscountNode: { codeDiscount: { codes: { nodes: Array<{ code: string }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } | null } = await codeGraphql(admin, `query ExistingPromotionCodes($id: ID!, $after: String) {
    codeDiscountNode(id: $id) { codeDiscount {
      ... on DiscountCodeBasic { codes(first: 250, after: $after) { nodes { code } pageInfo { hasNextPage endCursor } } }
      ... on DiscountCodeBxgy { codes(first: 250, after: $after) { nodes { code } pageInfo { hasNextPage endCursor } } }
      ... on DiscountCodeFreeShipping { codes(first: 250, after: $after) { nodes { code } pageInfo { hasNextPage endCursor } } }
    } }
  }`, { id: codeNodeId(discountId), after });
  const connection = data.codeDiscountNode?.codeDiscount?.codes;
  if (!connection) throw new Error("This code discount no longer exists or is unsupported.");
  if (connection.pageInfo.hasNextPage && (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === after)) throw new Error("Shopify returned an invalid code page.");
  return connection;
}
