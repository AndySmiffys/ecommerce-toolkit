import { useEffect, useRef, useState } from "react";

type Props = {
  dirty: boolean;
  saving: boolean;
  /** Something the form is still waiting for, such as an image upload. */
  busy?: boolean;
  /** The first thing that must be completed before the changes can be saved. */
  issue?: string | null;
  /** The last save failed with this message. */
  error?: string | null;
  /** Changes whenever a save succeeds; the bar then confirms it briefly. */
  savedToken?: unknown;
  discardDisabled?: boolean;
  /** Keep the bar, with Discard, while the form is incomplete. New promotions wait until the form is complete instead. */
  showWhileIncomplete?: boolean;
  onSave: () => void;
  onDiscard: () => void;
};

const buttonStyle = { font: "inherit", fontSize: 13, fontWeight: 600, padding: "6px 14px", borderRadius: 8, border: "1px solid transparent", cursor: "pointer" } as const;

/**
 * A Shopify-style contextual save bar. It carries the unsaved, incomplete, error,
 * saving and saved messages, which the native admin bar cannot display.
 */
export function PromotionSaveBar({ dirty, saving, busy = false, issue, error, savedToken, discardDisabled = false, showWhileIncomplete = false, onSave, onDiscard }: Props) {
  const [saved, setSaved] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!savedToken) return;
    setSaved(true);
    const timer = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(timer);
  }, [savedToken]);
  useEffect(() => { if (dirty) setSaved(false); }, [dirty]);

  const incomplete = Boolean(issue);
  const visible = (dirty && (!incomplete || showWhileIncomplete)) || saving || Boolean(error) || saved;
  if (!visible) return null;
  const tone = error ? "error" : saved && !dirty ? "saved" : incomplete && dirty ? "incomplete" : "default";
  const message = saving ? "Saving…"
    : error ? `Not saved: ${error}`
    : saved && !dirty ? "Saved"
    : incomplete && dirty ? `Complete before saving: ${issue}`
    : busy ? "Waiting for the upload to finish…"
    : "Unsaved changes";
  const dot = { error: "#ff7a6b", saved: "#6fd39a", incomplete: "#ffc453", default: "#b5b5b5" }[tone];
  const canSave = dirty && !incomplete && !saving && !busy;
  return <div role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} aria-label="Promotion save bar"
    style={{ position: "sticky", top: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "10px 16px", margin: "0 0 16px", borderRadius: 12, background: "#303030", color: "#fff" }}>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0, fontSize: 14, fontWeight: 500 }}>
      <span aria-hidden="true" style={{ flex: "0 0 auto", width: 10, height: 10, borderRadius: "50%", background: dot }} />
      <span style={{ overflowWrap: "anywhere" }}>{message}</span>
    </span>
    {(dirty || error) && <span style={{ display: "inline-flex", gap: 8 }}>
      <button type="button" disabled={!dirty || saving || busy || discardDisabled} onClick={onDiscard}
        style={{ ...buttonStyle, background: "#4a4a4a", color: "#fff", opacity: !dirty || saving || busy || discardDisabled ? 0.5 : 1 }}>Discard</button>
      <button type="button" disabled={!canSave} onClick={onSave}
        style={{ ...buttonStyle, background: "#fff", color: "#303030", opacity: canSave ? 1 : 0.5 }}>{saving ? "Saving…" : "Save"}</button>
    </span>}
  </div>;
}
