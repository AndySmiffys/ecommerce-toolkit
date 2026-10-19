import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { action } from "../../../routes/app.promotion-assets";
import type { PromotionImage } from "../services/promotionAssets.server";
import { ImageEditModal, type ImageEdit } from "./ImageEditModal";
export function PromotionImageField({ label, url, fileId, onChange, onBusy, edit }: { label: string; url: string; fileId: string; onChange: (image: PromotionImage | null) => void; onBusy: (busy: boolean) => void; edit?: { value: ImageEdit; altPlaceholder?: string; onApply: (edit: ImageEdit) => void } }) {
  const fetcher = useFetcher<typeof action>();
  const changeRef = useRef(onChange);
  const busyRef = useRef(onBusy);
  changeRef.current = onChange;
  busyRef.current = onBusy;
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const menuId = "image-menu-" + useId().replace(/:/g, "");
  const busy = pickerOpen || fetcher.state !== "idle";
  useEffect(() => { busyRef.current(busy); }, [busy]);
  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.image) changeRef.current(fetcher.data.image);
    setError(fetcher.data?.error ?? "");
  }, [fetcher.data]);
  function upload(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) { setError("Choose a JPG, PNG or WebP image up to 20 MB."); return; }
    const data = new FormData(); data.set("intent", "upload"); data.set("file", file);
    fetcher.submit(data, { method: "post", encType: "multipart/form-data", action: "/app/promotion-assets" });
  }
  async function browse() {
    if (busy) return;
    setError("");
    setPickerOpen(true);
    try {
      const bridge = window.shopify as unknown as { intents?: { invoke: (name: string, options: unknown) => Promise<{ complete: Promise<{ code: string; data?: { ids?: string[] } }> }> } };
      if (!bridge?.intents) { setError("Shopify Files is unavailable here. Try again or drag an image into the image area."); return; }
      const picker = await bridge.intents.invoke("pick:shopify/File", { data: { mediaTypes: ["MediaImage"], multiSelect: false, selectedFiles: fileId ? [fileId] : [] } });
      const result = await picker.complete;
      if (result.code === "ok" && result.data?.ids?.[0]) fetcher.submit({ intent: "resolve", fileId: result.data.ids[0] }, { method: "post", action: "/app/promotion-assets" });
    } catch { setError("The file picker could not be opened. Try again or drag an image into the image area."); }
    finally { setPickerOpen(false); }
  }
  const editable = Boolean(url && edit);
  return <div style={{ display: "grid", alignContent: "start", gap: 8, minWidth: 0 }}>
    <style>{".pe-image-box .pe-image-menu{opacity:0;transition:opacity .15s}.pe-image-box:hover .pe-image-menu,.pe-image-box:focus-within .pe-image-menu{opacity:1}@media (hover:none){.pe-image-box .pe-image-menu{opacity:1}}"}</style>
    <s-text type="strong">{label}</s-text>
    <div className="pe-image-box" style={{ position: "relative" }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) upload(event.dataTransfer.files[0]); }}>
    <s-clickable accessibilityLabel={editable ? `Edit ${label.toLowerCase()}: focal point and alt text` : "Choose " + label.toLowerCase() + " from Shopify Files"} disabled={busy || undefined} onClick={editable ? () => setEditing(true) : browse} border="base base dashed" borderRadius="base" padding="base" background="subdued" inlineSize="100%">
      <div style={{ height: 112, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {url ? <img src={url} alt={label} style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} /> : <s-text color="subdued">Drop an image or choose a file</s-text>}
      </div>
    </s-clickable>
    {url && <div className="pe-image-menu" style={{ position: "absolute", top: 8, right: 8 }}>
      <s-button type="button" variant="secondary" icon="menu-horizontal" accessibilityLabel={`${label} actions`} commandFor={menuId} disabled={busy || undefined} />
      <s-menu id={menuId} accessibilityLabel={`${label} actions`}>
        <s-button type="button" icon="replace" onClick={browse}>Change image</s-button>
        {edit && <s-button type="button" icon="image-alt" onClick={() => setEditing(true)}>Edit alt text</s-button>}
        <s-button type="button" icon="delete" tone="critical" onClick={() => { onChange(null); setError(""); }}>Remove image</s-button>
      </s-menu>
    </div>}
    </div>
    {busy && <span role="status" style={{ fontSize: 12, color: "#616161" }}>{pickerOpen ? "Choosing image…" : "Preparing image…"}</span>}
    {error && <span role="alert" style={{ color: "#b42318" }}>{error}</span>}
    {edit && url && <ImageEditModal open={editing} onClose={() => setEditing(false)} imageUrl={url} value={edit.value} altPlaceholder={edit.altPlaceholder} onApply={edit.onApply} />}
  </div>;
}
