import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { ModalOverlay } from "./ModalOverlay";

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

/**
 * Sets the part of the image that stays visible when it is cropped, the way Shopify does for product media:
 * a button opens a modal showing the image, and a click (or the arrow keys) places the focal point.
 */
export function FocalPointField({ imageUrl, x, y, onChange }: { imageUrl: string; x: number; y: number; onChange: (x: number, y: number) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ x, y });
  function show() { setDraft({ x, y }); setOpen(true); }
  function place(event: MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    setDraft({ x: clamp(((event.clientX - box.left) / box.width) * 100), y: clamp(((event.clientY - box.top) / box.height) * 100) });
  }
  function nudge(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 1;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!move) return;
    event.preventDefault();
    setDraft(current => ({ x: clamp(current.x + move[0]), y: clamp(current.y + move[1]) }));
  }
  return <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
    <s-text type="strong">Focal point</s-text>
    <s-text color="subdued">{imageUrl ? `Currently ${x}% across and ${y}% down. The focal point is the part of the image kept in view when it is cropped on desktop and mobile.` : "Add an image to set its focal point."}</s-text>
    <div><s-button type="button" disabled={!imageUrl || undefined} onClick={show}>Set focal point</s-button></div>
    <ModalOverlay open={open} heading="Set focal point" size="base" onClose={() => setOpen(false)}>
      <s-stack direction="block" gap="base">
        <s-text color="subdued">Click the image to choose the part that should stay visible. You can also use the arrow keys, and hold Shift to move further.</s-text>
        <div role="button" tabIndex={0} aria-label={`Focal point, ${draft.x}% across and ${draft.y}% down`} onClick={place} onKeyDown={nudge} style={{ position: "relative", cursor: "crosshair", lineHeight: 0, borderRadius: 8, overflow: "hidden", outlineOffset: 2 }}>
          <img src={imageUrl} alt="" draggable={false} style={{ display: "block", width: "100%", height: "auto", userSelect: "none" }} />
          <span aria-hidden="true" style={{ position: "absolute", left: `${draft.x}%`, top: `${draft.y}%`, width: 28, height: 28, marginLeft: -14, marginTop: -14, borderRadius: "50%", border: "3px solid #fff", background: "rgba(48,48,48,.55)", boxShadow: "0 0 0 1px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.35)", pointerEvents: "none" }} />
        </div>
        <s-text color="subdued">{draft.x}% across, {draft.y}% down</s-text>
      </s-stack>
      <s-button slot="secondary-actions" type="button" onClick={() => setOpen(false)}>Cancel</s-button>
      <s-button slot="primary-actions" type="button" variant="primary" onClick={() => { onChange(draft.x, draft.y); setOpen(false); }}>Apply</s-button>
    </ModalOverlay>
  </div>;
}
