import { useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import { reportPeriods, type ReportLine } from "../design/reports";
import type { DiscountCounts, ReportData } from "../services/reports.server";
import type { OrderReportData } from "../services/orderReport.server";
import { OrderDrilldown } from "./ReportOrders";
import { useCsvDownload } from "./useCsvDownload";
import { PolarisSelect } from "./PolarisControls";

const number = new Intl.NumberFormat("en-GB");
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";
const whenDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "";

export function ReportsPage({ data, orders, counts, period, refreshing, view }: { data: ReportData; orders: OrderReportData; counts: DiscountCounts | null; period: string; refreshing: boolean; view: "discounts" | "prefixes" | "redemptions" }) {
  const { busy: downloading, exportUrl, download } = useCsvDownload();
  const path = `/app/reports/${view}`;
  const titles = { discounts: "Revenue by discount", prefixes: "Code prefixes and apps", redemptions: "Redemptions" };
  const appUrl = useEmbeddedAppUrl();
  const navigate = useNavigate();
  const fetcher = useFetcher<{ ok: boolean; error: string | null; intent?: string }>();
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef<string | null>(null);
  const action = appUrl("/app/reports");
  const busy = fetcher.state !== "idle";

  // Close the editor when a save worked; show the message when it did not.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !submitted.current) return;
    const intent = submitted.current;
    submitted.current = null;
    if (!fetcher.data.ok) { setError(fetcher.data.error); return; }
    setError(null);
    if (intent === "refresh") shopify.toast.show("Reading the discounts from Shopify");
  }, [fetcher.state, fetcher.data]);

  const send = (values: Record<string, string>) => {
    submitted.current = values.intent;
    fetcher.submit(values, { method: "post", action });
  };

  const { report } = data;
  const compared = data.days !== null;
  const heading = compared ? "Redemptions" : "Redemptions (all time)";

  const table = (lines: ReportLine[], nameHeading: string) => <s-table>
    <s-table-header-row>
      <s-table-header>{nameHeading}</s-table-header>
      <s-table-header format="numeric">{heading}</s-table-header>
      <s-table-header format="numeric">Discounts used</s-table-header>
      {compared && <s-table-header format="numeric">All time</s-table-header>}
    </s-table-header-row>
    <s-table-body>
      {lines.map(line => <s-table-row key={line.key}>
        <s-table-cell>
          <s-stack direction="block" gap="small-300">
            <s-text type="strong">{line.name}</s-text>
            <s-text color="subdued">{line.description}</s-text>
          </s-stack>
        </s-table-cell>
        <s-table-cell>{number.format(line.redemptions)}</s-table-cell>
        <s-table-cell>{number.format(line.discounts)}</s-table-cell>
        {compared && <s-table-cell>{number.format(line.allTime)}</s-table-cell>}
      </s-table-row>)}
    </s-table-body>
  </s-table>;

  return <s-page heading={titles[view]} inlineSize="large">
    <s-link slot="breadcrumb-actions" href={appUrl("/app/reports")}>Reports</s-link>
    <s-button slot="primary-action" type="button" variant="primary" disabled={refreshing || busy || undefined} onClick={() => send({ intent: "refresh" })}>{refreshing ? "Reading discounts…" : "Refresh figures"}</s-button>
    {view === "discounts"
      ? <>
        <s-button slot="secondary-actions" commandFor="discount-export" disabled={downloading || !orders.syncedAt || undefined}>Export</s-button>
        <s-menu id="discount-export" accessibilityLabel="Export a table as CSV">
          {([["Discounts", "discounts"], ["By day", "days"], ["By group", "groups"], ["By code prefix", "prefixes"]] as const).map(([label, kind]) => <s-button key={kind} icon="export" onClick={() => void download(exportUrl(kind, orders.filter))}>{label}</s-button>)}
        </s-menu>
      </>
      : <s-button slot="secondary-actions" icon="export" disabled={downloading || !report || undefined} onClick={() => void download(exportUrl("redemptions", undefined, { period }))}>Export CSV</s-button>}
    <s-stack direction="block" gap="base">
      {error && <s-banner tone="critical" dismissible onDismiss={() => setError(null)}>{error}</s-banner>}
      {refreshing && <s-banner tone="info">Reading your discounts and orders from Shopify. This page updates by itself when it is done.</s-banner>}
      {!data.complete && <s-banner tone="warning" heading="These figures may be incomplete">There are more used discounts than one reading can cover, so some are missing from the totals.</s-banner>}
      {!report && !refreshing && <s-banner tone="info">There are no figures yet. Choose Refresh figures to read them from Shopify.</s-banner>}
      {report && compared && !data.comparedWith && <s-banner tone="info" heading="Not enough history for this period yet">
        Figures have been kept since {whenDate(data.historyStart)}, so this period cannot be measured yet. Until then the totals shown are for all time. The app takes a reading every day.
      </s-banner>}
      {view === "discounts" && <OrderDrilldown data={orders} />}
      {view === "redemptions" && counts && <s-section heading="All discounts in your store">
        <s-stack direction="block" gap="small-300">
          <s-heading>{number.format(counts.all)}{counts.capped ? "+" : ""} discounts</s-heading>
          <s-text color="subdued">
            {number.format(counts.codes)} with codes and {number.format(counts.automatic)} automatic promotions, from every source. {number.format(counts.active)} are active now. {number.format(counts.used)} have been used at least once and {number.format(counts.neverUsed)} never have. The tables below cover every discount that has been used.
          </s-text>
        </s-stack>
      </s-section>}
      {view !== "discounts" && report && <s-section heading="Redemptions, lifetime">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="end" justifyContent="space-between">
            <s-stack direction="block" gap="small-300">
              <s-heading>{number.format(compared && data.comparedWith ? report.totals.redemptions : report.totals.allTime)} redemptions</s-heading>
              <s-text color="subdued">
                {compared && data.comparedWith ? `Since ${when(data.comparedWith)}, across ${number.format(report.totals.discounts)} discounts.` : `Across ${number.format(report.totals.discounts || report.groups.reduce((sum, line) => sum + line.discounts, 0))} discounts used so far.`} Includes discounts made by hand, by this app and by other apps. Read from Shopify {when(data.takenAt)}.
              </s-text>
            </s-stack>
            <PolarisSelect label="Period" value={period} onChange={event => navigate(appUrl(`${path}?period=${event.currentTarget.value}`))}>
              {reportPeriods.map(option => <s-option key={option.value} value={option.value}>{option.label}</s-option>)}
            </PolarisSelect>
          </s-stack>
        </s-stack>
      </s-section>}
      {view === "prefixes" && report && report.prefixes.length > 0 && <s-section heading="By code prefix">
        <s-stack direction="block" gap="base">
          <s-paragraph>Generated codes shaped PREFIX-UNIQUE-UNIQUE are totalled by their prefix automatically, so a new campaign appears here as soon as one of its codes is used. Prefixes are not groups: a code can count here and in a group too.</s-paragraph>
          {table(report.prefixes, "Prefix")}
        </s-stack>
      </s-section>}
      {view === "prefixes" && report && <s-section heading="By app">
        <s-stack direction="block" gap="base">
          <s-paragraph>The same redemptions by whoever created the discount. A new app’s discounts appear here without any set-up.</s-paragraph>
          {report.creators.length ? table(report.creators, "Created by") : <s-text color="subdued">No discounts have been used yet.</s-text>}
        </s-stack>
      </s-section>}
    </s-stack>
  </s-page>;
}

