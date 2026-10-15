import { PromotionVisibilityNotice } from "./PromotionVisibilityNotice";
import type { VisibilityNotice } from "../design/storefrontVisibility";
import { PolarisSelect } from "./PolarisControls";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import promotionUiScript from "../design/promotion-ui.js?raw";
import { countdownParts, countdown, placements, promotionBlock, safeLink, type Placement, type WebsiteDraft } from "../design/design";
export type PreviewProduct = { id: string; title: string; image?: string | null; price?: string | null };
export const promotionCss = `
*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#202223;background:#f5f5f5}button,a{font:inherit}.pe-shell{padding:20px}.pe-context{background:#fff;border:1px solid #e1e1e1;border-radius:12px;padding:20px}.pe-promo{position:relative;overflow:hidden;border-radius:var(--pe-radius);background:var(--pe-bg);color:var(--pe-fg);text-align:var(--pe-align)}.pe-copy{position:relative;padding:var(--pe-space);display:flex;flex-direction:column;justify-content:center;align-items:var(--pe-items);gap:12px;overflow-wrap:anywhere}.pe-heading{margin:0;font-size:var(--pe-heading);line-height:1.15;font-weight:700}.pe-body{margin:0;font-size:var(--pe-body);line-height:1.5;white-space:pre-wrap}.pe-button{display:inline-block;text-decoration:none;padding:11px 18px;border-radius:var(--pe-radius);background:var(--pe-button-bg);color:var(--pe-button-fg);font-size:14px;font-weight:700}.pe-countdown{font-size:13px;font-weight:600}.pe-banner{min-height:var(--pe-height)}.pe-banner .pe-copy{min-height:var(--pe-height)}.pe-split{display:grid;grid-template-columns:1fr 1fr}.pe-picture{display:block;min-width:0;height:100%}.pe-split .pe-picture{position:relative;min-height:var(--pe-height)}.pe-split .pe-picture .pe-image{position:absolute;inset:0}.pe-image{width:100%;height:100%;object-fit:cover;object-position:var(--pe-focus);min-height:var(--pe-height)}.pe-full-image{position:absolute;inset:0}.pe-overlay{position:absolute;inset:0;background:rgba(0,0,0,var(--pe-overlay))}.pe-full .pe-copy{max-width:72%}.pe-header .pe-copy{flex-direction:row;flex-wrap:wrap;justify-content:var(--pe-items);align-items:center;padding:var(--pe-header-space);gap:16px}.pe-header .pe-heading{font-size:var(--pe-heading)}.pe-header .pe-body{font-size:var(--pe-body)}.pe-header .pe-button{padding:7px 12px;font-size:12px}.pe-product{display:grid;grid-template-columns:1fr 1fr;gap:24px}.pe-product-photo{width:100%;height:380px;object-fit:contain;background:#fafafa}.pe-product-title{font-size:24px;line-height:1.2}.pe-price{font-size:18px;font-weight:700}.pe-product .pe-promo{margin-top:20px}.pe-product .pe-heading{font-size:var(--pe-heading)}.pe-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.pe-card{position:relative;border:1px solid #eee;background:#fff;min-width:0}.pe-card img{width:100%;aspect-ratio:4/5;object-fit:contain;background:#fafafa}.pe-card-info{padding:12px;font-size:14px}.pe-badge{position:absolute;top:10px;left:10px;max-width:calc(100% - 20px);padding:6px 9px;border-radius:var(--pe-radius);background:var(--pe-badge-bg);color:var(--pe-badge-fg);font-size:var(--pe-heading);font-weight:700;overflow-wrap:anywhere}.pe-placeholder{display:grid;place-items:center;min-height:200px;background:#eee;color:#666}.pe-note{font-size:12px;color:#616161;margin-bottom:14px}

.pe-product-offer{border:0}.pe-product-offer.pe-full,.pe-product-offer.pe-full .pe-copy{min-height:var(--pe-height)}.pe-product-offer .pe-heading{font-size:var(--pe-heading);font-weight:600;letter-spacing:-.025em}.pe-offer-single{background:transparent;border:var(--pe-border-width) solid var(--pe-border)}.pe-offer-double{background:transparent;border:var(--pe-border-width) double var(--pe-border)}.pe-code-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px;max-width:100%}.pe-code{display:grid;gap:4px;min-width:0;text-align:left}.pe-code small,.pe-timer-label{font-size:12px;font-weight:500}.pe-code strong{font-size:16px;letter-spacing:.06em;user-select:all}.pe-copy-code{background:var(--pe-copy-bg);color:var(--pe-copy-fg);display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;border:0;min-height:44px;font-weight:500}.pe-button:focus-visible{outline:2px solid currentColor;outline-offset:3px}.pe-modern-countdown{display:grid;gap:10px;max-width:100%}.pe-time-units{display:flex;gap:8px}.pe-time-unit{display:grid;gap:5px;min-width:48px;padding:10px 6px;text-align:center;border:1px solid currentColor;border-color:color-mix(in srgb,currentColor 18%,transparent);border-radius:min(var(--pe-radius),8px)}.pe-time-unit strong{font-size:22px;line-height:1;font-weight:500;font-variant-numeric:tabular-nums;letter-spacing:-.025em}.pe-time-unit small{font-size:10px;font-weight:400}.pe-sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}[hidden]{display:none!important}
@media(max-width:600px){.pe-shell{padding:12px}.pe-context{padding:12px}.pe-product{grid-template-columns:1fr;gap:12px}.pe-product-photo{height:230px}.pe-split{grid-template-columns:1fr}.pe-split .pe-picture{height:240px;min-height:180px}.pe-split .pe-image{max-height:240px;min-height:180px}.pe-full .pe-copy{max-width:100%}.pe-copy{padding:max(16px,calc(var(--pe-space)*.7))}.pe-heading{font-size:clamp(10px,6vw,var(--pe-heading))}.pe-cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.pe-header .pe-copy{flex-direction:column;gap:8px;text-align:var(--pe-align);align-items:var(--pe-items)}.pe-banner,.pe-banner .pe-copy{min-height:min(var(--pe-height),360px)}}
`;
// Light DOM styles apply before the custom element upgrades. Scope every rule,
// including rules inside media queries, so theme controls and page layout stay untouched.
export const promotionInlineCss = promotionCss.replace(/(^|(?<=[{}]))([^{}]+)(?=\{)/g, (_match, boundary: string, selector: string) => {
  if (selector.trim().startsWith("@")) return boundary + selector;
  return boundary + selector.split(",").map(part => `promotion-engine[data-server-rendered="true"] ${part.trim()}`).join(",");
});
function responsiveImage(url: string) {
  try {
    const image = new URL(url);
    if (image.hostname !== "cdn.shopify.com" || !image.pathname.startsWith("/s/files/")) return undefined;
    return [390, 600, 900, 1200, 1600, 2000, 2560].map(width => {
      const resized = new URL(image); resized.searchParams.set("width", String(width));
      return `${resized.href} ${width}w`;
    }).join(", ");
  } catch { return undefined; }
}
function PromoContent({ value, placement, endsAt, now, offerNote, discountCode }: { value: WebsiteDraft; placement: Placement; endsAt?: string | null; now: number; offerNote?: string; discountCode?: string | null }) {
  const block = promotionBlock(value, placement);
  const { visibility } = block;
  const title = block.headline;
  const body = block.body;
  const button = block.buttonText;
  const timer = visibility.countdown ? countdown(endsAt, now) : "";
  const parts = visibility.countdown ? countdownParts(endsAt, now) : null;
  const productCode = placement === "product" && visibility.discountCode && discountCode;
  return <div className="pe-copy">{visibility.headline && <h2 className="pe-heading">{title || "Promotion headline"}</h2>}{visibility.body && body && <p className="pe-body">{body}</p>}{visibility.offerNote && (!discountCode || visibility.discountCode) && offerNote && !productCode && <p className="pe-body">{offerNote}</p>}{productCode && <div className="pe-code-row"><span className="pe-code"><small>Use code</small><strong>{discountCode}</strong></span>{block.style.copyCodeEnabled && <><button type="button" className="pe-button pe-copy-code" data-pe-copy-code={discountCode}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg><span data-pe-copy-label="">Copy code</span></button><span className="pe-sr-only" role="status" data-pe-copy-status="" /></>}</div>}{timer && (placement === "product" && parts ? <div className="pe-countdown pe-modern-countdown" data-pe-countdown={endsAt} role="timer" aria-live="off"><span className="pe-timer-label">{block.countdownText || "Offer ends in"}</span><div className="pe-time-units" data-pe-units="" hidden={parts.ended}>{(["days", "hours", "minutes", "seconds"] as const).map(unit => <span className="pe-time-unit" key={unit}><strong data-pe-value={unit}>{String(parts[unit]).padStart(2,"0")}</strong><small>{unit === "minutes" ? "Mins" : unit === "seconds" ? "Secs" : unit === "hours" ? "Hours" : "Days"}</small></span>)}</div><span data-pe-ended="" hidden={!parts.ended}>Offer ended</span></div> : <div className="pe-countdown" data-pe-compact-countdown={endsAt}><span>{block.countdownText || "Offer ends in"} </span><span data-pe-compact-value="">{timer}</span></div>)}{visibility.button && button && block.buttonUrl && safeLink(block.buttonUrl) && <a className="pe-button" href={block.buttonUrl}>{button}</a>}</div>;
}
export function PromotionOffer({ value, placement, endsAt, now, mobile = false, offerNote, discountCode }: { value: WebsiteDraft; placement: Placement; endsAt?: string | null; now: number; mobile?: boolean; offerNote?: string; discountCode?: string | null }) {
  const block = promotionBlock(value, placement);
  const d = block.style;
  const image = block.visibility.image ? (mobile ? d.mobileImage || d.desktopImage : d.desktopImage || d.mobileImage) : "";
  const style = { "--pe-header-space": value.design.blocks?.header ? `${d.spacing}px` : "12px 20px", "--pe-border": d.productBorderColour, "--pe-border-width": `${d.productBorderWidth}px`, "--pe-copy-bg": d.copyCodeBackground, "--pe-copy-fg": d.copyCodeColour, "--pe-bg": block.backgroundColour, "--pe-fg": block.textColour, "--pe-button-bg": d.buttonBackground, "--pe-button-fg": d.buttonColour, "--pe-badge-bg": block.badgeColour, "--pe-badge-fg": d.badgeTextColour, "--pe-radius": `${d.radius}px`, "--pe-space": `${d.spacing}px`, "--pe-heading": `${d.headingSize}px`, "--pe-body": `${d.bodySize}px`, "--pe-height": `${d.bannerHeight}px`, "--pe-focus": `${d.focalX}% ${d.focalY}%`, "--pe-overlay": d.overlay / 100, "--pe-align": d.alignment, "--pe-items": d.alignment === "center" ? "center" : d.alignment === "right" ? "flex-end" : "flex-start" } as CSSProperties;

  if (placement === "badge") return block.visibility.headline ? <span style={style} className="pe-badge">{block.headline || "PROMOTION"}</span> : null;
  const sizes = d.imageLayout === "full" ? "100vw" : "(max-width: 600px) 100vw, 50vw";
  const photo = image ? <picture className="pe-picture">{!mobile && d.mobileImage && <source media="(max-width: 600px)" srcSet={responsiveImage(d.mobileImage) || d.mobileImage} sizes={sizes} />}<img className="pe-image" src={image} srcSet={responsiveImage(image)} sizes={sizes} alt={d.imageAlt} loading="eager" {...{ fetchpriority: placement === "collection" ? "high" : "auto" }} /></picture> : null;
  return <div style={style} className={`pe-promo ${placement === "header" ? "pe-header" : placement === "collection" ? `pe-banner ${image ? d.imageLayout === "full" ? "pe-full" : "pe-split" : ""}` : `pe-product-offer pe-offer-${d.productOfferStyle} ${image ? d.imageLayout === "full" ? "pe-full" : "pe-split" : ""}`}`}>
    {(placement === "collection" || placement === "product") && image && (d.imageLayout === "full" ? <><div className="pe-full-image">{photo}</div><div className="pe-overlay" /></> : d.imageLayout === "half-left" ? photo : null)}
    <PromoContent value={value} placement={placement} endsAt={endsAt} now={now} offerNote={offerNote} discountCode={discountCode} />
    {(placement === "collection" || placement === "product") && image && d.imageLayout === "half-right" ? photo : null}
  </div>;
}
export function PromotionMarkup({ value, placement, products, endsAt, now, mobile = false, offerNote, discountCode }: { value: WebsiteDraft; placement: Placement; products: PreviewProduct[]; endsAt?: string | null; now: number; mobile?: boolean; offerNote?: string; discountCode?: string | null }) {
  const product = products[0];
  const offer = <PromotionOffer value={value} placement={placement} endsAt={endsAt} now={now} mobile={mobile} offerNote={offerNote} discountCode={discountCode} />;
  return <div className="pe-shell">
    {placement === "header" && offer}
    {placement === "collection" && <div className="pe-context"><p className="pe-note">Collection page</p>{offer}</div>}
    {placement === "product" && <div className="pe-context pe-product"><div>{product?.image ? <img className="pe-product-photo" src={product.image} alt={product.title} /> : <div className="pe-placeholder">Choose a preview product</div>}</div><div><h1 className="pe-product-title">{product?.title || "Example product"}</h1><p className="pe-price">{product?.price || "Price unavailable"}</p>{offer}</div></div>}
    {placement === "badge" && <div className="pe-context pe-cards">{products.length ? products.slice(0,3).map(p => <div key={p.id} className="pe-card">{p.image ? <img src={p.image} alt={p.title} /> : <div className="pe-placeholder">No image</div>}{offer}<div className="pe-card-info"><strong>{p.title}</strong><p>{p.price || "Price unavailable"}</p></div></div>) : <div className="pe-placeholder">Choose a preview product</div>}</div>}
  </div>;
}
export function PromotionPreview({ value, products, endsAt, productOptions = [], onProductChange, selectedProductId = "", loading = false, sample = false, offerNote, discountCode, visibilityNotices = [], placement: requestedPlacement, onPlacementChange }: { placement?: Placement; onPlacementChange?: (placement: Placement) => void; value: WebsiteDraft; products: PreviewProduct[]; endsAt?: string | null; productOptions?: PreviewProduct[]; onProductChange?: (id: string) => void; selectedProductId?: string; loading?: boolean; sample?: boolean; offerNote?: string; discountCode?: string | null; visibilityNotices?: VisibilityNotice[] }) {
  const [localPlacement, setLocalPlacement] = useState<Placement>("collection");
  const placement = requestedPlacement ?? localPlacement;
  const setPlacement = (next: Placement) => { setLocalPlacement(next); onPlacementChange?.(next); };
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [now, setNow] = useState(0);
  const [available, setAvailable] = useState(400);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setNow(Date.now()); }, [endsAt]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setAvailable(entries[0].contentRect.width));
    if (ref.current) observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  const enabled = placements.filter(p => value[p.flag]);
  const active = enabled.some(p => p.id === placement) ? placement : enabled[0]?.id;
  const width = device === "desktop" ? 1024 : device === "tablet" ? 768 : 390;
  const block = active ? promotionBlock(value, active) : null;
  const height = active === "product" ? device === "mobile" ? 1100 : 850 : active === "collection" ? (block?.style.bannerHeight ?? 280) + (device === "mobile" && block?.visibility.image && block.style.imageLayout !== "full" && (block.style.desktopImage || block.style.mobileImage) ? 280 : 180) : active === "badge" ? device === "mobile" ? 950 : 660 : 400;
  const scale = Math.min(1, available / width);
  const markup = active ? renderToStaticMarkup(<PromotionMarkup value={value} placement={active} products={products} endsAt={endsAt} now={now} mobile={device === "mobile"} offerNote={offerNote} discountCode={discountCode} />) : "";
  const document = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${promotionCss}</style></head><body>${markup}<script>${promotionUiScript}</script></body></html>`;
  return <section aria-label="Website preview" style={{ border: "1px solid #dedede", borderRadius: 12, padding: 12, background: "#fff", display: "grid", gap: 12, minWidth: 0 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <strong>Website preview</strong>
      <span role="status" aria-live="polite" aria-label={`Website promotion status: ${value.websiteEnabled ? "Enabled" : "Draft"}`}><s-badge tone={value.websiteEnabled ? "success" : "neutral"}>{value.websiteEnabled ? "Enabled" : "Draft"}</s-badge></span>
    </div>
    <PromotionVisibilityNotice notices={visibilityNotices} />
    <small style={{ color: "#616161" }}>Design preview. Storefront visibility depends on the customer, schedule, qualifying products and promotion priority.</small>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{enabled.map(p => <s-button type="button" variant={active === p.id ? "primary" : "secondary"} key={p.id} aria-pressed={active === p.id} onClick={() => setPlacement(p.id)}>{p.title}</s-button>)}</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{(["desktop", "tablet", "mobile"] as const).map(item => <s-button type="button" variant={device === item ? "primary" : "secondary"} key={item} aria-pressed={device === item} onClick={() => setDevice(item)}>{item[0].toUpperCase() + item.slice(1)}</s-button>)}</div>
    {onProductChange && <PolarisSelect label="Preview product" value={selectedProductId} onChange={event => onProductChange(event.currentTarget.value)}><s-option value="">Use eligible products</s-option>{productOptions.map(p => <s-option key={p.id} value={p.id}>{p.title}</s-option>)}</PolarisSelect>}
    {loading && <small role="status">Loading eligible products…</small>}
    {sample && <small>Example product — select qualifying products or collections to preview eligibility.</small>}
    <div ref={ref} style={{ overflow: "auto", minWidth: 0, maxHeight: 650 }}>
      {active ? <div style={{ width: "100%", height: height * scale, position: "relative" }}><iframe title={`${device} ${active} promotion preview`} sandbox="allow-scripts" allow="clipboard-write" srcDoc={document} style={{ position: "absolute", top: 0, left: 0, border: 0, width, height, transform: `scale(${scale})`, transformOrigin: "top left", background: "#f5f5f5" }} /></div> : <p>Select a website placement to preview the promotion.</p>}
    </div>
    <small style={{ color: "#616161" }}>{width}px storefront viewport. Theme fonts and surrounding page content may differ.</small>
  </section>;
}
