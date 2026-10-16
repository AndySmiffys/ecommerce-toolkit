import { contrastRatio, placements, promotionBlock, setPromotionBlock, type Placement, type PromotionBlock, type PromotionStyle, type WebsiteDraft } from "./design";

// A campaign has a main colour, a secondary colour and two text colours: one for
// text on a colour and one for text on white. Each block still stores its own
// colours, so the palette only decides which saved field each role colours. A
// field follows a palette change while it holds the shared value, so a colour set
// on one block is never overwritten. A block that shows an image has a white
// background, so its text uses the text-on-white colour.
export type PaletteRole = "primary" | "secondary";
export type PaletteColour = PaletteRole | "onColour" | "onWhite";
export type PaletteValues = Partial<Record<PaletteColour, string>>;
type StyleColour = "buttonBackground" | "buttonColour" | "badgeTextColour" | "productBorderColour" | "copyCodeBackground" | "copyCodeColour";
type BlockColour = "backgroundColour" | "textColour" | "badgeColour";
export type ColourKey = BlockColour | `style.${StyleColour}`;
/** A coloured element of a block. Paints without a role are surfaces, such as a banner background. */
export type Paint = { label: string; role?: PaletteRole; fill: ColourKey; text?: ColourKey };

export const white = "#ffffff";
export const black = "#000000";
/** What the main and secondary colour show until a campaign colour has been chosen. */
export const neutralColour = "#202223";
// The colours a block starts with. A field still holding its starting colour
// follows the palette, so the first change reaches every selected block.
const startingColour: Record<ColourKey, string> = {
  backgroundColour: white, textColour: black, badgeColour: "#d72c0d",
  "style.buttonBackground": neutralColour, "style.buttonColour": white, "style.badgeTextColour": white,
  "style.productBorderColour": neutralColour, "style.copyCodeBackground": neutralColour, "style.copyCodeColour": white,
};

/** Black or white, whichever reads better on the background. */
export function autoText(background: string): string {
  return contrastRatio(background, white) >= contrastRatio(background, black) ? white : black;
}
/** The campaign text colour for a background: "on colour" for dark colours, "on white" for light ones. */
export function textColourFor(background: string, palette: PaletteValues = {}): string {
  return autoText(background) === white ? palette.onColour ?? white : palette.onWhite ?? black;
}
/** Text is automatic while it is black, white or one of the campaign text colours. */
export function isAutomaticText(colour: string, palette: PaletteValues = {}): boolean {
  const value = colour.toLowerCase();
  return value === white || value === black || value === palette.onColour?.toLowerCase() || value === palette.onWhite?.toLowerCase();
}

export function readColour(block: PromotionBlock, key: ColourKey): string {
  return key.startsWith("style.") ? block.style[key.slice(6) as StyleColour] : block[key as BlockColour];
}
export function writeColour(block: PromotionBlock, key: ColourKey, value: string): PromotionBlock {
  return key.startsWith("style.") ? { ...block, style: { ...block.style, [key.slice(6)]: value } as PromotionStyle } : { ...block, [key]: value };
}

export function hasImage(block: PromotionBlock): boolean {
  return block.visibility.image && Boolean(block.style.desktopImage || block.style.mobileImage);
}

/** The coloured elements of a block, and the text colour each one carries. */
export function paintsFor(placement: Placement, block: PromotionBlock): Paint[] {
  switch (placement) {
    case "header": return [
      { label: "Header background", role: "primary", fill: "backgroundColour", text: "textColour" },
      { label: "Header button", role: "secondary", fill: "style.buttonBackground", text: "style.buttonColour" },
    ];
    case "collection": return [
      { label: "Collection banner", fill: "backgroundColour", text: "textColour" },
      { label: "Collection button", role: "primary", fill: "style.buttonBackground", text: "style.buttonColour" },
    ];
    case "product": return [
      block.style.productOfferStyle === "solid" && !hasImage(block)
        ? { label: "Product offer background", role: "primary", fill: "backgroundColour", text: "textColour" }
        : { label: "Product offer text", fill: "backgroundColour", text: "textColour" },
      ...(block.style.productOfferStyle === "solid" ? [] : [{ label: "Product offer border", role: "primary" as const, fill: "style.productBorderColour" as const }]),
      { label: "Product button", role: "primary", fill: "style.buttonBackground", text: "style.buttonColour" },
      { label: "Copy code button", role: "secondary", fill: "style.copyCodeBackground", text: "style.copyCodeColour" },
    ];
    case "badge": return [{ label: "Product badge", role: "primary", fill: "badgeColour", text: "style.badgeTextColour" }];
  }
}

