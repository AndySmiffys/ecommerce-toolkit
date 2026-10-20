import { useEffect, useState } from "react";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import { formatMoney } from "../design/formatMoney";
import type { OrderReportData } from "../services/orderReport.server";
import { MetricStrip, type Metric } from "./MetricStrip";

function greeting(hour: number) {
  return hour < 12 ? "Good morning!" : hour < 18 ? "Good afternoon!" : "Good evening!";
}

/** The change since the 30 days before, as a short note, or nothing when there is nothing to compare with. */
function trend(current: number, previous: number): Pick<Metric, "note" | "tone"> {
  if (!previous) return {};
  const change = (current - previous) / previous;
  if (!Number.isFinite(change)) return {};
  const text = `${change >= 0 ? "+" : ""}${(change * 100).toFixed(0)}%`;
  return { note: `${text} on the 30 days before`, tone: undefined };
}

const cards = [
  { title: "Promotions", description: "Create discounts, set who sees them on your website, and manage them in bulk.", path: "/app/promotions", action: "Open promotions" },
  { title: "Storefront priority", description: "Drag promotions into the order they are shown in when more than one qualifies.", path: "/app/storefront-priorities", action: "Set the order" },
  { title: "Reports", description: "See what each discount, code prefix and group returned, including codes made by other apps.", path: "/app/reports", action: "Open reports" },
];

/** The app's home page, laid out like Shopify's: figures across the top, a greeting with shortcuts, then cards. */
export function HomeDashboard({ current, previous, activeCount }: { current: OrderReportData; previous: OrderReportData; activeCount: number | null }) {
  const appUrl = useEmbeddedAppUrl();
  // The greeting follows the visitor's own clock, so it is chosen in the browser after the page loads.
  const [hello, setHello] = useState("Hello!");
  useEffect(() => { setHello(greeting(new Date().getHours())); }, []);
  const now = current.report.selected;
  const before = previous.report.selected;
  const money = (cents: number) => formatMoney(cents, current.currency);
  const ready = Boolean(current.syncedAt);
  const top = current.report.discounts.slice(0, 5);
  return <s-stack direction="block" gap="large">
    <MetricStrip caption="Last 30 days" metrics={[
      { label: "Orders with a discount", value: ready ? String(now.orders) : "–", ...(ready ? trend(now.orders, before.orders) : {}) },
      { label: "Order value", value: ready ? money(now.valueCents) : "–", ...(ready ? trend(now.valueCents, before.valueCents) : {}) },
      { label: "Discount given away", value: ready ? money(now.discountCents) : "–", ...(ready ? trend(now.discountCents, before.discountCents) : {}) },
      { label: "Share of orders", value: ready ? `${(current.report.discountedShare * 100).toFixed(1)}%` : "–", note: ready ? "used a discount" : undefined },
    ]} />
    {current.syncing && <s-banner tone="info">Reading your orders from Shopify. The figures above fill in when it is done.</s-banner>}
    {current.error && !current.syncing && <s-banner tone="warning" heading="Orders could not be read">{current.error}</s-banner>}
    <s-stack direction="block" gap="base" alignItems="center">
      <s-stack direction="block" gap="small-300" alignItems="center">
        <s-heading>{hello}</s-heading>
        <s-text color="subdued">Let’s make your promotions work harder.</s-text>
      </s-stack>
      <s-stack direction="inline" gap="small-200" justifyContent="center">
        <s-clickable-chip href={appUrl("/app/promotions")}>{activeCount === null ? "Active promotions" : `Active promotions ${activeCount}`}</s-clickable-chip>
        <s-clickable-chip href={appUrl("/app/promotions/new?type=product")}>Create discount</s-clickable-chip>
        <s-clickable-chip href={appUrl("/app/reports")}>View reports</s-clickable-chip>
      </s-stack>
    </s-stack>
    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="base">
      {cards.map(card => <s-section key={card.path} heading={card.title}>
        <s-stack direction="block" gap="base">
          <s-text color="subdued">{card.description}</s-text>
          <div><s-button href={appUrl(card.path)} variant="secondary">{card.action}</s-button></div>
        </s-stack>
      </s-section>)}
      <s-section heading="Top discounts, last 30 days">
        {top.length === 0
          ? <s-text color="subdued">{ready ? "No orders used a discount in this period." : "Figures appear once your orders have been read."}</s-text>
          : <s-stack direction="block" gap="small-200">
            {top.map(discount => <s-stack key={discount.key} direction="inline" gap="base" justifyContent="space-between" alignItems="center">
              <s-text type="strong">{discount.label}</s-text>
              <s-text color="subdued">{discount.orders} {discount.orders === 1 ? "order" : "orders"} · {money(discount.discountCents)} off</s-text>
            </s-stack>)}
          </s-stack>}
      </s-section>
    </s-grid>
  </s-stack>;
}
