import type { Prisma, PrismaClient } from "@prisma/client";
import db from "../../../db.server";

type Database = Pick<PrismaClient, "discountIndex" | "discountIndexState" | "promotionSettings" | "googlePromotion">;

export type HomeStats = {
  /** Null until the index of discounts has been built. */
  promotions: { active: number; scheduled: number; endingSoon: number } | null;
  websiteEnabled: number;
  google: { chosen: number; ready: number; issues: number };
};

/**
 * The counts on the app's home page, all from what the app already keeps, so the page opens quickly. Promotions are the
 * merchant's own (not another app's), and "ending soon" means running now and ending within the next seven days.
 */
export async function loadHomeStats(shop: string, database: Database = db, now = new Date()): Promise<HomeStats> {
  const soon = new Date(now.getTime() + 7 * 86400000);
  const own: Prisma.DiscountIndexWhereInput = { shop, other: false, ruleName: null };
  const running: Prisma.DiscountIndexWhereInput[] = [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }];
  const [state, websiteEnabled, google] = await Promise.all([
    database.discountIndexState.findUnique({ where: { shop } }),
    database.promotionSettings.count({ where: { shop, websiteEnabled: true } }),
    database.googlePromotion.groupBy({ by: ["status"], where: { shop }, _count: { _all: true } }),
  ]);
  const promotions = state?.scanDone
    ? {
      active: await database.discountIndex.count({ where: { ...own, AND: running } }),
      scheduled: await database.discountIndex.count({ where: { ...own, startsAt: { gt: now } } }),
      endingSoon: await database.discountIndex.count({ where: { ...own, AND: [...running, { endsAt: { not: null, lte: soon } }] } }),
    }
    : null;
  const byStatus = Object.fromEntries(google.map(row => [row.status, row._count._all]));
  const chosen = google.reduce((sum, row) => sum + row._count._all, 0);
  return { promotions, websiteEnabled, google: { chosen, ready: byStatus.ready ?? 0, issues: byStatus.issues ?? 0 } };
}
