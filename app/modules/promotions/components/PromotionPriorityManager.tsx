import { useEffect, useMemo, useState } from "react";
import { useFetcher, Link } from "react-router";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import type { buildPriorityOverview } from "../design/priorityOverview";
import { PolarisNumberField } from "./PolarisControls";
import { PromotionSaveBar } from "./PromotionSaveBar";
type Sections = ReturnType<typeof buildPriorityOverview>;
const cell = { padding: "12px 10px", textAlign: "left" as const, verticalAlign: "top", borderBottom: "1px solid #ebebeb" };
export function PromotionPriorityManager({ sections, errors, refreshing, onRefresh }: { sections: Sections; errors: string[]; refreshing: boolean; onRefresh: () => void }) {
  const fetcher = useFetcher<{ success: boolean; error: string | null }>();
  const appUrl = useEmbeddedAppUrl();
  const baseline = useMemo(() => Object.fromEntries(sections.flatMap(section => section.rows.map(row => [row.id, String(row.priority)]))), [sections]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const changes = Object.entries(edits).filter(([id, priority]) => baseline[id] !== undefined && priority !== baseline[id]);
  const dirty = changes.length > 0;
  const invalid = changes.some(([, value]) => !value.trim() || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 9999);
  const saving = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.success) { setEdits({}); setSaveError(null); }
    else setSaveError(fetcher.data.error);
  }, [fetcher.data, fetcher.state]);
  function edit(id: string, value: string) { setEdits(current => ({ ...current, [id]: value })); }
  function save() {
    if (!dirty || invalid || saving || refreshing) return;
    setSaveError(null);
    fetcher.submit({ changes: JSON.stringify(changes.map(([id, priority]) => ({ id, priority: Number(priority), expectedPriority: Number(baseline[id]) }))) }, { method: "post", action: appUrl("/app/storefront-priorities") });
  }
  return <s-page heading="Storefront priorities" inlineSize="large">
    <PromotionSaveBar dirty={dirty} saving={saving} busy={refreshing} invalid={invalid} onSave={save} onDiscard={() => { setEdits({}); setSaveError(null); }} />
    <div style={{ display: "grid", gap: 20, padding: "20px 0" }}>
      {saveError && <s-banner tone="critical">{saveError}</s-banner>}
      {invalid && <s-banner tone="warning">Enter whole-number priorities between 0 and 9999.</s-banner>}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
        <p style={{ margin: 0, maxWidth: 760 }}>Review saved promotions for each storefront block, ordered by highest priority first. The first promotion eligible for the visitor and page appears. Equal priorities favour the most recently added promotion.</p>
        <s-button type="button" variant="secondary" disabled={refreshing || saving || dirty || undefined} onClick={onRefresh}>{refreshing ? "Refreshing…" : "Refresh lists"}</s-button>
      </div>
      <small style={{ color: "#616161" }}>Edit priorities here, then use Save or Discard at the top. A promotion shares one priority across its selected blocks; changing it in one list updates the others. Lists reorder after saving. Draft and customer-restricted promotions remain visible for review.</small>
      {errors.length > 0 && <s-banner tone="warning"><ul style={{ margin: 0, paddingLeft: 18 }}>{errors.map(error => <li key={error}>{error}</li>)}</ul></s-banner>}
      {sections.map(section => <s-section key={section.id} heading={section.title}>
        {!section.rows.length ? <p style={{ margin: 0, color: "#616161" }}>No promotions have this block selected.</p> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr><th scope="col" style={cell}>Priority</th><th scope="col" style={cell}>Promotion</th><th scope="col" style={cell}>Audience</th><th scope="col" style={cell}>Visibility</th></tr></thead>
          <tbody>{section.rows.map(row => <tr key={row.id}>
            <td style={{ ...cell, width: 130 }}><PolarisNumberField label={`Priority for ${row.title}`} labelAccessibilityVisibility="exclusive" min={0} max={9999} step={1} value={edits[row.id] ?? baseline[row.id]} disabled={saving || refreshing} onInput={event => edit(row.id, event.currentTarget.value)} onChange={event => edit(row.id, event.currentTarget.value)} /></td>
            <td style={cell}><Link to={appUrl(`/app/promotions/${row.routeId}`)}>{row.title}</Link></td>
            <td style={cell}>{row.audience}</td>
            <td style={cell}><div style={{ display: "grid", gap: 6 }}><s-badge tone={row.status === "Available" ? "success" : row.status === "Customer restricted" ? "warning" : "neutral"}>{row.status}</s-badge><span>{row.detail}</span></div></td>
          </tr>)}</tbody>
        </table></div>}
      </s-section>)}
    </div>
  </s-page>;
}
