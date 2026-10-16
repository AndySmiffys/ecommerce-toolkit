import type { ReactNode } from "react";

/** One collapsible step of the promotion form. The parent keeps one step open at a time. */
export function FormStep({ id, number, title, summary, optional = false, status, locked = false, open, onToggle, next, children }: {
  id: string;
  number: number;
  title: string;
  summary: string;
  optional?: boolean;
  /** Complete when everything the form needs is filled in; attention when this step holds the problem that blocks saving. */
  status?: "complete" | "attention";
  /** A step after an incomplete one cannot be opened yet. */
  locked?: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  /** Continue is greyed out, with the reason, until the step is complete. */
  next?: { label: string; onClick: () => void; disabled?: boolean; hint?: string };
  children: ReactNode;
}) {
  return <details data-step={id} open={open} onToggle={event => onToggle(event.currentTarget.open)} style={{ border: "1px solid #dedede", borderRadius: 12, background: "#fff", boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)", minWidth: 0 }}>
    <summary aria-disabled={locked || undefined} onClick={event => { if (locked) event.preventDefault(); }} style={{ cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.55 : 1, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
      <span aria-hidden="true" style={{ flex: "0 0 auto", width: 24, height: 24, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, background: open ? "#202223" : "#f1f1f1", color: open ? "#fff" : "#303030" }}>{number}</span>
      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 8 }}>{title}{optional && <s-badge>Optional</s-badge>}{status === "complete" && <s-badge tone="success">Complete</s-badge>}{status === "attention" && <s-badge tone="warning">Needs attention</s-badge>}</span>
        {!open && <span style={{ color: "#616161", fontSize: 12, overflowWrap: "anywhere" }}>{locked ? "Complete the earlier steps first." : summary}</span>}
      </span>
    </summary>
    <div style={{ padding: "0 16px 16px", display: "grid", gap: 16 }}>
      {children}
      {next && <div style={{ display: "grid", gap: 6 }}><div><s-button type="button" variant="secondary" disabled={next.disabled || undefined} onClick={next.onClick}>{next.label}</s-button></div>{next.disabled && next.hint && <s-text color="subdued">{next.hint}</s-text>}</div>}
    </div>
  </details>;
}