function selected(draft: WebsiteDraft): Placement[] {
  return placements.filter(p => draft[p.flag]).map(p => p.id);
}
type Slot = { id: Placement; paint: Paint; fill: string; text?: string };
function slots(draft: WebsiteDraft): Slot[] {
  return selected(draft).flatMap(id => {
    const block = promotionBlock(draft, id);
    return paintsFor(id, block).map(paint => ({ id, paint, fill: readColour(block, paint.fill).toLowerCase(), text: paint.text ? readColour(block, paint.text).toLowerCase() : undefined }));
  });
}
function mode(values: string[]): string | undefined {
  let best: string | undefined; let bestCount = 0;
  for (const value of values) {
    const count = values.filter(other => other === value).length;
    if (count > bestCount) { best = value; bestCount = count; }
  }
  return best;
}

/** What each palette colour currently is. Main and secondary are undefined when no selected block uses them. */
export function paletteValues(draft: WebsiteDraft): PaletteValues {
  const all = slots(draft);
  const result: PaletteValues = {};
  for (const role of ["primary", "secondary"] as const) {
    const own = all.filter(slot => slot.paint.role === role);
    if (!own.length) continue;
    result[role] = own.every(slot => slot.fill === startingColour[slot.paint.fill]) ? neutralColour : mode(own.map(slot => slot.fill));
  }
  for (const kind of ["onColour", "onWhite"] as const) {
    const texts = all.filter(slot => slot.text !== undefined && (autoText(slot.fill) === white) === (kind === "onColour")).map(slot => slot.text!);
    const top = mode(texts);
    result[kind] = top && top !== white && top !== black ? top : kind === "onColour" ? white : black;
  }
  return result;
}
export function paletteColour(draft: WebsiteDraft, key: PaletteColour): string | undefined {
  return paletteValues(draft)[key];
}

/** Change palette colours on every selected block that still follows them. */
export function applyPalette(draft: WebsiteDraft, change: PaletteValues): WebsiteDraft {
  const old = paletteValues(draft);
  const wanted = Object.fromEntries(Object.entries(change).filter(([, value]) => value).map(([key, value]) => [key, value!.toLowerCase()])) as PaletteValues;
  const next: PaletteValues = { ...old, ...wanted };
  let result = draft;
  for (const id of selected(draft)) {
    let block = promotionBlock(result, id);
    for (const paint of paintsFor(id, block)) {
      const fillOld = readColour(block, paint.fill).toLowerCase();
      let fill = fillOld;
      const target = paint.role ? wanted[paint.role] : undefined;
      if (target && paint.role && (fillOld === old[paint.role] || fillOld === startingColour[paint.fill])) fill = target;
      if (paint.text) {
        const textOld = readColour(block, paint.text).toLowerCase();
        const textNew = textColourFor(fill, next).toLowerCase();
        if (isAutomaticText(textOld, old) && textNew !== textOld) block = writeColour(block, paint.text, textNew);
      }
      if (fill !== fillOld) block = writeColour(block, paint.fill, fill);
    }
    result = setPromotionBlock(result, id, block);
  }
  return result;
}

