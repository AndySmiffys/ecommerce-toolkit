import { formatMinor, type DeliveryProfile, type DeliveryZone, type Market, type ShippingSnapshot } from "./deliveryModel";
import { zoneServices } from "./deliveryServices";
import { activeRates, defaultProfile, namingZones, primaryZone, priceRange, zoneForCountry, zoneFree } from "./freeService";

export type Severity = "problem" | "suggestion" | "info";
export type Finding = {
  /** Stable, so a finding keeps its identity between visits. */
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  recommendation?: string;
  profile?: string;
  zone?: string;
  /** Where the merchant makes the change: Shopify's shipping settings, Markets, or the app's own permissions. */
  fix: "shipping" | "markets" | "app";
};

const countryNames = new Intl.DisplayNames(["en-GB"], { type: "region" });
const nameOf = (code: string) => { try { return countryNames.of(code) || code; } catch { return code; } };
const list = (codes: string[], limit = 8) => {
  const names = codes.map(nameOf);
  return names.length <= limit ? names.join(", ") : `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`;
};
const where = (profile: DeliveryProfile, zone?: DeliveryZone) => (zone ? `${zone.name} zone in the ${profile.name} profile` : `${profile.name} profile`);

/** The threshold most zones in a profile already use, as the suggestion for a zone that has none. Ties go to the lowest. */
export function usualThreshold(profile: DeliveryProfile): { thresholdMinor: number; currency: string } | null {
  const counts = new Map<string, { thresholdMinor: number; currency: string; count: number }>();
  for (const zone of profile.zones) {
    const effective = zoneFree(zone).effective;
    if (effective?.kind !== "threshold") continue;
    const key = `${effective.currency}:${effective.thresholdMinor}`;
    counts.set(key, { thresholdMinor: effective.thresholdMinor, currency: effective.currency, count: (counts.get(key)?.count ?? 0) + 1 });
  }
  const best = [...counts.values()].sort((a, b) => b.count - a.count || a.thresholdMinor - b.thresholdMinor)[0];
  return best ? { thresholdMinor: best.thresholdMinor, currency: best.currency } : null;
}

/**
 * Order totals no active rate in a zone covers, as inclusive ranges in minor units. Only judged when every active rate depends on the
 * order total alone (a weight condition or a carrier rate makes this unknowable from here), and only for a zone that has rates.
 */
export function priceGaps(zone: DeliveryZone): Array<{ from: number; to: number }> | null {
  const rates = activeRates(zone);
  if (!rates.length) return null;
  const ranges = rates.map(priceRange);
  if (rates.some(rate => rate.kind === "carrier") || ranges.some(range => range === null)) return null;
  const gaps: Array<{ from: number; to: number }> = [];
  let next = 0;
  for (const range of (ranges as Array<{ min: number; max: number }>).sort((a, b) => a.min - b.min)) {
    if (range.min > next) gaps.push({ from: next, to: range.min - 1 });
    next = Math.max(next, range.max === Infinity ? Infinity : range.max + 1);
    if (next === Infinity) break;
  }
  if (next !== Infinity) gaps.push({ from: next, to: Infinity });
  return gaps;
}

const money = (minor: number, currency: string) => formatMinor(minor, currency);

/** The free-delivery threshold a profile gives a country: 0 for always free, null for none. */
function thresholdFor(profile: DeliveryProfile, country: string): number | null {
  const zone = zoneForCountry(profile, country);
  const effective = zone ? zoneFree(zone).effective : null;
  return effective?.kind === "threshold" ? effective.thresholdMinor : effective?.kind === "always" ? 0 : null;
}

