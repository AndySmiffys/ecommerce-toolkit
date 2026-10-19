import type { ReactNode } from "react";
import { getStatusTone } from "../design/statusTone";
import { PolarisSelect } from "./PolarisControls";

const statusLabels: Record<string, string> = { ACTIVE: "Active", SCHEDULED: "Scheduled", EXPIRED: "Expired" };

/**
 * The top of a promotion: its name and type, the discount's Shopify status, whether it is visible on the
 * website, the website status control, a plain-English summary of the offer, where it ranks in the storefront
 * priority order, and anything that still stops it being saved.
 */
export function PromotionOverview({ title, typeLabel, discountStatus, websiteVisible, websiteEnabled, onWebsiteEnabledChange, websiteLocked = false, summary, priority, issue }: {
  title: string;
  typeLabel: string;
  /** The Shopify status of a saved discount, or undefined for one that has not been saved yet. */
  discountStatus?: string;
  websiteVisible: boolean;
  /** The website status the merchant controls: Enabled shows eligible offers, Draft keeps them hidden. */
  websiteEnabled: boolean;
  onWebsiteEnabledChange: (enabled: boolean) => void;
  /** Code lists stay in Draft. */
  websiteLocked?: boolean;
  summary: string;
  priority: ReactNode;
  issue?: { message: string; stepTitle: string; onGo: () => void } | null;
}) {
  return <s-box background="subdued" border="base" borderRadius="large" padding="large">
    <div role="region" aria-label="Promotion overview">
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-heading>{title}</s-heading>
          <s-badge>{typeLabel}</s-badge>
          <s-badge tone={discountStatus ? getStatusTone(discountStatus) : "neutral"}>{discountStatus ? statusLabels[discountStatus] ?? "Unknown" : "Not saved yet"}</s-badge>
          <s-badge tone={websiteVisible ? "success" : "warning"}>{websiteVisible ? "Visible on website" : "Not visible on website"}</s-badge>
        </s-stack>
        <div role="status" aria-label="Promotion summary" style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.35, overflowWrap: "anywhere" }}>{summary}</div>
        <s-divider />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          <s-box background="base" border="base" borderRadius="base" padding="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>Website status</s-heading>
              <PolarisSelect label="Website promotion status" labelAccessibilityVisibility="exclusive" disabled={websiteLocked} details={websiteLocked ? "Code lists stay in Draft. Distribute their codes using the CSV download." : "Enabled shows eligible offers on the storefront. Draft keeps the design saved but hidden."} value={websiteEnabled ? "enabled" : "draft"} onChange={event => onWebsiteEnabledChange(event.currentTarget.value === "enabled")}><s-option value="enabled">Enabled</s-option><s-option value="draft">Draft</s-option></PolarisSelect>
            </s-stack>
          </s-box>
          <s-box background="base" border="base" borderRadius="base" padding="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>Priority</s-heading>
              {priority}
            </s-stack>
          </s-box>
        </div>
        {issue && <s-text color="subdued">To save: {issue.message} <s-button type="button" variant="tertiary" onClick={issue.onGo}>Go to {issue.stepTitle}</s-button></s-text>}
      </s-stack>
    </div>
  </s-box>;
}
