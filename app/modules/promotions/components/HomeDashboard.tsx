import { useEffect, useState } from "react";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import { averages, dailySeries, type Totals } from "../design/orderReport";
import { formatMoney } from "../design/formatMoney";
import type { HomeStats } from "../services/homeStats.server";
import type { OrderReportData } from "../services/orderReport.server";
import { AreaChart, BarList, Donut, Sparkline } from "./charts/Charts";
import { slicesOf } from "./ReportOverview";

const count = new Intl.NumberFormat("en-GB");
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const greeting = (hour: number) => hour < 12 ? "Good morning!" : hour < 18 ? "Good afternoon!" : "Good evening!";

/** The change on the 30 days before, as a small badge, or nothing when there is nothing to compare with. */
function change(current: number, previous: number | undefined, good: "up" | "none") {
  if (!previous) return null;
  const part = (current - previous) / previous;
  if (!Number.isFinite(part)) return null;
  return <s-badge tone={good === "none" ? "neutral" : part >= 0 ? "success" : "critical"}>{`${part >= 0 ? "▲" : "▼"} ${Math.abs(part * 100).toFixed(0)}%`}</s-badge>;
}

type Attention = { key: string; tone: "warning" | "info"; text: string; path: string; action: string };

/**
 * The app's home page: a greeting, what needs attention, the headline figures with trends, two charts, and a card for
 * each part of the app with its own live numbers and the way in.
 */
