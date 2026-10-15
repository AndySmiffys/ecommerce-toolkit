import { PolarisSelect, PolarisCheckbox, PolarisNumberField } from "./PolarisControls";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { PromotionImageField } from "./PromotionImageField";
import { applyCampaignPatch, campaignValue, customisedPlacements, matchCampaign, selectedCampaignPlacements, type CampaignPatch } from "../design/sharedCampaign";
import { contrastRatio, copyLimits, placements, presetDesign, promotionBlock, setPromotionBlock, validateWebsite, type BlockVisibility, type Placement, type PromotionBlock, type PromotionStyle, type WebsiteDraft } from "../design/design";

const sectionStyle = { border: "1px solid #dedede", borderRadius: 12, background: "#fff", padding: 16, display: "grid", gap: 14 };
const helpStyle = { color: "#616161", fontSize: 12, lineHeight: 1.5 };
function ControlGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = useId();
  return <section aria-labelledby={id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12, borderTop: "1px solid #ebebeb", paddingTop: 16, minWidth: 0 }}>
    <div style={{ display: "grid", gap: 4 }}><h3 id={id} style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{title}</h3><p style={{ ...helpStyle, margin: 0 }}>{description}</p></div>
    {children}
  </section>;
}
function ColourField({ label, value, onChange, details }: { label: string; value: string; onChange: (value: string) => void; details: string }) {
  const id = useId();
  return <div style={{ display: "grid", gap: 5 }}>
    <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, border: "1px solid #8a8a8a", borderRadius: 8, padding: "8px 12px", background: "#fff", cursor: "pointer", minWidth: 0 }}>
      <span style={{ display: "grid", gap: 3 }}><span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span><span style={{ fontSize: 13, color: "#616161", fontVariantNumeric: "tabular-nums" }}>{value.toUpperCase()}</span></span>
      <input type="color" aria-label={label} aria-describedby={id} value={value} onChange={event => onChange(event.currentTarget.value)} style={{ width: 28, height: 28, flexShrink: 0, padding: 0, border: 0, background: "transparent", cursor: "pointer" }} />
    </label>
    <small id={id} style={helpStyle}>{details}</small>
  </div>;
}
function TextField({ label, value, onChange, maxLength, multiline = false, details }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number; multiline?: boolean; details?: string }) {
  return <div style={{ display: "grid", gap: 5 }}>{multiline ? <s-text-area label={label} rows={3} value={value} maxLength={maxLength} details={details} onInput={event => onChange(event.currentTarget.value)} /> : <s-text-field label={label} value={value} maxLength={maxLength} details={details} onInput={event => onChange(event.currentTarget.value)} />}{maxLength && <small style={{ ...helpStyle, textAlign: "right" }}>{value.length}/{maxLength}</small>}</div>;
}
const numberSettings = {
  headingSize: { label: "Headline size (px)", min: 10, max: 48, details: "Size of this block's headline. Use a smaller size for a header or badge." },
  bodySize: { label: "Body size (px)", min: 10, max: 24, details: "Size of this block's description and discount message." },
  bannerHeight: { label: "Image height (px)", min: 160, max: 600, details: "Minimum height of the image area. Mobile adjusts to fit the content." },
  spacing: { label: "Content padding (px)", min: 12, max: 60, details: "Space between the edges and content of this block." },
  radius: { label: "Corner radius (px)", min: 0, max: 32, details: "Rounds this block and its buttons. Use 0 for square corners." },
};

function ButtonLinkField({ value, onChange, onBusy }: { value: string; onChange: (value: string) => void; onBusy: (busy: boolean) => void }) {
  const shopify = useAppBridge();
  const [linkType, setLinkType] = useState<"product" | "collection">("collection");
  const [linkError, setLinkError] = useState("");
  const [picking, setPicking] = useState(false);
  const busyRef = useRef(onBusy); busyRef.current = onBusy;
  useEffect(() => { busyRef.current(picking); }, [picking]);
  useEffect(() => () => busyRef.current(false), []);
  async function choose() {
    setPicking(true);
    try {
      const selected = await shopify.resourcePicker({ type: linkType, multiple: false, action: "select" });
      if (selected?.[0]) onChange(`/${linkType === "product" ? "products" : "collections"}/${selected[0].handle}`);
      setLinkError("");
    } catch { setLinkError("The selector could not be opened. Enter the button link instead."); }
    finally { setPicking(false); }
  }
  return <>
    <TextField label="Button link" value={value} details="Use a shop path or an http/https address." onChange={onChange} />
    <PolarisSelect label="Link destination" value={linkType} onChange={event => setLinkType(event.currentTarget.value as typeof linkType)}><s-option value="collection">Collection</s-option><s-option value="product">Product</s-option></PolarisSelect>
    <s-button type="button" variant="secondary" disabled={picking} onClick={choose}>{linkType === "collection" ? "Select collection" : "Select product"}</s-button>
    {linkError && <small role="alert">{linkError}</small>}
  </>;
}

