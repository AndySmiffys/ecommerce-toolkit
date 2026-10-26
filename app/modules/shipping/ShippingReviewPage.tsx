import { useEmbeddedAppUrl } from "../navigation/embeddedAppUrl";
import { formatMinor, type ShippingSnapshot } from "./delivery/deliveryModel";
import { describeFree, describeRate, zoneFree } from "./delivery/freeService";
import { marketCoverage, summarise, type Finding, type Severity } from "./delivery/shippingReview";

export type ShippingReviewData =
  | { ok: true; snapshot: ShippingSnapshot; findings: Finding[]; checkedAt: string }
  | { ok: false; access: boolean; error: string };

const names = new Intl.DisplayNames(["en-GB"], { type: "region" });
const countryName = (code: string) => { try { return names.of(code) || code; } catch { return code; } };
const countryList = (codes: string[], limit = 6) => (codes.length <= limit ? codes.map(countryName).join(", ") : `${codes.slice(0, limit).map(countryName).join(", ")} and ${codes.length - limit} more`);

const shopifyLinks = { shipping: "shopify://admin/settings/shipping", markets: "shopify://admin/settings/markets" } as const;
const tone: Record<Severity, "critical" | "warning" | undefined> = { problem: "critical", suggestion: "warning", info: undefined };
const label: Record<Severity, string> = { problem: "Problem", suggestion: "Suggestion", info: "Note" };

function FindingRow({ finding }: { finding: Finding }) {
  return <s-stack direction="block" gap="small-300">
    <s-stack direction="inline" gap="small-300" alignItems="center">
      <s-badge tone={tone[finding.severity]}>{label[finding.severity]}</s-badge>
      <s-text type="strong">{finding.title}</s-text>
    </s-stack>
    <s-text>{finding.detail}</s-text>
    {finding.recommendation && <s-text color="subdued">{finding.recommendation}</s-text>}
    {finding.fix !== "app" && <div><s-link href={shopifyLinks[finding.fix]}>{finding.fix === "markets" ? "Open Markets in Shopify" : "Open shipping settings in Shopify"}</s-link></div>}
  </s-stack>;
}

/**
 * Shopify's shipping setup as the app understands it: where free delivery is offered and from what order total, what is wrong, and what to
 * change. It only reads. Changes are made in Shopify, where the links go.
 */
