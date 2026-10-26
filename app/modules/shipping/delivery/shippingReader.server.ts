import { codeGraphql } from "../../promotions/services/discountCodes.server";
import type { ShopifyAdminClient } from "../../promotions/services/discount.server";
import { toMinor, type DeliveryProfile, type DeliveryRate, type DeliveryZone, type Market, type RateCondition, type ShippingSnapshot } from "./deliveryModel";

type PageInfo = { hasNextPage: boolean; endCursor: string | null };
type RawCountry = { name: string; code: { countryCode: string | null; restOfWorld: boolean } };
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
          zone { id name countries { name code { countryCode restOfWorld } } }
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

export function parseZone(raw: RawZone, rates: RawRate[], idPrefix = ""): DeliveryZone {
  return {
    id: `${idPrefix}${raw.zone.id}`,
    name: raw.zone.name,
    countries: raw.zone.countries.flatMap(country => (country.code.countryCode ? [country.code.countryCode] : [])),
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

async function loadZones(admin: ShopifyAdminClient, profile: RawProfile): Promise<DeliveryZone[]> {
  type ZoneData = { deliveryProfile: { profileLocationGroups: Array<{ locationGroupZones: { nodes: RawZone[]; pageInfo: PageInfo } }> } | null };
  const zones: DeliveryZone[] = [];
  const groups = profile.profileLocationGroups;
  for (const [index, group] of groups.entries()) {
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
        zones.push(parseZone(zone, rates, groups.length > 1 ? `${index}:` : ""));
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
    for (const profile of profiles) {
      loaded.push({ id: profile.id, name: profile.name, isDefault: profile.default, variantCount: profile.productVariantsCount?.count ?? 0, zones: await loadZones(admin, profile) });
    }
    return { shopCurrency, shipsTo, profiles: loaded, markets: await loadMarkets(admin) };
  } catch (error) {
    if (looksLikeAccess(error)) throw new ShippingAccessError("Allow the app to read Shopify shipping settings, then reopen this page.");
    throw error;
  }
}
