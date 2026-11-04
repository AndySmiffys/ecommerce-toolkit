type Admin = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };

export const metafieldNamespace = "shipping_countdown";

async function graphql(admin: Admin, query: string, variables?: Record<string, unknown>) {
  const result = await (await admin.graphql(query, variables ? { variables } : undefined)).json();
  if (result.errors?.length) throw new Error(result.errors.map((error: { message: string }) => error.message).join(" "));
  return result.data;
}

/** The raw text of one of the shipping countdown's app metafields, or null when it has not been written. The theme block reads them as `app.metafields.shipping_countdown.<key>.value`. */
export async function readAppMetafield(admin: Admin, key: string, namespace: string = metafieldNamespace): Promise<string | null> {
  const data = await graphql(admin, `query ShippingMetafieldRead { currentAppInstallation { metafield(namespace: "${namespace}", key: "${key}") { value } } }`);
  return data?.currentAppInstallation?.metafield?.value ?? null;
}

/** Writes JSON text to one of the app metafields. Returns the problems Shopify reported, empty when it was saved. */
export async function writeAppMetafield(admin: Admin, key: string, value: string, namespace: string = metafieldNamespace): Promise<string[]> {
  const owner = await graphql(admin, `query ShippingMetafieldOwner { currentAppInstallation { id } }`);
  const ownerId = owner?.currentAppInstallation?.id;
  if (!ownerId) return ["Shopify did not say which app installation to save the settings to."];
  const data = await graphql(admin, `mutation ShippingMetafieldWrite($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { message } } }`, {
    metafields: [{ ownerId, namespace, key, type: "json", value }],
  });
  const errors: Array<{ message: string }> | undefined = data?.metafieldsSet?.userErrors;
  if (!errors) return ["Shopify did not confirm the save."];
  return errors.map(error => error.message);
}
