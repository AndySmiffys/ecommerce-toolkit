import type { VisibilityNotice } from "../design/storefrontVisibility";
export function PromotionVisibilityNotice({ notices }: { notices: VisibilityNotice[] }) {
  if (!notices.length) return null;
  return <div aria-live="polite"><s-banner tone={notices.some(notice => notice.tone === "warning") ? "warning" : "info"}>
    <s-text type="strong">Storefront visibility</s-text>
    <s-unordered-list>
      {notices.map(notice => <s-list-item key={notice.id}>{notice.message}</s-list-item>)}
    </s-unordered-list>
  </s-banner></div>;
}
