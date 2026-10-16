import test from "node:test";
import assert from "node:assert/strict";
import { defaultDesign, promotionBlock, readDesign, setPromotionBlock, type PromotionStyle, type WebsiteDraft } from "../app/modules/promotions/design/design";
import { applyPalette, autoText, colourElements, customisedPaletteBlocks, matchPalette, paletteColour, settleSurfaces, switchProductAppearance } from "../app/modules/promotions/design/campaignPalette";

function draft(flags: Partial<WebsiteDraft> = {}): WebsiteDraft {
  return {
    included: true, websiteEnabled: true, showProductPage: true, showCollectionPage: true, showProductBadge: true, showCountdown: false, showHeaderBanner: true,
    headline: "", body: "", badgeText: "20% OFF", countdownText: "", buttonText: "", buttonUrl: "", backgroundColour: "#ffffff", textColour: "#000000", badgeColour: "#d72c0d",
    priority: 0, design: defaultDesign(), ...flags,
  };
}
const block = (value: WebsiteDraft, id: "header" | "collection" | "product" | "badge") => promotionBlock(value, id);

test("text is black or white depending on how dark the background is", () => {
  assert.equal(autoText("#ffffff"), "#000000");
  assert.equal(autoText("#ffe066"), "#000000");
  assert.equal(autoText("#202223"), "#ffffff");
  assert.equal(autoText("#642080"), "#ffffff");
  assert.equal(autoText("#d72c0d"), "#ffffff");
  assert.equal(autoText("not a colour"), "#000000");
});

test("the main colour fills the header, collection button, product offer, product button and badge, with automatic text", () => {
  const next = applyPalette(draft(), { primary: "#642080" });
  assert.equal(block(next, "header").backgroundColour, "#642080");
  assert.equal(block(next, "header").textColour, "#ffffff");
  assert.equal(block(next, "collection").style.buttonBackground, "#642080");
  assert.equal(block(next, "collection").style.buttonColour, "#ffffff");
  assert.equal(block(next, "collection").backgroundColour, "#ffffff", "the collection banner background is not part of the palette");
  assert.equal(block(next, "product").backgroundColour, "#642080");
  assert.equal(block(next, "product").textColour, "#ffffff");
  assert.equal(block(next, "product").style.buttonBackground, "#642080");
  assert.equal(block(next, "badge").badgeColour, "#642080");
  assert.equal(block(next, "badge").style.badgeTextColour, "#ffffff");
  assert.equal(paletteColour(next, "primary"), "#642080");
  const light = applyPalette(next, { primary: "#ffe066" });
  assert.equal(block(light, "header").textColour, "#000000");
  assert.equal(block(light, "badge").style.badgeTextColour, "#000000");
});

test("the secondary colour fills only the header button and the copy code button", () => {
  const next = applyPalette(draft(), { secondary: "#f5a623" });
  assert.equal(block(next, "header").style.buttonBackground, "#f5a623");
  assert.equal(block(next, "header").style.buttonColour, "#ffffff", "button labels keep the button text colour");
  assert.equal(block(next, "product").style.copyCodeBackground, "#f5a623");
  assert.equal(block(next, "product").style.copyCodeColour, "#ffffff");
  assert.equal(block(next, "collection").style.buttonBackground, "#202223", "the collection button uses the main colour");
  assert.equal(block(next, "product").style.buttonBackground, "#202223");
  assert.equal(block(next, "header").backgroundColour, "#ffffff");
});

test("an outlined product offer colours its border, not its background", () => {
  let value = draft();
  value = setPromotionBlock(value, "product", { ...block(value, "product"), style: { ...block(value, "product").style, productOfferStyle: "single" } });
  const next = applyPalette(value, { primary: "#642080" });
  assert.equal(block(next, "product").style.productBorderColour, "#642080");
  assert.equal(block(next, "product").backgroundColour, "#ffffff");
  assert.equal(block(next, "product").textColour, "#000000");
  assert.equal(block(next, "product").style.buttonBackground, "#642080");
});

test("a colour set on one block, or a custom text colour, survives a palette change and can be reset", () => {
  let value = applyPalette(draft(), { primary: "#642080" });
  value = setPromotionBlock(value, "collection", { ...block(value, "collection"), style: { ...block(value, "collection").style, buttonBackground: "#00aa00" } });
  value = setPromotionBlock(value, "header", { ...block(value, "header"), textColour: "#ff00ff" });
  assert.deepEqual(customisedPaletteBlocks(value), ["collection"]);
  const next = applyPalette(value, { primary: "#1e3a8a" });
  assert.equal(block(next, "collection").style.buttonBackground, "#00aa00");
  assert.equal(block(next, "header").backgroundColour, "#1e3a8a");
  assert.equal(block(next, "header").textColour, "#ff00ff", "a custom text colour is kept");
  assert.equal(block(next, "badge").badgeColour, "#1e3a8a");
  const reset = matchPalette(next, "collection");
  assert.equal(block(reset, "collection").style.buttonBackground, "#1e3a8a");
  assert.equal(block(reset, "collection").style.buttonColour, "#ffffff");
  assert.deepEqual(customisedPaletteBlocks(reset), []);
});

