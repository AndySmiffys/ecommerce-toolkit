import { useState } from "react";
import { useNavigate } from "react-router";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import { averages, type OrderFilter, type OrderLine, type Totals } from "../design/orderReport";
import type { OrderReportData } from "../services/orderReport.server";
import { DateField } from "./DateTimeField";
import { PolarisSelect } from "./PolarisControls";

const count = new Intl.NumberFormat("en-GB");
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";
const day = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" });
const percent = (value: number | null) => value === null ? "–" : `${(value * 100).toFixed(1)}%`;
const makeMoney = (currency: string) => {
  const format = new Intl.NumberFormat("en-GB", { style: "currency", currency });
  return (cents: number | null) => cents === null ? "–" : format.format(cents / 100);
};

/** Why there may be nothing to show yet, in plain words. */
export function ReportStatus({ data }: { data: OrderReportData }) {
  const denied = /access|scope|permission|approved/i.test(data.error ?? "");
  return <>
    {data.syncing && <s-banner tone="info">Reading your orders from Shopify. This can take a few minutes the first time, and this page updates by itself when it is done.</s-banner>}
    {data.error && !data.syncing && <s-banner tone="warning" heading="Orders could not be read">
      {data.error}{denied ? " The app needs permission to read orders, and Shopify may need to approve access to protected customer data first. Approve the new permission when Shopify asks, then choose Refresh figures." : ""}
    </s-banner>}
    {!data.syncedAt && !data.syncing && !data.error && <s-banner tone="info">Orders have not been read yet. Choose Refresh figures.</s-banner>}
  </>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <s-stack direction="block" gap="small-300">
    <s-text color="subdued">{label}</s-text>
    <s-heading>{value}</s-heading>
    {note && <s-text color="subdued">{note}</s-text>}
  </s-stack>;
}

function Metrics({ data, totals, exact }: { data: OrderReportData; totals: Totals; exact: boolean }) {
  const money = makeMoney(data.currency);
  const average = averages(totals);
  const { report } = data;
  return <s-grid gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="base">
    <Metric label={exact ? "Orders with a discount" : "Orders using these discounts"} value={count.format(totals.orders)} note={exact ? `${percent(report.discountedShare)} of ${count.format(report.all.orders)} orders` : undefined} />
    <Metric label="Order value" value={money(totals.valueCents)} note="What customers paid, including shipping and tax" />
    <Metric label="Discount given away" value={money(totals.discountCents)} note={average.discountRate === null ? undefined : `${percent(average.discountRate)} of the value before discount`} />
    <Metric label="Average order value" value={money(average.orderValueCents)} />
    <Metric label="Average discount per order" value={money(average.discountPerOrderCents)} />
    <Metric label="Refunded" value={money(totals.refundCents)} note={average.refundRate === null ? undefined : `${percent(average.refundRate)} of the value`} />
  </s-grid>;
}

/** A short summary for the Home page that links to the full report. */
export function OrderOverview({ data }: { data: OrderReportData }) {
  const appUrl = useEmbeddedAppUrl();
  const { report } = data;
  return <s-section heading="Discount returns, last 30 days">
    <s-stack direction="block" gap="base">
      <ReportStatus data={data} />
      {data.syncedAt && <>
        <Metrics data={data} totals={report.selected} exact />
        <s-text color="subdued">Orders that used a discount code or an automatic discount, from every source. Read from Shopify {when(data.syncedAt)}. Orders using two discounts count once here.</s-text>
      </>}
      <div><s-button href={appUrl("/app/reports")} variant="secondary">Open the full report</s-button></div>
    </s-stack>
  </s-section>;
}

function Table({ lines, heading, money, empty }: { lines: Array<Totals & { key: string; name: string; sub?: string }>; heading: string; money: (cents: number | null) => string; empty: string }) {
  if (!lines.length) return <s-text color="subdued">{empty}</s-text>;
  return <s-table>
    <s-table-header-row>
      <s-table-header>{heading}</s-table-header>
      <s-table-header format="numeric">Orders</s-table-header>
      <s-table-header format="numeric">Order value</s-table-header>
      <s-table-header format="numeric">Discount given</s-table-header>
      <s-table-header format="numeric">Average order</s-table-header>
      <s-table-header format="numeric">Average discount</s-table-header>
      <s-table-header format="numeric">Refunded</s-table-header>
    </s-table-header-row>
    <s-table-body>
      {lines.map(line => {
        const average = averages(line);
        return <s-table-row key={line.key}>
          <s-table-cell>{line.sub ? <s-stack direction="block" gap="small-300"><s-text type="strong">{line.name}</s-text><s-text color="subdued">{line.sub}</s-text></s-stack> : line.name}</s-table-cell>
          <s-table-cell>{count.format(line.orders)}</s-table-cell>
          <s-table-cell>{money(line.valueCents)}</s-table-cell>
          <s-table-cell>{money(line.discountCents)}</s-table-cell>
          <s-table-cell>{money(average.orderValueCents)}</s-table-cell>
          <s-table-cell>{money(average.discountPerOrderCents)}</s-table-cell>
          <s-table-cell>{money(line.refundCents)}</s-table-cell>
        </s-table-row>;
      })}
    </s-table-body>
  </s-table>;
}

const presets = [{ value: "7", label: "Last 7 days" }, { value: "14", label: "Last 14 days" }, { value: "30", label: "Last 30 days" }, { value: "60", label: "Last 60 days" }, { value: "custom", label: "Choose dates" }];
const kinds = [{ value: "", label: "All types" }, { value: "code", label: "Discount codes" }, { value: "automatic", label: "Automatic discounts" }, { value: "manual", label: "Manual (staff) discounts" }];

