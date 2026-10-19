import { PolarisSelect, PolarisCheckbox } from "./PolarisControls";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FocalPointField } from "./FocalPointField";
import { PromotionImageField } from "./PromotionImageField";
import { LinkDestinationField } from "./LinkDestinationField";
import { applyPalette, colourElements, customisedPaletteBlocks, hasImage, isAutomaticText, isButtonText, matchPalette, neutralColour, paletteValues, readColour, settleSurfaces, switchProductAppearance, textColourFor, white, writeColour, type ColourKey, type PaletteRole, type PaletteValues } from "../design/campaignPalette";
import { applyCampaignPatch, campaignValue, customisedPlacements, matchCampaign, selectedCampaignPlacements, type CampaignPatch } from "../design/sharedCampaign";
import { contrastRatio, copyLimits, defaultDesign, placements, presetDesign, promotionBlock, setPromotionBlock, validateWebsite, type BlockVisibility, type Placement, type PromotionBlock, type PromotionStyle, type WebsiteDraft } from "../design/design";

const sectionStyle = { border: "1px solid #e3e3e3", borderRadius: 12, background: "#fff", padding: 16, display: "grid", gap: 14 };
const helpStyle = { color: "#616161", fontSize: 12, lineHeight: 1.5 };
function ControlGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = useId();
  return <section aria-labelledby={id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12, borderTop: "1px solid #e3e3e3", paddingTop: 16, minWidth: 0 }}>
    <div style={{ display: "grid", gap: 4 }}><s-heading id={id}>{title}</s-heading><s-text color="subdued">{description}</s-text></div>
    {children}
  </section>;
}
// Shopify's native colour field. Only complete six-digit colours are passed on while someone is typing.
function ColourField({ label, value, onChange, details, reset }: { label: string; value: string; onChange: (value: string) => void; details: string; reset?: { label: string; value: string } }) {
  const ref = useRef<HTMLElementTagNameMap["s-color-field"]>(null);
  const latest = useRef(onChange); latest.current = onChange;
  useEffect(() => {
    const element = ref.current;
    const changed = () => { const next = String(element?.value ?? ""); if (/^#[\da-f]{6}$/i.test(next)) latest.current(next.toLowerCase()); };
    element?.addEventListener("input", changed);
    element?.addEventListener("change", changed);
    return () => { element?.removeEventListener("input", changed); element?.removeEventListener("change", changed); };
  }, []);
  useEffect(() => { if (ref.current && String(ref.current.value).toLowerCase() !== value.toLowerCase()) ref.current.value = value; });
  return <div style={{ display: "grid", gap: 5 }}>
    <s-color-field ref={ref} label={label} value={value} details={details} />
    {reset && value.toLowerCase() !== reset.value.toLowerCase() && <div><s-button type="button" variant="tertiary" onClick={() => onChange(reset.value)}>{reset.label}</s-button></div>}
  </div>;
}
function TextField({ label, value, onChange, maxLength, multiline = false, details, placeholder }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number; multiline?: boolean; details?: string; placeholder?: string }) {
  return <div style={{ display: "grid", gap: 5 }}>{multiline ? <s-text-area label={label} rows={3} value={value} placeholder={placeholder} maxLength={maxLength} details={details} onInput={event => onChange(event.currentTarget.value)} /> : <s-text-field label={label} value={value} placeholder={placeholder} maxLength={maxLength} details={details} onInput={event => onChange(event.currentTarget.value)} />}{maxLength && <s-text color="subdued">{value.length}/{maxLength}</s-text>}</div>;
}
const numberSettings = {
  headingSize: { label: "Headline size (px)", min: 10, max: 48, details: "Size of this block's headline. Use a smaller size for a header or badge." },
  bodySize: { label: "Body size (px)", min: 10, max: 24, details: "Size of this block's description and discount message." },
  bannerHeight: { label: "Image height (px)", min: 160, max: 600, details: "Minimum height of the image area. Mobile adjusts to fit the content." },
  spacing: { label: "Content padding (px)", min: 12, max: 60, details: "Space between the edges and content of this block." },
  radius: { label: "Corner radius (px)", min: 0, max: 32, details: "Rounds this block and its buttons. Use 0 for square corners." },
};

type ChangeBlock = (change: (current: PromotionBlock) => PromotionBlock) => void;
type CampaignWording = Partial<Record<"headline" | "body" | "buttonText" | "countdownText" | "buttonUrl" | "imageAlt", string>>;
function PromotionBlockEditor({ placement, block, palette, campaign, onChange, onBusy }: { placement: Placement; block: PromotionBlock; palette: PaletteValues; campaign: CampaignWording; onChange: ChangeBlock; onBusy: (busy: boolean) => void }) {
  const [busySlots, setBusySlots] = useState({ desktop: false, mobile: false });
  const busyRef = useRef(onBusy); busyRef.current = onBusy;
  useEffect(() => { busyRef.current(busySlots.desktop || busySlots.mobile); }, [busySlots]);
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
  function numberField(name: keyof typeof numberSettings, override: Partial<{ label: string; details: string }> = {}) {
    const setting = { ...numberSettings[name], ...override };
    return <s-number-field label={setting.label} details={setting.details} min={setting.min} max={setting.max} value={String(style[name])} onInput={event => { const next = Number(event.currentTarget.value); if (event.currentTarget.value && Number.isFinite(next)) styling(name, next); }} />;
  }
  // A block that still matches the campaign shows its wording in grey; typing makes it the block's own, clearing the box follows the campaign again.
  function wording(key: "headline" | "body" | "buttonText" | "countdownText", label: string, maxLength: number, extra: { multiline?: boolean; details?: string } = {}) {
    const shared = isBadge ? undefined : campaign[key];
    return <TextField label={label} value={shared !== undefined && block[key] === shared ? "" : block[key]} placeholder={shared || undefined} maxLength={maxLength} {...extra} onChange={next => set(key, next === "" && shared !== undefined ? shared : next)} />;
  }
  const roleNames: Record<PaletteRole, string> = { primary: "main campaign colour", secondary: "secondary colour" };
  function setColour(fill: ColourKey, text: ColourKey | undefined, next: string) {
    onChange(current => {
      let updated = writeColour(current, fill, next);
      if (text && !isButtonText(text) && isAutomaticText(readColour(updated, text), palette)) updated = writeColour(updated, text, textColourFor(next, palette));
      return updated;
    });
  }
  function fillField(label: string, fill: ColourKey, text: ColourKey | undefined, role: PaletteRole | undefined, what: string) {
    const shared = role ? palette[role] : undefined;
    return <ColourField label={label} value={readColour(block, fill)} onChange={next => setColour(fill, text, next)}
      details={role ? `${what}. Follows the ${roleNames[role]} until you change it here.` : `${what}. Not part of the campaign colours.`}
      reset={role && shared ? { label: `Use ${roleNames[role]}`, value: shared } : undefined} />;
  }
  function textField(label: string, text: ColourKey, surface: string) {
    return <ColourField label={label} value={readColour(block, text)} onChange={next => setColour(text, undefined, next)}
      details={isButtonText(text) ? "Uses the campaign button text colour. Choose a colour to override it." : "Uses the campaign text colour: Text on colour over a colour, Text on white over white. Choose a colour to override it."}
      reset={isButtonText(text) ? { label: "Use campaign button text colour", value: palette.button ?? white } : { label: "Use campaign text colour", value: textColourFor(surface, palette) }} />;
  }
  const contrastIssues = [
    ["Promotion text", block.textColour, block.backgroundColour],
    ...(block.visibility.button && block.buttonText ? [["Button text", style.buttonColour, style.buttonBackground]] : []),
    ...(isBadge && block.visibility.headline ? [["Badge text", style.badgeTextColour, block.badgeColour]] : []),
    ...(placement === "product" && block.visibility.discountCode && style.copyCodeEnabled ? [["Copy code button text", style.copyCodeColour, style.copyCodeBackground]] : []),
  ].filter(([,a,b]) => contrastRatio(a,b) < 4.5);
  return <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 16, padding: "0 16px 16px" }}>
    <ControlGroup title="Content & visibility" description={isBadge ? "Choose whether the badge text appears, then set its wording. Hidden elements keep their saved values." : "Choose which elements appear. Grey text is the campaign wording: type to change it for this block only, or clear a box to follow the campaign again. Hidden elements keep their saved values."}>
      {visibility("headline", isBadge ? "Show badge text" : "Show headline")}
      {block.visibility.headline && wording("headline", isBadge ? "Badge text" : "Headline", isBadge ? copyLimits.badgeText : copyLimits.headline)}
      {!isBadge && <>
        {visibility("body", "Show body")}
        {block.visibility.body && wording("body", "Body", copyLimits.body, { multiline: true })}
        {visibility("offerNote", "Show discount message", "The code instruction or automatic-discount message supplied by the promotion.")}
        {hasImages && <>
          {visibility("image", "Show image")}
          {block.visibility.image && <>
            <PromotionImageField label="Desktop image" url={style.desktopImage} fileId={style.desktopImageId} onBusy={busy => setBusySlots(current => ({ ...current, desktop: busy }))} onChange={image => onChange(current => ({ ...current, style: { ...current.style, desktopImage: image?.url ?? "", desktopImageId: image?.id ?? "" } }))} />
            <PromotionImageField label="Mobile image" url={style.mobileImage} fileId={style.mobileImageId} onBusy={busy => setBusySlots(current => ({ ...current, mobile: busy }))} onChange={image => onChange(current => ({ ...current, style: { ...current.style, mobileImage: image?.url ?? "", mobileImageId: image?.id ?? "" } }))} />
            <s-text color="subdued">Mobile uses the desktop image if left blank. Choose a Shopify file or drag a JPG, PNG or WebP up to 20 MB into the image area.</s-text>
            <TextField label="Image description (alt text)" value={campaign.imageAlt !== undefined && style.imageAlt === campaign.imageAlt ? "" : style.imageAlt} placeholder={campaign.imageAlt || undefined} maxLength={250} details="Describe the image for shoppers using screen readers." onChange={next => styling("imageAlt", next === "" && campaign.imageAlt !== undefined ? campaign.imageAlt : next)} />
          </>}
        </>}
        {visibility("countdown", "Show countdown", "Requires an end date in Schedule. Each block can show or hide its own timer.")}
        {block.visibility.countdown && wording("countdownText", "Countdown label", copyLimits.countdownText)}
        {visibility("button", "Show button")}
        {block.visibility.button && <>
          {wording("buttonText", "Button text", copyLimits.buttonText, { details: "Leave blank to use the campaign button text. Turn off Show button to remove the button." })}
          <LinkDestinationField value={block.buttonUrl} inherited={campaign.buttonUrl} onChange={next => set("buttonUrl", next)} />
        </>}
        {placement === "product" && <>
          {visibility("discountCode", "Show discount code", "Applies to code discounts. Automatic discounts use the discount message instead.")}
          {block.visibility.discountCode && <PolarisCheckbox label="Show copy code button" details="Displays beside the discount code. Automatic discounts do not show this button." checked={style.copyCodeEnabled} onChange={event => styling("copyCodeEnabled", event.currentTarget.checked)} />}
        </>}
      </>}
    </ControlGroup>
    <ControlGroup title="Styling" description={`These settings apply only to the ${placements.find(p => p.id === placement)!.title.toLowerCase()} block.`}>
      {!isBadge && <>
        <PolarisSelect label="Text alignment" value={style.alignment} onChange={event => styling("alignment", event.currentTarget.value as PromotionStyle["alignment"])}><s-option value="left">Left</s-option><s-option value="center">Centre</s-option><s-option value="right">Right</s-option></PolarisSelect>
        {numberField("headingSize")}
        {numberField("bodySize")}
        {hasImages && block.visibility.image && <>
          <PolarisSelect label="Image layout" value={style.imageLayout} onChange={event => styling("imageLayout", event.currentTarget.value as PromotionStyle["imageLayout"])}><s-option value="full">Full background</s-option><s-option value="half-left">Image left</s-option><s-option value="half-right">Image right</s-option></PolarisSelect>
          {numberField("bannerHeight")}
          <FocalPointField imageUrl={style.desktopImage || style.mobileImage} x={style.focalX} y={style.focalY} onChange={(x, y) => onChange(current => ({ ...current, style: { ...current.style, focalX: x, focalY: y } }))} />
        </>}
      </>}
      {placement === "product" && <>
        <PolarisSelect label="Offer appearance" value={style.productOfferStyle} onChange={event => onChange(current => { const next = event.currentTarget.value as PromotionStyle["productOfferStyle"]; return switchProductAppearance({ ...current, style: { ...current.style, productOfferStyle: next, productBorderWidth: next === "double" ? Math.max(3, current.style.productBorderWidth) : current.style.productBorderWidth } }, current.style.productOfferStyle, palette); })}><s-option value="solid">Solid background</s-option><s-option value="single">Single line border</s-option><s-option value="double">Double line border</s-option></PolarisSelect>
        {style.productOfferStyle !== "solid" && <>
          <s-number-field label="Offer border thickness (px)" details={style.productOfferStyle === "double" ? "Use 3–12px so both lines and the gap remain visible." : "Width of the outline, from 1–12px."} min={style.productOfferStyle === "double" ? 3 : 1} max={12} value={String(style.productBorderWidth)} onInput={event => { const next = Number(event.currentTarget.value); if (event.currentTarget.value && Number.isFinite(next)) styling("productBorderWidth", next); }} />
        </>}
      </>}
      {isBadge && <>
        {numberField("headingSize")}
      </>}
      {!isBadge && numberField("spacing")}
      {numberField("radius", placement === "header" ? { label: "Button corner radius (px)", details: "Rounds the header button. The header itself is always square because it sits in the site header." } : {})}
    </ControlGroup>
    <ControlGroup title="Colours" description="These follow the campaign colours above until you change one here. Use the button under a colour to return to the campaign colour.">
      {placement === "header" && <>
        {fillField("Header background", "backgroundColour", "textColour", "primary", "Fill behind the header announcement")}
        {textField("Header text colour", "textColour", block.backgroundColour)}
        {block.visibility.button && <>
          {fillField("Header button background", "style.buttonBackground", "style.buttonColour", "secondary", "Fill behind the header button")}
          {textField("Header button text colour", "style.buttonColour", style.buttonBackground)}
        </>}
      </>}
      {placement === "collection" && <>
        {fillField("Collection banner background", "backgroundColour", "textColour", undefined, "Fill behind the collection banner. Kept white while the banner shows an image")}
        {textField("Collection banner text colour", "textColour", block.backgroundColour)}
        {block.visibility.button && <>
          {fillField("Collection button background", "style.buttonBackground", "style.buttonColour", "primary", "Fill behind the collection banner button")}
          {textField("Collection button text colour", "style.buttonColour", style.buttonBackground)}
        </>}
      </>}
      {placement === "product" && <>
        {style.productOfferStyle === "solid"
          ? <>
            {fillField("Product offer background", "backgroundColour", "textColour", hasImage(block) ? undefined : "primary", hasImage(block) ? "Kept white while the offer shows an image" : "Fill behind the product offer")}
            {textField("Product offer text colour", "textColour", block.backgroundColour)}
          </>
          : <>
            {fillField("Product offer border colour", "style.productBorderColour", undefined, "primary", "Colour of the product offer outline")}
            {textField("Product offer text colour (on the page background)", "textColour", white)}
          </>}
        {block.visibility.button && <>
          {fillField("Product button background", "style.buttonBackground", "style.buttonColour", "primary", "Fill behind the product offer button")}
          {textField("Product button text colour", "style.buttonColour", style.buttonBackground)}
        </>}
        {block.visibility.discountCode && style.copyCodeEnabled && <>
          {fillField("Copy code button background", "style.copyCodeBackground", "style.copyCodeColour", "secondary", "Fill behind the copy code button")}
          {textField("Copy code button text colour", "style.copyCodeColour", style.copyCodeBackground)}
        </>}
      </>}
      {isBadge && <>
        {fillField("Badge background", "badgeColour", "style.badgeTextColour", "primary", "Fill behind the product-card badge")}
        {textField("Badge text colour", "style.badgeTextColour", block.badgeColour)}
      </>}
    </ControlGroup>
    {contrastIssues.length > 0 && <div role="status" style={{ ...helpStyle, padding: 10, background: "#fff8e6", borderRadius: 8 }}>Improve readability: {contrastIssues.map(([label]) => label).join(", ")} has low contrast. Check text over images in the preview too.</div>}
  </div>;
}