test("deselected blocks keep their colours and a newly selected block is reported until it matches", () => {
  const value = applyPalette(draft({ showCollectionPage: false }), { primary: "#642080" });
  assert.equal(block(value, "collection").style.buttonBackground, "#202223");
  assert.equal(block(value, "header").backgroundColour, "#642080");
  const added = { ...value, showCollectionPage: true };
  assert.deepEqual(customisedPaletteBlocks(added), ["collection"]);
  assert.equal(applyPalette(draft({ showHeaderBanner: false, showCollectionPage: false, showProductPage: false, showProductBadge: false }), { primary: "#642080" }).design.blocks, undefined);
});

test("switching a product offer between solid and outline moves the chosen colour and keeps text readable", () => {
  const solid = block(applyPalette(draft(), { primary: "#642080" }), "product");
  const outlineStyle: PromotionStyle = { ...solid.style, productOfferStyle: "single" };
  const outline = switchProductAppearance({ ...solid, style: outlineStyle }, "solid");
  assert.equal(outline.style.productBorderColour, "#642080");
  assert.equal(outline.backgroundColour, "#ffffff");
  assert.equal(outline.textColour, "#000000");
  const back = switchProductAppearance({ ...outline, style: { ...outline.style, productOfferStyle: "solid" } }, "single");
  assert.equal(back.backgroundColour, "#642080");
  assert.equal(back.textColour, "#ffffff");
  const unchanged = switchProductAppearance({ ...outline, style: { ...outline.style, productOfferStyle: "double" } }, "single");
  assert.deepEqual(unchanged, { ...outline, style: { ...outline.style, productOfferStyle: "double" } });
  const fresh = block(draft(), "product");
  assert.equal(switchProductAppearance({ ...fresh, style: { ...fresh.style, productOfferStyle: "single" } }, "solid").style.productBorderColour, "#202223", "an unset white background does not become an invisible border");
  const custom = switchProductAppearance({ ...solid, textColour: "#ff00ff", style: outlineStyle }, "solid");
  assert.equal(custom.textColour, "#ff00ff");
});

test("text on a colour and text on white are two campaign colours, chosen per surface by contrast", () => {
  let value = applyPalette(draft(), { primary: "#642080" });
  value = applyPalette(value, { onColour: "#fff2cc" });
  for (const text of [block(value, "header").textColour, block(value, "product").textColour, block(value, "badge").style.badgeTextColour]) assert.equal(text, "#fff2cc");
  for (const label of [block(value, "header").style.buttonColour, block(value, "collection").style.buttonColour, block(value, "product").style.buttonColour, block(value, "product").style.copyCodeColour]) assert.equal(label, "#ffffff", "button labels do not use the text colours");
  assert.equal(block(value, "collection").textColour, "#000000", "the collection banner is white, so it uses the text on white colour");
  value = applyPalette(value, { onWhite: "#242124" });
  assert.equal(block(value, "collection").textColour, "#242124");
  assert.equal(block(value, "header").textColour, "#fff2cc");
  assert.equal(paletteColour(value, "onColour"), "#fff2cc");
  assert.equal(paletteColour(value, "onWhite"), "#242124");
  const light = applyPalette(value, { primary: "#ffe066" });
  assert.equal(block(light, "header").backgroundColour, "#ffe066");
  assert.equal(block(light, "header").textColour, "#242124", "a light main colour switches to the text on white colour");
  assert.equal(block(applyPalette(light, { primary: "#1e3a8a" }), "header").textColour, "#fff2cc", "and back again for a dark one");
});

test("a block that shows an image has a white background and returns to the main colour without it", () => {
  let value = applyPalette(draft(), { primary: "#642080", onWhite: "#242124" });
  const product = block(value, "product");
  assert.equal(product.backgroundColour, "#642080");
  value = setPromotionBlock(value, "product", { ...product, visibility: { ...product.visibility, image: true }, style: { ...product.style, desktopImage: "https://cdn.shopify.com/offer.jpg" } });
  value = settleSurfaces(value);
  assert.equal(block(value, "product").backgroundColour, "#ffffff");
  assert.equal(block(value, "product").textColour, "#242124");
  assert.equal(block(value, "product").style.buttonBackground, "#642080", "the button keeps the main colour");
  assert.equal(block(applyPalette(value, { primary: "#1e3a8a" }), "product").backgroundColour, "#ffffff", "the main colour no longer fills an image block");
  const imageless = block(value, "product");
  value = settleSurfaces(setPromotionBlock(value, "product", { ...imageless, style: { ...imageless.style, desktopImage: "" } }));
  assert.equal(block(value, "product").backgroundColour, "#642080");
  assert.equal(block(value, "product").textColour, "#ffffff");
  assert.equal(settleSurfaces(value), value, "settling twice changes nothing");
  const collection = block(value, "collection");
  const withImage = settleSurfaces(setPromotionBlock(value, "collection", { ...collection, backgroundColour: "#642080", style: { ...collection.style, desktopImage: "https://cdn.shopify.com/banner.jpg" } }));
  assert.equal(block(withImage, "collection").backgroundColour, "#ffffff");
});

