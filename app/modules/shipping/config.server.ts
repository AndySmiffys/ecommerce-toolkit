import { readAppMetafield, writeAppMetafield } from "./appMetafield.server";
import { defaultShippingConfig, validateShippingConfig, type ShippingCountdownConfig } from "./config";

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

export async function saveShippingConfig(admin: Admin, input: unknown): Promise<{ ok: true; config: ShippingCountdownConfig } | { ok: false; errors: string[] }> {
  const check = validateShippingConfig(input);
  if (!check.ok) return check;
  const errors = await writeAppMetafield(admin, key, JSON.stringify(check.config));
  return errors.length ? { ok: false, errors } : { ok: true, config: check.config };
}
