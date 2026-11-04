import { readAppMetafield, writeAppMetafield } from "../shipping/appMetafield.server";
import { defaultPriceDisplay, validatePriceDisplay, type PriceDisplayConfig } from "./config";

type Admin = Parameters<typeof readAppMetafield>[0];

/** The theme block reads this as `app.metafields.price_display.config.value`. */
export const priceNamespace = "price_display";
const key = "config";

/** The saved settings, or the defaults (flagged) when nothing has been saved yet. Saved data that no longer validates is not trusted. */
export async function loadPriceDisplay(admin: Admin): Promise<{ config: PriceDisplayConfig; saved: boolean }> {
  const value = await readAppMetafield(admin, key, priceNamespace);
  if (!value) return { config: defaultPriceDisplay, saved: false };
  try {
    const check = validatePriceDisplay(JSON.parse(value));
    if (check.ok) return { config: check.config, saved: true };
  } catch { /* fall through to the defaults */ }
  return { config: defaultPriceDisplay, saved: false };
}

/** Saves the settings, or returns what is wrong with them. */
export async function savePriceDisplay(admin: Admin, input: unknown): Promise<{ ok: true; config: PriceDisplayConfig } | { ok: false; errors: string[] }> {
  const check = validatePriceDisplay(input);
  if (!check.ok) return check;
  const errors = await writeAppMetafield(admin, key, JSON.stringify(check.config), priceNamespace);
  return errors.length ? { ok: false, errors } : { ok: true, config: check.config };
}