type ChangeBlock = (change: (current: PromotionBlock) => PromotionBlock) => void;
function PromotionBlockEditor({ placement, block, onChange, onBusy }: { placement: Placement; block: PromotionBlock; onChange: ChangeBlock; onBusy: (busy: boolean) => void }) {
  const [busySlots, setBusySlots] = useState({ desktop: false, mobile: false, link: false });
  const busyRef = useRef(onBusy); busyRef.current = onBusy;
  useEffect(() => { busyRef.current(busySlots.desktop || busySlots.mobile || busySlots.link); }, [busySlots]);
  useEffect(() => () => busyRef.current(false), []);
  const isBadge = placement === "badge";
  const hasImages = placement === "collection" || placement === "product";
  const style = block.style;
  function set<K extends keyof PromotionBlock>(name: K, next: PromotionBlock[K]) { onChange(current => ({ ...current, [name]: next })); }
  function styling<K extends keyof PromotionStyle>(name: K, next: PromotionStyle[K]) { onChange(current => ({ ...current, style: { ...current.style, [name]: next } })); }
  function visible(name: keyof BlockVisibility, next: boolean) { onChange(current => ({ ...current, visibility: { ...current.visibility, [name]: next } })); }
  function visibility(name: keyof BlockVisibility, label: string, details?: string) {
    return <PolarisCheckbox label={label} details={details} checked={block.visibility[name]} onChange={event => visible(name, event.currentTarget.checked)} />;
  }
  function numberField(name: keyof typeof numberSettings) {
    const setting = numberSettings[name];
    return <s-number-field label={setting.label} details={setting.details} min={setting.min} max={setting.max} value={String(style[name])} onInput={event => { const next = Number(event.currentTarget.value); if (event.currentTarget.value && Number.isFinite(next)) styling(name, next); }} />;
  }
  const contrastIssues = [
    ["Promotion text", block.textColour, block.backgroundColour],
    ...(block.visibility.button && block.buttonText ? [["Button text", style.buttonColour, style.buttonBackground]] : []),
    ...(isBadge && block.visibility.headline ? [["Badge text", style.badgeTextColour, block.badgeColour]] : []),
    ...(placement === "product" && block.visibility.discountCode && style.copyCodeEnabled ? [["Copy code button text", style.copyCodeColour, style.copyCodeBackground]] : []),
  ].filter(([,a,b]) => contrastRatio(a,b) < 4.5);
  return <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 16, padding: "0 16px 16px" }}>
    <ControlGroup title="Content & visibility" description="Choose which elements appear, then set their wording. Hidden elements keep their saved values.">
      {visibility("headline", isBadge ? "Show badge text" : "Show headline")}
      {block.visibility.headline && <TextField label={isBadge ? "Badge text" : "Headline"} value={block.headline} maxLength={isBadge ? copyLimits.badgeText : copyLimits.headline} onChange={next => set("headline", next)} />}
      {!isBadge && <>
        {visibility("body", "Show body")}
        {block.visibility.body && <TextField label="Body" value={block.body} maxLength={copyLimits.body} multiline onChange={next => set("body", next)} />}
        {visibility("offerNote", "Show discount message", "The code instruction or automatic-discount message supplied by the promotion.")}
        {hasImages && <>
          {visibility("image", "Show image")}
          {block.visibility.image && <>
            <PromotionImageField label="Desktop image" url={style.desktopImage} fileId={style.desktopImageId} onBusy={busy => setBusySlots(current => ({ ...current, desktop: busy }))} onChange={image => onChange(current => ({ ...current, style: { ...current.style, desktopImage: image?.url ?? "", desktopImageId: image?.id ?? "" } }))} />
            <PromotionImageField label="Mobile image" url={style.mobileImage} fileId={style.mobileImageId} onBusy={busy => setBusySlots(current => ({ ...current, mobile: busy }))} onChange={image => onChange(current => ({ ...current, style: { ...current.style, mobileImage: image?.url ?? "", mobileImageId: image?.id ?? "" } }))} />
            <small style={helpStyle}>Mobile uses the desktop image if left blank. Choose a Shopify file or drag a JPG, PNG or WebP up to 20 MB into the image area.</small>
            <TextField label="Image description (alt text)" value={style.imageAlt} maxLength={250} details="Describe the image for shoppers using screen readers." onChange={next => styling("imageAlt", next)} />
          </>}
        </>}
        {visibility("countdown", "Show countdown", "Requires an end date in Schedule. Each block can show or hide its own timer.")}
        {block.visibility.countdown && <TextField label="Countdown label" value={block.countdownText} maxLength={copyLimits.countdownText} onChange={next => set("countdownText", next)} />}
        {visibility("button", "Show button")}
        {block.visibility.button && <>
          <TextField label="Button text" value={block.buttonText} maxLength={copyLimits.buttonText} details="Leave blank to omit the button." onChange={next => set("buttonText", next)} />
          <ButtonLinkField value={block.buttonUrl} onChange={next => set("buttonUrl", next)} onBusy={busy => setBusySlots(current => ({ ...current, link: busy }))} />
        </>}
        {placement === "product" && <>
          {visibility("discountCode", "Show discount code", "Applies to code discounts. Automatic discounts use the discount message instead.")}
          {block.visibility.discountCode && <PolarisCheckbox label="Show copy code button" details="Displays beside the discount code. Automatic discounts do not show this button." checked={style.copyCodeEnabled} onChange={event => styling("copyCodeEnabled", event.currentTarget.checked)} />}
        </>}
      </>}
    </ControlGroup>
    <ControlGroup title="Styling" description={`These settings apply only to the ${placements.find(p => p.id === placement)!.title.toLowerCase()} block.`}>
      {!isBadge && <>
        <PolarisSelect label="Design preset" details="Adjusts this block's layout and spacing while keeping its messages and images." value={style.preset} onChange={event => onChange(current => {
          const { overrides, blocks, ...nextStyle } = presetDesign(event.currentTarget.value as PromotionStyle["preset"], { ...current.style, overrides: { header: { headline: "", body: "", buttonText: "" }, collection: { headline: "", body: "", buttonText: "" }, product: { headline: "", body: "", buttonText: "" }, badge: { headline: "", body: "", buttonText: "" } } });
          void overrides; void blocks;
          return { ...current, style: nextStyle };
        })}><s-option value="simple">Simple offer</s-option><s-option value="campaign">Image campaign</s-option><s-option value="compact">Compact offer</s-option></PolarisSelect>
        <ColourField label="Background colour" value={block.backgroundColour} onChange={next => set("backgroundColour", next)} details="Fill behind this block. A full background image covers this colour; outlined product offers use the page background." />
        <ColourField label="Text colour" value={block.textColour} onChange={next => set("textColour", next)} details="Colour of this block's headline, description, discount message and countdown." />
        <PolarisSelect label="Text alignment" value={style.alignment} onChange={event => styling("alignment", event.currentTarget.value as PromotionStyle["alignment"])}><s-option value="left">Left</s-option><s-option value="center">Centre</s-option><s-option value="right">Right</s-option></PolarisSelect>
        {numberField("headingSize")}
        {numberField("bodySize")}
        {block.visibility.button && <>
          <ColourField label="Button background colour" value={style.buttonBackground} onChange={next => styling("buttonBackground", next)} details="Fill behind this block's button label." />
          <ColourField label="Button text colour" value={style.buttonColour} onChange={next => styling("buttonColour", next)} details="Choose a colour with good contrast against the button background." />
        </>}
        {hasImages && block.visibility.image && <>
          <PolarisSelect label="Image layout" value={style.imageLayout} onChange={event => styling("imageLayout", event.currentTarget.value as PromotionStyle["imageLayout"])}><s-option value="full">Full background</s-option><s-option value="half-left">Image left</s-option><s-option value="half-right">Image right</s-option></PolarisSelect>
          {numberField("bannerHeight")}
          <label style={{ display: "grid", gap: 5 }}>Horizontal focal point ({style.focalX}%)<input aria-label="Horizontal focal point" style={{ width: "100%", accentColor: "#303030" }} type="range" min={0} max={100} value={style.focalX} onChange={event => styling("focalX", Number(event.currentTarget.value))} /><small style={helpStyle}>0% keeps the left edge visible; 100% keeps the right edge visible.</small></label>
          <label style={{ display: "grid", gap: 5 }}>Vertical focal point ({style.focalY}%)<input aria-label="Vertical focal point" style={{ width: "100%", accentColor: "#303030" }} type="range" min={0} max={100} value={style.focalY} onChange={event => styling("focalY", Number(event.currentTarget.value))} /><small style={helpStyle}>0% keeps the top visible; 100% keeps the bottom visible.</small></label>
          {style.imageLayout === "full" && <label style={{ display: "grid", gap: 5 }}>Dark image overlay ({style.overlay}%)<input aria-label="Image overlay" style={{ width: "100%", accentColor: "#303030" }} type="range" min={0} max={90} value={style.overlay} onChange={event => styling("overlay", Number(event.currentTarget.value))} /><small style={helpStyle}>Darkens the background image in this block to improve text contrast.</small></label>}
        </>}
      </>}
      {placement === "product" && <>
        <PolarisSelect label="Offer appearance" value={style.productOfferStyle} onChange={event => onChange(current => { const next = event.currentTarget.value as PromotionStyle["productOfferStyle"]; return { ...current, style: { ...current.style, productOfferStyle: next, productBorderWidth: next === "double" ? Math.max(3, current.style.productBorderWidth) : current.style.productBorderWidth } }; })}><s-option value="solid">Solid background</s-option><s-option value="single">Single line border</s-option><s-option value="double">Double line border</s-option></PolarisSelect>
        {style.productOfferStyle !== "solid" && <>
          <s-number-field label="Offer border thickness (px)" details={style.productOfferStyle === "double" ? "Use 3–12px so both lines and the gap remain visible." : "Width of the outline, from 1–12px."} min={style.productOfferStyle === "double" ? 3 : 1} max={12} value={String(style.productBorderWidth)} onInput={event => { const next = Number(event.currentTarget.value); if (event.currentTarget.value && Number.isFinite(next)) styling("productBorderWidth", next); }} />
          <ColourField label="Offer border colour" value={style.productBorderColour} onChange={next => styling("productBorderColour", next)} details="Colour of this product offer's outline." />
        </>}
        {block.visibility.discountCode && style.copyCodeEnabled && <>
          <ColourField label="Copy code button background" value={style.copyCodeBackground} onChange={next => styling("copyCodeBackground", next)} details="Fill colour of the copy-code button." />
          <ColourField label="Copy code button text colour" value={style.copyCodeColour} onChange={next => styling("copyCodeColour", next)} details="Colour of the copy label and icon." />
        </>}
      </>}
      {isBadge && <>
        <ColourField label="Badge background colour" value={block.badgeColour} onChange={next => set("badgeColour", next)} details="Fill behind this product-card badge." />
        <ColourField label="Badge text colour" value={style.badgeTextColour} onChange={next => styling("badgeTextColour", next)} details="Choose a colour with good contrast against the badge background." />
        {numberField("headingSize")}
      </>}
      {!isBadge && numberField("spacing")}
      {numberField("radius")}
    </ControlGroup>
    {contrastIssues.length > 0 && <div role="status" style={{ ...helpStyle, padding: 10, background: "#fff8e6", borderRadius: 8 }}>Improve readability: {contrastIssues.map(([label]) => label).join(", ")} has low contrast. Check text over images in the preview too.</div>}
  </div>;
}

