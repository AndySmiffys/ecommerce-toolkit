/**
 * Shopify's shipping setup in the shape the app reasons about. The reader (`shippingReader.server.ts`) builds it from the Admin API and
 * everything else here is plain functions of it, so they can be tested without Shopify. Money is whole minor units (pence).
 */

export type Money = { amount: number; currency: string };

export type RateCondition =
  | { field: "TOTAL_PRICE"; operator: "GREATER_THAN_OR_EQUAL_TO" | "LESS_THAN_OR_EQUAL_TO"; money: Money }
  | { field: "TOTAL_WEIGHT"; operator: "GREATER_THAN_OR_EQUAL_TO" | "LESS_THAN_OR_EQUAL_TO"; weight: { unit: string; value: number } }
  | { field: string; operator: string };

export type DeliveryRate = {
  id: string;
  name: string;
  active: boolean;
  /** A price set in Shopify, or a rate worked out live by a carrier. */
  kind: "fixed" | "carrier";
  /** Null for a carrier rate. */
  price: Money | null;
  conditions: RateCondition[];
};

export type DeliveryZone = {
  id: string;
  name: string;
  /** Two-letter country codes named in the zone. */
  countries: string[];
  /** The zone also covers every shipping destination not named in another zone of the profile. */
  restOfWorld: boolean;
  rates: DeliveryRate[];
};

export type DeliveryProfile = {
  id: string;
  name: string;
  isDefault: boolean;
  /** How many product variants are assigned to it. */
  variantCount: number;
  zones: DeliveryZone[];
};

export type Market = { id: string; name: string; active: boolean; countries: string[]; /** Its regions were more than could be read. */ truncated: boolean };

export type ShippingSnapshot = {
  shopCurrency: string;
  /** Two-letter codes Shopify says the shop ships to. */
  shipsTo: string[];
  profiles: DeliveryProfile[];
  /** Null when the app has not been given access to Markets. */
  markets: Market[] | null;
};

/** "49.99" to 4999. */
export function toMinor(amount: string | number): number {
  return Math.round(Number(amount) * 100);
}

export function formatMinor(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}
