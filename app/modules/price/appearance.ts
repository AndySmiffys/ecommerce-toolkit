import type { PriceDisplayConfig } from "./config";

/**
 * The block's look as the stylesheet reads it: CSS variables on the element. The theme block's Liquid writes the same ones from the same
 * settings (a test renders it and compares), and the preview in the app uses this, so what you see here is what the product page gets.
 */
export function priceVars(config: PriceDisplayConfig): Record<string, string> {
  return {
    "--dp-margin": `${config.margin}px`,
    ...(config.size > 0 ? { "--dp-size": `${config.size}px` } : {}),
    "--dp-weight": config.weight,
    "--dp-text": config.textColour || "inherit",
    "--dp-sale": config.saleColour,
    "--dp-was": config.wasColour,
    "--dp-save-bg": config.saveBackground,
    "--dp-save-text": config.saveText,
    "--dp-auto": config.autoColour,
    "--dp-code": config.codeColour,
  };
}