function CampaignEditor({ value, onChange, onMatch, onBusy }: { value: WebsiteDraft; onChange: (patch: CampaignPatch) => void; onMatch: (placement: Placement) => void; onBusy: (busy: boolean) => void }) {
  const [busy, setBusy] = useState({ desktop: false, mobile: false, link: false });
  const busyRef = useRef(onBusy); busyRef.current = onBusy;
  useEffect(() => { busyRef.current(busy.desktop || busy.mobile || busy.link); }, [busy]);
  useEffect(() => () => busyRef.current(false), []);
  const selected = selectedCampaignPlacements(value);
  const titles = (ids: string[]) => ids.map(id => placements.find(p => p.id === id)!.title).join(", ");
  const showImages = selected.some(id => id === "collection" || id === "product");
  const text = (key: "headline" | "body" | "buttonText" | "countdownText") => campaignValue(value, key) ?? "";
  const colour = (key: "backgroundColour" | "textColour") => campaignValue(value, key) ?? "#ffffff";
  const style = (key: "buttonBackground" | "buttonColour" | "desktopImage" | "desktopImageId" | "mobileImage" | "mobileImageId" | "imageAlt") => campaignValue(value, "style", key) ?? "";
  const customised = customisedPlacements(value);
  return <section aria-label="Campaign content and style" style={sectionStyle}>
    <h2 style={{ fontSize: 16, margin: 0 }}>Campaign content & style</h2>
    <small style={helpStyle}>Set the wording, image and colours once for {titles(selected)}. Each block below can still be fine-tuned. A block you change on its own keeps its own value.</small>
    <ControlGroup title="Content" description="Shown on each selected block that has this element turned on.">
      <TextField label="Headline" value={text("headline")} maxLength={copyLimits.headline} onChange={next => onChange({ headline: next })} />
      <TextField label="Body" value={text("body")} maxLength={copyLimits.body} multiline onChange={next => onChange({ body: next })} />
      <TextField label="Button text" value={text("buttonText")} maxLength={copyLimits.buttonText} details="Leave blank to omit the button." onChange={next => onChange({ buttonText: next })} />
      <ButtonLinkField value={campaignValue(value, "buttonUrl") ?? ""} onChange={next => onChange({ buttonUrl: next })} onBusy={next => setBusy(current => ({ ...current, link: next }))} />
      <TextField label="Countdown label" value={text("countdownText")} maxLength={copyLimits.countdownText} details="Needs an end date in Schedule." onChange={next => onChange({ countdownText: next })} />
    </ControlGroup>
    {showImages && <ControlGroup title="Images" description="Used by the Collection and Product blocks. Mobile uses the desktop image if left blank.">
      <PromotionImageField label="Desktop image" url={style("desktopImage")} fileId={style("desktopImageId")} onBusy={next => setBusy(current => ({ ...current, desktop: next }))} onChange={image => onChange({ style: { desktopImage: image?.url ?? "", desktopImageId: image?.id ?? "" } })} />
      <PromotionImageField label="Mobile image" url={style("mobileImage")} fileId={style("mobileImageId")} onBusy={next => setBusy(current => ({ ...current, mobile: next }))} onChange={image => onChange({ style: { mobileImage: image?.url ?? "", mobileImageId: image?.id ?? "" } })} />
      <TextField label="Image description (alt text)" value={style("imageAlt")} maxLength={250} details="Describe the image for shoppers using screen readers." onChange={next => onChange({ style: { imageAlt: next } })} />
    </ControlGroup>}
    <ControlGroup title="Colours" description="Applied to each selected block.">
      <ColourField label="Background colour" value={colour("backgroundColour")} onChange={next => onChange({ backgroundColour: next })} details="Fill behind the block. A full background image covers this colour." />
      <ColourField label="Text colour" value={colour("textColour")} onChange={next => onChange({ textColour: next })} details="Colour of the headline, description, discount message and countdown." />
      <ColourField label="Button background colour" value={style("buttonBackground") || "#202223"} onChange={next => onChange({ style: { buttonBackground: next } })} details="Fill behind the button label." />
      <ColourField label="Button text colour" value={style("buttonColour") || "#ffffff"} onChange={next => onChange({ style: { buttonColour: next } })} details="Choose a colour with good contrast against the button background." />
    </ControlGroup>
    {customised.length > 0 && <div role="status" style={{ ...helpStyle, padding: 10, background: "#f1f1f1", borderRadius: 8, display: "grid", gap: 8 }}>
      <span>Customised, so not following the settings above: {titles(customised)}.</span>
      <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{customised.map(id => <s-button key={id} type="button" variant="secondary" onClick={() => onMatch(id)}>Use campaign settings for {placements.find(p => p.id === id)!.title}</s-button>)}</span>
    </div>}
  </section>;
}

