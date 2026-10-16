import { useEffect, useMemo, useState } from "react";
import { useFetcher, Link } from "react-router";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import type { buildPriorityOverview } from "../design/priorityOverview";
import { PolarisNumberField } from "./PolarisControls";
import { PromotionSaveBar } from "./PromotionSaveBar";
import { SaveNotices } from "./SaveNotices";
import { useAppBridge } from "@shopify/app-bridge-react";
type Sections = ReturnType<typeof buildPriorityOverview>;
export function PromotionPriorityManager({ sections, errors, refreshing, onRefresh }: { sections: Sections; errors: string[]; refreshing: boolean; onRefresh: () => void }) {
  const fetcher = useFetcher<{ success: boolean; error: string | null }>();
  const appUrl = useEmbeddedAppUrl();
  const shopify = useAppBridge();
  const baseline = useMemo(() => Object.fromEntries(sections.flatMap(section => section.rows.map(row => [row.id, String(row.priority)]))), [sections]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const changes = Object.entries(edits).filter(([id, priority]) => baseline[id] !== undefined && priority !== baseline[id]);
  const dirty = changes.length > 0;
  const invalid = changes.some(([, value]) => !value.trim() || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 9999);
  const saving = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.success) { setEdits({}); setSaveError(null); shopify.toast.show("Priorities saved"); }
    else setSaveError(fetcher.data.error);
  }, [fetcher.data, fetcher.state, shopify]);
  function edit(id: string, value: string) { setEdits(current => ({ ...current, [id]: value })); }
  function save() {
    if (!dirty || invalid || saving || refreshing) return;
    setSaveError(null);
    fetcher.submit({ changes: JSON.stringify(changes.map(([id, priority]) => ({ id, priority: Number(priority), expectedPriority: Number(baseline[id]) }))) }, { method: "post", action: appUrl("/app/storefront-priorities") });
  }
  return <s-page heading="Storefront priorities" inlineSize="large">
    <PromotionSaveBar dirty={dirty} saving={saving} busy={refreshing} issue={invalid ? "Enter whole-number priorities between 0 and 9999." : null} showWhileIncomplete onSave={save} onDiscard={() => { setEdits({}); setSaveError(null); }} />
    <div style={{ display: "grid", gap: 20, padding: "20px 0" }}>
      <SaveNotices error={saveError} issue={dirty && invalid ? "Enter whole-number priorities between 0 and 9999." : null} onDismissError={() => setSaveError(null)} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
        <s-paragraph>Review saved promotions for each storefront block, ordered by highest priority first. The first promotion eligible for the visitor and page appears. Equal priorities favour the most recently added promotion.</s-paragraph>
        <s-button type="button" variant="secondary" disabled={refreshing || saving || dirty || undefined} onClick={onRefresh}>{refreshing ? "Refreshing…" : "Refresh lists"}</s-button>
      </div>
      <s-text color="subdued">Edit priorities here, then use Save or Discard at the top. A promotion shares one priority across its selected blocks; changing it in one list updates the others. Lists reorder after saving. Draft and customer-restricted promotions remain visible for review.</s-text>
      {errors.length > 0 && <s-banner tone="warning"><s-unordered-list>{errors.map(error => <s-list-item key={error}>{error}</s-list-item>)}</s-unordered-list></s-banner>}
      {sections.map(section => <s-section key={section.id} heading={section.title}>
        {!section.rows.length ? <s-text color="subdued">No promotions have this block selected.</s-text> : <s-table>
          <s-table-header-row><s-table-header>Priority</s-table-header><s-table-header>Promotion</s-table-header><s-table-header>Audience</s-table-header><s-table-header>Visibility</s-table-header></s-table-header-row>
          <s-table-body>{section.rows.map(row => <s-table-row key={row.id}>
            <s-table-cell><PolarisNumberField label={`Priority for ${row.title}`} labelAccessibilityVisibility="exclusive" min={0} max={9999} step={1} value={edits[row.id] ?? baseline[row.id]} disabled={saving || refreshing} onInput={event => edit(row.id, event.currentTarget.value)} onChange={event => edit(row.id, event.currentTarget.value)} /></s-table-cell>
            <s-table-cell><Link to={appUrl(`/app/promotions/${row.routeId}`)}>{row.title}</Link></s-table-cell>
            <s-table-cell>{row.audience}</s-table-cell>
            <s-table-cell><s-stack direction="block" gap="small-300"><s-badge tone={row.status === "Available" ? "success" : row.status === "Customer restricted" ? "warning" : "neutral"}>{row.status}</s-badge><s-text color="subdued">{row.detail}</s-text></s-stack></s-table-cell>
          </s-table-row>)}</s-table-body>
        </s-table>}
      </s-section>)}
    </div>
  </s-page>;
}