/** Selected blocks holding a colour of their own for a main or secondary colour. */
export function customisedPaletteBlocks(draft: WebsiteDraft): Placement[] {
  const values = paletteValues(draft);
  const all = slots(draft);
  const result = new Set<Placement>();
  for (const role of ["primary", "secondary"] as const) {
    const own = all.filter(slot => slot.paint.role === role);
    if (own.every(slot => slot.fill === startingColour[slot.paint.fill])) continue;
    for (const slot of own) if (slot.fill !== values[role]) result.add(slot.id);
  }
  return selected(draft).filter(id => result.has(id));
}

/** Make one block use the campaign colours, with the campaign text colours, again. */
export function matchPalette(draft: WebsiteDraft, placement: Placement): WebsiteDraft {
  const values = paletteValues(draft);
  let block = promotionBlock(draft, placement);
  for (const paint of paintsFor(placement, block)) {
    const shared = paint.role ? values[paint.role] : undefined;
    if (shared !== undefined) block = writeColour(block, paint.fill, shared);
    if (paint.text) block = writeColour(block, paint.text, textColourFor(readColour(block, paint.fill), values));
  }
  return setPromotionBlock(draft, placement, block);
}

/**
 * A block that shows an image has a white background; without one a solid product
 * offer returns to the main colour. Run after any change to keep this true.
 */
export function settleSurfaces(draft: WebsiteDraft): WebsiteDraft {
  const values = paletteValues(draft);
  const primarySet = slots(draft).some(slot => slot.paint.role === "primary" && slot.fill !== startingColour[slot.paint.fill]);
  let result = draft;
  for (const id of selected(draft)) {
    if (id !== "collection" && id !== "product") continue;
    const block = promotionBlock(result, id);
    const background = block.backgroundColour.toLowerCase();
    let target: string | null = null;
    if (hasImage(block)) { if (background === values.primary) target = white; }
    else if (id === "product" && block.style.productOfferStyle === "solid" && background === white && primarySet) target = values.primary ?? null;
    if (!target || target === background) continue;
    let next = writeColour(block, "backgroundColour", target);
    if (isAutomaticText(block.textColour, values)) next = writeColour(next, "textColour", textColourFor(target, values));
    result = setPromotionBlock(result, id, next);
  }
  return result;
}

export type ColourElement = { placement: Placement; label: string; fill: string; text?: string; source: "Main colour" | "Secondary colour" | "White" | "Default" | "Own colour"; readable: boolean };
/** Every coloured element of the selected blocks, for the "what this controls" list. */
export function colourElements(draft: WebsiteDraft): ColourElement[] {
  const values = paletteValues(draft);
  return slots(draft).map(({ id, paint, fill, text }) => {
    const unchosen = paint.role !== undefined && fill === startingColour[paint.fill] && values[paint.role] === neutralColour;
    const source = unchosen ? "Default" : paint.role ? fill === values[paint.role] ? (paint.role === "primary" ? "Main colour" : "Secondary colour") : "Own colour" : fill === white ? "White" : "Own colour";
    return { placement: id, label: paint.label, fill, text, source, readable: !text || contrastRatio(text, fill) >= 4.5 };
  });
}

/**
 * Keep a product offer readable when it changes between a solid background and
 * an outline. The chosen colour moves between the background and the border.
 * Pass the block after the appearance changed, and the appearance it had before.
 */
export function switchProductAppearance(block: PromotionBlock, from: PromotionStyle["productOfferStyle"], palette: PaletteValues = {}): PromotionBlock {
  const to = block.style.productOfferStyle;
  if ((from === "solid") === (to === "solid")) return block;
  if (to === "solid") {
    const colour = block.style.productBorderColour;
    return { ...block, backgroundColour: colour, textColour: isAutomaticText(block.textColour, palette) ? textColourFor(colour, palette) : block.textColour };
  }
  const colour = block.backgroundColour.toLowerCase() === white ? block.style.productBorderColour : block.backgroundColour;
  return { ...block, backgroundColour: white, textColour: isAutomaticText(block.textColour, palette) ? textColourFor(white, palette) : block.textColour, style: { ...block.style, productBorderColour: colour } };
}