export function PromotionWebsiteEditor({ value, onChange, endsAt, onBusyChange, publicationDisabled = false }: { value: WebsiteDraft; onChange: (value: WebsiteDraft) => void; endsAt?: string | null; onBusyChange: (busy: boolean) => void; publicationDisabled?: boolean }) {
  const latestValue = useRef(value); latestValue.current = value;
  const [busyBlocks, setBusyBlocks] = useState<Partial<Record<Placement | "campaign", boolean>>>({});
  const busy = Object.values(busyBlocks).some(Boolean);
  const busyRef = useRef(onBusyChange); busyRef.current = onBusyChange;
  useEffect(() => { busyRef.current(busy); }, [busy]);
  function set<K extends keyof WebsiteDraft>(name: K, next: WebsiteDraft[K]) { latestValue.current = { ...latestValue.current, [name]: next }; onChange(latestValue.current); }
  function changeBlock(placement: Placement, change: (current: PromotionBlock) => PromotionBlock) {
    latestValue.current = setPromotionBlock(latestValue.current, placement, change(promotionBlock(latestValue.current, placement)));
    onChange(latestValue.current);
  }
  function changeCampaign(patch: CampaignPatch) { latestValue.current = applyCampaignPatch(latestValue.current, patch); onChange(latestValue.current); }
  function matchBlock(placement: Placement) { latestValue.current = matchCampaign(latestValue.current, placement); onChange(latestValue.current); }
  const errors = validateWebsite(value, endsAt);
  const hasCampaign = selectedCampaignPlacements(value).length > 0;
  const selected = placements.filter(p => value[p.flag]);
  return <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 20 }}>
    <section aria-label="Website promotion" style={sectionStyle}>
      <h2 style={{ fontSize: 16, margin: 0 }}>Website promotion</h2>
      <PolarisSelect label="Website promotion status" disabled={publicationDisabled} details={publicationDisabled ? "Individual code lists stay in Draft. Distribute their codes using the CSV download." : "Enabled allows eligible offers to appear on the storefront. Draft saves the design while keeping it hidden."} value={value.websiteEnabled ? "enabled" : "draft"} onChange={event => set("websiteEnabled", event.currentTarget.value === "enabled")}><s-option value="enabled">Enabled</s-option><s-option value="draft">Draft</s-option></PolarisSelect>
      <PolarisCheckbox label="Include in promotion sync" details="Required for storefront display, alongside Enabled status." checked={value.included} onChange={event => set("included", event.currentTarget.checked)} />
      <PolarisNumberField label="Promotion priority" details="Higher numbers take precedence when more than one offer qualifies. Use 0 for normal priority." min={0} max={9999} step={1} value={String(value.priority)} onInput={event => set("priority", Math.max(0, Number(event.currentTarget.value) || 0))} onChange={event => set("priority", Math.max(0, Number(event.currentTarget.value) || 0))} />
    </section>
    <section aria-label="Choose promotion blocks" style={sectionStyle}>
      <h2 style={{ fontSize: 16, margin: 0 }}>Where should this promotion appear?</h2>
      <small style={helpStyle}>Only selected blocks appear below. Deselecting a block keeps its settings for later.</small>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
        {placements.map(p => <div key={p.id} style={{ border: value[p.flag] ? "1px solid #8a8a8a" : "1px solid #dedede", borderRadius: 8, padding: 12, display: "grid", gap: 6, background: value[p.flag] ? "#f7f7f7" : "#fff" }}><PolarisCheckbox label={p.title} checked={Boolean(value[p.flag])} disabled={busy} onChange={event => set(p.flag, event.currentTarget.checked)} /><small style={helpStyle}>{p.description}</small></div>)}
      </div>
    </section>
    {hasCampaign && <CampaignEditor value={value} onChange={changeCampaign} onMatch={matchBlock} onBusy={next => setBusyBlocks(current => current.campaign === next ? current : { ...current, campaign: next })} />}
    {selected.map(p => <details key={p.id} data-promotion-block={p.id} open={!hasCampaign || p.id === "badge"} style={{ border: "1px solid #dedede", borderRadius: 12, background: "#fff", minWidth: 0 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, padding: 16 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>{hasCampaign && p.id !== "badge" ? `Fine-tune ${p.title.toLowerCase()}` : p.title}<s-badge tone="success">Selected</s-badge></span></summary>
      <PromotionBlockEditor placement={p.id} block={promotionBlock(value, p.id)} onChange={change => changeBlock(p.id, change)} onBusy={next => setBusyBlocks(current => current[p.id] === next ? current : { ...current, [p.id]: next })} />
    </details>)}
    {!selected.length && <p style={helpStyle}>Select a block above to customise its content and styling.</p>}
    {errors.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, color: "#b42318", fontSize: 12 }}>{errors.map(error => <li key={error}>{error}</li>)}</ul>}
  </div>;
}
