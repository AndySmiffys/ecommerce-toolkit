import { useEffect, useRef } from "react";

/** Native Shopify banners for what the save bar cannot say: why saving failed, and what is still missing. */
/** Shown after a save while the website status is still Draft, so a hidden promotion is not forgotten. */
export const draftSavedWarning = "The promotion is saved, but its website status is Draft, so it is not showing on the storefront. Set the website status to Enabled when it is ready to go live.";

export function SaveNotices({ error, issue, warning, onDismissError }: { error?: string | null; issue?: string | null; warning?: string | null; onDismissError?: () => void }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const banner = useRef<HTMLElementTagNameMap["s-banner"]>(null);
  const dismiss = useRef(onDismissError); dismiss.current = onDismissError;
  useEffect(() => {
    const element = banner.current;
    const handler = () => dismiss.current?.();
    element?.addEventListener("dismiss", handler);
    return () => element?.removeEventListener("dismiss", handler);
  }, [error]);
  useEffect(() => {
    if (!error) return;
    wrapper.current?.focus({ preventScroll: true });
    wrapper.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [error]);
  if (!error && !issue && !warning) return null;
  return <div ref={wrapper} tabIndex={-1} style={{ display: "grid", gap: 12, marginBottom: 16, outline: "none" }}>
    {error && <div role="alert"><s-banner ref={banner} tone="critical" heading="Not saved" dismissible>{error}</s-banner></div>}
    {issue && <s-banner tone="warning" heading="Complete before saving">{issue}</s-banner>}
    {warning && <s-banner tone="warning" heading="Website status is Draft">{warning}</s-banner>}
  </div>;
}
