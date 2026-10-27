import { formatMinor, transitText, type DeliveryProfile, type DeliveryRate, type DeliveryZone, type ShippingSnapshot } from "./deliveryModel";

/**
 * Which of a zone's rates is "the free service". Shopify has no such thing as a free-shipping setting: free delivery is a rate that costs
 * nothing, usually with a minimum order total (the threshold), or with no condition at all (free for everyone).
 */

/** What an order total must be for a rate to apply: min and max in minor units, or null when the rate has another kind of condition. */
export function priceRange(rate: DeliveryRate): { min: number; max: number } | null {
  let min = 0;
  let max = Infinity;
  for (const condition of rate.conditions) {
    if (condition.field !== "TOTAL_PRICE" || !("money" in condition)) return null;
    if (condition.operator === "GREATER_THAN_OR_EQUAL_TO") min = Math.max(min, condition.money.amount);
    else if (condition.operator === "LESS_THAN_OR_EQUAL_TO") max = Math.min(max, condition.money.amount);
    else return null;
  }
  return { min, max };
}

const hasWeightCondition = (rate: DeliveryRate) => rate.conditions.some(condition => condition.field === "TOTAL_WEIGHT");

export const isFreeRate = (rate: DeliveryRate) => rate.kind === "fixed" && rate.price !== null && rate.price.amount === 0;

export type FreeOption =
  | { kind: "always"; rate: DeliveryRate }
  /** Free from this order total up. */
  | { kind: "threshold"; rate: DeliveryRate; thresholdMinor: number; currency: string }
  /** Free, but depending on weight or something else, so there is no order total to name. */
  | { kind: "other"; rate: DeliveryRate };

export function freeOption(rate: DeliveryRate): FreeOption | null {
  if (!isFreeRate(rate)) return null;
  if (!rate.conditions.length) return { kind: "always", rate };
  const range = hasWeightCondition(rate) ? null : priceRange(rate);
  if (!range) return { kind: "other", rate };
  if (range.min <= 0) return { kind: "always", rate };
  return { kind: "threshold", rate, thresholdMinor: range.min, currency: rate.price!.currency };
}

export type ZoneFree = {
  /** Every free rate in the zone, switched on or not. */
  options: FreeOption[];
  /** The one shoppers get among rates that are switched on: always free, else the lowest threshold, else a free rate that depends on something other than the order total. */
  effective: FreeOption | null;
};

export function zoneFree(zone: DeliveryZone): ZoneFree {
  const options = zone.rates.map(freeOption).filter((option): option is FreeOption => option !== null);
  const live = options.filter(option => option.rate.active);
  const always = live.find(option => option.kind === "always");
  const thresholds = live.filter((option): option is Extract<FreeOption, { kind: "threshold" }> => option.kind === "threshold").sort((a, b) => a.thresholdMinor - b.thresholdMinor);
  return { options, effective: always ?? thresholds[0] ?? live.find(option => option.kind === "other") ?? null };
}

export const activeRates = (zone: DeliveryZone) => zone.rates.filter(rate => rate.active);

/** Sentence for a zone's free option, as the review shows it. */
export function describeFree(free: ZoneFree, money: (minor: number, currency: string) => string): string {
  const { effective, options } = free;
  if (effective?.kind === "always") return "Always free";
  if (effective?.kind === "threshold") return `Free over ${money(effective.thresholdMinor, effective.currency)}`;
  if (effective?.kind === "other") return "Free, depending on something other than the order total";
  return options.length ? "Free rate is switched off" : "No free option";
}

/** The default profile, or the first one if Shopify names none. */
export function defaultProfile(snapshot: ShippingSnapshot): DeliveryProfile | null {
  return snapshot.profiles.find(profile => profile.isDefault) ?? snapshot.profiles[0] ?? null;
}

/**
 * Which rates cover a country in a profile: the zone that names it, else the rest-of-world zone. A country named in a zone with no rates
 * is not given to the rest-of-world zone, matching how Shopify assigns destinations.
 */
export function zoneForCountry(profile: DeliveryProfile, country: string): DeliveryZone | null {
  return profile.zones.find(zone => zone.countries.includes(country)) ?? profile.zones.find(zone => zone.restOfWorld) ?? null;
}

/** What one destination gets. `free: false` is written out because the theme's Liquid cannot tell a missing key from a null. */
export type FreeDeliveryEntry = { free: false } | { free: true; /** 0 means always free. */ thresholdMinor: number; rate: string };

export type FreeDeliveryTable = {
  version: 1;
  currency: string;
  /** By country named in a zone. A zone with no free option says so, and does not borrow the rest-of-world zone's. */
  countries: Record<string, FreeDeliveryEntry>;
  /** For destinations not named in any zone, or null when there is no zone for them. */
  restOfWorld: FreeDeliveryEntry | null;
};

/**
 * The free-delivery table the product page reads. It comes from the default profile, which covers every product not given its own, and
 * the review flags a custom profile whose threshold is different.
 */
export function freeDeliveryTable(snapshot: ShippingSnapshot): FreeDeliveryTable {
  const table: FreeDeliveryTable = { version: 1, currency: snapshot.shopCurrency, countries: {}, restOfWorld: null };
  const profile = defaultProfile(snapshot);
  if (!profile) return table;
  const entry = (zone: DeliveryZone): FreeDeliveryEntry => {
    const effective = zoneFree(zone).effective;
    return effective && effective.kind !== "other" ? { free: true, thresholdMinor: effective.kind === "always" ? 0 : effective.thresholdMinor, rate: effective.rate.name } : { free: false };
  };
  for (const zone of profile.zones) {
    const found = entry(zone);
    if (zone.restOfWorld) table.restOfWorld = found;
    for (const country of zone.countries) table.countries[country] = found;
  }
  return table;
}

/** What a shopper in a country gets from a published table. */
export function freeDeliveryFor(table: FreeDeliveryTable, country: string): FreeDeliveryEntry | null {
  return table.countries[country] ?? table.restOfWorld;
}

/** A rate in a line: "Standard: £4.99 (up to £49.99)", "Free delivery: free (from £50)", "Courier: worked out by a carrier". */
export function describeRate(rate: DeliveryRate, money: (minor: number, currency: string) => string = formatMinor): string {
  const currency = rate.price?.currency ?? "GBP";
  const price = rate.kind === "carrier" || !rate.price ? "worked out by a carrier" : rate.price.amount === 0 ? "free" : money(rate.price.amount, currency);
  let when = "";
  if (rate.kind === "fixed" && rate.conditions.length) {
    const range = priceRange(rate);
    if (!range) when = "depends on weight or other conditions";
    else if (range.min > 0 && range.max !== Infinity) when = `${money(range.min, currency)} to ${money(range.max, currency)}`;
    else if (range.min > 0) when = `from ${money(range.min, currency)}`;
    else if (range.max !== Infinity) when = `up to ${money(range.max, currency)}`;
  }
  return `${rate.name}: ${price}${when ? ` (${when})` : ""}${rate.transit ? `, ${transitText(rate.transit)}` : ""}${rate.active ? "" : " (switched off)"}`;
}
