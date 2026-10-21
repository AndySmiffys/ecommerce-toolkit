import { useNavigate } from "react-router";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import { averages, dailySeries, spanDays, type Totals } from "../design/orderReport";
import { formatMoney } from "../design/formatMoney";
import type { OrderReportData } from "../services/orderReport.server";
import { AreaChart, BarList, Donut, Sparkline, type Slice } from "./charts/Charts";
import { PolarisCheckbox, PolarisSelect } from "./PolarisControls";
import { ReportStatus } from "./ReportOrders";
import { useCsvDownload } from "./useCsvDownload";

const count = new Intl.NumberFormat("en-GB");
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";
const periods = [{ value: "7", label: "Last 7 days" }, { value: "14", label: "Last 14 days" }, { value: "30", label: "Last 30 days" }, { value: "60", label: "Last 60 days" }];

/** The change from the period before as a note beside a figure: up or down, in percent. */
function change(current: number, previous: number | undefined, good: "up" | "none") {
  if (previous === undefined || !previous) return null;
  const part = (current - previous) / previous;
  if (!Number.isFinite(part)) return null;
  const text = `${part >= 0 ? "▲" : "▼"} ${Math.abs(part * 100).toFixed(0)}%`;
  return <s-badge tone={good === "none" ? "neutral" : part >= 0 ? "success" : "critical"}>{text}</s-badge>;
}

