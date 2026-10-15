import { placements, promotionBlock, setPromotionBlock, type Placement, type PromotionBlock, type PromotionStyle, type WebsiteDraft } from "./design";

// Header, Collection and Product tell the same campaign story, so the editor
// offers one set of shared fields for them. Each block still stores its own
// copy. A shared field shows the value most selected blocks hold (the first
// block wins a tie), and an edit reaches only the blocks holding that value, so
// a block that has been customised is never overwritten.
export const campaignPlacements: Placement[] = ["header", "collection", "product"];
const imagePlacements: Placement[] = ["collection", "product"];
export const campaignBlockKeys = ["headline", "body", "buttonText", "buttonUrl", "countdownText", "backgroundColour", "textColour"] as const;
export const campaignStyleKeys = ["buttonBackground", "buttonColour", "desktopImage", "desktopImageId", "mobileImage", "mobileImageId", "imageAlt"] as const;
const imageKeys: ReadonlyArray<string> = ["desktopImage", "desktopImageId", "mobileImage", "mobileImageId", "imageAlt"];

type BlockKey = typeof campaignBlockKeys[number];
type StyleKey = typeof campaignStyleKeys[number];
export type CampaignPatch = Partial<Pick<PromotionBlock, BlockKey>> & { style?: Partial<Pick<PromotionStyle, StyleKey>> };

export function selectedCampaignPlacements(draft: WebsiteDraft): Placement[] {
  return campaignPlacements.filter(id => draft[placements.find(p => p.id === id)!.flag]);
}

// Header cannot show images, so it never takes part in the image fields.
function takesPart(placement: Placement, style?: StyleKey) {
  return !style || !imageKeys.includes(style) || imagePlacements.includes(placement);
}

type Field = { block: BlockKey } | { style: StyleKey };
const fields: Field[] = [...campaignBlockKeys.map(block => ({ block })), ...campaignStyleKeys.map(style => ({ style }))];
function read(block: PromotionBlock, field: Field): string { return "block" in field ? block[field.block] : block.style[field.style]; }
function write(block: PromotionBlock, field: Field, value: string): PromotionBlock {
  return "block" in field ? { ...block, [field.block]: value } : { ...block, style: { ...block.style, [field.style]: value } };
}
function participants(draft: WebsiteDraft, field: Field) {
  return selectedCampaignPlacements(draft).filter(id => takesPart(id, "style" in field ? field.style : undefined)).map(id => ({ id, block: promotionBlock(draft, id) }));
}
function reference(draft: WebsiteDraft, field: Field): string | undefined {
  const counts = new Map<string, number>();
  const values = participants(draft, field).map(({ block }) => read(block, field));
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | undefined; let bestCount = 0;
  for (const value of values) if ((counts.get(value) ?? 0) > bestCount) { best = value; bestCount = counts.get(value)!; }
  return best;
}

/** The value a shared field displays, or undefined when no campaign block is selected. */
export function campaignValue(draft: WebsiteDraft, key: BlockKey): string | undefined;
export function campaignValue(draft: WebsiteDraft, key: "style", style: StyleKey): string | undefined;
export function campaignValue(draft: WebsiteDraft, key: BlockKey | "style", style?: StyleKey) {
  return reference(draft, key === "style" ? { style: style! } : { block: key });
}

/** Selected blocks holding a value that differs from what a shared field shows. */
export function customisedPlacements(draft: WebsiteDraft): Placement[] {
  const result = new Set<Placement>();
  for (const field of fields) {
    const shared = reference(draft, field);
    for (const { id, block } of participants(draft, field)) if (read(block, field) !== shared) result.add(id);
  }
  return campaignPlacements.filter(id => result.has(id));
}

/** Apply a shared edit to every selected block that currently holds the shared value. */
export function applyCampaignPatch(draft: WebsiteDraft, patch: CampaignPatch): WebsiteDraft {
  let next = draft;
  for (const field of fields) {
    const value = "block" in field ? patch[field.block] : patch.style?.[field.style];
    if (value === undefined) continue;
    const shared = reference(draft, field);
    for (const { id, block } of participants(draft, field)) {
      if (read(block, field) === shared) next = setPromotionBlock(next, id, write(promotionBlock(next, id), field, value));
    }
  }
  return next;
}

/** Make one customised block use the shared values again. */
export function matchCampaign(draft: WebsiteDraft, placement: Placement): WebsiteDraft {
  let block = promotionBlock(draft, placement);
  for (const field of fields) {
    const shared = reference(draft, field);
    if (shared !== undefined && takesPart(placement, "style" in field ? field.style : undefined)) block = write(block, field, shared);
  }
  return setPromotionBlock(draft, placement, block);
}
