import type { DeliveryZone, ShippingSnapshot, Transit } from "./deliveryModel";
import { defaultProfile, namingZones, primaryZone, priceRange } from "./freeService";

/**
 * The delivery services a shopper can choose in each country, as the product page and the settings read them. A service is a Shopify shipping
 * option: all the rates of one name in a zone (one per price band) are one service. Prices and delivery times come from Shopify; what the app
 * adds (guaranteed or not, delivery days, cut-offs) is in the app's own settings, matched by the option's name.
 */

/** From this order total up, this price. A band that starts at 0 is the one for every basket. */
export type ServiceTier = { from: number; price: number };

export type PublishedService = {
  name: string;
  tiers: ServiceTier[];
  /** The price also depends on something other than the order total (weight), so only the lowest price can be said. */
  complex?: true;
  /** The delivery time set in Shopify, in business days, when it could be read. */
  transit?: Transit;
};

export type PublishedServices = {
  version: 1;
  currency: string;
  /** Zones by a short key. A zone with no services is kept so a country named in it does not fall back to rest of world. */
  zones: Record<string, { name: string; services: PublishedService[] }>;
  /** Country to zone key. */
  countries: Record<string, string>;
  /** The zone for destinations not named in any zone, or null when there is none. */
  restOfWorld: string | null;
};

/** The name as a shopper would read it: stray and doubled spaces removed. */
export const cleanName = (name: string) => name.trim().replace(/\s+/g, " ");

/** What makes two lines the same service. Shopify needs a separate line for each price band, so the lines of one service share a name. */
export const serviceKey = (name: string) => cleanName(name).toLowerCase();

/**
 * The services of one zone: every active fixed-price rate, with lines of the same name joined into one service. Shopify only allows a free
 * threshold on a single option, so a service whose price changes with the order total is several lines with one name. Carrier-calculated rates
 * have no price or time to read.
 */
export function zoneServices(zone: DeliveryZone): PublishedService[] {
  const byName = new Map<string, PublishedService>();
  for (const rate of zone.rates) {
    if (!rate.active || rate.kind !== "fixed" || !rate.price) continue;
    const range = priceRange(rate);
    const service = byName.get(serviceKey(rate.name)) ?? { name: cleanName(rate.name), tiers: [] };
    const tier = { from: range?.min ?? 0, price: rate.price.amount };
    if (!service.tiers.some(item => item.from === tier.from && item.price === tier.price)) service.tiers.push(tier);
    if (!range) service.complex = true;
    if (rate.transit) {
      // Price bands of one option normally share a time. If they differ, keep the widest span so a date is never earlier than a band allows.
      service.transit = service.transit
        ? { minDays: Math.min(service.transit.minDays, rate.transit.minDays), maxDays: Math.max(service.transit.maxDays, rate.transit.maxDays) }
        : { ...rate.transit };
    }
    byName.set(serviceKey(rate.name), service);
  }
  return [...byName.values()].map(service => ({ ...service, tiers: service.tiers.sort((a, b) => a.from - b.from || a.price - b.price) }));
}

/** Built from the general profile, which covers every product not given its own (the review flags a custom profile that differs). */
export function deliveryServicesTable(snapshot: ShippingSnapshot): PublishedServices {
  const table: PublishedServices = { version: 1, currency: snapshot.shopCurrency, zones: {}, countries: {}, restOfWorld: null };
  const profile = defaultProfile(snapshot);
  if (!profile) return table;
  profile.zones.forEach((zone, index) => {
    const key = `z${index}`;
    table.zones[key] = { name: zone.name, services: zoneServices(zone) };
    if (zone.restOfWorld) table.restOfWorld = key;
  });
  // A country split into zones by region has one zone per region. A product page only knows the country, so it shows the one covering most.
  for (const country of new Set(profile.zones.flatMap(zone => zone.countries))) {
    const primary = primaryZone(namingZones(profile, country), country);
    if (primary) table.countries[country] = `z${profile.zones.indexOf(primary)}`;
  }
  return table;
}

/** The services a shopper in a country can choose, from a published table. */
export function servicesFor(table: PublishedServices, country: string): PublishedService[] {
  const key = table.countries[country] ?? table.restOfWorld;
  return key ? table.zones[key]?.services ?? [] : [];
}

/** Every service name in the table, with the zones it is offered in, in the order first met. For listing what there is to set up. */
export function serviceCatalogue(table: PublishedServices): Array<{ name: string; zones: string[]; service: PublishedService }> {
  const found = new Map<string, { name: string; zones: string[]; service: PublishedService }>();
  for (const zone of Object.values(table.zones)) {
    for (const service of zone.services) {
      const entry = found.get(serviceKey(service.name));
      if (entry) {
        entry.zones.push(zone.name);
        // Shown for the first zone it appears in; the zones can differ, which the page says.
      } else found.set(serviceKey(service.name), { name: service.name, zones: [zone.name], service });
    }
  }
  return [...found.values()];
}