/** The filters. They live in the address, so a filtered report can be bookmarked or shared. */
function Filters({ data }: { data: OrderReportData }) {
  const appUrl = useEmbeddedAppUrl();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<OrderFilter & { preset: string }>(() => ({ ...data.filter, preset: presets.find(item => item.value !== "custom" && Math.round((Date.parse(`${data.filter.to}T00:00:00Z`) - Date.parse(`${data.filter.from}T00:00:00Z`)) / 86400000) === Number(item.value))?.value ?? "custom" }));
  const set = (change: Partial<typeof draft>) => setDraft(current => ({ ...current, ...change }));
  const apply = (next = draft) => {
    const params = new URLSearchParams();
    if (next.preset === "custom") { params.set("from", next.from); params.set("to", next.to); } else params.set("days", next.preset);
    if (next.group) params.set("group", next.group);
    if (next.prefix) params.set("prefix", next.prefix);
    if (next.kind) params.set("kind", next.kind);
    if (next.search.trim()) params.set("q", next.search.trim());
    navigate(appUrl(`/app/reports?${params}`));
  };
  const clear = () => { const reset = { ...draft, preset: "30", group: "", prefix: "", kind: "", search: "" }; setDraft(reset); apply(reset); };
  return <s-stack direction="block" gap="base">
    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
      <PolarisSelect label="Period" value={draft.preset} onChange={event => set({ preset: event.currentTarget.value })}>
        {presets.map(item => <s-option key={item.value} value={item.value}>{item.label}</s-option>)}
      </PolarisSelect>
      {draft.preset === "custom" && <DateField label="From" value={draft.from} onChange={from => set({ from })} />}
      {draft.preset === "custom" && <DateField label="To" value={draft.to} onChange={to => set({ to })} />}
      <PolarisSelect label="Group" value={draft.group} onChange={event => set({ group: event.currentTarget.value })}>
        <s-option value="">All groups</s-option>
        {data.groups.map(group => <s-option key={group.id} value={`group-${group.id}`}>{group.name}</s-option>)}
        <s-option value="other">Other discounts</s-option>
      </PolarisSelect>
      <PolarisSelect label="Code prefix" value={draft.prefix} onChange={event => set({ prefix: event.currentTarget.value })}>
        <s-option value="">All prefixes</s-option>
        {data.report.prefixChoices.map(prefix => <s-option key={prefix} value={prefix}>{prefix}-</s-option>)}
      </PolarisSelect>
      <PolarisSelect label="Type" value={draft.kind} onChange={event => set({ kind: event.currentTarget.value })}>
        {kinds.map(item => <s-option key={item.value} value={item.value}>{item.label}</s-option>)}
      </PolarisSelect>
      <s-text-field label="Search code or title" value={draft.search} maxLength={60} onInput={event => set({ search: event.currentTarget.value })} />
    </s-grid>
    <s-stack direction="inline" gap="base">
      <s-button type="button" variant="primary" onClick={() => apply()}>Apply filters</s-button>
      <s-button type="button" variant="secondary" onClick={clear}>Clear filters</s-button>
    </s-stack>
  </s-stack>;
}

/** The full report on the Reports page: filters, headline figures, then the same figures by day, group, prefix and discount. */
export function OrderDrilldown({ data }: { data: OrderReportData }) {
  const { report, filter } = data;
  const money = makeMoney(data.currency);
  const narrowed = !report.exact;
  const groups: Array<Totals & { key: string; name: string; sub?: string }> = report.groups.map((line: OrderLine) => ({ ...line, sub: undefined }));
  return <>
    <ReportStatus data={data} />
    <s-section heading="Returns by discount">
      <s-stack direction="block" gap="base">
        <s-paragraph>What orders that used a discount were worth, and what the discounts gave away, from your Shopify orders for {day(filter.from)} to {day(filter.to)}. The last 60 days are kept, and the app reads orders daily. Days are counted in UTC.</s-paragraph>
        <Filters key={`${filter.from}${filter.to}${filter.group}${filter.prefix}${filter.kind}${filter.search}`} data={data} />
      </s-stack>
    </s-section>
    {data.syncedAt && <s-section heading={narrowed ? "Selected discounts" : "All discounts"}>
      <s-stack direction="block" gap="base">
        <Metrics data={data} totals={report.selected} exact={report.exact} />
        <s-text color="subdued">
          {narrowed ? "An order that used two of the selected discounts is counted under each, so the totals can add up to more than the number of orders. " : "Orders using more than one discount are counted once. "}
          Order value is the whole order, not just the discounted items. Read from Shopify {when(data.syncedAt)}.
        </s-text>
      </s-stack>
    </s-section>}
    {data.syncedAt && <s-section heading="By day">
      <Table lines={report.days.map(item => ({ ...item, key: item.day, name: day(item.day) }))} heading="Day" money={money} empty="No orders used these discounts in this period." />
    </s-section>}
    {data.syncedAt && <s-section heading="By group">
      <Table lines={groups} heading="Group" money={money} empty="No groups yet." />
    </s-section>}
    {data.syncedAt && report.prefixes.length > 0 && <s-section heading="By code prefix">
      <Table lines={report.prefixes} heading="Prefix" money={money} empty="" />
    </s-section>}
    {data.syncedAt && <s-section heading="By discount">
      <s-stack direction="block" gap="base">
        <Table lines={report.discounts.map(item => ({ ...item, name: item.label, sub: item.kind === "code" ? "Discount code" : item.kind === "manual" ? "Manual discount" : "Automatic discount" }))} heading="Discount" money={money} empty="No orders used these discounts in this period." />
        {report.discountCount > report.discounts.length && <s-text color="subdued">Showing the {count.format(report.discounts.length)} most used of {count.format(report.discountCount)}. Use the filters to narrow it.</s-text>}
      </s-stack>
    </s-section>}
  </>;
}
