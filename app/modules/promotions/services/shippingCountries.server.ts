import { codeGraphql as query } from "./discountCodes.server";
import type { ShopifyAdminClient } from "./discount.server";
import type { CreateDiscountDraft } from "./createPromotion.server";

export type ShippingCountry = { code: string; name: string; shippingOptions: string[] };
export type ShippingCountries = { countries: ShippingCountry[]; error?: string };
type PageInfo = { hasNextPage: boolean; endCursor: string | null };
type Country = { name: string; code: { countryCode: string | null; restOfWorld: boolean } };
type Group = { locationGroup: { id: string }; countriesInAnyZone: { country: Country }[] };
type Profile = { id: string; name: string; profileLocationGroups: Group[] };
type Zone = { zone: { id: string; name: string; countries: Country[] }; methodDefinitions: { nodes: { name: string; active: boolean }[]; pageInfo: PageInfo } };
const profilesQuery = `#graphql
query PromotionShippingProfiles($after: String) {
  shop { shipsToCountries }
  deliveryProfiles(first: 25, after: $after) {
    nodes { id name profileLocationGroups { locationGroup { id } countriesInAnyZone { country { name code { countryCode restOfWorld } } } } }
    pageInfo { hasNextPage endCursor }
  }
}`;
// Fetch one zone at a time so method pagination stays inside Shopify's query cost limit.
const zoneQuery = `#graphql
query PromotionShippingZone($profile: ID!, $group: ID!, $after: String, $methodsAfter: String) {
  deliveryProfile(id: $profile) {
    profileLocationGroups(locationGroupId: $group) {
      locationGroupZones(first: 1, after: $after) {
        nodes {
          zone { id name countries { name code { countryCode restOfWorld } } }
          methodDefinitions(first: 100, after: $methodsAfter) { nodes { name active } pageInfo { hasNextPage endCursor } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;
function nextCursor(info: PageInfo, previous: string | null): string | null {
  if (!info.hasNextPage) return null;
  if (!info.endCursor || info.endCursor === previous) throw new Error("Shipping settings could not be fully loaded. Refresh and try again.");
  return info.endCursor;
}
export async function getShippingCountries(admin: ShopifyAdminClient): Promise<ShippingCountries> {
  try {
    const profiles: Profile[] = [];
    const shopCountries = new Set<string>();
    let after: string | null = null;
    do {
      const data: { shop: { shipsToCountries: string[] }; deliveryProfiles: { nodes: Profile[]; pageInfo: PageInfo } } = await query(admin, profilesQuery, { after });
      data.shop.shipsToCountries.forEach(code => shopCountries.add(code));
      profiles.push(...data.deliveryProfiles.nodes);
      after = nextCursor(data.deliveryProfiles.pageInfo, after);
    } while (after);
    const countries = new Map<string, ShippingCountry>();
    const names = new Intl.DisplayNames(["en-GB"], { type: "region" });
    for (const profile of profiles) for (const group of profile.profileLocationGroups) {
      // Rest-of-world excludes countries explicitly assigned to any other zone in this group,
      // including zones with no active rates.
      const assigned = new Set(group.countriesInAnyZone.flatMap(item => item.country.code.countryCode ? [item.country.code.countryCode] : []));
      let zoneAfter: string | null = null;
      do {
        type ZoneData = { deliveryProfile: { profileLocationGroups: { locationGroupZones: { nodes: Zone[]; pageInfo: PageInfo } }[] } | null };
        const loadZone = (methodsAfter: string | null) => query<ZoneData>(admin, zoneQuery, { profile: profile.id, group: group.locationGroup.id, after: zoneAfter, methodsAfter });
        const data = await loadZone(null);
        const page = data.deliveryProfile?.profileLocationGroups[0]?.locationGroupZones;
        if (!page) throw new Error("Shipping settings changed while loading. Refresh and try again.");
        const zone = page.nodes[0];
        if (zone) {
          const methods = [...zone.methodDefinitions.nodes];
          let methodsAfter = nextCursor(zone.methodDefinitions.pageInfo, null);
          while (methodsAfter) {
            const more = (await loadZone(methodsAfter)).deliveryProfile?.profileLocationGroups[0]?.locationGroupZones.nodes[0];
            if (!more || more.zone.id !== zone.zone.id) throw new Error("Shipping settings changed while loading. Refresh and try again.");
            methods.push(...more.methodDefinitions.nodes);
            methodsAfter = nextCursor(more.methodDefinitions.pageInfo, methodsAfter);
          }
          const options = methods.filter(method => method.active).map(method => `${method.name} (${profile.name} · ${zone.zone.name})`);
          if (options.length) {
            const destinations = zone.zone.countries.flatMap(country => country.code.restOfWorld
              ? [...shopCountries].filter(code => !assigned.has(code)).map(code => ({ code, name: names.of(code) || code }))
              : country.code.countryCode ? [{ code: country.code.countryCode, name: country.name }] : []);
            for (const destination of destinations) {
              if (!/^[A-Z]{2}$/.test(destination.code)) continue;
              const previous = countries.get(destination.code);
              countries.set(destination.code, { ...destination, shippingOptions: [...new Set([...(previous?.shippingOptions ?? []), ...options])] });
            }
          }
        }
        zoneAfter = nextCursor(page.pageInfo, zoneAfter);
      } while (zoneAfter);
    }
    return { countries: [...countries.values()].sort((a, b) => a.name.localeCompare(b.name, "en-GB")) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shipping settings could not be loaded.";
    return { countries: [], error: /access|permission|scope/i.test(message)
      ? "Allow the app to read Shopify shipping settings, then reopen this page to load countries and shipping options."
      : "Shipping countries could not be loaded. Refresh this page and try again." };
  }
}
export async function validateShippingCountries(admin: ShopifyAdminClient, draft: CreateDiscountDraft, previousCountries: string[] = []) {
  if (draft.discountType !== "shipping" || draft.countryMode !== "selected") return;
  const added = draft.countries.filter(code => !previousCountries.includes(code));
  if (!added.length) return;
  const available = await getShippingCountries(admin);
  if (available.error) throw new Error(available.error);
  const invalid = added.filter(code => !available.countries.some(country => country.code === code));
  if (invalid.length) throw new Error(`Choose countries with active Shopify shipping options. Unavailable: ${invalid.join(", ")}.`);
}
