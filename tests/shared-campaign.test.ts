import test from "node:test";
import assert from "node:assert/strict";
import { defaultDesign, promotionBlock, setPromotionBlock, validateWebsite, type WebsiteDraft } from "../app/modules/promotions/design/design";
import { applyCampaignPatch, campaignValue, customisedPlacements, joinCampaign, matchCampaign, selectedCampaignPlacements } from "../app/modules/promotions/design/sharedCampaign";

function draft(flags: Partial<WebsiteDraft> = {}): WebsiteDraft {
  return {
    websiteEnabled: true, showProductPage: true, showCollectionPage: true, showProductBadge: true, showCountdown: false, showHeaderBanner: true,
    headline: "", body: "", badgeText: "20% OFF", countdownText: "", buttonText: "", buttonUrl: "", backgroundColour: "#ffffff", textColour: "#000000", badgeColour: "#ff0000",
    priority: 0, design: defaultDesign(), ...flags,
  };
}

test("one shared edit reaches the header, collection and product blocks but never the badge", () => {
  const next = applyCampaignPatch(draft(), { headline: "Frightfully good fun", buttonUrl: "/collections/halloween", style: { desktopImage: "https://cdn.shopify.com/a.jpg", desktopImageId: "gid://shopify/MediaImage/1" } });
  for (const id of ["header", "collection", "product"] as const) {
    const block = promotionBlock(next, id);
    assert.equal(block.headline, "Frightfully good fun");
    assert.equal(block.buttonUrl, "/collections/halloween");
  }
  assert.equal(promotionBlock(next, "header").style.desktopImage, "", "the header has no image");
  assert.equal(promotionBlock(next, "collection").style.desktopImage, "https://cdn.shopify.com/a.jpg");
  assert.equal(promotionBlock(next, "product").style.desktopImageId, "gid://shopify/MediaImage/1");
  assert.equal(promotionBlock(next, "badge").headline, "20% OFF");
});

test("a customised block keeps its own value, even the header, and is reported until it matches again", () => {
  let value = applyCampaignPatch(draft(), { headline: "Shared headline", body: "Shared body" });
  value = setPromotionBlock(value, "header", { ...promotionBlock(value, "header"), headline: "Header only" });
  assert.equal(campaignValue(value, "headline"), "Shared headline", "the shared field shows what most blocks hold");
  assert.deepEqual(customisedPlacements(value), ["header"]);
  value = applyCampaignPatch(value, { headline: "Edited headline", body: "Edited body" });
  assert.equal(promotionBlock(value, "header").headline, "Header only");
  assert.equal(promotionBlock(value, "header").body, "Edited body");
  assert.equal(promotionBlock(value, "collection").headline, "Edited headline");
  assert.equal(promotionBlock(value, "product").headline, "Edited headline");
  value = matchCampaign(value, "header");
  assert.equal(promotionBlock(value, "header").headline, "Edited headline");
  assert.deepEqual(customisedPlacements(value), []);
});

test("only selected blocks are edited and deselected blocks keep their saved settings", () => {
  const value = draft({ showCollectionPage: false });
  const saved = promotionBlock(value, "collection");
  const next = applyCampaignPatch(value, { headline: "Header and product" });
  assert.deepEqual(selectedCampaignPlacements(next), ["header", "product"]);
  assert.equal(promotionBlock(next, "collection").headline, saved.headline);
  assert.equal(promotionBlock(next, "product").headline, "Header and product");
  assert.equal(campaignValue(draft({ showHeaderBanner: false, showCollectionPage: false, showProductPage: false }), "headline"), undefined);
  assert.equal(applyCampaignPatch(draft({ showHeaderBanner: false, showCollectionPage: false, showProductPage: false }), { headline: "x" }).design.blocks, undefined);
});

test("a block added to a live promotion starts with the campaign wording instead of asking for it again", () => {
  // A promotion with its wording set once, on the collection and product blocks. The header was never selected.
  const live = applyCampaignPatch(draft({ showHeaderBanner: false }), { headline: "Frightfully good fun", body: "20% off costumes", buttonText: "Shop Halloween", buttonUrl: "/collections/halloween", countdownText: "Ends in" });
  assert.deepEqual(validateWebsite(live, null), []);
  const added = joinCampaign(live, { ...live, showHeaderBanner: true }, "header");
  const header = promotionBlock(added, "header");
  assert.equal(header.headline, "Frightfully good fun");
  assert.equal(header.body, "20% off costumes");
  assert.equal(header.buttonText, "Shop Halloween");
  assert.equal(header.buttonUrl, "/collections/halloween");
  assert.equal(header.countdownText, "Ends in");
  assert.deepEqual(validateWebsite(added, null), [], "the header no longer complains about a missing headline");
  assert.deepEqual(customisedPlacements(added), [], "the new block follows the campaign, so it is not reported as customised");
  assert.equal(promotionBlock(added, "header").style.desktopImage, "", "the header still takes no image");
  // Without joining, the problem the merchant saw: the new block has no headline of its own.
  assert.match(validateWebsite({ ...live, showHeaderBanner: true }, null).join(" "), /Add a headline for the Header block/);
});

test("a block added first takes the images, and a block selected earlier keeps its own saved settings", () => {
  const live = applyCampaignPatch(draft({ showCollectionPage: false, showHeaderBanner: false }), { headline: "Shared", style: { desktopImage: "https://cdn.shopify.com/a.jpg", desktopImageId: "gid://shopify/MediaImage/1", desktopImageRatio: "3" } });
  const added = joinCampaign(live, { ...live, showCollectionPage: true }, "collection");
  assert.equal(promotionBlock(added, "collection").style.desktopImage, "https://cdn.shopify.com/a.jpg");
  assert.equal(promotionBlock(added, "collection").style.desktopImageRatio, "3");
  // The header was selected before and deselected: its own saved headline is kept.
  const own = setPromotionBlock(live, "header", { ...promotionBlock(live, "header"), headline: "Header only" });
  const again = joinCampaign(own, { ...own, showHeaderBanner: true }, "header");
  assert.equal(promotionBlock(again, "header").headline, "Header only");
  // The badge is not part of the campaign.
  const badge = joinCampaign(live, { ...live, showProductBadge: true }, "badge");
  assert.equal(promotionBlock(badge, "badge").headline, "20% OFF");
});
