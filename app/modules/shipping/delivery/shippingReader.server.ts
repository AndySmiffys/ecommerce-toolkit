import { ApiVersion } from "@shopify/shopify-api";
import { codeGraphql } from "../../promotions/services/discountCodes.server";
import type { ShopifyAdminClient } from "../../promotions/services/discount.server";
import { toMinor, type DeliveryProfile, type DeliveryRate, type DeliveryZone, type Market, type RateCondition, type ShippingSnapshot, type Transit } from "./deliveryModel";

type PageInfo = { hasNextPage: boolean; endCursor: string | null };
type RawCountry = { name: string; code: { countryCode: string | null; restOfWorld: boolean }; provinces?: Array<{ name: string; code: string }> };
type RawCondition = { field: string; operator: string; conditionCriteria: { __typename: string; amount?: string; currencyCode?: string; unit?: string; value?: number } };
export type RawRate = { id: string; name: string; active: boolean; rateProvider: { __typename: string; price?: { amount: string; currencyCode: string } }; methodConditions: RawCondition[] };
export type RawZone = { zone: { id: string; name: string; countries: RawCountry[] }; methodDefinitions: { nodes: RawRate[]; pageInfo: PageInfo } };
type RawProfile = { id: string; name: string; default: boolean; productVariantsCount: { count: number } | null; profileLocationGroups: Array<{ locationGroup: { id: string } }> };
export type RawMarket = { id: string; name: string; status: string; conditions: { regionsCondition: { regions: { nodes: Array<{ name: string; code?: string }>; pageInfo: { hasNextPage: boolean } } } | null } | null };

