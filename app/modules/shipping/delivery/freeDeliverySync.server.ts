import { readAppMetafield, writeAppMetafield } from "../appMetafield.server";
import type { ShippingSnapshot } from "./deliveryModel";
import { deliveryServicesTable, type PublishedServices } from "./deliveryServices";
import { freeDeliveryTable, type FreeDeliveryTable } from "./freeService";
import { loadShippingSnapshot } from "./shippingReader.server";

type Admin = Parameters<typeof readAppMetafield>[0];

export const freeDeliveryKey = "delivery";
export const servicesKey = "delivery_services";

async function load<T extends { version: number }>(admin: Admin, key: string, valid: (value: T) => boolean): Promise<T | null> {
  const value = await readAppMetafield(admin, key);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed?.version === 1 && valid(parsed) ? parsed : null;
  } catch { return null; }
}

/** What the product page reads: where free delivery is offered and from what order total, as of the last time shipping was read. */
export const loadPublishedFreeDelivery = (admin: Admin) => load<FreeDeliveryTable>(admin, freeDeliveryKey, table => Boolean(table.countries) && typeof table.countries === "object");

/** The delivery services (names, price bands, delivery times) of each country, as of the last time shipping was read. */
export const loadPublishedServices = (admin: Admin) => load<PublishedServices>(admin, servicesKey, table => Boolean(table.zones) && typeof table.zones === "object" && Boolean(table.countries));

async function publish(admin: Admin, key: string, value: unknown): Promise<boolean> {
  const text = JSON.stringify(value);
  if ((await readAppMetafield(admin, key)) === text) return false;
  const errors = await writeAppMetafield(admin, key, text);
  if (errors.length) throw new Error(errors.join(" "));
  return true;
}

/** Publishes what the product page reads, from a shipping snapshot, writing each only when it differs from what is already there. */
export async function publishFreeDelivery(admin: Admin, snapshot: ShippingSnapshot): Promise<{ changed: boolean; table: FreeDeliveryTable; services: PublishedServices }> {
  const table = freeDeliveryTable(snapshot);
  const services = deliveryServicesTable(snapshot);
  const freeChanged = await publish(admin, freeDeliveryKey, table);
  const servicesChanged = await publish(admin, servicesKey, services);
  return { changed: freeChanged || servicesChanged, table, services };
}

/** Reads shipping fresh from Shopify and publishes it. Used when shipping changes in Shopify. */
export async function syncFreeDelivery(admin: Admin) {
  return publishFreeDelivery(admin, await loadShippingSnapshot(admin));
}

/** Makes sure something has been published, so the product page works before anyone opens the Shipping page. Cheap once it has. */
export async function ensureFreeDelivery(admin: Admin) {
  if ((await readAppMetafield(admin, freeDeliveryKey)) !== null && (await readAppMetafield(admin, servicesKey)) !== null) return;
  await syncFreeDelivery(admin);
}
