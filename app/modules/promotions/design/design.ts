export type Placement = "header" | "collection" | "product" | "badge";
export type PlacementCopy = { headline: string; body: string; buttonText: string };
export type PromotionStyle = {
  version: 1;
  productOfferStyle: "solid" | "single" | "double";
  productBorderColour: string;
  productBorderWidth: number;
  copyCodeBackground: string;
  copyCodeColour: string;
  copyCodeEnabled: boolean;
  preset: "simple" | "campaign" | "compact";
  desktopImage: string;
  desktopImageId: string;
  mobileImage: string;
  mobileImageId: string;
  imageAlt: string;
  imageLayout: "full" | "half-left" | "half-right";
  focalX: number;
  focalY: number;
  /** No longer used: the dark image overlay was removed. Kept so saved designs still load. */
  overlay: number;
  alignment: "left" | "center" | "right";
  bannerHeight: number;
  spacing: number;
  radius: number;
  headingSize: number;
  bodySize: number;
  buttonBackground: string;
  buttonColour: string;
  badgeTextColour: string;
};
export type BlockVisibility = Record<"headline" | "body" | "image" | "offerNote" | "discountCode" | "countdown" | "button", boolean>;
export type PromotionBlock = {
  headline: string; body: string; buttonText: string; buttonUrl: string; countdownText: string;
  backgroundColour: string; textColour: string; badgeColour: string;
  visibility: BlockVisibility; style: PromotionStyle;
};
export type PromotionDesign = PromotionStyle & {
  overrides: Record<Placement, PlacementCopy>;
  blocks?: Partial<Record<Placement, PromotionBlock>>;
  /** The campaign text colours chosen in the campaign colours section. */
  palette?: { onColour?: string; onWhite?: string; button?: string };
};
export type WebsiteDraft = {
  websiteEnabled: boolean;
  showProductPage: boolean; showCollectionPage: boolean; showProductBadge: boolean;
  showCountdown: boolean; showHeaderBanner: boolean;
  headline: string; body: string; badgeText: string; countdownText: string;
  buttonText: string; buttonUrl: string;
  backgroundColour: string; textColour: string; badgeColour: string;
  priority: number; design: PromotionDesign;
};
const emptyCopy = (): PlacementCopy => ({ headline: "", body: "", buttonText: "" });
export function defaultDesign(): PromotionDesign {
  return { version: 1, productOfferStyle: "solid", productBorderColour: "#202223", productBorderWidth: 1, copyCodeBackground: "#202223", copyCodeColour: "#ffffff", copyCodeEnabled: false, preset: "simple", desktopImage: "", desktopImageId: "", mobileImage: "", mobileImageId: "", imageAlt: "", imageLayout: "half-right", focalX: 50, focalY: 50, overlay: 45, alignment: "left", bannerHeight: 280, spacing: 24, radius: 8, headingSize: 28, bodySize: 16, buttonBackground: "#202223", buttonColour: "#ffffff", badgeTextColour: "#ffffff", overrides: { header: emptyCopy(), collection: emptyCopy(), product: emptyCopy(), badge: emptyCopy() } };
}
export const placements: Array<{ id: Placement; title: string; flag: "showHeaderBanner" | "showCollectionPage" | "showProductPage" | "showProductBadge"; description: string }> = [
  { id: "header", title: "Header", flag: "showHeaderBanner", description: "A short announcement above the site content." },
  { id: "collection", title: "Collection", flag: "showCollectionPage", description: "A campaign banner on qualifying collection pages." },
  { id: "product", title: "Product", flag: "showProductPage", description: "An offer panel beside the details of an eligible product." },
  { id: "badge", title: "Product badge", flag: "showProductBadge", description: "A short label on eligible product cards." },
];
export const copyLimits = { headline: 120, body: 500, badgeText: 40, countdownText: 80, buttonText: 60 };
export function safeLink(value: string): boolean {
  return !value || /^\/(?!\/)/.test(value) || /^https?:\/\//i.test(value);
}
export function safeImage(value: string): boolean { return !value || /^https:\/\//i.test(value); }
export function readDesign(value: unknown): PromotionDesign {
  const defaults = defaultDesign();
  const input = typeof value === "string" ? JSON.parse(value || "{}") : value;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The promotion design is invalid.");
  const source = input as Record<string, unknown>;
  const design = { ...defaults };
  for (const name of ["desktopImage", "desktopImageId", "mobileImage", "mobileImageId", "imageAlt", "buttonBackground", "buttonColour", "badgeTextColour", "productBorderColour", "copyCodeBackground", "copyCodeColour"] as const) {
    if (source[name] !== undefined) {
      if (typeof source[name] !== "string") throw new Error("Invalid design field: " + name);
      design[name] = (source[name] as string).trim();
    }
  }
  if (design.imageAlt.length > 250) throw new Error("Image description must be 250 characters or fewer.");
  for (const name of ["desktopImage", "mobileImage"] as const) if (!safeImage(design[name])) throw new Error("Images must use secure Shopify file URLs.");
  for (const name of ["buttonBackground", "buttonColour", "badgeTextColour", "productBorderColour", "copyCodeBackground", "copyCodeColour"] as const) if (!/^#[\da-f]{6}$/i.test(design[name])) throw new Error("Use six-digit hex colours.");
  const ranges = { productBorderWidth: [1, 12], focalX: [0, 100], focalY: [0, 100], overlay: [0, 90], bannerHeight: [160, 600], spacing: [12, 60], radius: [0, 32], headingSize: [10, 48], bodySize: [10, 24] } as const;
  for (const name of Object.keys(ranges) as Array<keyof typeof ranges>) {
    if (source[name] !== undefined) {
      const number = Number(source[name]);
      if (!Number.isFinite(number) || number < ranges[name][0] || number > ranges[name][1]) throw new Error("Invalid design field: " + name);
      design[name] = number;
    }
  }
  for (const [name, options] of [["productOfferStyle", ["solid", "single", "double"]], ["preset", ["simple", "campaign", "compact"]], ["imageLayout", ["full", "half-left", "half-right"]], ["alignment", ["left", "center", "right"]]] as const) {
    if (source[name] !== undefined) {
      if (!(options as readonly unknown[]).includes(source[name])) throw new Error("Invalid design field: " + name);
      Object.assign(design, { [name]: source[name] });
    }
  }
  if (source.productBorderWidth === undefined) design.productBorderWidth = design.productOfferStyle === "double" ? 4 : 1;
  if (design.productOfferStyle === "double" && design.productBorderWidth < 3) throw new Error("Double borders must be at least 3px thick.");
  if (source.copyCodeBackground === undefined) design.copyCodeBackground = design.buttonBackground;
  if (source.copyCodeColour === undefined) design.copyCodeColour = design.buttonColour;
  if (source.copyCodeEnabled !== undefined) {
    if (typeof source.copyCodeEnabled !== "boolean") throw new Error("Invalid design field: copyCodeEnabled");
    design.copyCodeEnabled = source.copyCodeEnabled;
  }
  design.overrides = { ...defaults.overrides };
  for (const placement of placements) {
    const item = (source.overrides as Record<string, unknown> | undefined)?.[placement.id];
    if (!item) continue;
    if (typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid placement text.");
    const copy = emptyCopy();
    for (const name of ["headline", "body", "buttonText"] as const) {
      const text = (item as Record<string, unknown>)[name];
      if (text === undefined) continue;
      if (typeof text !== "string" || text.length > (placement.id === "badge" && name === "headline" ? 40 : copyLimits[name])) throw new Error("Placement text is too long.");
      copy[name] = text.trim();
    }
    design.overrides[placement.id] = copy;
  }
  if (source.palette !== undefined) {
    if (!source.palette || typeof source.palette !== "object" || Array.isArray(source.palette)) throw new Error("Invalid campaign colours.");
    const palette: NonNullable<PromotionDesign["palette"]> = {};
    for (const name of ["onColour", "onWhite", "button"] as const) {
      const colour = (source.palette as Record<string, unknown>)[name];
      if (colour === undefined) continue;
      if (typeof colour !== "string" || !/^#[\da-f]{6}$/i.test(colour)) throw new Error("Use six-digit hex colours.");
      palette[name] = colour.toLowerCase();
    }
    design.palette = palette;
  }
  if (source.blocks !== undefined) {
    if (!source.blocks || typeof source.blocks !== "object" || Array.isArray(source.blocks)) throw new Error("Invalid block settings.");
    design.blocks = {};
    for (const placement of placements) {
      const block = (source.blocks as Record<string, unknown>)[placement.id];
      if (block !== undefined) design.blocks[placement.id] = readBlock(block, placement.id);
    }
  }
  return design;
}

function readBlock(value: unknown, placement: Placement): PromotionBlock {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid block settings.");
  const source = value as Record<string, unknown>;
  const block = {} as PromotionBlock;
  const limits = { headline: placement === "badge" ? 40 : 120, body: 500, buttonText: 60, buttonUrl: 2048, countdownText: 80, backgroundColour: 7, textColour: 7, badgeColour: 7 };
  for (const name of Object.keys(limits) as Array<keyof typeof limits>) {
    if (typeof source[name] !== "string" || (source[name] as string).length > limits[name]) throw new Error(`Invalid ${placement} block field: ${name}`);
    block[name] = (source[name] as string).trim();
  }
  if (!safeLink(block.buttonUrl)) throw new Error("Use a relative shop link or an http/https button link.");
  for (const name of ["backgroundColour", "textColour", "badgeColour"] as const) if (!/^#[\da-f]{6}$/i.test(block[name])) throw new Error("Use six-digit hex colours.");
  if (!source.visibility || typeof source.visibility !== "object" || Array.isArray(source.visibility)) throw new Error("Invalid block visibility.");
  block.visibility = {} as BlockVisibility;
  for (const name of ["headline", "body", "image", "offerNote", "discountCode", "countdown", "button"] as const) {
    const next = (source.visibility as Record<string, unknown>)[name];
    if (typeof next !== "boolean") throw new Error(`Invalid ${placement} visibility: ${name}`);
    block.visibility[name] = next;
  }
  if (!source.style || typeof source.style !== "object" || Array.isArray(source.style)) throw new Error("Invalid block styling.");
  const { overrides: ignoredOverrides, blocks: ignoredBlocks, palette: ignoredPalette, ...style } = readDesign({ ...source.style, overrides: {}, blocks: undefined, palette: undefined });
  void ignoredOverrides; void ignoredBlocks; void ignoredPalette;
  block.style = style;
  return block;
}

// Old campaigns retain their shared design and text overrides until a block is
// edited. A block snapshot then becomes independent of every other placement.
export function promotionBlock(value: WebsiteDraft, placement: Placement): PromotionBlock {
  const saved = value.design.blocks?.[placement];
  if (saved) return saved;
  const { overrides, blocks: ignoredBlocks, palette: ignoredPalette, ...style } = value.design;
  void ignoredBlocks; void ignoredPalette;
  if (placement === "header") { style.headingSize = 16; style.bodySize = 13; style.spacing = 12; style.alignment = "center"; }
  if (placement === "product") style.headingSize = Math.min(style.headingSize, 26);
  if (placement === "badge") style.headingSize = 12;
  return {
    headline: overrides[placement].headline || (placement === "badge" ? value.badgeText : value.headline), body: overrides[placement].body || value.body,
    buttonText: overrides[placement].buttonText || value.buttonText, buttonUrl: value.buttonUrl, countdownText: value.countdownText,
    backgroundColour: value.backgroundColour, textColour: value.textColour, badgeColour: value.badgeColour,
    visibility: { headline: true, body: true, image: placement === "collection", offerNote: true, discountCode: true, countdown: value.showCountdown, button: true }, style,
  };
}

export function setPromotionBlock(value: WebsiteDraft, placement: Placement, block: PromotionBlock): WebsiteDraft {
  return { ...value, design: { ...value.design, blocks: { ...value.design.blocks, [placement]: block } } };
}
export function presetDesign(preset: PromotionDesign["preset"], current: PromotionDesign): PromotionDesign {
  const styles = preset === "campaign" ? { imageLayout: "full" as const, bannerHeight: 360, headingSize: 36, spacing: 32, radius: 12 } : preset === "compact" ? { imageLayout: "half-right" as const, bannerHeight: 180, headingSize: 22, spacing: 16, radius: 6 } : { imageLayout: "half-right" as const, bannerHeight: 280, headingSize: 28, spacing: 24, radius: 8 };
  return { ...current, ...styles, preset };
}
export function contrastRatio(a: string, b: string): number {
  function luminance(hex: string) {
    if (!/^#[\da-f]{6}$/i.test(hex)) return NaN;
    const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function countdown(endsAt: string | null | undefined, now: number): string {
  if (!endsAt) return "";
  const remaining = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(remaining)) return "";
  if (remaining <= 0) return "Offer ended";
  const minutes = Math.ceil(remaining / 60000);
  return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h ${minutes % 60}m`;
}
export function countdownParts(endsAt: string | null | undefined, now: number) {
  if (!endsAt || !Number.isFinite(Date.parse(endsAt))) return null;
  const seconds = Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 1000));
  return { ended: seconds === 0, days: Math.floor(seconds / 86400), hours: Math.floor(seconds % 86400 / 3600), minutes: Math.floor(seconds % 3600 / 60), seconds: seconds % 60 };
}
export function validateWebsite(value: WebsiteDraft, endsAt?: string | null): string[] {
  const errors: string[] = [];
  try { readDesign(value.design); } catch (error) { errors.push(error instanceof Error ? error.message : "Invalid design settings."); }
  for (const name of Object.keys(copyLimits) as Array<keyof typeof copyLimits>) if (value[name].length > copyLimits[name]) errors.push(`${name} is too long.`);
  if (value.buttonUrl.length > 2048) errors.push("The button link is too long.");
  if (!safeLink(value.buttonUrl)) errors.push("Use a relative shop link or an http/https button link.");
  if (value.websiteEnabled && !placements.some(p => value[p.flag])) errors.push("Choose at least one website placement.");
  for (const placement of placements.filter(p => value[p.flag])) {
    const block = promotionBlock(value, placement.id);
    if (value.websiteEnabled && block.visibility.headline && !block.headline) errors.push(`Add a headline for the ${placement.title} block, or hide its headline.`);
    if (placement.id !== "badge" && block.visibility.countdown && !endsAt) errors.push(`${placement.title}: set an end date to show a countdown.`);
    if (placement.id !== "badge" && block.visibility.button && block.buttonText && !block.buttonUrl) errors.push(`${placement.title}: select a link for the promotion button.`);
  }
  return errors;
}

export function readWebsite(value: unknown): WebsiteDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid website settings.");
  const source = value as Record<string, unknown>;
  const result = { design: readDesign(source.design ?? {}) } as WebsiteDraft;
  for (const name of ["websiteEnabled", "showProductPage", "showCollectionPage", "showProductBadge", "showCountdown", "showHeaderBanner"] as const) {
    if (typeof source[name] !== "boolean") throw new Error("Invalid website setting: " + name);
    result[name] = source[name] as boolean;
  }
  for (const name of ["headline", "body", "badgeText", "countdownText", "buttonText", "buttonUrl", "backgroundColour", "textColour", "badgeColour"] as const) {
    if (typeof source[name] !== "string") throw new Error("Invalid website text: " + name);
    result[name] = (source[name] as string).trim();
  }
  for (const name of ["backgroundColour", "textColour", "badgeColour"] as const) if (!/^#[\da-f]{6}$/i.test(result[name])) throw new Error("Use six-digit hex colours.");
  result.priority = Number(source.priority);
  if (!Number.isInteger(result.priority) || result.priority < 0 || result.priority > 9999) throw new Error("Priority must be between 0 and 9999.");
  return result;
}
export function websiteFromSettings(settings: { [K in Exclude<keyof WebsiteDraft, "design">]: WebsiteDraft[K] extends string ? string | null : WebsiteDraft[K] } & { designJson?: string | null }): WebsiteDraft {
  return readWebsite({ ...settings, headline: settings.headline ?? "", body: settings.body ?? "", badgeText: settings.badgeText ?? "", countdownText: settings.countdownText ?? "", buttonText: settings.buttonText ?? "", buttonUrl: settings.buttonUrl ?? "", backgroundColour: settings.backgroundColour || "#ffffff", textColour: settings.textColour || "#000000", badgeColour: settings.badgeColour || "#d72c0d", design: readDesign(settings.designJson ?? "{}") });
}
export function websiteStorage(value: WebsiteDraft) {
  const { design, ...fields } = value;
  return { ...fields, designJson: JSON.stringify(design) };
}