const profilesQuery = `#graphql
query ShippingReviewProfiles($after: String) {
  shop { currencyCode shipsToCountries }
  deliveryProfiles(first: 25, after: $after) {
    nodes {
      id
      name
      default
      productVariantsCount { count }
      profileLocationGroups { locationGroup { id } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

// One zone at a time, so the rates and their conditions stay inside Shopify's query cost limit.
const zoneQuery = `#graphql
query ShippingReviewZone($profile: ID!, $group: ID!, $after: String, $methodsAfter: String) {
  deliveryProfile(id: $profile) {
    profileLocationGroups(locationGroupId: $group) {
      locationGroupZones(first: 1, after: $after) {
        nodes {
          zone { id name countries { name code { countryCode restOfWorld } provinces { name code } } }
          methodDefinitions(first: 100, after: $methodsAfter) {
            nodes {
              id
              name
              active
              rateProvider {
                __typename
                ... on DeliveryRateDefinition { price { amount currencyCode } }
              }
              methodConditions {
                field
                operator
                conditionCriteria {
                  __typename
                  ... on MoneyV2 { amount currencyCode }
                  ... on Weight { unit value }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

// Delivery times ("2 business days") are only in Shopify's unstable API, so this is a separate, optional read. It asks for each option's name and
// the transit time of its rates, a zone at a time, and is matched to the rates already read by zone and name.
const transitQuery = `#graphql
query ShippingTransitTimes($profile: ID!, $group: ID!, $after: String) {
  deliveryProfile(id: $profile) {
    profileLocationGroups(locationGroupId: $group) {
      locationGroupZones(first: 5, after: $after) {
        nodes {
          zone { id }
          methodDefinitions(first: 50) {
            nodes {
              name
              rateGroups(first: 20) {
                nodes {
                  rateProviders(first: 20) {
                    nodes {
                      ... on DeliveryRateDefinition { minTransitTime maxTransitTime }
                    }
                  }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const marketsQuery = `#graphql
query ShippingReviewMarkets($after: String) {
  markets(first: 50, after: $after) {
    nodes {
      id
      name
      status
      conditions {
        regionsCondition {
          regions(first: 250) {
            nodes { name ... on MarketRegionCountry { code } }
            pageInfo { hasNextPage }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** A rate as Shopify sends it, in the app's own shape. A condition on something other than price or weight is kept but not interpreted. */
export function parseRate(raw: RawRate): DeliveryRate {
  const fixed = raw.rateProvider.__typename === "DeliveryRateDefinition" && raw.rateProvider.price;
  const conditions = raw.methodConditions.map((condition): RateCondition => {
    const criteria = condition.conditionCriteria;
    const operator = condition.operator;
    if (condition.field === "TOTAL_PRICE" && criteria.__typename === "MoneyV2" && criteria.amount !== undefined && (operator === "GREATER_THAN_OR_EQUAL_TO" || operator === "LESS_THAN_OR_EQUAL_TO")) {
      return { field: "TOTAL_PRICE", operator, money: { amount: toMinor(criteria.amount), currency: criteria.currencyCode ?? "" } };
    }
    if (condition.field === "TOTAL_WEIGHT" && criteria.__typename === "Weight" && (operator === "GREATER_THAN_OR_EQUAL_TO" || operator === "LESS_THAN_OR_EQUAL_TO")) {
      return { field: "TOTAL_WEIGHT", operator, weight: { unit: criteria.unit ?? "", value: criteria.value ?? 0 } };
    }
    return { field: condition.field, operator };
  });
  return {
    id: raw.id,
    name: raw.name,
    active: raw.active,
    kind: fixed ? "fixed" : "carrier",
    price: fixed ? { amount: toMinor(fixed.amount), currency: fixed.currencyCode } : null,
    conditions,
  };
}

export type RawTransitZone = { zone: { id: string }; methodDefinitions: { nodes: Array<{ name: string; rateGroups: { nodes: Array<{ rateProviders: { nodes: Array<{ minTransitTime?: number | null; maxTransitTime?: number | null }> } }> } | null }> } };

const SECONDS_PER_DAY = 86400;

/**
 * Delivery times by zone and option name, as business days. Shopify keeps them in seconds on each rate. An option can have several rates (a
 * price band each) and they normally share one time; if they differ, the widest span is kept so a date is never earlier than a rate allows.
 */
export function parseTransit(zones: RawTransitZone[]): Map<string, Transit> {
  const found = new Map<string, Transit>();
  for (const zone of zones) {
    for (const method of zone.methodDefinitions.nodes) {
      const seconds = (method.rateGroups?.nodes ?? []).flatMap(group => group.rateProviders?.nodes ?? []);
      const mins = seconds.map(rate => rate.minTransitTime).filter((value): value is number => typeof value === "number" && value >= 0);
      const maxes = seconds.map(rate => rate.maxTransitTime).filter((value): value is number => typeof value === "number" && value >= 0);
      const lows = mins.length ? mins : maxes;
      const highs = maxes.length ? maxes : mins;
      if (!lows.length || !highs.length) continue;
      const key = `${zone.zone.id}|${method.name}`;
      const next = { minDays: Math.round(Math.min(...lows) / SECONDS_PER_DAY), maxDays: Math.round(Math.max(...highs) / SECONDS_PER_DAY) };
      const previous = found.get(key);
      found.set(key, previous ? { minDays: Math.min(previous.minDays, next.minDays), maxDays: Math.max(previous.maxDays, next.maxDays) } : next);
    }
  }
  return found;
}

export function parseZone(raw: RawZone, rates: RawRate[], idPrefix = ""): DeliveryZone {
  const regions: Record<string, string[]> = {};
  for (const country of raw.zone.countries) {
    if (country.code.countryCode && country.provinces?.length) regions[country.code.countryCode] = country.provinces.map(province => province.name);
  }
  return {
    id: `${idPrefix}${raw.zone.id}`,
    name: raw.zone.name,
    countries: raw.zone.countries.flatMap(country => (country.code.countryCode ? [country.code.countryCode] : [])),
    ...(Object.keys(regions).length ? { regions } : {}),
    restOfWorld: raw.zone.countries.some(country => country.code.restOfWorld),
    rates: rates.map(parseRate),
  };
}

export function parseMarket(raw: RawMarket): Market {
  const regions = raw.conditions?.regionsCondition?.regions;
  return {
    id: raw.id,
    name: raw.name,
    active: raw.status === "ACTIVE",
    countries: regions?.nodes.flatMap(region => (region.code && /^[A-Z]{2}$/.test(region.code) ? [region.code] : [])) ?? [],
    truncated: Boolean(regions?.pageInfo.hasNextPage),
  };
}

function nextCursor(info: PageInfo, previous: string | null): string | null {
  if (!info.hasNextPage) return null;
  if (!info.endCursor || info.endCursor === previous) throw new Error("Shipping settings could not be fully loaded. Refresh and try again.");
  return info.endCursor;
}

const looksLikeAccess = (error: unknown) => /access|permission|scope|not approved/i.test(error instanceof Error ? error.message : String(error));

type TransitAdmin = { graphql: (query: string, options?: { variables?: Record<string, unknown>; apiVersion?: ApiVersion }) => Promise<Response> };

/** Delivery times for one location group, or null when Shopify cannot give them. This must never stop the rest of the review. */
async function loadTransit(admin: ShopifyAdminClient, profileId: string, groupId: string): Promise<Map<string, Transit> | null> {
  try {
    const zones: RawTransitZone[] = [];
    let after: string | null = null;
    do {
      const response = await (admin as unknown as TransitAdmin).graphql(transitQuery, { variables: { profile: profileId, group: groupId, after }, apiVersion: ApiVersion.Unstable });
      const result: { data?: { deliveryProfile: { profileLocationGroups: Array<{ locationGroupZones: { nodes: RawTransitZone[]; pageInfo: PageInfo } }> } | null }; errors?: Array<{ message: string }> } = await response.json();
      if (result.errors?.length || !result.data) throw new Error(result.errors?.map(error => error.message).join(" ") || "no data");
      const page = result.data.deliveryProfile?.profileLocationGroups[0]?.locationGroupZones;
      if (!page) throw new Error("no zones");
      zones.push(...page.nodes);
      after = nextCursor(page.pageInfo, after);
    } while (after);
    return parseTransit(zones);
  } catch (error) {
    console.warn("Delivery times could not be read from Shopify:", error instanceof Error ? error.message : error);
    return null;
  }
}

async function loadZones(admin: ShopifyAdminClient, profile: RawProfile, transitRead: { ok: boolean }): Promise<DeliveryZone[]> {
  type ZoneData = { deliveryProfile: { profileLocationGroups: Array<{ locationGroupZones: { nodes: RawZone[]; pageInfo: PageInfo } }> } | null };
  const zones: DeliveryZone[] = [];
  const groups = profile.profileLocationGroups;
  for (const [index, group] of groups.entries()) {
    const transit = await loadTransit(admin, profile.id, group.locationGroup.id);
    if (!transit) transitRead.ok = false;
    let zoneAfter: string | null = null;
    do {
      const load = (methodsAfter: string | null) => codeGraphql<ZoneData>(admin, zoneQuery, { profile: profile.id, group: group.locationGroup.id, after: zoneAfter, methodsAfter });
      const data = await load(null);
      const page = data.deliveryProfile?.profileLocationGroups[0]?.locationGroupZones;
      if (!page) throw new Error("Shipping settings changed while loading. Refresh and try again.");
      const zone = page.nodes[0];
      if (zone) {
        const rates = [...zone.methodDefinitions.nodes];
        let methodsAfter = nextCursor(zone.methodDefinitions.pageInfo, null);
        while (methodsAfter) {
          const more = (await load(methodsAfter)).deliveryProfile?.profileLocationGroups[0]?.locationGroupZones.nodes[0];
          if (!more || more.zone.id !== zone.zone.id) throw new Error("Shipping settings changed while loading. Refresh and try again.");
          rates.push(...more.methodDefinitions.nodes);
          methodsAfter = nextCursor(more.methodDefinitions.pageInfo, methodsAfter);
        }
        // With more than one warehouse group the same zone can appear in each, with its own rates.
        const parsed = parseZone(zone, rates, groups.length > 1 ? `${index}:` : "");
        if (transit) for (const rate of parsed.rates) { const found = transit.get(`${zone.zone.id}|${rate.name}`); if (found) rate.transit = found; }
        zones.push(parsed);
      }
      zoneAfter = nextCursor(page.pageInfo, zoneAfter);
    } while (zoneAfter);
  }
  return zones;
}

/** Markets are optional: without the permission the review still works and says what it could not check. */
async function loadMarkets(admin: ShopifyAdminClient): Promise<Market[] | null> {
  try {
    const markets: Market[] = [];
    let after: string | null = null;
    do {
      const data: { markets: { nodes: RawMarket[]; pageInfo: PageInfo } } = await codeGraphql(admin, marketsQuery, { after });
      markets.push(...data.markets.nodes.map(parseMarket));
      after = nextCursor(data.markets.pageInfo, after);
    } while (after);
    return markets;
  } catch (error) {
    if (looksLikeAccess(error)) return null;
    throw error;
  }
}

export class ShippingAccessError extends Error {}

/** Everything the review and the storefront message need, read fresh from Shopify. */
export async function loadShippingSnapshot(admin: ShopifyAdminClient): Promise<ShippingSnapshot> {
  try {
    const profiles: RawProfile[] = [];
    let shopCurrency = "GBP";
    let shipsTo: string[] = [];
    let after: string | null = null;
    do {
      const data: { shop: { currencyCode: string; shipsToCountries: string[] }; deliveryProfiles: { nodes: RawProfile[]; pageInfo: PageInfo } } = await codeGraphql(admin, profilesQuery, { after });
      shopCurrency = data.shop.currencyCode;
      shipsTo = data.shop.shipsToCountries;
      profiles.push(...data.deliveryProfiles.nodes);
      after = nextCursor(data.deliveryProfiles.pageInfo, after);
    } while (after);
    const loaded: DeliveryProfile[] = [];
    const transitRead = { ok: true };
    for (const profile of profiles) {
      loaded.push({ id: profile.id, name: profile.name, isDefault: profile.default, variantCount: profile.productVariantsCount?.count ?? 0, zones: await loadZones(admin, profile, transitRead) });
    }
    return { shopCurrency, shipsTo, profiles: loaded, markets: await loadMarkets(admin), transit: transitRead.ok ? "shopify" : "unavailable" };
  } catch (error) {
    if (looksLikeAccess(error)) throw new ShippingAccessError("Allow the app to read Shopify shipping settings, then reopen this page.");
    throw error;
  }
}