export function HomeDashboard({ current, stats }: { current: OrderReportData; stats: HomeStats }) {
  const appUrl = useEmbeddedAppUrl();
  // The greeting follows the visitor's own clock, so it is chosen in the browser after the page loads.
  const [hello, setHello] = useState("Hello!");
  useEffect(() => { setHello(greeting(new Date().getHours())); }, []);
  const { report, previous, filter } = current;
  const ready = Boolean(current.syncedAt);
  const money = (cents: number | null) => formatMoney(cents, current.currency);
  const compactMoney = (cents: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: current.currency, notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);
  const days = dailySeries(report.days, filter.from, filter.to);
  const before = previous && current.previousRange ? dailySeries(previous.days, current.previousRange.from, current.previousRange.to) : null;
  const series = (pick: (item: Totals) => number) => days.map(pick);
  const previousSeries = (pick: (item: Totals) => number) => before?.map(pick) ?? null;
  const now = report.selected;
  const was = previous?.selected;
  const average = averages(now);
  const averageBefore = was ? averages(was) : null;
  const labels = days.map(item => shortDay(item.day));

  const cards = [
    { label: "Revenue", value: money(now.valueCents), trend: change(now.valueCents, was?.valueCents, "up"), values: series(item => item.valueCents), previous: previousSeries(item => item.valueCents) },
    { label: "Orders with a discount", value: count.format(now.orders), trend: change(now.orders, was?.orders, "up"), values: series(item => item.orders), previous: previousSeries(item => item.orders) },
    { label: "Average order value", value: money(average.orderValueCents), trend: average.orderValueCents !== null && averageBefore?.orderValueCents ? change(average.orderValueCents, averageBefore.orderValueCents, "up") : null, values: series(item => item.orders ? item.valueCents / item.orders : 0), previous: before ? before.map(item => item.orders ? item.valueCents / item.orders : 0) : null },
    { label: "Discount given away", value: money(now.discountCents), trend: change(now.discountCents, was?.discountCents, "none"), values: series(item => item.discountCents), previous: previousSeries(item => item.discountCents) },
  ];

  const groups = slicesOf(report.groups, line => line.valueCents);
  const topDiscounts = [...report.discounts].sort((a, b) => b.valueCents - a.valueCents).slice(0, 5).map(item => ({ label: item.label, value: item.valueCents, note: `${count.format(item.orders)} ${item.orders === 1 ? "order" : "orders"}` }));

  const attention: Attention[] = [];
  if (stats.promotions?.endingSoon) attention.push({ key: "ending", tone: "info", text: `${stats.promotions.endingSoon} ${stats.promotions.endingSoon === 1 ? "promotion ends" : "promotions end"} in the next 7 days.`, path: "/app/promotions?status=active", action: "Review" });
  if (stats.google.issues) attention.push({ key: "google", tone: "warning", text: `${stats.google.issues} ${stats.google.issues === 1 ? "promotion chosen for Google isn’t" : "promotions chosen for Google aren’t"} ready to send.`, path: "/app/google", action: "See what to change" });
  if (current.error && !current.syncing) attention.push({ key: "orders", tone: "warning", text: `Your orders could not be read: ${current.error}`, path: "/app/reports", action: "Open reports" });

  const manual = report.manual;
  const tools = [
    { icon: "discount" as const, title: "Promotions", path: "/app/promotions", action: "Open promotions", secondary: { path: "/app/promotions/new?type=product", label: "Create discount" },
      stat: stats.promotions ? `${count.format(stats.promotions.active)} active` : "Reading your discounts…",
      line: stats.promotions ? `${count.format(stats.promotions.scheduled)} scheduled, ${count.format(stats.promotions.endingSoon)} ending in the next 7 days` : "Your promotions appear once they have been read." },
    { icon: "drag-handle" as const, title: "Storefront priority", path: "/app/storefront-priorities", action: "Set the order", secondary: null,
      stat: `${count.format(stats.websiteEnabled)} on your website`,
      line: "Promotions enabled for your website. When several fit the same place, the one nearest the top is shown." },
    { icon: "globe" as const, title: "Google Merchant Center", path: "/app/google", action: "Open Google", secondary: null,
      stat: stats.google.chosen ? `${count.format(stats.google.ready)} of ${count.format(stats.google.chosen)} ready` : "Not set up yet",
      line: stats.google.chosen ? "Promotions sent to Google as a promotions file." : "Choose promotions to send to Google from the Promotions page." },
    { icon: "search" as const, title: "Reports", path: "/app/reports", action: "Open reports", secondary: { path: "/app/reports/manual", label: "Manual discounts" },
      stat: ready ? `${count.format(manual.totals.orders)} replacement ${manual.totals.orders === 1 ? "order" : "orders"}` : "Reading your orders…",
      line: ready ? `${(manual.share * 100).toFixed(1)}% of orders had a manual discount in the last 30 days.` : "Revenue, groups, prefixes and manual discounts." },
  ];

  return <s-stack direction="block" gap="large">
    <s-stack direction="block" gap="small-300">
      <s-heading>{hello}</s-heading>
      <s-text color="subdued">Here’s how your promotions did in the last 30 days.</s-text>
    </s-stack>

    {current.syncing && <s-banner tone="info">Reading your orders from Shopify. The figures below fill in when it is done.</s-banner>}
    {attention.length > 0 && <s-section heading="Needs attention">
      <s-stack direction="block" gap="small">
        {attention.map(item => <s-stack key={item.key} direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-stack direction="inline" gap="small-200" alignItems="center"><s-badge tone={item.tone}>{item.tone === "warning" ? "Action" : "Heads up"}</s-badge><s-text>{item.text}</s-text></s-stack>
          <s-button variant="tertiary" href={appUrl(item.path)}>{item.action}</s-button>
        </s-stack>)}
      </s-stack>
    </s-section>}

    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(210px, 1fr))" gap="base">
      {cards.map(card => <s-section key={card.label}>
        <s-stack direction="block" gap="small-300">
          <s-text color="subdued">{card.label}</s-text>
          <s-stack direction="inline" gap="small-200" alignItems="center"><s-heading>{ready ? card.value : "–"}</s-heading>{ready && card.trend}</s-stack>
          {ready ? <Sparkline values={card.values} previous={card.previous} label={`${card.label}: ${card.value}`} /> : <s-text color="subdued">Waiting for your orders</s-text>}
        </s-stack>
      </s-section>)}
    </s-grid>

    {ready && <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
      <s-section heading="Revenue over time">
        <AreaChart values={series(item => item.valueCents)} previous={previousSeries(item => item.valueCents)} labels={labels} previousLabels={before?.map(item => shortDay(item.day))} format={money as (value: number) => string} axisFormat={compactMoney} label={`Revenue by day from orders that used a discount, ${money(now.valueCents)} in all`} height={220} />
      </s-section>
      <s-section heading="Revenue by group">
        {groups.length ? <Donut slices={groups} centreLabel="Revenue" centreValue={compactMoney(groups.reduce((sum, slice) => sum + slice.value, 0))} format={compactMoney} label="Revenue by group" /> : <s-text color="subdued">No orders used a discount in this period.</s-text>}
      </s-section>
    </s-grid>}

    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
      {tools.map(tool => <s-section key={tool.path}>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center"><s-icon type={tool.icon} /><s-heading>{tool.title}</s-heading></s-stack>
          <s-stack direction="block" gap="small-300">
            <s-heading>{tool.stat}</s-heading>
            <s-text color="subdued">{tool.line}</s-text>
          </s-stack>
          <s-stack direction="inline" gap="small-200">
            <s-button href={appUrl(tool.path)} variant="secondary">{tool.action}</s-button>
            {tool.secondary && <s-button href={appUrl(tool.secondary.path)} variant="tertiary">{tool.secondary.label}</s-button>}
          </s-stack>
        </s-stack>
      </s-section>)}
    </s-grid>

    {ready && topDiscounts.length > 0 && <s-section heading="Top discounts by revenue">
      <BarList items={topDiscounts} format={money as (value: number) => string} empty="No orders used a discount in this period." />
    </s-section>}
  </s-stack>;
}