export function ShippingReviewPage({ data, checking, onCheck }: { data: ShippingReviewData; checking: boolean; onCheck: () => void }) {
  const appUrl = useEmbeddedAppUrl();
  const header = <>
    <s-link slot="breadcrumb-actions" href={appUrl("/app")}>Home</s-link>
    <s-button slot="primary-action" type="button" variant="primary" loading={checking || undefined} disabled={checking || undefined} onClick={onCheck}>Check again</s-button>
    <s-button slot="secondary-actions" href={appUrl("/app/shipping-countdown")}>Product page message</s-button>
    <s-button slot="secondary-actions" href={shopifyLinks.shipping}>Shipping settings in Shopify</s-button>
  </>;

  if (!data.ok) {
    return <s-page heading="Shipping" inlineSize="large">{header}
      <s-banner tone="critical" heading={data.access ? "The app cannot read your shipping settings" : "Shipping settings could not be loaded"}>{data.error}</s-banner>
    </s-page>;
  }

  const { snapshot, findings, checkedAt } = data;
  const counts = summarise(findings);
  const money = (minor: number, currency: string) => formatMinor(minor, currency);
  const coverage = marketCoverage(snapshot);
  const several = snapshot.profiles.length > 1;
  const checked = new Date(checkedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const actionable = findings.filter(finding => finding.severity !== "info");
  const notes = findings.filter(finding => finding.severity === "info");

  return <s-page heading="Shipping" inlineSize="large">{header}
    <s-stack direction="block" gap="base">
      {counts.problems > 0
        ? <s-banner tone="critical" heading={`${counts.problems} ${counts.problems === 1 ? "problem needs" : "problems need"} fixing`}>Shoppers may not be able to check out. Details are below.</s-banner>
        : counts.suggestions > 0
          ? <s-banner tone="warning" heading={`${counts.suggestions} ${counts.suggestions === 1 ? "suggestion" : "suggestions"} to improve shipping`}>Nothing is stopping orders. Details are below.</s-banner>
          : <s-banner tone="success" heading="Your shipping setup looks good">No problems or suggestions. Read at {checked}.</s-banner>}

      <s-section heading="Free delivery by zone">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">The product page tells each shopper about free delivery for their own country, using the rates below from {snapshot.profiles.find(profile => profile.isDefault)?.name ?? "your shipping profile"}. Read from Shopify at {checked}.</s-text>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Zone</s-table-header>
              <s-table-header>Where</s-table-header>
              <s-table-header listSlot="inline">Free delivery</s-table-header>
              <s-table-header>Rates</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {snapshot.profiles.flatMap(profile => profile.zones.map(zone => {
                const free = zoneFree(zone);
                const anyRate = zone.rates.some(rate => rate.active);
                return <s-table-row key={`${profile.id}:${zone.id}`}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-300">
                      <s-text type="strong">{zone.name}</s-text>
                      {several && <s-text color="subdued">{profile.name}{profile.isDefault ? "" : ` · ${profile.variantCount} variants`}</s-text>}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{[countryList(zone.countries), zone.restOfWorld ? "Rest of world" : ""].filter(Boolean).join(zone.countries.length && zone.restOfWorld ? " and " : "") || "No countries"}</s-table-cell>
                  <s-table-cell>{!anyRate ? <s-badge tone="critical">No rates</s-badge> : <s-badge tone={free.effective ? "success" : undefined}>{describeFree(free, money)}</s-badge>}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-300">
                      {zone.rates.length ? zone.rates.map(rate => <s-text key={rate.id} color={rate.active ? undefined : "subdued"}>{describeRate(rate, money)}</s-text>) : <s-text color="subdued">None</s-text>}
                    </s-stack>
                  </s-table-cell>
                </s-table-row>;
              }))}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>

      {actionable.length > 0 && <s-section heading="What to fix">
        <s-stack direction="block" gap="large">{actionable.map(finding => <FindingRow key={finding.id} finding={finding} />)}</s-stack>
      </s-section>}

      <s-section heading="Markets and shipping">
        {coverage === null
          ? <s-banner tone="info" heading="The app cannot see your Markets yet">Allow the app to read Markets to check that every country you sell to has shipping. Reopen the app and approve the new permission.</s-banner>
          : <s-stack direction="block" gap="base">
            <s-text color="subdued">Markets decide where you sell. Shipping zones decide where you deliver. Each country you sell to needs a zone with a rate.</s-text>
            {coverage.length === 0 ? <s-text>You have no Markets.</s-text> : <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Market</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header>Countries</s-table-header>
                <s-table-header>Shipping</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {coverage.map(({ market, missing }) => <s-table-row key={market.id}>
                  <s-table-cell>{market.name}</s-table-cell>
                  <s-table-cell>{market.active ? <s-badge tone="success">Active</s-badge> : <s-badge>Not active</s-badge>}</s-table-cell>
                  <s-table-cell>{market.countries.length ? countryList(market.countries) : "No countries"}</s-table-cell>
                  <s-table-cell>{!market.active ? "Not checked" : missing.length ? <s-badge tone="critical">{`No shipping to ${countryList(missing, 4)}`}</s-badge> : <s-badge tone="success">Covered</s-badge>}</s-table-cell>
                </s-table-row>)}
              </s-table-body>
            </s-table>}
          </s-stack>}
      </s-section>

      {notes.length > 0 && <s-section heading="Notes">
        <s-stack direction="block" gap="large">{notes.filter(finding => finding.id !== "markets-access").map(finding => <FindingRow key={finding.id} finding={finding} />)}</s-stack>
      </s-section>}
    </s-stack>
  </s-page>;
}
