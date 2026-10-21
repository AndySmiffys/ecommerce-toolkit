import { useNavigate } from "react-router";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import { averages, dailySeries, spanDays, type Totals } from "../design/orderReport";
import { formatMoney } from "../design/formatMoney";
import type { OrderReportData } from "../services/orderReport.server";
import { AreaChart, BarList, Sparkline } from "./charts/Charts";
import { PolarisSelect } from "./PolarisControls";
import { ReportStatus } from "./ReportOrders";
import { useCsvDownload } from "./useCsvDownload";

const count = new Intl.NumberFormat("en-GB");
const periods = [{ value: "7", label: "Last 7 days" }, { value: "14", label: "Last 14 days" }, { value: "30", label: "Last 30 days" }, { value: "60", label: "Last 60 days" }];
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function change(current: number, previous: number | undefined) {
  if (previous === undefined || !previous) return null;
  const part = (current - previous) / previous;
  if (!Number.isFinite(part)) return null;
  // More replacement orders is not a good thing, so the change is shown without a good or bad colour.
  return <s-badge tone="neutral">{`${part >= 0 ? "▲" : "▼"} ${Math.abs(part * 100).toFixed(0)}%`}</s-badge>;
}

type ManualOrderRow = { orderId: string; name: string; createdAt: string; reasons: string; valueCents: number; discountCents: number };

/**
 * Orders with a discount added by hand, which Smiffys uses for replacements after a dispatch or shipping error. They
 * are kept apart from promotions everywhere else, so the other figures show what marketing discounts return and this
 * page shows what putting things right costs.
 */
