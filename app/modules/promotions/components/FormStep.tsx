import type { ReactNode } from "react";

/** One collapsible step of the promotion form. The parent keeps one step open at a time. */
export function FormStep({ id, number, title, summary, optional = false, open, onToggle, next, children }: {
  id: string;
  number: number;
  title: string;
  summary: string;
  optional?: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  next?: { label: string; onClick: () => void };
  children: ReactNode;
}) {
  return <details data-step={id} open={open} onToggle={event => onToggle(event.currentTarget.open)} style={{ border: "1px solid #dedede", borderRadius: 12, background: "#fff", boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)", minWidth: 0 }}>
    <summary style={{ cursor: "pointer", padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
      <span aria-hidden="true" style={{ flex: "0 0 auto", width: 24, height: 24, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, background: open ? "#202223" : "#f1f1f1", color: open ? "#fff" : "#303030" }}>{number}</span>
      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 8 }}>{title}{optional && <s-badge>Optional</s-badge>}</span>
        {!open && <span style={{ color: "#616161", fontSize: 12, overflowWrap: "anywhere" }}>{summary}</span>}
      </span>
    </summary>
    <div style={{ padding: "0 16px 16px", display: "grid", gap: 16 }}>
      {children}
      {next && <div><s-button type="button" variant="secondary" onClick={next.onClick}>{next.label}</s-button></div>}
    </div>
  </details>;
}
