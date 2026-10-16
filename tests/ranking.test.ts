import test from "node:test";
import assert from "node:assert/strict";
import { canRank, isRanked, rankBlocker, whyNotRanked, type RankingWebsite } from "../app/modules/promotions/design/ranking";
import type { PromotionRecord } from "../app/modules/promotions/models/promotion";

const live: RankingWebsite = { websiteEnabled: true, showHeaderBanner: true, showCollectionPage: false, showProductPage: false, showProductBadge: false };
const now = Date.parse("2026-10-20T12:00:00Z");
const record = (status: string, website: Partial<RankingWebsite> = {}) => ({ status, settings: { ...live, ...website } }) as unknown as PromotionRecord;

test("a promotion is ranked only when it can appear on the storefront", () => {
  assert.equal(canRank({ endsAt: null, website: live }, now), true);
  assert.equal(canRank({ endsAt: "2026-10-31T23:59:00Z", website: live }, now), true, "a future end date is still ranked");
  assert.equal(rankBlocker({ endsAt: "2026-10-19T00:00:00Z", website: live }, now), "It has ended.");
  assert.equal(rankBlocker({ endsAt: null, website: { ...live, websiteEnabled: false } }, now), "Its website status is Draft.");
  assert.equal(rankBlocker({ endsAt: null, website: { ...live, showHeaderBanner: false } }, now), "No website blocks are selected.");
  for (const flag of ["showCollectionPage", "showProductPage", "showProductBadge"] as const) {
    assert.equal(canRank({ endsAt: null, website: { ...live, showHeaderBanner: false, [flag]: true } }, now), true, `${flag} is enough`);
  }
});

test("a saved promotion is ranked from its Shopify status and website settings", () => {
  assert.equal(isRanked(record("ACTIVE")), true);
  assert.equal(isRanked(record("SCHEDULED")), true);
  assert.equal(whyNotRanked(record("EXPIRED")), "It has ended.");
  assert.equal(whyNotRanked(record("UNKNOWN")), "Its status is not Active or Scheduled.");
  assert.equal(whyNotRanked(record("ACTIVE", { websiteEnabled: false })), "Its website status is Draft.");
  assert.equal(whyNotRanked(record("SCHEDULED", { showHeaderBanner: false })), "No website blocks are selected.");
});
