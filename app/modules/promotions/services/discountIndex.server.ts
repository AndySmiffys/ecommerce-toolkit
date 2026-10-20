import type { Prisma, PrismaClient } from "@prisma/client";
import db from "../../../db.server";
import { isOtherApp, type SourceChoice } from "../design/discountSource";
import { promotionDiscountId } from "../design/discountIdentity";
import { discountsPerPage, type DiscountsPage } from "./discounts.server";
import type { ShopifyAdminClient } from "./discount.server";

type Database = Pick<PrismaClient, "discountIndex" | "discountIndexState" | "$transaction">;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// The index is built by reading every discount in pages, oldest first, which can take minutes when other apps have made
// tens of thousands. It remembers its place, so an interrupted scan carries on. Once complete, only discounts changed
// since the last read are fetched, which takes a moment, so the list can do it each time it opens.
const pageSize = 100;
const PAGE = `query DiscountIndexPage($first: Int!, $after: String, $query: String) {
  discountNodes(first: $first, after: $after, query: $query, sortKey: ID) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      events(first: 1, query: "action:create") { nodes { ... on BasicEvent { appTitle } } }
      discount {
        __typename
        ... on DiscountCodeBasic { title startsAt endsAt codes(first: 1) { nodes { code } } }
        ... on DiscountCodeBxgy { title startsAt endsAt codes(first: 1) { nodes { code } } }
        ... on DiscountCodeFreeShipping { title startsAt endsAt codes(first: 1) { nodes { code } } }
        ... on DiscountCodeApp { title startsAt endsAt codes(first: 1) { nodes { code } } }
        ... on DiscountAutomaticBasic { title startsAt endsAt }
        ... on DiscountAutomaticBxgy { title startsAt endsAt }
        ... on DiscountAutomaticFreeShipping { title startsAt endsAt }
        ... on DiscountAutomaticApp { title startsAt endsAt }
      }
    }
  }
}`;

type IndexNode = {
  id: string;
  events?: { nodes?: Array<{ appTitle?: string | null } | null> };
  discount?: { __typename?: string; title?: string | null; startsAt?: string | null; endsAt?: string | null; codes?: { nodes?: Array<{ code?: string } | null> } } | null;
};
type Row = Prisma.DiscountIndexCreateManyInput;

const asDate = (value: string | null | undefined) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; };

export function indexRow(shop: string, node: IndexNode): Row | null {
  const discount = node.discount;
  if (!discount?.__typename) return null;
  const id = promotionDiscountId(node.id);
  const numeric = id.split("/").pop() ?? "";
  if (!/^\d+$/.test(numeric)) return null;
  const createdBy = node.events?.nodes?.[0]?.appTitle || "Unknown";
  return {
    shop, discountId: id, numericId: BigInt(numeric),
    kind: discount.__typename.startsWith("DiscountCode") ? "code" : "automatic",
    title: String(discount.title ?? ""), code: String(discount.codes?.nodes?.[0]?.code ?? ""),
    createdBy, other: isOtherApp(createdBy), startsAt: asDate(discount.startsAt), endsAt: asDate(discount.endsAt),
  };
}

async function readPage(admin: ShopifyAdminClient, after: string | null, query: string | null, wait: (ms: number) => Promise<unknown>) {
  for (let attempt = 0; ; attempt++) {
    const result = await (await admin.graphql(PAGE, { variables: { first: pageSize, after, query } })).json();
    const errors: Array<{ message: string; extensions?: { code?: string } }> = result.errors ?? [];
    if (!errors.length) return result.data?.discountNodes as { pageInfo?: { hasNextPage: boolean; endCursor: string | null }; nodes?: IndexNode[] } | undefined;
    if (errors.every(error => error.extensions?.code === "THROTTLED") && attempt < 8) { await wait(1500 * (attempt + 1)); continue; }
    throw new Error(errors.map(error => error.message).join(" "));
  }
}

async function store(database: Database, shop: string, nodes: IndexNode[]) {
  const rows = nodes.map(node => indexRow(shop, node)).filter((row): row is Row => Boolean(row));
  if (!rows.length) return;
  await database.$transaction([
    database.discountIndex.deleteMany({ where: { shop, discountId: { in: rows.map(row => row.discountId) } } }),
    database.discountIndex.createMany({ data: rows }),
  ]);
}

const running = new Set<string>();
export const isIndexing = (shop: string) => running.has(shop);

/**
 * Builds or refreshes the index. A first build keeps its place as it goes; a later one reads only what changed since
 * the last. One at a time per shop. Failures are kept on the state for the page to show, and the next call tries again.
 */