function Card({ heading, action, children }: { heading: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <s-section>
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="base" justifyContent="space-between" alignItems="center">
        <s-heading>{heading}</s-heading>
        {action}
      </s-stack>
      {children}
    </s-stack>
  </s-section>;
}

export const otherHint = "Discounts used in this period that none of your groups matches. Add a group, or another way to match to a group, to break it down. The Revenue by group page lists them.";
export const everythingElseHint = "The smaller groups beyond the five biggest, added together so the chart stays readable. The Revenue by group page lists every group separately.";

function slicesOf(lines: Array<Totals & { name: string; key?: string }>, pick: (line: Totals) => number): Slice[] {
  const sorted = lines.filter(line => pick(line) > 0).sort((a, b) => pick(b) - pick(a));
  const head = sorted.slice(0, 5).map(line => ({ label: line.name, value: pick(line), hint: line.key === "other" ? otherHint : undefined }));
  const rest = sorted.slice(5).reduce((sum, line) => sum + pick(line), 0);
  return rest > 0 ? [...head, { label: "Everything else", value: rest, hint: everythingElseHint }] : head;
}

/** The Reports home: headline figures with trends, charts, a breakdown, and the way into each fuller report. */
export function ReportOverview({ data, compare, refreshing, onRefresh }: { data: OrderReportData; compare: boolean; refreshing: boolean; onRefresh: () => void }) {
  const appUrl = useEmbeddedAppUrl();
  const navigate = useNavigate();
  const { busy, exportUrl, download } = useCsvDownload();
  const { report, previous, filter } = data;
  const days = dailySeries(report.days, filter.from, filter.to);
  const before = previous && data.previousRange ? dailySeries(previous.days, data.previousRange.from, data.previousRange.to) : null;
  const money = (cents: number) => formatMoney(cents, data.currency);
  const compactMoney = (cents: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: data.currency, notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);
  const now = report.selected;
  const was = previous?.selected;
  const average = averages(now);
  const averageBefore = was ? averages(was) : null;
  const labels = days.map(item => shortDay(item.day));
  const previousLabels = before?.map(item => shortDay(item.day));
  const series = (pick: (item: Totals) => number) => days.map(pick);
  const previousSeries = (pick: (item: Totals) => number) => before?.map(pick) ?? null;
  const ready = Boolean(data.syncedAt);
  const preset = periods.find(item => spanDays(filter) === Number(item.value))?.value ?? "30";
  const go = (nextDays: string, nextCompare: boolean) => navigate(appUrl(`/app/reports?days=${nextDays}&compare=${nextCompare ? 1 : 0}`));

  const metrics: Array<{ label: string; value: string; trend: React.ReactNode; values: number[]; previous: number[] | null }> = [
    { label: "Revenue", value: money(now.valueCents), trend: change(now.valueCents, was?.valueCents, "up"), values: series(item => item.valueCents), previous: previousSeries(item => item.valueCents) },
    { label: "Orders with a discount", value: count.format(now.orders), trend: change(now.orders, was?.orders, "up"), values: series(item => item.orders), previous: previousSeries(item => item.orders) },
    { label: "Average order value", value: average.orderValueCents === null ? "–" : money(average.orderValueCents), trend: average.orderValueCents !== null && averageBefore?.orderValueCents ? change(average.orderValueCents, averageBefore.orderValueCents, "up") : null, values: series(item => item.orders ? item.valueCents / item.orders : 0), previous: previous && before ? before.map(item => item.orders ? item.valueCents / item.orders : 0) : null },
    { label: "Discount given away", value: money(now.discountCents), trend: change(now.discountCents, was?.discountCents, "none"), values: series(item => item.discountCents), previous: previousSeries(item => item.discountCents) },
  ];

  const preDiscount = now.valueCents + now.discountCents;
  const groups = slicesOf(report.groups, line => line.valueCents);
  const topPrefixes = [...report.prefixes].sort((a, b) => b.valueCents - a.valueCents).slice(0, 6).map(line => ({ label: line.name, value: line.valueCents, note: `${count.format(line.orders)} ${line.orders === 1 ? "order" : "orders"}` }));
  const topDiscounts = [...report.discounts].sort((a, b) => b.valueCents - a.valueCents).slice(0, 6).map(item => ({ label: item.label, value: item.valueCents, note: `${count.format(item.orders)} ${item.orders === 1 ? "order" : "orders"}` }));
  const rowOf = (label: string, cents: number, strong = false) => <s-table-row key={label}>
    <s-table-cell>{strong ? <s-text type="strong">{label}</s-text> : label}</s-table-cell>
    <s-table-cell>{strong ? <s-text type="strong">{money(cents)}</s-text> : money(cents)}</s-table-cell>
  </s-table-row>;
  const exportItems: Array<[string, string]> = [["Discounts", "discounts"], ["By day", "days"], ["By group", "groups"], ["By code prefix", "prefixes"]];

  return <s-page heading="Reports" inlineSize="large">
    <s-button slot="primary-action" type="button" variant="primary" disabled={refreshing || undefined} onClick={onRefresh}>{refreshing ? "Reading orders…" : "Refresh figures"}</s-button>
    <s-button slot="secondary-actions" commandFor="reports-export" disabled={busy || !ready || undefined}>Export</s-button>
    <s-menu id="reports-export" accessibilityLabel="Export a table as CSV">
      {exportItems.map(([label, kind]) => <s-button key={kind} icon="export" onClick={() => void download(exportUrl(kind, filter))}>{label}</s-button>)}
    </s-menu>
    <s-stack direction="block" gap="base">
      <ReportStatus data={data} />
      <s-section padding="none">
        <s-box padding="base">
          <s-stack direction="inline" gap="base" alignItems="end" justifyContent="space-between">
            <s-stack direction="inline" gap="base" alignItems="end">
              <PolarisSelect label="Period" value={preset} onChange={event => go(event.currentTarget.value, compare)}>
                {periods.map(item => <s-option key={item.value} value={item.value}>{item.label}</s-option>)}
              </PolarisSelect>
              <PolarisCheckbox label="Compare with the period before" checked={compare && Boolean(previous)} disabled={!previous && !compare} onChange={event => go(preset, event.currentTarget.checked)} />
            </s-stack>
            <s-text color="subdued">{ready ? `Last refreshed ${when(data.syncedAt)}` : ""}</s-text>
          </s-stack>
          {compare && !previous && ready && <s-box paddingBlockStart="small-200"><s-text color="subdued">Orders are kept for 60 days, so there is no earlier period to compare with for this length.</s-text></s-box>}
        </s-box>
      </s-section>

      {ready && <>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(210px, 1fr))" gap="base">
          {metrics.map(metric => <s-section key={metric.label}>
            <s-stack direction="block" gap="small-300">
              <s-text color="subdued">{metric.label}</s-text>
              <s-stack direction="inline" gap="small-200" alignItems="center"><s-heading>{metric.value}</s-heading>{metric.trend}</s-stack>
              <Sparkline values={metric.values} previous={compare ? metric.previous : null} label={`${metric.label} by day: ${metric.value}`} />
            </s-stack>
          </s-section>)}
        </s-grid>

        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
          <Card heading="Revenue over time">
            <AreaChart values={series(item => item.valueCents)} previous={compare ? previousSeries(item => item.valueCents) : null} labels={labels} previousLabels={previousLabels} format={money} axisFormat={compactMoney} label={`Revenue by day from orders that used a discount, ${money(now.valueCents)} in all`} />
          </Card>
          <Card heading="Revenue by group" action={<s-button variant="tertiary" href={appUrl("/app/reports/groups")}>Manage groups</s-button>}>
            {groups.length ? <Donut slices={groups} centreLabel="Revenue" centreValue={compactMoney(groups.reduce((sum, slice) => sum + slice.value, 0))} format={compactMoney} label="Revenue by group" /> : <s-text color="subdued">No orders used a discount in this period.</s-text>}
          </Card>
        </s-grid>

        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
          <Card heading="Orders over time">
            <AreaChart values={series(item => item.orders)} previous={compare ? previousSeries(item => item.orders) : null} labels={labels} previousLabels={previousLabels} format={value => count.format(value)} label={`Orders with a discount by day, ${count.format(now.orders)} in all`} height={200} />
          </Card>
          <Card heading="Discount breakdown">
            <s-table>
              <s-table-header-row><s-table-header>Item</s-table-header><s-table-header format="currency">Amount</s-table-header></s-table-header-row>
              <s-table-body>
                {rowOf("Revenue before discounts", preDiscount)}
                {rowOf("Discounts", -now.discountCents)}
                {rowOf("Revenue", now.valueCents, true)}
                {rowOf("Refunds", -now.refundCents)}
                {rowOf("After refunds", now.valueCents - now.refundCents, true)}
              </s-table-body>
            </s-table>
            <s-text color="subdued">Revenue is what customers paid on orders that used a discount, including shipping and tax.</s-text>
          </Card>
        </s-grid>

        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
          <Card heading="Revenue by code prefix" action={<s-button variant="tertiary" href={appUrl("/app/reports/prefixes")}>View all</s-button>}>
            <BarList items={topPrefixes} format={money} empty="No generated codes (like WELCOME-1A2B-3C4D5E) were used in this period." />
          </Card>
          <Card heading="Top discounts by revenue" action={<s-button variant="tertiary" href={appUrl("/app/reports/discounts")}>View all</s-button>}>
            <BarList items={topDiscounts} format={money} empty="No orders used a discount in this period." />
          </Card>
        </s-grid>
      </>}

      {ready && <s-section heading="Manual discounts">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">Discounts added by hand, such as replacement orders after a dispatch or shipping error. They are left out of the figures above.</s-text>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="base">
            <s-stack direction="block" gap="small-300"><s-text color="subdued">Orders</s-text><s-heading>{count.format(report.manual.totals.orders)}</s-heading></s-stack>
            <s-stack direction="block" gap="small-300"><s-text color="subdued">Share of all orders</s-text><s-heading>{`${(report.manual.share * 100).toFixed(1)}%`}</s-heading></s-stack>
            <s-stack direction="block" gap="small-300"><s-text color="subdued">Discount given</s-text><s-heading>{money(report.manual.totals.discountCents)}</s-heading></s-stack>
          </s-grid>
          <div><s-button variant="secondary" href={appUrl("/app/reports/manual")}>Open manual discounts</s-button></div>
        </s-stack>
      </s-section>}

      <s-section heading="More reports">
        <s-stack direction="block" gap="base">
          {reportLinks.map(item => <s-stack key={item.path} direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-stack direction="block" gap="small-300">
              <s-link href={appUrl(item.path)}>{item.title}</s-link>
              <s-text color="subdued">{item.description}</s-text>
            </s-stack>
            <s-button variant="secondary" href={appUrl(item.path)}>Open</s-button>
          </s-stack>)}
        </s-stack>
      </s-section>
    </s-stack>
  </s-page>;
}

export const reportLinks = [
  { path: "/app/reports/manual", title: "Manual discounts", description: "Orders with a discount added by hand, such as replacements for dispatch or shipping errors, kept apart from your promotions." },
  { path: "/app/reports/discounts", title: "Revenue by discount", description: "Orders, revenue and discounts for every code and automatic discount, with filters and a CSV download." },
  { path: "/app/reports/groups", title: "Revenue by group", description: "What each of your groups of discounts returned, with the controls to add and change groups and the discounts that no group catches yet." },
  { path: "/app/reports/prefixes", title: "Code prefixes and apps", description: "Redemptions of generated codes by prefix, such as Dotdigital's, and of every discount by the app that made it." },
  { path: "/app/reports/redemptions", title: "Redemptions", description: "How often every discount has been used over its lifetime, including codes made by other apps." },
];