/** Everything worth telling the merchant about their shipping setup, worst first. */
export function reviewShipping(snapshot: ShippingSnapshot): Finding[] {
  const findings: Finding[] = [];
  const add = (finding: Finding) => findings.push(finding);
  const currency = snapshot.shopCurrency;
  const base = defaultProfile(snapshot);

  if (!snapshot.profiles.length || !snapshot.profiles.some(profile => profile.zones.some(zone => activeRates(zone).length))) {
    add({ id: "no-rates", severity: "problem", fix: "shipping", title: "No shipping rates are switched on", detail: "Shoppers cannot choose a delivery option at checkout, so no one can order.", recommendation: "Add a shipping zone with at least one rate in Shopify's shipping settings." });
    return findings;
  }

  for (const profile of snapshot.profiles) {
    const custom = !profile.isDefault;
    if (custom && profile.variantCount === 0) continue;
    const usual = usualThreshold(profile);
    const anyFree = profile.zones.some(other => zoneFree(other).effective !== null);

    for (const zone of profile.zones) {
      const live = activeRates(zone);
      const free = zoneFree(zone);
      const here = where(profile, zone);

      if (!live.length) {
        add({ id: `zone-no-rates:${profile.id}:${zone.id}`, severity: custom ? "suggestion" : "problem", fix: "shipping", profile: profile.name, zone: zone.name, title: `No rates are switched on in ${here}`, detail: `Shoppers in ${zone.restOfWorld && !zone.countries.length ? "the rest of the world" : list(zone.countries) || "this zone"} cannot check out${custom ? " with products from this profile" : ""}.`, recommendation: "Switch on a rate, or remove the zone if you do not ship there." });
        continue;
      }

      if (free.effective?.kind === "other") {
        add({ id: `free-not-by-total:${profile.id}:${zone.id}`, severity: "info", fix: "shipping", profile: profile.name, zone: zone.name, title: `Free delivery in ${here} does not depend on the order total`, detail: "It is based on weight, so the product page cannot say how much more to spend.", recommendation: "Base the free rate on order price if you want a \"spend £X\" message." });
      }

      if (!free.effective) {
        const switchedOff = free.options.find(option => !option.rate.active);
        add(switchedOff
          ? { id: `free-off:${profile.id}:${zone.id}`, severity: "suggestion", fix: "shipping", profile: profile.name, zone: zone.name, title: `The free rate in ${here} is switched off`, detail: `"${switchedOff.rate.name}" exists but is not offered, so shoppers there are not told about free delivery.`, recommendation: "Switch the rate on, or delete it if you no longer offer free delivery." }
          : { id: `no-free:${profile.id}:${zone.id}`, severity: anyFree ? "info" : "suggestion", fix: "shipping", profile: profile.name, zone: zone.name, title: `No free delivery option in ${here}`, detail: anyFree ? "Shoppers there are never offered free delivery, so the product page shows them no free-delivery message. Other zones do offer it." : "Nothing in this profile offers free delivery, so the product page shows no free-delivery message.", recommendation: usual ? `Add a free rate at ${money(usual.thresholdMinor, usual.currency)}, the threshold your other zones use.` : "Add a free rate with a minimum order total in Shopify's shipping settings." });
      } else if (free.effective.kind === "always") {
        const others = profile.zones.filter(other => other.id !== zone.id && zoneFree(other).effective?.kind === "threshold");
        if (others.length) add({ id: `always-free:${profile.id}:${zone.id}`, severity: "info", fix: "shipping", profile: profile.name, zone: zone.name, title: `Delivery is always free in ${here}`, detail: `Your other zones need a minimum order for free delivery. Orders of any size ship free here.`, recommendation: "Check this is intended, for example a promotion you forgot to end." });
      }

      const gaps = priceGaps(zone);
      if (gaps?.length) {
        const first = gaps[0];
        const range = first.to === Infinity ? `${money(first.from, currency)} and over` : `${money(first.from, currency)} to ${money(first.to, currency)}`;
        add({ id: `price-gap:${profile.id}:${zone.id}`, severity: "problem", fix: "shipping", profile: profile.name, zone: zone.name, title: `Some order totals get no rate in ${here}`, detail: `Orders of ${range} match none of the rates, so shoppers with a basket in that range cannot check out.`, recommendation: "Make the paid rate's maximum and the free rate's minimum meet, for example up to £49.99 and from £50." });
      }
    }

    if (custom) {
      const differs = Boolean(base) && profile.zones.some(zone => zone.countries.some(country => thresholdFor(profile, country) !== thresholdFor(base!, country)));
      add({ id: `custom-profile:${profile.id}`, severity: differs ? "suggestion" : "info", fix: "shipping", profile: profile.name, title: `${profile.variantCount} product variant${profile.variantCount === 1 ? "" : "s"} use the ${profile.name} profile`, detail: differs ? "Its free-delivery threshold is not the same as your general profile's, but the product page message follows the general profile, so it may be wrong for these products." : "The product page message follows your general profile, and this profile's free-delivery rules match it.", recommendation: differs ? "Give it the same threshold, or tell me when you want messages by product group." : undefined });
    }

    const carrier = profile.zones.flatMap(zone => zone.rates.filter(rate => rate.kind === "carrier" && rate.active));
    if (carrier.length) add({ id: `carrier:${profile.id}`, severity: "info", fix: "shipping", profile: profile.name, title: `${carrier.length} rate${carrier.length === 1 ? " is" : "s are"} worked out by a carrier in the ${profile.name} profile`, detail: "The review cannot see their prices or conditions, so it cannot check them or find a free threshold." });
  }

  if (base) {
    // A country split into zones by region: a product page only knows the country, so it can show only one zone's options.
    const signature = (zone: DeliveryZone) => {
      const effective = zoneFree(zone).effective;
      return JSON.stringify([zoneServices(zone).map(service => [service.name.toLowerCase(), service.tiers, service.transit ?? null]), effective ? [effective.kind, effective.kind === "threshold" ? effective.thresholdMinor : null] : null]);
    };
    for (const country of new Set(base.zones.flatMap(zone => zone.countries))) {
      const zones = namingZones(base, country);
      if (zones.length < 2 || new Set(zones.map(signature)).size < 2) continue;
      const chosen = primaryZone(zones, country)!;
      const regions = (zone: DeliveryZone) => (zone.regions?.[country]?.length ? zone.regions[country].join(", ") : "the rest of the country");
      add({ id: `split-country:${country}`, severity: "info", fix: "shipping", profile: base.name, title: `${nameOf(country)} is split into zones by region`, detail: `${zones.map(zone => `${zone.name} (${regions(zone)})`).join("; ")}. A product page only knows the country, not the region, so it shows the options for ${chosen.name}, which covers the most. Shoppers in the other regions are shown options that may not apply to them; at checkout they are offered the right ones for their address.`, recommendation: "No change is needed if that is what you want. If the options are the same everywhere, the zones can be one." });
    }

    const thresholds = base.zones.flatMap(zone => { const e = zoneFree(zone).effective; return e?.kind === "threshold" ? [{ zone, thresholdMinor: e.thresholdMinor, currency: e.currency }] : []; });
    if (new Set(thresholds.map(item => `${item.currency}:${item.thresholdMinor}`)).size > 1) {
      add({ id: "thresholds-differ", severity: "info", fix: "shipping", profile: base.name, title: "Free-delivery thresholds differ between zones", detail: thresholds.map(item => `${item.zone.name}: ${money(item.thresholdMinor, item.currency)}`).join(" · "), recommendation: "This is fine. The product page shows each shopper the threshold for their own country." });
    }
    const unsupported = thresholds.filter(item => item.currency !== currency);
    if (unsupported.length) add({ id: "currency-differs", severity: "info", fix: "shipping", profile: base.name, title: "A free rate is priced in a different currency from your shop", detail: unsupported.map(item => `${item.zone.name}: ${item.currency}`).join(", "), recommendation: "The product page message is shown only for carts in your shop currency." });
  }

  if (snapshot.markets === null) {
    add({ id: "markets-access", severity: "info", fix: "app", title: "The app cannot see your Markets yet", detail: "Allow the app to read Markets to check that every country you sell to has shipping.", recommendation: "Reopen the app and approve the new permission." });
  } else if (base) {
    const active = snapshot.markets.filter(market => market.active);
    const sold = [...new Set(active.flatMap(market => market.countries))];
    const uncovered = sold.filter(country => { const zone = zoneForCountry(base, country); return !zone || !activeRates(zone).length; });
    if (uncovered.length) add({ id: "market-no-shipping", severity: "problem", fix: "shipping", profile: base.name, title: `${uncovered.length} ${uncovered.length === 1 ? "country you sell to has" : "countries you sell to have"} no shipping`, detail: `${list(uncovered)} ${uncovered.length === 1 ? "is" : "are"} in an active Market, but no shipping zone with a rate covers ${uncovered.length === 1 ? "it" : "them"}. Shoppers there can browse but cannot check out.`, recommendation: "Add the countries to a shipping zone, or take them out of the Market." });
    const incomplete = active.filter(market => market.truncated);
    if (incomplete.length) add({ id: "markets-truncated", severity: "info", fix: "markets", title: `Too many regions to check in ${incomplete.map(market => market.name).join(", ")}`, detail: "Only the first part of the list could be read, so the coverage check above may miss some countries." });
    const named = [...new Set(base.zones.flatMap(zone => zone.countries))];
    const unsold = sold.length ? named.filter(country => !sold.includes(country)) : [];
    if (unsold.length) add({ id: "zone-not-sold", severity: "info", fix: "markets", profile: base.name, title: `You ship to ${unsold.length === 1 ? "a country" : "countries"} that no active Market sells to`, detail: `${list(unsold)}. Shoppers there cannot reach the store, so the rates are unused.`, recommendation: "Remove the zone, or add the country to a Market if you do want to sell there." });
  }

  const order: Record<Severity, number> = { problem: 0, suggestion: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function summarise(findings: Finding[]) {
  return { problems: findings.filter(f => f.severity === "problem").length, suggestions: findings.filter(f => f.severity === "suggestion").length, info: findings.filter(f => f.severity === "info").length };
}


/** For each Market, the countries in it that no shipping zone with a rate covers in the general profile. */
export function marketCoverage(snapshot: ShippingSnapshot): Array<{ market: Market; missing: string[] }> | null {
  if (snapshot.markets === null) return null;
  const base = defaultProfile(snapshot);
  return snapshot.markets.map(market => ({
    market,
    missing: market.active && base ? market.countries.filter(country => { const zone = zoneForCountry(base, country); return !zone || !activeRates(zone).length; }) : [],
  }));
}
