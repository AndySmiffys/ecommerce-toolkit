import { defaultShippingConfig, validateShippingConfig, type ShippingCountdownConfig } from "./config";

type Admin = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };

/** The theme block reads this as `app.metafields.shipping_countdown.config.value`, like the promotion snapshot's metafields. */
export const metafieldNamespace = "shipping_countdown";
export const metafieldKey = "config";

async function graphql(admin: Admin, query: string, variables?: Record<string, unknown>) {
  const result = await (await admin.graphql(query, variables ? { variables } : undefined)).json();
  if (result.errors?.length) throw new Error(result.errors.map((error: { message: string }) => error.message).join(" "));
  return result.data;
}

/** The saved settings, or the defaults (flagged) when nothing has been saved yet. Saved data that no longer validates is not trusted. */
export async function loadShippingConfig(admin: Admin): Promise<{ config: ShippingCountdownConfig; saved: boolean }> {
  const data = await graphql(admin, `query ShippingCountdownConfig { currentAppInstallation { metafield(namespace: "${metafieldNamespace}", key: "${metafieldKey}") { value } } }`);
  const value = data?.currentAppInstallation?.metafield?.value;
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
  const owner = await graphql(admin, `query ShippingCountdownOwner { currentAppInstallation { id } }`);
  const ownerId = owner?.currentAppInstallation?.id;
  if (!ownerId) return { ok: false, errors: ["Shopify did not say which app installation to save the settings to."] };
  const data = await graphql(admin, `mutation ShippingCountdownSave($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { message } } }`, {
    metafields: [{ ownerId, namespace: metafieldNamespace, key: metafieldKey, type: "json", value: JSON.stringify(check.config) }],
  });
  const errors: Array<{ message: string }> | undefined = data?.metafieldsSet?.userErrors;
  if (!errors) return { ok: false, errors: ["Shopify did not confirm the save."] };
  if (errors.length) return { ok: false, errors: errors.map(error => error.message) };
  return { ok: true, config: check.config };
}
