/**
 * How the Discounted price block looks and what it says: one JSON document the merchant edits in the app and the theme block reads from an
 * app metafield (`price_display.config`). Which discounts apply to a product, and what they take off, come from the promotions (see
 * promotions/design/priceRule.ts); only the presentation is set here.
 */

export type PriceDisplayConfig = {
  version: 1;
  /** Show "Save £4.00" beside the old price. */
  showSavings: boolean;
  /** {amount} is what is saved, {percent} the percentage of the old price. */
  savingsText: string;
  /** Said under the price when a code would make it lower. {price} is the price with the code, {code} the code, {amount} and {percent} what it saves against the price before any discount. */
  codeText: string;
  /** Text size in px, or 0 to use the theme's own size. */
  size: number;
  weight: "400" | "500" | "600" | "700";
  /** Space above and below, px. */
  margin: number;
  /** The price when nothing is taken off it. Empty is the theme's own text colour. */
  textColour: string;
  saleColour: string;
  /** The old price, struck through. */
  wasColour: string;
  saveBackground: string;
  saveText: string;
  codeColour: string;
};

export const defaultPriceDisplay: PriceDisplayConfig = {
  version: 1,
  showSavings: false,
  savingsText: "Save {amount}",
  codeText: "{price} with code {code}",
  size: 0,
  weight: "600",
  margin: 0,
  textColour: "",
  saleColour: "#b12704",
  wasColour: "#6b6b6b",
  saveBackground: "#b12704",
  saveText: "#ffffff",
  codeColour: "#1e7e34",
};

/** What can be written in braces in the saving message and in the code message. */
export const savingsPlaceholders = [
  { name: "amount", meaning: "How much is saved, written as the shop writes prices", example: "£4.00" },
  { name: "percent", meaning: "The percentage of the old price that is saved, as a whole number (do not add the % sign)", example: "20" },
] as const;
export const codePlaceholders = [
  { name: "price", meaning: "The price with the code applied", example: "£15.00" },
  { name: "code", meaning: "The code the shopper types", example: "SAVE25" },
  { name: "amount", meaning: "How much the code takes off the price before any discount", example: "£5.00" },
  { name: "percent", meaning: "The percentage of the price before any discount that the code takes off, as a whole number (do not add the % sign)", example: "25" },
] as const;

const hexColour = /^#[0-9a-fA-F]{6}$/;
const textLimit = 100;

export type PriceDisplayCheck = { ok: true; config: PriceDisplayConfig } | { ok: false; errors: string[] };

const unknownIn = (text: string, known: ReadonlyArray<{ name: string }>) => [...new Set([...text.matchAll(/\{([^{}]*)\}/g)].map(match => match[1]).filter(name => !known.some(item => item.name === name)))].map(name => `{${name}}`);

/** Checks what was entered and returns the clean settings, or every problem found. Takes unknown input so the same check protects the save and the metafield read back. */
export function validatePriceDisplay(input: unknown): PriceDisplayCheck {
  const errors: string[] = [];
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d = defaultPriceDisplay;
  const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  const colour = (value: unknown, label: string, fallback: string, allowEmpty = false) => {
    if (value === undefined) return fallback;
    if (value === "" && allowEmpty) return "";
    if (typeof value !== "string" || !hexColour.test(value)) { errors.push(`${label} must be a colour such as #b12704.`); return fallback; }
    return value.toLowerCase();
  };
  const whole = (value: unknown, label: string, min: number, max: number, fallback: number) => {
    if (value === undefined) return fallback;
    const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
    if (!Number.isInteger(n) || n < min || n > max) { errors.push(`${label} must be a whole number from ${min} to ${max}.`); return fallback; }
    return n;
  };
  const message = (value: unknown, label: string, fallback: string, known: ReadonlyArray<{ name: string }>, required: string[]) => {
    const clean = typeof value === "string" ? value.trim() : fallback;
    if (!clean) { errors.push(`${label} cannot be empty.`); return fallback; }
    if (clean.length > textLimit) errors.push(`${label} must be ${textLimit} characters or fewer.`);
    const unknown = unknownIn(clean, known);
    if (unknown.length) errors.push(`${label} uses ${unknown.join(", ")}, which is not a placeholder. You can use ${known.map(item => `{${item.name}}`).join(", ")}.`);
    else for (const name of required) if (!clean.includes(`{${name}}`)) errors.push(`${label} must include {${name}}.`);
    return clean;
  };
  const weight = source.weight === undefined ? d.weight : source.weight;
  if (typeof weight !== "string" || !["400", "500", "600", "700"].includes(weight)) errors.push("Font weight is not one of the choices.");
  const config: PriceDisplayConfig = {
    version: 1,
    showSavings: flag(source.showSavings, d.showSavings),
    savingsText: message(source.savingsText, "Saving message", d.savingsText, savingsPlaceholders, []),
    codeText: message(source.codeText, "Code message", d.codeText, codePlaceholders, ["price", "code"]),
    size: whole(source.size, "Text size", 0, 48, d.size),
    weight: (["400", "500", "600", "700"].includes(weight as string) ? weight : d.weight) as PriceDisplayConfig["weight"],
    margin: whole(source.margin, "Space above and below", 0, 40, d.margin),
    textColour: colour(source.textColour, "Price colour", d.textColour, true),
    saleColour: colour(source.saleColour, "Sale price colour", d.saleColour),
    wasColour: colour(source.wasColour, "Old price colour", d.wasColour),
    saveBackground: colour(source.saveBackground, "Saving background colour", d.saveBackground),
    saveText: colour(source.saveText, "Saving text colour", d.saveText),
    codeColour: colour(source.codeColour, "Code message colour", d.codeColour),
  };
  return errors.length ? { ok: false, errors } : { ok: true, config };
}
