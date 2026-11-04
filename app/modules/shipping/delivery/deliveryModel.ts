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
  /**
   * The delivery time set on the option in Shopify, in business days. Absent when Shopify gave none or could not be asked (see
   * `ShippingSnapshot.transit`), in which case the days typed into the app are used.
   */
  transit?: Transit | null;
};

/** Business days from dispatch to delivery, a minimum and a maximum (the same number when Shopify has one figure). */
export type Transit = { minDays: number; maxDays: number };

export type DeliveryZone = {
  id: string;
  name: string;
  /** Two-letter country codes named in the zone. */
  countries: string[];
  /**
   * Regions (counties, nations) of a country the zone covers, by country, when it covers only some. A country missing here, or with an empty
   * list, is covered whole. A country can be split across zones: "Domestic" (England, Scotland, Wales) and "Northern Ireland".
   */
  regions?: Record<string, string[]>;
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
  /** Whether delivery times were read from Shopify. They are only offered by its unstable API, so this can stop working without warning. */
  transit?: "shopify" | "unavailable";
};

/** "2 business days", "1 business day", "2 to 3 business days". */
export function transitText(transit: Transit): string {
  const days = (n: number) => `${n} business day${n === 1 ? "" : "s"}`;
  return transit.minDays === transit.maxDays ? days(transit.maxDays) : `${transit.minDays} to ${days(transit.maxDays)}`;
}

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
