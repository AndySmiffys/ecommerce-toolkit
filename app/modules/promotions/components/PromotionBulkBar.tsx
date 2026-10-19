import { useState } from "react";
import type { BulkIntent } from "../services/bulkPromotions.server";
import { ModalOverlay } from "./ModalOverlay";

type Confirm = "delete" | "deactivate";
const confirmations: Record<Confirm, { heading: (count: number) => string; button: (count: number) => string; tone: "critical" | "auto"; body: string }> = {
  delete: {
    heading: count => `Delete ${count} promotion${count === 1 ? "" : "s"}?`,
    button: count => `Delete ${count} promotion${count === 1 ? "" : "s"}`,
    tone: "critical",
    body: "This permanently deletes the discount in Shopify and the promotion's website design in this app, and removes it from the storefront. Orders already placed are not affected. This cannot be undone.",
  },
  deactivate: {
    heading: count => `Deactivate ${count} discount${count === 1 ? "" : "s"}?`,
    button: count => `Deactivate ${count} discount${count === 1 ? "" : "s"}`,
    tone: "auto",
    body: "Deactivating ends the discount in Shopify straight away and replaces its end date with now. Customers can no longer use it. If you activate it again, check its dates.",
  },
};

/**
 * What can be done to the promotions ticked on the list: switch the Shopify discounts on or off, switch the website
 * promotion between Enabled and Draft, or delete them. Deleting and deactivating ask first.
 */
export function PromotionBulkBar({ titles, busy, onAction, onClear }: { titles: string[]; busy: boolean; onAction: (intent: BulkIntent) => void; onClear: () => void }) {
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [shown, setShown] = useState<Confirm>("delete");
  const count = titles.length;
  function ask(kind: Confirm) { setShown(kind); setConfirm(kind); }
  const text = confirmations[shown];
  const listed = titles.slice(0, 8);
  return <s-box padding="base" background="subdued">
    <s-stack direction="inline" gap="base" alignItems="center">
      <s-text type="strong">{count} selected</s-text>
      <s-button type="button" disabled={busy || undefined} onClick={() => onAction("activate")}>Activate</s-button>
      <s-button type="button" disabled={busy || undefined} onClick={() => ask("deactivate")}>Deactivate</s-button>
      <s-button type="button" disabled={busy || undefined} onClick={() => onAction("website-enable")}>Enable on website</s-button>
      <s-button type="button" disabled={busy || undefined} onClick={() => onAction("website-draft")}>Set website to Draft</s-button>
      <s-button type="button" tone="critical" disabled={busy || undefined} onClick={() => ask("delete")}>Delete</s-button>
      <s-button type="button" variant="tertiary" disabled={busy || undefined} onClick={onClear}>Clear selection</s-button>
      {busy && <s-spinner accessibilityLabel="Working" size="base" />}
    </s-stack>
    <ModalOverlay open={confirm !== null} heading={text.heading(count)} size="base" onClose={() => setConfirm(null)}>
      <s-stack direction="block" gap="base">
        <s-text>{text.body}</s-text>
        <s-unordered-list>
          {listed.map((title, index) => <s-list-item key={`${index}-${title}`}>{title}</s-list-item>)}
        </s-unordered-list>
        {count > listed.length && <s-text color="subdued">and {count - listed.length} more</s-text>}
      </s-stack>
      <s-button slot="secondary-actions" type="button" onClick={() => setConfirm(null)}>Cancel</s-button>
      <s-button slot="primary-actions" type="button" variant="primary" tone={text.tone} disabled={busy || undefined} onClick={() => { const kind = shown; setConfirm(null); onAction(kind); }}>{text.button(count)}</s-button>
    </ModalOverlay>
  </s-box>;
}
