import test from "node:test";
import assert from "node:assert/strict";
import { defaultDesign, promotionBlock, setPromotionBlock, type WebsiteDraft } from "../app/modules/promotions/design/design";
import { applyCampaignPatch, campaignValue, customisedPlacements, matchCampaign, selectedCampaignPlacements } from "../app/modules/promotions/design/sharedCampaign";

function draft(flags: Partial<WebsiteDraft> = {}): WebsiteDraft {
  return {
    included: true, websiteEnabled: true, showProductPage: true, showCollectionPage: true, showProductBadge: true, showCountdown: false, showHeaderBanner: true,
    headline: "", body: "", badgeText: "20% OFF", countdownText: "", buttonText: "", buttonUrl: "", backgroundColour: "#ffffff", textColour: "#000000", badgeColour: "#ff0000",
    priority: 0, design: defaultDesign(), ...flags,
  };
}

test("one shared edit reaches the header, collection and product blocks but never the badge", () => {
  const next = applyCampaignPatch(draft(), { headline: "Frightfully good fun", buttonUrl: "/collections/halloween", backgroundColour: "#faf3e0", style: { buttonBackground: "#642080", desktopImage: "https://cdn.shopify.com/a.jpg", desktopImageId: "gid://shopify/MediaImage/1" } });
  for (const id of ["header", "collection", "product"] as const) {
    const block = promotionBlock(next, id);
    assert.equal(block.headline, "Frightfully good fun");
    assert.equal(block.buttonUrl, "/collections/halloween");
    assert.equal(block.backgroundColour, "#faf3e0");
    assert.equal(block.style.buttonBackground, "#642080");
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