function CampaignColours({ value, onChange, onMatch, onOverride }: { value: WebsiteDraft; onChange: (change: PaletteValues) => void; onMatch: (placement: Placement) => void; onOverride: (placement: Placement) => void }) {
  const values = paletteValues(value);
  const chosen = placements.filter(p => value[p.flag]);
  const elements = colourElements(value);
  const own = customisedPaletteBlocks(value);
  const unreadable = elements.filter(element => !element.readable);
  const titleOf = (id: string) => placements.find(p => p.id === id)!.title;
  return <section aria-label="Campaign colours" style={sectionStyle}>
    <s-heading>Campaign colours</s-heading>
    <s-text color="subdued">Choose the campaign colours once. Text uses Text on colour over the main or secondary colour and Text on white over white, picked for you by contrast. Each block below can still override a colour.</s-text>
    <ColourField label="Main colour" value={values.primary ?? neutralColour} onChange={next => onChange({ primary: next })} details="Header background, collection button, product offer background or border and its button, and the product badge." />
    {(value.showHeaderBanner || value.showProductPage) && <ColourField label="Secondary colour" value={values.secondary ?? neutralColour} onChange={next => onChange({ secondary: next })} details="Header button and copy code button." />}
    {(value.showHeaderBanner || value.showCollectionPage || value.showProductPage) && <ColourField label="Button text colour" value={values.button ?? white} onChange={next => onChange({ button: next })} details="The label on the header, collection and product buttons and the copy code button, whatever colour the button is." />}
    <ColourField label="Text on colour" value={values.onColour ?? white} onChange={next => onChange({ onColour: next })} details="Headlines, body text, discount messages and the product badge when they sit on the main colour." />
    <ColourField label="Text on white" value={values.onWhite ?? "#000000"} onChange={next => onChange({ onWhite: next })} details="Text on white: collection banners, and any block that shows an image." />
    <ControlGroup title="What this controls" description="Where each colour is used on the blocks you selected. Open a block to override a single element.">
      {chosen.map(p => <div key={p.id} style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <s-text type="strong">{p.title}</s-text>
          <s-button type="button" variant="tertiary" onClick={() => onOverride(p.id)}>Override colours</s-button>
        </div>
        {elements.filter(element => element.placement === p.id).map(element => <div key={element.label} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span aria-hidden="true" style={{ flex: "0 0 auto", width: 32, height: 24, borderRadius: 6, border: "1px solid #c9c9c9", background: element.fill, color: element.text ?? "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>Aa</span>
          <span style={{ fontSize: 13, minWidth: 0 }}>{element.label}</span>
          <span style={{ ...helpStyle, marginLeft: "auto", whiteSpace: "nowrap" }}>{element.source}{element.readable ? "" : " · low contrast"}</span>
        </div>)}
      </div>)}
    </ControlGroup>
    {unreadable.length > 0 && <div role="status" style={{ ...helpStyle, padding: 10, background: "#fff8e6", borderRadius: 8 }}>Improve readability: {unreadable.map(element => element.label).join(", ")}. Choose a different text colour or main colour.</div>}
    {own.length > 0 && <div role="status" style={{ ...helpStyle, padding: 10, background: "#f1f1f1", borderRadius: 8, display: "grid", gap: 8 }}>
      <span>Using their own colours, so not following the campaign colours: {own.map(titleOf).join(", ")}.</span>
      <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {own.map(id => <s-button key={id} type="button" variant="secondary" onClick={() => onMatch(id)}>Use campaign colours for {titleOf(id).toLowerCase()}</s-button>)}
        {own.length > 1 && <s-button type="button" variant="secondary" onClick={() => own.forEach(id => onMatch(id))}>Use campaign colours for all</s-button>}
      </span>
    </div>}
  </section>;
}

const promoDesigns: Array<{ id: PromotionStyle["preset"]; title: string; summary: string }> = [
  { id: "simple", title: "Simple offer", summary: "The image sits beside the wording. A balanced banner that suits most promotions." },
  { id: "campaign", title: "Image campaign", summary: "The image fills the background behind the wording. A tall banner with a larger heading for big campaigns." },
  { id: "compact", title: "Compact offer", summary: "A short banner with a smaller heading and the image beside it. Best where space is tight." },
];

/** The preset as selectable cards, matching the block cards above, so each layout and what it does is visible. */
function PromoDesignChoice({ value, onChange }: { value: PromotionStyle["preset"]; onChange: (preset: PromotionStyle["preset"]) => void }) {
  const id = useId();
  return <div role="group" aria-labelledby={id} data-promo-design="" style={{ display: "grid", gap: 8 }}>
    <s-text type="strong" id={id}>Collection Promo Design</s-text>
    <s-text color="subdued">Sets the image layout, banner height, heading size, spacing and corners for the Collection and Product blocks. It keeps their wording and images, and replaces any fine-tuning of those settings.</s-text>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(180px,100%),1fr))", gap: 8, minWidth: 0 }}>
      {promoDesigns.map(design => {
        const selected = design.id === value;
        const { bannerHeight, headingSize } = presetDesign(design.id, defaultDesign());
        return <div key={design.id} style={{ display: "grid", minWidth: 0 }}><s-clickable accessibilityLabel={`${design.title}${selected ? ", selected" : ""}. ${design.summary}`} onClick={() => { if (!selected) onChange(design.id); }} inlineSize="100%" blockSize="100%" border="none" borderRadius="base" padding="none">
          <div style={{ border: selected ? "1px solid #8a8a8a" : "1px solid #e3e3e3", borderRadius: 8, padding: 12, display: "grid", gap: 6, background: selected ? "#f7f7f7" : "#fff", textAlign: "left", overflowWrap: "anywhere" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><s-text type="strong">{design.title}</s-text>{selected && <s-badge tone="success">Selected</s-badge>}</span>
            <s-text color="subdued">{design.summary}</s-text>
            <s-text color="subdued">{bannerHeight}px banner, {headingSize}px heading</s-text>
          </div>
        </s-clickable></div>;
      })}
    </div>
  </div>;
}

function CampaignEditor({ value, onChange, onPreset, onMatch, onBusy }: { value: WebsiteDraft; onChange: (patch: CampaignPatch) => void; onPreset: (preset: PromotionStyle["preset"]) => void; onMatch: (placement: Placement) => void; onBusy: (busy: boolean) => void }) {
  const [busy, setBusy] = useState({ desktop: false, mobile: false });
  const busyRef = useRef(onBusy); busyRef.current = onBusy;
  useEffect(() => { busyRef.current(busy.desktop || busy.mobile); }, [busy]);
  useEffect(() => () => busyRef.current(false), []);
  const selected = selectedCampaignPlacements(value);
  const titles = (ids: string[]) => ids.map(id => placements.find(p => p.id === id)!.title).join(", ");
  const showImages = selected.some(id => id === "collection" || id === "product");
  const text = (key: "headline" | "body" | "buttonText" | "countdownText") => campaignValue(value, key) ?? "";
  const style = (key: "desktopImage" | "desktopImageId" | "mobileImage" | "mobileImageId" | "imageAlt") => campaignValue(value, "style", key) ?? "";
  const customised = customisedPlacements(value);
  const firstImageBlock = selected.find(id => id === "collection" || id === "product");
  const preset = firstImageBlock ? promotionBlock(value, firstImageBlock).style.preset : "simple";
  return <section aria-label="Campaign content and style" style={sectionStyle}>
    <s-heading>Campaign content & style</s-heading>
    <s-text color="subdued">Set the wording and images once for {titles(selected)}. Each block below can still be fine-tuned. A block you change on its own keeps its own value.</s-text>
    <ControlGroup title="Content" description="Shown on each selected block that has this element turned on.">
      <TextField label="Headline" value={text("headline")} maxLength={copyLimits.headline} onChange={next => onChange({ headline: next })} />
      <TextField label="Body" value={text("body")} maxLength={copyLimits.body} multiline onChange={next => onChange({ body: next })} />
      <TextField label="Button text" value={text("buttonText")} maxLength={copyLimits.buttonText} details="Leave blank to omit the button." onChange={next => onChange({ buttonText: next })} />
      <LinkDestinationField value={campaignValue(value, "buttonUrl") ?? ""} onChange={next => onChange({ buttonUrl: next })} />
      <TextField label="Countdown label" value={text("countdownText")} maxLength={copyLimits.countdownText} details="Needs an end date in Schedule." onChange={next => onChange({ countdownText: next })} />
    </ControlGroup>
    {showImages && <ControlGroup title="Images" description="Used by the Collection and Product blocks. Mobile uses the desktop image if left blank.">
      <PromoDesignChoice value={preset} onChange={onPreset} />
      <PromotionImageField label="Desktop image" url={style("desktopImage")} fileId={style("desktopImageId")} onBusy={next => setBusy(current => ({ ...current, desktop: next }))} onChange={image => onChange({ style: { desktopImage: image?.url ?? "", desktopImageId: image?.id ?? "" } })} />
      <PromotionImageField label="Mobile image" url={style("mobileImage")} fileId={style("mobileImageId")} onBusy={next => setBusy(current => ({ ...current, mobile: next }))} onChange={image => onChange({ style: { mobileImage: image?.url ?? "", mobileImageId: image?.id ?? "" } })} />
      <TextField label="Image description (alt text)" value={style("imageAlt")} maxLength={250} details="Describe the image for shoppers using screen readers." onChange={next => onChange({ style: { imageAlt: next } })} />
    </ControlGroup>}
    {customised.length > 0 && <div role="status" style={{ ...helpStyle, padding: 10, background: "#f1f1f1", borderRadius: 8, display: "grid", gap: 8 }}>
      <span>Customised, so not following the settings above: {titles(customised)}.</span>
      <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{customised.map(id => <s-button key={id} type="button" variant="secondary" onClick={() => onMatch(id)}>Use campaign settings for {placements.find(p => p.id === id)!.title}</s-button>)}</span>
    </div>}
  </section>;
}

export function PromotionWebsiteEditor({ value, onChange, endsAt, onBusyChange, onActiveBlockChange }: { value: WebsiteDraft; onActiveBlockChange?: (placement: Placement) => void; onChange: (value: WebsiteDraft) => void; endsAt?: string | null; onBusyChange: (busy: boolean) => void }) {
  const latestValue = useRef(value); latestValue.current = value;
  const [busyBlocks, setBusyBlocks] = useState<Partial<Record<Placement | "campaign", boolean>>>({});
  const busy = Object.values(busyBlocks).some(Boolean);
  const busyRef = useRef(onBusyChange); busyRef.current = onBusyChange;
  useEffect(() => { busyRef.current(busy); }, [busy]);
  // Every change settles block backgrounds: a block that shows an image is white.
  function commit(next: WebsiteDraft) { latestValue.current = settleSurfaces(next); onChange(latestValue.current); }
  function set<K extends keyof WebsiteDraft>(name: K, next: WebsiteDraft[K]) { commit({ ...latestValue.current, [name]: next }); }
  function changeBlock(placement: Placement, change: (current: PromotionBlock) => PromotionBlock) {
    commit(setPromotionBlock(latestValue.current, placement, change(promotionBlock(latestValue.current, placement))));
  }
  // The preset belongs to the campaign images, so it applies to every selected block that can show an image.
  function changePreset(preset: PromotionStyle["preset"]) {
    let next = latestValue.current;
    for (const id of selectedCampaignPlacements(next).filter(id => id === "collection" || id === "product")) {
      const block = promotionBlock(next, id);
      const { overrides, blocks, palette: keptPalette, ...nextStyle } = presetDesign(preset, { ...block.style, overrides: { header: { headline: "", body: "", buttonText: "" }, collection: { headline: "", body: "", buttonText: "" }, product: { headline: "", body: "", buttonText: "" }, badge: { headline: "", body: "", buttonText: "" } } });
      void overrides; void blocks; void keptPalette;
      next = setPromotionBlock(next, id, { ...block, style: nextStyle });
    }
    commit(next);
  }
  function changeCampaign(patch: CampaignPatch) { commit(applyCampaignPatch(latestValue.current, patch)); }
  function matchBlock(placement: Placement) { commit(matchCampaign(latestValue.current, placement)); }
  function changePalette(change: PaletteValues) { commit(applyPalette(latestValue.current, change)); }
  function matchColours(placement: Placement) { commit(matchPalette(latestValue.current, placement)); }
  const palette = paletteValues(value);
  const campaign: CampaignWording = { headline: campaignValue(value, "headline"), body: campaignValue(value, "body"), buttonText: campaignValue(value, "buttonText"), countdownText: campaignValue(value, "countdownText"), buttonUrl: campaignValue(value, "buttonUrl"), imageAlt: campaignValue(value, "style", "imageAlt") };
  const errors = validateWebsite(value, endsAt);
  const hasCampaign = selectedCampaignPlacements(value).length > 0;
  const selected = placements.filter(p => value[p.flag]);
  const [openBlock, setOpenBlock] = useState<Placement | null>(null);
  const openId = selected.some(p => p.id === openBlock) ? openBlock : null;
  function toggleBlock(placement: Placement, isOpen: boolean) {
    if (isOpen) { setOpenBlock(placement); onActiveBlockChange?.(placement); }
    else setOpenBlock(current => current === placement ? null : current);
  }
  return <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 20 }}>
    <section aria-label="Choose promotion blocks" style={sectionStyle}>
      <s-heading>Where should this promotion appear?</s-heading>
      <s-text color="subdued">Only selected blocks appear below. Deselecting a block keeps its settings for later.</s-text>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
        {placements.map(p => <div key={p.id} style={{ border: value[p.flag] ? "1px solid #8a8a8a" : "1px solid #e3e3e3", borderRadius: 8, padding: 12, display: "grid", gap: 6, background: value[p.flag] ? "#f7f7f7" : "#fff" }}><PolarisCheckbox label={p.title} checked={Boolean(value[p.flag])} disabled={busy} onChange={event => set(p.flag, event.currentTarget.checked)} /><s-text color="subdued">{p.description}</s-text></div>)}
      </div>
    </section>
    {hasCampaign && <CampaignEditor value={value} onChange={changeCampaign} onPreset={changePreset} onMatch={matchBlock} onBusy={next => setBusyBlocks(current => current.campaign === next ? current : { ...current, campaign: next })} />}
    {selected.length > 0 && <CampaignColours value={value} onChange={changePalette} onMatch={matchColours} onOverride={placement => toggleBlock(placement, true)} />}
    {selected.map(p => <details key={p.id} data-promotion-block={p.id} open={openId === p.id} onToggle={event => toggleBlock(p.id, event.currentTarget.open)} style={{ border: "1px solid #e3e3e3", borderRadius: 12, background: "#fff", minWidth: 0 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, padding: 16 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>{hasCampaign && p.id !== "badge" ? `Fine-tune ${p.title.toLowerCase()}` : p.title}<s-badge tone="success">Selected</s-badge></span></summary>
      <PromotionBlockEditor placement={p.id} block={promotionBlock(value, p.id)} palette={palette} campaign={campaign} onChange={change => changeBlock(p.id, change)} onBusy={next => setBusyBlocks(current => current[p.id] === next ? current : { ...current, [p.id]: next })} />
    </details>)}
    {!selected.length && <s-text color="subdued">Select a block above to customise its content and styling.</s-text>}
    {errors.length > 0 && <s-unordered-list>{errors.map(error => <s-list-item key={error}>{error}</s-list-item>)}</s-unordered-list>}
  </div>;
}
