import { readAppMetafield, writeAppMetafield } from "../appMetafield.server";
import type { ShippingSnapshot } from "./deliveryModel";
import { freeDeliveryTable, type FreeDeliveryTable } from "./freeService";
import { loadShippingSnapshot } from "./shippingReader.server";

type Admin = Parameters<typeof readAppMetafield>[0];

export const freeDeliveryKey = "delivery";

/** What the product page reads: where free delivery is offered and from what order total, as of the last time shipping was read. */
export async function loadPublishedFreeDelivery(admin: Admin): Promise<FreeDeliveryTable | null> {
  const value = await readAppMetafield(admin, freeDeliveryKey);
  if (!value) return null;
  try {
    const table = JSON.parse(value) as FreeDeliveryTable;
    return table?.version === 1 && table.countries && typeof table.countries === "object" ? table : null;
  } catch { return null; }
}

/** Publishes the table made from a shipping snapshot, only writing when it differs from what is already there. */
export async function publishFreeDelivery(admin: Admin, snapshot: ShippingSnapshot): Promise<{ changed: boolean; table: FreeDeliveryTable }> {
  const table = freeDeliveryTable(snapshot);
  const text = JSON.stringify(table);
  if ((await readAppMetafield(admin, freeDeliveryKey)) === text) return { changed: false, table };
  const errors = await writeAppMetafield(admin, freeDeliveryKey, text);
  if (errors.length) throw new Error(errors.join(" "));
  return { changed: true, table };
}

/** Reads shipping fresh from Shopify and publishes it. Used when shipping changes in Shopify. */
export async function syncFreeDelivery(admin: Admin) {
  return publishFreeDelivery(admin, await loadShippingSnapshot(admin));
}

/** Makes sure something has been published, so the product page works before anyone opens the Shipping page. Cheap once it has. */
export async function ensureFreeDelivery(admin: Admin) {
  if ((await readAppMetafield(admin, freeDeliveryKey)) !== null) return;
  await syncFreeDelivery(admin);
}
