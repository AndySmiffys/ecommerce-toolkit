import { placements, promotionBlock, setPromotionBlock, type Placement, type PromotionBlock, type PromotionStyle, type WebsiteDraft } from "./design";
import { matchPalette } from "./campaignPalette";

// Header, Collection and Product tell the same campaign story, so the editor
// offers one set of shared fields for them. Each block still stores its own
// copy. A shared field shows the value most selected blocks hold (the first
// block wins a tie), and an edit reaches only the blocks holding that value, so
// block that has been customised is never overwritten. Colours are handled
// separately, by the campaign palette.
export const campaignPlacements: Placement[] = ["header", "collection", "product"];
const imagePlacements: Placement[] = ["collection", "product"];
export const campaignBlockKeys = ["headline", "body", "buttonText", "buttonUrl", "countdownText"] as const;
export const campaignStyleKeys = ["desktopImage", "desktopImageId", "desktopImageRatio", "mobileImage", "mobileImageId", "mobileImageRatio", "imageAlt"] as const;
const imageKeys: ReadonlyArray<string> = campaignStyleKeys;

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

/**
 * A block that is being selected for the first time joins the campaign: it takes the wording, link, countdown label
 * and images the other selected blocks share, and their colours, so a promotion whose wording was set once does not
 * ask for it again. `before` is the draft as it was before the block was selected, which keeps the new block's empty
 * fields out of the vote. A block that was selected earlier keeps the settings it was saved with.
 */
export function joinCampaign(before: WebsiteDraft, after: WebsiteDraft, placement: Placement): WebsiteDraft {
  if (!campaignPlacements.includes(placement) || before.design.blocks?.[placement]) return after;
  let block = promotionBlock(after, placement);
  for (const field of fields) {
    if (!takesPart(placement, "style" in field ? field.style : undefined)) continue;
    const shared = reference(before, field);
    if (shared !== undefined) block = write(block, field, shared);
  }
  const joined = setPromotionBlock(after, placement, block);
  // Colours follow the campaign too. They are read with the block still unselected, so only the other blocks vote.
  const colours = matchPalette({ ...before, design: joined.design }, placement);
  return { ...joined, design: colours.design };
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