export async function buildIndex(getAdmin: () => Promise<ShopifyAdminClient>, shop: string, database: Database = db, now = Date.now(), wait: (ms: number) => Promise<unknown> = sleep, maxPages = 2000): Promise<void> {
  if (running.has(shop)) return;
  running.add(shop);
  try {
    const state = await database.discountIndexState.findUnique({ where: { shop } });
    const started = new Date(now);
    const incremental = Boolean(state?.scanDone && state.refreshedAt);
    // A little before the last read, so a change made while that read ran is not missed.
    const query = incremental ? `updated_at:>=${new Date(state!.refreshedAt!.getTime() - 5 * 60000).toISOString()}` : null;
    let cursor = incremental ? null : state?.scanCursor ?? null;
    if (!incremental && !state) await database.discountIndexState.create({ data: { shop, scanStarted: started } });
    for (let page = 0; page < maxPages; page++) {
      const connection = await readPage(await getAdmin(), cursor, query, wait);
      await store(database, shop, connection?.nodes ?? []);
      cursor = connection?.pageInfo?.endCursor ?? cursor;
      if (!connection?.pageInfo?.hasNextPage) {
        await database.discountIndexState.update({ where: { shop }, data: { scanDone: true, scanCursor: null, refreshedAt: incremental ? started : state?.scanStarted ?? started, count: await database.discountIndex.count({ where: { shop } }), error: null } });
        return;
      }
      if (!incremental) await database.discountIndexState.update({ where: { shop }, data: { scanCursor: cursor } });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The discounts could not be read.";
    await database.discountIndexState.upsert({ where: { shop }, create: { shop, error: message }, update: { error: message } });
  } finally { running.delete(shop); }
}

export async function indexState(shop: string, database: Pick<PrismaClient, "discountIndexState"> = db) {
  const state = await database.discountIndexState.findUnique({ where: { shop } });
  return { ready: Boolean(state?.scanDone), count: state?.count ?? 0, refreshedAt: state?.refreshedAt ?? null, error: state?.error ?? null };
}

/** True when the index has never been built, or was last brought up to date more than `seconds` ago. */
export async function indexIsDue(shop: string, seconds: number, database: Pick<PrismaClient, "discountIndexState"> = db, now = Date.now()): Promise<boolean> {
  const state = await database.discountIndexState.findUnique({ where: { shop } });
  return !state?.scanDone || !state.refreshedAt || now - state.refreshedAt.getTime() > seconds * 1000;
}

// ---- Reading the list from the index ----

export type IndexFilter = { source: SourceChoice; app: string; status: string; text: string; after: string | null; before: string | null };

function where(shop: string, filter: IndexFilter, now: Date): Prisma.DiscountIndexWhereInput {
  const and: Prisma.DiscountIndexWhereInput[] = [];
  if (filter.source === "") and.push({ other: false });
  if (filter.source === "other") and.push({ other: true });
  if (filter.app) and.push({ createdBy: filter.app });
  if (filter.status === "active") and.push({ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] });
  if (filter.status === "scheduled") and.push({ startsAt: { gt: now } });
  if (filter.status === "expired") and.push({ endsAt: { lte: now } });
  const text = filter.text.trim();
  if (text) and.push({ OR: [{ title: { contains: text, mode: "insensitive" } }, { code: { contains: text, mode: "insensitive" } }] });
  return { shop, AND: and };
}

const digits = (value: string | null) => value && /^\d{1,20}$/.test(value) ? BigInt(value) : null;

/** The ids for one page of the list, newest first, with the paging details and how many match in all. */
export async function listFromIndex(shop: string, filter: IndexFilter, database: Pick<PrismaClient, "discountIndex"> = db, now = new Date()): Promise<{ ids: string[]; pageInfo: DiscountsPage["pageInfo"]; total: number }> {
  const condition = where(shop, filter, now);
  const before = digits(filter.before);
  const after = before === null ? digits(filter.after) : null;
  const total = await database.discountIndex.count({ where: condition });
  const rows = await database.discountIndex.findMany({
    where: { ...condition, AND: [...(condition.AND as Prisma.DiscountIndexWhereInput[]), ...(before !== null ? [{ numericId: { gt: before } }] : after !== null ? [{ numericId: { lt: after } }] : [])] },
    orderBy: { numericId: before !== null ? "asc" : "desc" },
    take: discountsPerPage + 1,
    select: { discountId: true, numericId: true },
  });
  const more = rows.length > discountsPerPage;
  const page = (more ? rows.slice(0, discountsPerPage) : rows);
  if (before !== null) page.reverse();
  return {
    ids: page.map(row => row.discountId),
    pageInfo: {
      hasNextPage: before !== null ? true : more,
      hasPreviousPage: before !== null ? more : after !== null,
      startCursor: page.length ? String(page[0].numericId) : null,
      endCursor: page.length ? String(page[page.length - 1].numericId) : null,
    },
    total,
  };
}

/** Who created each of these discounts, where the index knows. */
export async function creatorsOf(shop: string, ids: string[], database: Pick<PrismaClient, "discountIndex"> = db): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const rows = await database.discountIndex.findMany({ where: { shop, discountId: { in: ids.map(id => promotionDiscountId(id)) } }, select: { discountId: true, createdBy: true } });
  return Object.fromEntries(rows.map(row => [row.discountId, row.createdBy]));
}

/** The other apps that have made discounts, and how many each, for the app filter. */
export async function otherApps(shop: string, database: Pick<PrismaClient, "discountIndex"> = db): Promise<Array<{ name: string; count: number }>> {
  const groups = await database.discountIndex.groupBy({ by: ["createdBy"], where: { shop, other: true }, _count: { _all: true } });
  return groups.map(group => ({ name: group.createdBy, count: group._count._all })).sort((a, b) => b.count - a.count);
}

/** Drops discounts Shopify no longer has, so the list does not keep asking for them. */
export async function forgetDiscounts(shop: string, ids: string[], database: Pick<PrismaClient, "discountIndex"> = db): Promise<void> {
  if (ids.length) await database.discountIndex.deleteMany({ where: { shop, discountId: { in: ids.map(id => promotionDiscountId(id)) } } });
}

/** Which of these discounts another app created. Anything not in the index is treated as the merchant's own. */
export async function madeByOtherApps(shop: string, ids: string[], database: Pick<PrismaClient, "discountIndex"> = db): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const rows = await database.discountIndex.findMany({ where: { shop, other: true, discountId: { in: ids.map(id => promotionDiscountId(id)) } }, select: { discountId: true, createdBy: true } });
  return Object.fromEntries(rows.map(row => [row.discountId, row.createdBy]));
}