export function ReportManual({ orders, manualOrders, refreshing, onRefresh }: { orders: OrderReportData; manualOrders: { orders: ManualOrderRow[]; count: number }; refreshing: boolean; onRefresh: () => void }) {
  const appUrl = useEmbeddedAppUrl();
  const navigate = useNavigate();
  const { busy, exportUrl, download } = useCsvDownload();
  const { report, previous, filter } = orders;
  const manual = report.manual;
  const was = previous?.manual.totals;
  const money = (cents: number | null) => formatMoney(cents, orders.currency);
  const compactMoney = (cents: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: orders.currency, notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);
  const days = dailySeries(manual.days, filter.from, filter.to);
  const before = previous && orders.previousRange ? dailySeries(previous.manual.days, orders.previousRange.from, orders.previousRange.to) : null;
  const labels = days.map(item => shortDay(item.day));
  const series = (pick: (item: Totals) => number) => days.map(pick);
  const previousSeries = (pick: (item: Totals) => number) => before?.map(pick) ?? null;
  const ready = Boolean(orders.syncedAt);
  const preset = periods.find(item => spanDays(filter) === Number(item.value))?.value ?? "30";
  const average = averages(manual.totals);
  const cards = [
    { label: "Orders with a manual discount", value: count.format(manual.totals.orders), trend: change(manual.totals.orders, was?.orders), values: series(item => item.orders), previous: previousSeries(item => item.orders) },
    { label: "Share of all orders", value: `${(manual.share * 100).toFixed(1)}%`, trend: null, values: series(item => item.orders), previous: null },
    { label: "Discount given", value: money(manual.totals.discountCents), trend: change(manual.totals.discountCents, was?.discountCents), values: series(item => item.discountCents), previous: previousSeries(item => item.discountCents) },
    { label: "Average discount per order", value: money(average.discountPerOrderCents), trend: null, values: series(item => item.orders ? item.discountCents / item.orders : 0), previous: null },
  ];
  const reasons = manual.reasons.slice(0, 8).map(item => ({ label: item.label, value: item.orders, note: money(item.discountCents) }));

  return <s-page heading="Manual discounts" inlineSize="large">
    <s-link slot="breadcrumb-actions" href={appUrl("/app/reports")}>Reports</s-link>
    <s-button slot="primary-action" type="button" variant="primary" disabled={refreshing || undefined} onClick={onRefresh}>{refreshing ? "Reading orders…" : "Refresh figures"}</s-button>
    <s-button slot="secondary-actions" commandFor="manual-export" disabled={busy || !ready || undefined}>Export</s-button>
    <s-menu id="manual-export" accessibilityLabel="Export a table as CSV">
      <s-button icon="export" onClick={() => void download(exportUrl("manual", filter))}>By reason</s-button>
      <s-button icon="export" onClick={() => void download(exportUrl("manual-orders", filter))}>Orders</s-button>
    </s-menu>
    <s-stack direction="block" gap="base">
      <ReportStatus data={orders} />
      <s-section padding="none">
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">Discounts added by hand to an order, such as replacements after a dispatch or shipping error. They are left out of every other report, so those show only what your promotions return.</s-text>
            <PolarisSelect label="Period" value={preset} onChange={event => navigate(appUrl(`/app/reports/manual?days=${event.currentTarget.value}`))}>
              {periods.map(item => <s-option key={item.value} value={item.value}>{item.label}</s-option>)}
            </PolarisSelect>
          </s-stack>
        </s-box>
      </s-section>

      {ready && <>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(210px, 1fr))" gap="base">
          {cards.map(card => <s-section key={card.label}>
            <s-stack direction="block" gap="small-300">
              <s-text color="subdued">{card.label}</s-text>
              <s-stack direction="inline" gap="small-200" alignItems="center"><s-heading>{card.value}</s-heading>{card.trend}</s-stack>
              <Sparkline values={card.values} previous={card.previous} label={`${card.label}: ${card.value}`} />
            </s-stack>
          </s-section>)}
        </s-grid>

        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
          <s-section heading="Orders over time">
            <AreaChart values={series(item => item.orders)} previous={previousSeries(item => item.orders)} labels={labels} previousLabels={before?.map(item => shortDay(item.day))} format={value => count.format(value)} label={`Orders with a manual discount by day, ${count.format(manual.totals.orders)} in all`} height={200} />
          </s-section>
          <s-section heading="Discount given over time">
            <AreaChart values={series(item => item.discountCents)} previous={previousSeries(item => item.discountCents)} labels={labels} previousLabels={before?.map(item => shortDay(item.day))} format={money as (value: number) => string} axisFormat={compactMoney} label={`Discount given on manual discounts by day, ${money(manual.totals.discountCents)} in all`} height={200} />
          </s-section>
        </s-grid>

        <s-section heading="By reason">
          <s-stack direction="block" gap="base">
            <BarList items={reasons} format={value => `${count.format(value)} ${value === 1 ? "order" : "orders"}`} empty="No orders had a manual discount in this period." />
            {manual.reasons.length > 0 && <s-table>
              <s-table-header-row>
                <s-table-header>Reason</s-table-header>
                <s-table-header format="numeric">Orders</s-table-header>
                <s-table-header format="numeric">Order total</s-table-header>
                <s-table-header format="numeric">Discount given</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {manual.reasons.map(item => <s-table-row key={item.key}>
                  <s-table-cell>{item.label}</s-table-cell>
                  <s-table-cell>{count.format(item.orders)}</s-table-cell>
                  <s-table-cell>{money(item.valueCents)}</s-table-cell>
                  <s-table-cell>{money(item.discountCents)}</s-table-cell>
                </s-table-row>)}
              </s-table-body>
            </s-table>}
          </s-stack>
        </s-section>

        <s-section heading="Orders">
          <s-stack direction="block" gap="base">
            {manualOrders.orders.length === 0
              ? <s-text color="subdued">No orders had a manual discount in this period.</s-text>
              : <s-table>
                <s-table-header-row>
                  <s-table-header>Order</s-table-header>
                  <s-table-header>Date</s-table-header>
                  <s-table-header>Reason</s-table-header>
                  <s-table-header format="numeric">Order total</s-table-header>
                  <s-table-header format="numeric">Discount given</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {manualOrders.orders.map(order => <s-table-row key={order.orderId}>
                    <s-table-cell><s-link href={`shopify:admin/orders/${order.orderId.split("/").pop()}`} target="_blank">{order.name || "Order"}</s-link></s-table-cell>
                    <s-table-cell>{date(order.createdAt)}</s-table-cell>
                    <s-table-cell>{order.reasons}</s-table-cell>
                    <s-table-cell>{money(order.valueCents)}</s-table-cell>
                    <s-table-cell>{money(order.discountCents)}</s-table-cell>
                  </s-table-row>)}
                </s-table-body>
              </s-table>}
            {manualOrders.count > manualOrders.orders.length && <s-text color="subdued">Showing the latest {count.format(manualOrders.orders.length)} of {count.format(manualOrders.count)}. Export the orders to see them all.</s-text>}
            <s-text color="subdued">Order numbers, dates, the reason typed and amounts only: no customer details are read or kept.</s-text>
          </s-stack>
        </s-section>
      </>}
    </s-stack>
  </s-page>;
}
