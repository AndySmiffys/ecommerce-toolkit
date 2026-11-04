import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ModalOverlay } from "./ModalOverlay";

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

export type ImageEdit = { x: number; y: number; alt: string; /** Width divided by height, measured from the image itself. */ ratio?: string };

/**
 * Edits what belongs to a chosen image, the way Shopify's own image editor does: click the image to set the
 * focal point (the part kept in view when it is cropped), and describe it with alt text. Shopify offers apps
 * no image editor to open (only a file picker), so this is a native modal with the same two controls.
 */
export function ImageEditModal({ open, onClose, imageUrl, value, altPlaceholder, onApply }: { open: boolean; onClose: () => void; imageUrl: string; value: ImageEdit; altPlaceholder?: string; onApply: (edit: ImageEdit) => void }) {
  const [draft, setDraft] = useState(value);
  const [measured, setMeasured] = useState("");
  // Start from the saved values each time the popup opens.
  useEffect(() => { if (open) setDraft(value); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  function place(event: MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    setDraft(current => ({ ...current, x: clamp(((event.clientX - box.left) / box.width) * 100), y: clamp(((event.clientY - box.top) / box.height) * 100) }));
  }
  function nudge(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 1;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!move) return;
    event.preventDefault();
    setDraft(current => ({ ...current, x: clamp(current.x + move[0]), y: clamp(current.y + move[1]) }));
  }
  return <ModalOverlay open={open} heading="Edit image" size="base" onClose={onClose}>
    <s-stack direction="block" gap="base">
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">Focal point</s-text>
        <s-text color="subdued">Click the image to choose the part that should stay in view when it is cropped, on desktop and mobile. You can also use the arrow keys, and hold Shift to move further.</s-text>
        <div role="button" tabIndex={0} aria-label={`Focal point, ${draft.x}% across and ${draft.y}% down`} onClick={place} onKeyDown={nudge} style={{ position: "relative", cursor: "crosshair", lineHeight: 0, borderRadius: 8, overflow: "hidden", outlineOffset: 2 }}>
          <img src={imageUrl} alt="" draggable={false} onLoad={event => { const { naturalWidth, naturalHeight } = event.currentTarget; if (naturalWidth && naturalHeight) setMeasured(String(Math.round((naturalWidth / naturalHeight) * 1000) / 1000)); }} style={{ display: "block", width: "100%", height: "auto", userSelect: "none" }} />
          <span aria-hidden="true" style={{ position: "absolute", left: `${draft.x}%`, top: `${draft.y}%`, width: 28, height: 28, marginLeft: -14, marginTop: -14, borderRadius: "50%", border: "3px solid #fff", background: "rgba(48,48,48,.55)", boxShadow: "0 0 0 1px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.35)", pointerEvents: "none" }} />
        </div>
        <s-text color="subdued">{draft.x}% across, {draft.y}% down</s-text>
      </s-stack>
      <s-text-field label="Image description (alt text)" value={draft.alt} placeholder={altPlaceholder} maxLength={250} details="Describe the image for shoppers using screen readers." onInput={event => { const next = event.currentTarget.value; setDraft(current => ({ ...current, alt: next })); }} />
    </s-stack>
    <s-button slot="secondary-actions" type="button" onClick={onClose}>Cancel</s-button>
    <s-button slot="primary-actions" type="button" variant="primary" onClick={() => { onApply({ ...draft, ratio: measured || undefined }); onClose(); }}>Apply</s-button>
  </ModalOverlay>;
}
