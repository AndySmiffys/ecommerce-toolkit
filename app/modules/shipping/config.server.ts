import { readAppMetafield, writeAppMetafield } from "./appMetafield.server";
import { defaultShippingConfig, validateShippingConfig, type DeliveryServiceSetting, type ShippingCountdownConfig } from "./config";

type Admin = Parameters<typeof readAppMetafield>[0];

const key = "config";

/** The saved settings, or the defaults (flagged) when nothing has been saved yet. Saved data that no longer validates is not trusted. */
export async function loadShippingConfig(admin: Admin): Promise<{ config: ShippingCountdownConfig; saved: boolean }> {
  const value = await readAppMetafield(admin, key);
  if (!value) return { config: defaultShippingConfig, saved: false };
  try {
    const check = validateShippingConfig(JSON.parse(value));
    if (check.ok) return { config: check.config, saved: true };
  } catch { /* fall through to the defaults */ }
  return { config: defaultShippingConfig, saved: false };
}

/**
 * Saves the settings. The delivery services are edited on the Shipping page and the rest on Shipping countdown, each posting only its own part,
 * so `keepServices` keeps the services already saved instead of whatever the posting page last saw.
 */
export async function saveShippingConfig(admin: Admin, input: unknown, options: { keepServices?: boolean } = {}): Promise<{ ok: true; config: ShippingCountdownConfig } | { ok: false; errors: string[] }> {
  let candidate = input;
  if (options.keepServices && input && typeof input === "object") {
    const stored = (await loadShippingConfig(admin)).config.delivery.services;
    const delivery = ((input as { delivery?: unknown }).delivery && typeof (input as { delivery?: unknown }).delivery === "object" ? (input as { delivery: object }).delivery : {});
    candidate = { ...input, delivery: { ...delivery, services: stored } };
  }
  const check = validateShippingConfig(candidate);
  if (!check.ok) return check;
  const errors = await writeAppMetafield(admin, key, JSON.stringify(check.config));
  return errors.length ? { ok: false, errors } : { ok: true, config: check.config };
}

/** Saves the delivery services (what the app adds to each Shopify shipping option) into the latest saved settings, leaving the rest as it is. */
export async function saveDeliveryServices(admin: Admin, services: unknown): Promise<{ ok: true; services: DeliveryServiceSetting[] } | { ok: false; errors: string[] }> {
  const { config } = await loadShippingConfig(admin);
  const result = await saveShippingConfig(admin, { ...config, delivery: { ...config.delivery, services } });
  return result.ok ? { ok: true, services: result.config.delivery.services } : result;
}
