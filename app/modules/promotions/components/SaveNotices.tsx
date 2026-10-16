import { useEffect, useRef } from "react";

/** Native Shopify banners for what the save bar cannot say: why saving failed, and what is still missing. */
export function SaveNotices({ error, issue, onDismissError }: { error?: string | null; issue?: string | null; onDismissError?: () => void }) {
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
  if (!error && !issue) return null;
  return <div ref={wrapper} tabIndex={-1} style={{ display: "grid", gap: 12, marginBottom: 16, outline: "none" }}>
    {error && <div role="alert"><s-banner ref={banner} tone="critical" heading="Not saved" dismissible>{error}</s-banner></div>}
    {issue && <s-banner tone="warning" heading="Complete before saving">{issue}</s-banner>}
  </div>;
}