test("the list of coloured elements says where each colour comes from and whether its text is readable", () => {
  const fresh = colourElements(draft());
  assert.equal(fresh.find(item => item.label === "Header background")!.source, "Default");
  assert.equal(fresh.find(item => item.label === "Collection banner")!.source, "White");
  let value = applyPalette(draft(), { primary: "#642080", secondary: "#f5a623" });
  const items = colourElements(value);
  const item = (label: string) => items.find(element => element.label === label)!;
  assert.deepEqual([item("Header background").source, item("Header background").fill, item("Header background").text, item("Header background").readable], ["Main colour", "#642080", "#ffffff", true]);
  assert.equal(item("Header button").source, "Secondary colour");
  assert.equal(item("Copy code button").source, "Secondary colour");
  assert.equal(item("Product badge").source, "Main colour");
  assert.equal(items.filter(element => element.placement === "header").length, 2);
  value = setPromotionBlock(value, "header", { ...block(value, "header"), backgroundColour: "#00aa00", textColour: "#00bb00" });
  const changed = colourElements(value).find(element => element.label === "Header background")!;
  assert.deepEqual([changed.source, changed.readable], ["Own colour", false]);
});

test("button labels have their own campaign colour and never switch with the background", () => {
  let value = applyPalette(draft(), { primary: "#ffe066", secondary: "#f5a623" });
  assert.equal(block(value, "header").style.buttonColour, "#ffffff", "a light button colour keeps white labels until a button text colour is chosen");
  assert.equal(block(value, "header").textColour, "#000000", "ordinary text still switches");
  assert.equal(colourElements(value).find(item => item.label === "Collection button")!.readable, false, "white on pale yellow is flagged");
  value = applyPalette(value, { button: "#242124" });
  for (const label of [block(value, "header").style.buttonColour, block(value, "collection").style.buttonColour, block(value, "product").style.buttonColour, block(value, "product").style.copyCodeColour]) assert.equal(label, "#242124");
  assert.equal(paletteColour(value, "button"), "#242124");
  assert.equal(block(value, "badge").style.badgeTextColour, "#000000", "the badge is not a button");
  assert.equal(colourElements(value).find(item => item.label === "Collection button")!.readable, true);
  value = applyPalette(value, { primary: "#1e3a8a" });
  assert.equal(block(value, "collection").style.buttonColour, "#242124", "changing the main colour leaves button labels alone");
  assert.equal(block(value, "collection").style.buttonBackground, "#1e3a8a");
  value = setPromotionBlock(value, "product", { ...block(value, "product"), style: { ...block(value, "product").style, buttonColour: "#ff00ff" } });
  assert.equal(paletteColour(value, "button"), "#242124", "one custom label does not become the campaign colour");
  value = applyPalette(value, { button: "#ffffff" });
  assert.equal(block(value, "product").style.buttonColour, "#ff00ff", "a custom label survives");
  assert.equal(block(value, "header").style.buttonColour, "#ffffff");
  assert.equal(block(matchPalette(value, "product"), "product").style.buttonColour, "#ffffff");
});

test("chosen text colours are saved with the design and survive a main colour that hides them", () => {
  let value = applyPalette(draft(), { primary: "#642080", onColour: "#fff2cc", onWhite: "#242124", button: "#ffffff" });
  assert.deepEqual(value.design.palette, { onColour: "#fff2cc", onWhite: "#242124", button: "#ffffff" });
  const light = applyPalette(value, { primary: "#ffe066" });
  assert.equal(paletteColour(light, "onColour"), "#fff2cc", "no block uses it now, but it is remembered");
  const stored = readDesign(JSON.stringify(light.design));
  assert.deepEqual(stored.palette, { onColour: "#fff2cc", onWhite: "#242124", button: "#ffffff" });
  assert.equal(readDesign(JSON.stringify({ ...defaultDesign(), palette: { button: "#ABCDEF" } })).palette?.button, "#abcdef");
  assert.throws(() => readDesign(JSON.stringify({ ...defaultDesign(), palette: { button: "red" } })), /hex/);
  assert.throws(() => readDesign(JSON.stringify({ ...defaultDesign(), palette: [] })), /Invalid campaign colours/);
  assert.equal(readDesign(JSON.stringify(defaultDesign())).palette, undefined);
  assert.equal("palette" in promotionBlock(light, "header").style, false, "the palette is not copied into a block's styling");
  value = applyPalette(light, { primary: "#1e3a8a" });
  assert.equal(block(value, "header").textColour, "#fff2cc");
});
