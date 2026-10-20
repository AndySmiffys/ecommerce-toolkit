/** A row of headline figures, like the strip across the top of Shopify's Products and Home pages. It wraps on a phone. */
export type Metric = { label: string; value: string; note?: string; tone?: "positive" | "negative" };

export function MetricStrip({ metrics, caption }: { metrics: Metric[]; caption?: string }) {
  return <s-section padding="none">
    <s-box padding="base">
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(150px, 1fr))" gap="base" alignItems="start">
        {caption && <s-text color="subdued">{caption}</s-text>}
        {metrics.map(metric => <s-stack key={metric.label} direction="block" gap="small-300">
          <s-text color="subdued">{metric.label}</s-text>
          <s-heading>{metric.value}</s-heading>
          {metric.note && (metric.tone ? <s-badge tone={metric.tone === "positive" ? "success" : "critical"}>{metric.note}</s-badge> : <s-text color="subdued">{metric.note}</s-text>)}
        </s-stack>)}
      </s-grid>
    </s-box>
  </s-section>;
}
