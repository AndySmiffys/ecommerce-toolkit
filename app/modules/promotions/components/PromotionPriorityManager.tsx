import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import type { HiddenPromotion, PriorityRow } from "../design/priorityOverview";
import { PromotionSaveBar } from "./PromotionSaveBar";
import { SaveNotices } from "./SaveNotices";

/** Move one entry of a list to the position of another. */
export function moveTo<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * One drag-and-drop order for the whole storefront: the promotion nearest the top is shown when
 * several qualify for the same place. Saving gives the list the priorities N down to 1.
 */
export function PromotionPriorityManager({ rows, hidden, errors, highlight, refreshing, onRefresh }: { rows: PriorityRow[]; hidden: HiddenPromotion[]; errors: string[]; highlight: string | null; refreshing: boolean; onRefresh: () => void }) {
  const fetcher = useFetcher<{ success: boolean; error: string | null }>();
  const appUrl = useEmbeddedAppUrl();
  const shopify = useAppBridge();
  const loadedOrder = useMemo(() => rows.map(row => row.id), [rows]);
  const [chosenOrder, setChosenOrder] = useState(loadedOrder);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [introduced, setIntroduced] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const highlighted = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setChosenOrder(loadedOrder); }, [loadedOrder]);
  useEffect(() => { highlighted.current?.scrollIntoView?.({ block: "center" }); }, [highlight, rows]);

  const byId = useMemo(() => Object.fromEntries(rows.map(row => [row.id, row])), [rows]);
  // The merchant's arrangement is used only while it holds exactly the promotions that were loaded. When the list is
  // reloaded and a promotion has joined or left the order (for example its website status changed), the loaded order
  // is used at once, not for one render after it, which would look up a promotion that is no longer there.
  const order = chosenOrder.length === loadedOrder.length && chosenOrder.every(id => id in byId) ? chosenOrder : loadedOrder;
  const dirty = order.some((id, index) => id !== loadedOrder[index]);
  const changes = order.map((id, index) => ({ id, priority: order.length - index, expectedPriority: byId[id].priority })).filter(change => change.priority !== change.expectedPriority);
  const saving = fetcher.state !== "idle";
  const target = rows.find(row => row.routeId === highlight);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.success) { setSaveError(null); setIntroduced(false); shopify.toast.show("Priority order saved"); }
    else setSaveError(fetcher.data.error);
  }, [fetcher.data, fetcher.state, shopify]);

  function move(from: number, to: number) {
    const next = moveTo(order, from, to);
    if (next === order) return;
    setChosenOrder(next);
    setAnnouncement(`Moved ${byId[order[from]].title} to position ${to + 1} of ${order.length}.`);
  }
  function save() {
    if (!dirty || saving || refreshing) return;
    setSaveError(null);
    fetcher.submit({ changes: JSON.stringify(changes) }, { method: "post", action: appUrl("/app/storefront-priorities") });
  }

  return <s-page heading="Storefront priority" inlineSize="large">
    <PromotionSaveBar dirty={dirty} saving={saving} busy={refreshing} issue={null} showWhileIncomplete onSave={save} onDiscard={() => { setChosenOrder(loadedOrder); setSaveError(null); }} />
    <SaveNotices error={saveError} onDismissError={() => setSaveError(null)} />
    <s-stack direction="block" gap="base">
      {target && introduced && !dirty && <s-banner tone="info" heading={`Set where ${target.title} ranks`}>It starts at the top of the order. Drag it to a new place, or use Move up and Move down, then save.</s-banner>}
      {errors.length > 0 && <s-banner tone="warning"><s-unordered-list>{errors.map(error => <s-list-item key={error}>{error}</s-list-item>)}</s-unordered-list></s-banner>}
      <s-section heading="Priority order">
        <s-stack direction="block" gap="base">
          <s-paragraph>Promotions are ranked from the top. When more than one promotion qualifies for the same place on the storefront (the header, a collection page, a product page or a product card), the one nearest the top is shown. Customer eligibility and dates are checked first.</s-paragraph>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <s-text color="subdued">Drag a promotion by its handle, or use Move up and Move down. Only Active and Scheduled promotions that can appear on the website are listed.</s-text>
            <s-button type="button" variant="secondary" disabled={refreshing || saving || dirty || undefined} onClick={onRefresh}>{refreshing ? "Refreshing…" : "Refresh list"}</s-button>
          </div>
          <div role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>{announcement}</div>
          {!order.length
            ? <s-banner tone="info">No promotions are in the order yet. A promotion joins it when it is Active or Scheduled, enabled for the website and has a block selected.</s-banner>
            : <div role="list" aria-label="Priority order" style={{ display: "grid", gap: 8 }}>
              {order.map((id, index) => {
                const row = byId[id];
                const isTarget = row.routeId === highlight;
                return <div key={id} role="listitem" ref={isTarget ? highlighted : undefined} aria-current={isTarget ? "true" : undefined}
                  draggable onDragStart={event => { setDragging(id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); }}
                  onDragOver={event => { if (dragging) { event.preventDefault(); setOver(id); } }}
                  onDrop={event => { event.preventDefault(); if (dragging) move(order.indexOf(dragging), index); setDragging(null); setOver(null); }}
                  onDragEnd={() => { setDragging(null); setOver(null); }}
                  style={{ display: "grid", gridTemplateColumns: "auto auto minmax(0, 1fr) auto", gap: 12, alignItems: "center", padding: "12px 14px", border: over === id && dragging !== id ? "2px solid #202223" : "1px solid #e3e3e3", borderRadius: 12, background: isTarget ? "#f1f8f5" : "#fff", opacity: dragging === id ? 0.5 : 1, cursor: "grab" }}>
                  <span aria-hidden="true" style={{ display: "inline-flex" }}><s-icon type="drag-handle" /></span>
                  <span style={{ minWidth: 28, textAlign: "center", fontWeight: 600 }} aria-label={`Position ${index + 1}`}>{index + 1}</span>
                  <s-stack direction="block" gap="small-300">
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <Link to={appUrl(`/app/promotions/${row.routeId}`)}>{row.title}</Link>
                      <s-badge tone={row.status === "Active" ? "success" : "info"}>{row.status}</s-badge>
                      {row.restricted && <s-badge tone="warning">Customer restricted</s-badge>}
                    </s-stack>
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      {row.blocks.map(block => <s-badge key={block}>{block}</s-badge>)}
                    </s-stack>
                    <s-text color="subdued">{row.audience} · {row.schedule}</s-text>
                    {row.warning && <s-text color="subdued">{row.warning}</s-text>}
                  </s-stack>
                  <s-stack direction="inline" gap="small-200">
                    <s-button type="button" variant="tertiary" icon="arrow-up" accessibilityLabel={`Move ${row.title} up`} disabled={index === 0 || saving || undefined} onClick={() => move(index, index - 1)} />
                    <s-button type="button" variant="tertiary" icon="arrow-down" accessibilityLabel={`Move ${row.title} down`} disabled={index === order.length - 1 || saving || undefined} onClick={() => move(index, index + 1)} />
                  </s-stack>
                </div>;
              })}
            </div>}
        </s-stack>
      </s-section>
      {hidden.length > 0 && <s-section heading={`Not in the order (${hidden.length})`}>
        <s-stack direction="block" gap="small">
          <s-text color="subdued">These promotions cannot appear on the website, so they are not ranked. They join the order when they can.</s-text>
          <s-unordered-list>{hidden.map(item => <s-list-item key={item.id}><Link to={appUrl(`/app/promotions/${item.routeId}`)}>{item.title}</Link>: {item.reason}</s-list-item>)}</s-unordered-list>
        </s-stack>
      </s-section>}
    </s-stack>
  </s-page>;
}
