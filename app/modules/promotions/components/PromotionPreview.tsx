import { PromotionVisibilityNotice } from "./PromotionVisibilityNotice";
import type { VisibilityNotice } from "../design/storefrontVisibility";
import { PolarisSelect } from "./PolarisControls";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ModalOverlay } from "./ModalOverlay";
import { renderToStaticMarkup } from "react-dom/server";
import promotionUiScript from "../design/promotion-ui.js?raw";
import { countdownParts, countdown, placements, promotionBlock, safeLink, type Placement, type WebsiteDraft } from "../design/design";
export type PreviewProduct = { id: string; title: string; image?: string | null; price?: string | null };
export const promotionCss = `
*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#202223;background:#f5f5f5}button,a{font:inherit}.pe-promo{position:relative;overflow:hidden;border-radius:var(--pe-radius);background:var(--pe-bg);color:var(--pe-fg);text-align:var(--pe-align)}.pe-copy{position:relative;padding:var(--pe-space);display:flex;flex-direction:column;justify-content:center;align-items:var(--pe-items);gap:12px;overflow-wrap:anywhere}.pe-heading{margin:0;font-size:var(--pe-heading);line-height:1.15;font-weight:700}.pe-body{margin:0;font-size:var(--pe-body);line-height:1.5;white-space:pre-wrap}.pe-button{display:inline-block;text-decoration:none;padding:11px 18px;border-radius:var(--pe-radius);background:var(--pe-button-bg);color:var(--pe-button-fg);font-size:14px;font-weight:700}.pe-countdown{font-size:13px;font-weight:600}.pe-banner{min-height:var(--pe-height)}.pe-banner .pe-copy{min-height:var(--pe-height)}.pe-split{display:grid;grid-template-columns:1fr 1fr}.pe-picture{display:block;min-width:0;height:100%}.pe-split .pe-picture{position:relative;min-height:var(--pe-height)}.pe-split .pe-picture .pe-image{position:absolute;inset:0}.pe-image{width:100%;height:100%;object-fit:cover;object-position:var(--pe-focus);min-height:var(--pe-height)}.pe-full-image{position:absolute;inset:0}.pe-full .pe-copy{max-width:72%}.pe-promo.pe-header{border-radius:0}.pe-header .pe-copy{flex-direction:row;flex-wrap:wrap;justify-content:var(--pe-items);align-items:center;padding:var(--pe-header-space);gap:16px}.pe-header .pe-heading{font-size:var(--pe-heading)}.pe-header .pe-body{font-size:var(--pe-body)}.pe-header .pe-button{padding:7px 12px;font-size:12px}.pe-badge{position:absolute;top:10px;left:10px;max-width:calc(100% - 20px);padding:6px 9px;border-radius:var(--pe-radius);background:var(--pe-badge-bg);color:var(--pe-badge-fg);font-size:var(--pe-heading);font-weight:700;overflow-wrap:anywhere}

.pe-product-offer{border:0}.pe-product-offer.pe-full,.pe-product-offer.pe-full .pe-copy{min-height:var(--pe-height)}.pe-product-offer .pe-heading{font-size:var(--pe-heading);font-weight:600;letter-spacing:-.025em}.pe-offer-single{background:transparent;border:var(--pe-border-width) solid var(--pe-border)}.pe-offer-double{background:transparent;border:var(--pe-border-width) double var(--pe-border)}.pe-code-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px;max-width:100%}.pe-code{display:grid;gap:4px;min-width:0;text-align:left}.pe-code small,.pe-timer-label{font-size:12px;font-weight:500}.pe-code strong{font-size:16px;letter-spacing:.06em;user-select:all}.pe-copy-code{background:var(--pe-copy-bg);color:var(--pe-copy-fg);display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;border:0;min-height:44px;font-weight:500}.pe-button:focus-visible{outline:2px solid currentColor;outline-offset:3px}.pe-modern-countdown{display:grid;gap:10px;max-width:100%}.pe-time-units{display:flex;gap:8px}.pe-time-unit{display:grid;gap:5px;min-width:48px;padding:10px 6px;text-align:center;border:1px solid currentColor;border-color:color-mix(in srgb,currentColor 18%,transparent);border-radius:min(var(--pe-radius),8px)}.pe-time-unit strong{font-size:22px;line-height:1;font-weight:500;font-variant-numeric:tabular-nums;letter-spacing:-.025em}.pe-time-unit small{font-size:10px;font-weight:400}.pe-sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}[hidden]{display:none!important}
@media(max-width:600px){.pe-split{grid-template-columns:1fr}.pe-split .pe-picture{height:240px;min-height:180px}.pe-split .pe-image{max-height:240px;min-height:180px}.pe-full .pe-copy{max-width:100%}.pe-copy{padding:max(16px,calc(var(--pe-space)*.7))}.pe-heading{font-size:clamp(10px,6vw,var(--pe-heading))}.pe-header .pe-copy{flex-direction:column;gap:8px;text-align:var(--pe-align);align-items:var(--pe-items)}.pe-banner,.pe-banner .pe-copy{min-height:min(var(--pe-height),360px)}}
/* Ratio sizing: a banner takes its shape from its image (--pe-ratio is width/height, or auto), so artwork is not cropped. */
.pe-promo.pe-ratio{display:grid;min-height:0;aspect-ratio:var(--pe-ratio)}
.pe-promo.pe-ratio .pe-full-image{position:static;grid-area:1/1;min-width:0}
.pe-promo.pe-ratio .pe-picture{position:static;display:block;height:100%;min-height:0}
.pe-promo.pe-ratio .pe-image{position:static;display:block;width:100%;height:100%;min-height:0;max-height:none;aspect-ratio:var(--pe-ratio);object-fit:cover;object-position:var(--pe-focus)}
.pe-promo.pe-ratio.pe-full .pe-copy{grid-area:1/1;z-index:1;min-height:0;align-self:stretch}
.pe-promo.pe-only{display:block;min-height:0}
.pe-only .pe-only-link{display:block;color:inherit;text-decoration:none}
.pe-only .pe-picture{position:static;display:block;height:auto;min-height:0}
.pe-only .pe-image{position:static;display:block;width:100%;height:auto;min-height:0;max-height:none;aspect-ratio:var(--pe-ratio)}
@media(max-width:600px){.pe-promo.pe-ratio{aspect-ratio:var(--pe-ratio-m)}.pe-promo.pe-ratio .pe-image,.pe-only .pe-image{aspect-ratio:var(--pe-ratio-m);max-height:none;min-height:0}.pe-promo.pe-ratio.pe-full .pe-copy{min-height:0}}
`;
// Preview-only styles. They show the surroundings of a block and never reach the storefront.
const previewCss = `html{overflow:hidden}body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:#fff;color:#1a1a1a}
.pe-shell{padding:0}.pe-site{background:#fff;min-height:100%}
.pe-site-nav{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 32px;border-bottom:1px solid #ececec}
.pe-site-logo{width:104px;height:20px;border-radius:5px;background:#1a1a1a}
.pe-site-links{display:flex;flex:1;justify-content:center;gap:24px}.pe-site-links span{width:56px;height:8px;border-radius:4px;background:#dcdcdc}
.pe-site-icons{display:flex;gap:14px}.pe-site-icons i{width:20px;height:20px;border-radius:50%;background:#e2e2e2}
.pe-page{display:grid;gap:20px;padding:20px 32px 40px}
.pe-crumbs{display:flex;align-items:center;gap:8px}.pe-crumbs span{width:48px;height:8px;border-radius:4px;background:#e2e2e2}.pe-crumbs span+span{width:72px}
.pe-bar{height:12px;border-radius:6px;background:#ececec}.pe-bar-title{width:220px;height:22px;background:#e0e0e0}.pe-bar-mid{width:80%}.pe-bar-short{width:55%}
.pe-toolbar{display:flex;justify-content:space-between;gap:12px}.pe-toolbar span{width:96px;height:32px;border:1px solid #e2e2e2;border-radius:8px}
.pe-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}
.pe-card{display:grid;gap:10px;min-width:0;align-content:start}
.pe-card-media{position:relative;aspect-ratio:4/5;overflow:hidden;border-radius:12px;background:#f1f1f1}.pe-card-media img{display:block;width:100%;height:100%;object-fit:cover}
.pe-card-title{font-size:14px;font-weight:600;line-height:1.3}.pe-card-price{font-size:14px;color:#555}
.pe-pdp{display:grid;grid-template-columns:1.1fr 1fr;gap:40px;align-items:start}
.pe-gallery{display:grid;gap:12px}.pe-gallery-main{aspect-ratio:1/1;overflow:hidden;border-radius:14px;background:#f1f1f1}.pe-gallery-main img{display:block;width:100%;height:100%;object-fit:cover}
.pe-thumbs{display:flex;gap:10px}.pe-thumbs span{width:64px;height:64px;border-radius:10px;background:#ececec}
.pe-pdp-info{display:grid;gap:16px;min-width:0}
.pe-product-title{margin:0;font-size:28px;font-weight:700;line-height:1.15;letter-spacing:-.02em}.pe-price{margin:0;font-size:20px;font-weight:600}
.pe-pills{display:flex;gap:8px}.pe-pills span{width:44px;height:36px;border:1px solid #d6d6d6;border-radius:8px}
.pe-buy{display:flex;gap:12px}.pe-qty{width:96px;height:48px;border:1px solid #d6d6d6;border-radius:10px}.pe-atc{display:grid;flex:1;height:48px;place-items:center;border-radius:10px;background:#1a1a1a;color:#fff;font-size:15px;font-weight:600}
@media(max-width:600px){.pe-site-nav{padding:12px 16px}.pe-site-links{display:none}.pe-page{padding:14px 16px 28px}.pe-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.pe-pdp{grid-template-columns:1fr;gap:20px}.pe-product-title{font-size:24px}}
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
  const desktopRatio = Number(d.desktopImageRatio) > 0 ? d.desktopImageRatio : "";
  const mobileRatio = Number(d.mobileImageRatio) > 0 ? d.mobileImageRatio : "";
  // Phones show the mobile image when there is one, so they take its shape, never the desktop image's. An unknown shape falls back to the image's own size.
  const phoneRatio = d.mobileImage ? mobileRatio : desktopRatio;
  const style = { "--pe-header-space": value.design.blocks?.header ? `${d.spacing}px` : "12px 20px", "--pe-border": d.productBorderColour, "--pe-border-width": `${d.productBorderWidth}px`, "--pe-copy-bg": d.copyCodeBackground, "--pe-copy-fg": d.copyCodeColour, "--pe-bg": block.backgroundColour, "--pe-fg": block.textColour, "--pe-button-bg": d.buttonBackground, "--pe-button-fg": d.buttonColour, "--pe-badge-bg": block.badgeColour, "--pe-badge-fg": d.badgeTextColour, "--pe-radius": `${d.radius}px`, "--pe-space": `${d.spacing}px`, "--pe-heading": `${d.headingSize}px`, "--pe-body": `${d.bodySize}px`, "--pe-height": `${d.bannerHeight}px`, "--pe-focus": `${d.focalX}% ${d.focalY}%`, "--pe-ratio": (mobile ? phoneRatio : desktopRatio) || "auto", "--pe-ratio-m": phoneRatio || "auto", "--pe-align": d.alignment, "--pe-items": d.alignment === "center" ? "center" : d.alignment === "right" ? "flex-end" : "flex-start" } as CSSProperties;

  if (placement === "badge") return block.visibility.headline ? <span style={style} className="pe-badge">{block.headline || "PROMOTION"}</span> : null;
  const sizes = d.imageLayout === "full" || d.imageLayout === "only" ? "100vw" : "(max-width: 600px) 100vw, 50vw";
  const photo = image ? <picture className="pe-picture">{!mobile && d.mobileImage && <source media="(max-width: 600px)" srcSet={responsiveImage(d.mobileImage) || d.mobileImage} sizes={sizes} />}<img className="pe-image" src={image} srcSet={responsiveImage(image)} sizes={sizes} alt={d.imageAlt} loading="eager" {...{ fetchpriority: placement === "collection" ? "high" : "auto" }} /></picture> : null;
  // Artwork that already carries the message: the image alone, at its own shape, linking to the button destination.
  if (image && d.imageLayout === "only" && (placement === "collection" || placement === "product")) {
    const href = block.buttonUrl && safeLink(block.buttonUrl) ? block.buttonUrl : "";
    return <div style={style} className={`pe-promo ${placement === "collection" ? "pe-banner" : `pe-product-offer pe-offer-${d.productOfferStyle}`} pe-only`}>{href ? <a className="pe-only-link" href={href}>{photo}</a> : photo}</div>;
  }
  const layoutClass = !image ? "" : d.imageLayout === "full" ? `pe-full${desktopRatio || (d.mobileImage && mobileRatio) ? " pe-ratio" : ""}` : "pe-split";
  return <div style={style} className={`pe-promo ${placement === "header" ? "pe-header" : placement === "collection" ? `pe-banner ${layoutClass}` : `pe-product-offer pe-offer-${d.productOfferStyle} ${layoutClass}`}`}>
    {(placement === "collection" || placement === "product") && image && (d.imageLayout === "full" ? <div className="pe-full-image">{photo}</div> : d.imageLayout === "half-left" ? photo : null)}
    <PromoContent value={value} placement={placement} endsAt={endsAt} now={now} offerNote={offerNote} discountCode={discountCode} />
    {(placement === "collection" || placement === "product") && image && d.imageLayout === "half-right" ? photo : null}
  </div>;
}
function SiteNav() {
  return <div className="pe-site-nav"><span className="pe-site-logo" /><span className="pe-site-links"><span /><span /><span /><span /></span><span className="pe-site-icons"><i /><i /></span></div>;
}
function Crumbs() { return <div className="pe-crumbs"><span /><span /></div>; }
function ProductCard({ product, badge }: { product?: PreviewProduct; badge?: ReactNode }) {
  return <div className="pe-card">
    <div className="pe-card-media">{product?.image && <img src={product.image} alt={product.title} />}{badge}</div>
    {product ? <><div className="pe-card-title">{product.title}</div><div className="pe-card-price">{product.price}</div></> : <><div className="pe-bar pe-bar-mid" /><div className="pe-bar pe-bar-short" /></>}
  </div>;
}
// The block is drawn where it sits on a storefront. The surroundings are placeholders and are preview-only.
export function PromotionMarkup({ value, placement, products, endsAt, now, mobile = false, offerNote, discountCode }: { value: WebsiteDraft; placement: Placement; products: PreviewProduct[]; endsAt?: string | null; now: number; mobile?: boolean; offerNote?: string; discountCode?: string | null }) {
  const product = products[0];
  const cards = Array.from({ length: 4 }, (_, index) => products[index]);
  const offer = <PromotionOffer value={value} placement={placement} endsAt={endsAt} now={now} mobile={mobile} offerNote={offerNote} discountCode={discountCode} />;
  return <div className="pe-shell">
    {placement === "header" && <div className="pe-site">{offer}<SiteNav /><div className="pe-page"><div className="pe-bar pe-bar-title" /><div className="pe-bar pe-bar-mid" /><div className="pe-bar pe-bar-short" /></div></div>}
    {placement === "collection" && <div className="pe-site"><SiteNav /><div className="pe-page"><Crumbs /><div className="pe-bar pe-bar-title" />{offer}<div className="pe-toolbar"><span /><span /></div><div className="pe-grid">{cards.map((card, index) => <ProductCard key={card?.id ?? index} product={card} />)}</div></div></div>}
    {placement === "product" && <div className="pe-site"><SiteNav /><div className="pe-page"><Crumbs />
      <div className="pe-pdp">
        <div className="pe-gallery"><div className="pe-gallery-main">{product?.image && <img src={product.image} alt={product.title} />}</div><div className="pe-thumbs"><span /><span /><span /></div></div>
        <div className="pe-pdp-info"><h1 className="pe-product-title">{product?.title || "Example product"}</h1><p className="pe-price">{product?.price || "£0.00"}</p>{offer}<div className="pe-pills"><span /><span /><span /></div><div className="pe-buy"><span className="pe-qty" /><span className="pe-atc">Add to cart</span></div><div className="pe-bar" /><div className="pe-bar pe-bar-mid" /><div className="pe-bar pe-bar-short" /></div>
      </div></div></div>}
    {placement === "badge" && <div className="pe-site"><SiteNav /><div className="pe-page"><Crumbs /><div className="pe-bar pe-bar-title" /><div className="pe-toolbar"><span /><span /></div><div className="pe-grid">{cards.map((card, index) => <ProductCard key={card?.id ?? index} product={card} badge={offer} />)}</div></div></div>}
  </div>;
}
const devices = [{ id: "desktop", label: "Desktop", width: 1024 }, { id: "tablet", label: "Tablet", width: 768 }, { id: "mobile", label: "Mobile", width: 390 }] as const;
type Device = typeof devices[number]["id"];

// The frame reports its own content height, so a one-line header is not given the room of a product page.
const reportHeight = `<script>(function(){function post(){parent.postMessage({peHeight:Math.ceil(document.body.getBoundingClientRect().height)},"*")}addEventListener("load",post);if(window.ResizeObserver)new ResizeObserver(post).observe(document.body);post()})()</script>`;

// The preview never scrolls inside itself. In the side panel (`fitHeight` set) the page is scaled down to fit the window
// height; elsewhere it is shown in full and the surrounding page or modal scrolls.
function PreviewStage({ document: html, width, title, fallbackHeight, fitHeight }: { document: string; width: number; title: string; fallbackHeight: number; fitHeight?: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [available, setAvailable] = useState(400);
  const [measured, setMeasured] = useState<number | null>(null);
  const recent = useRef<number[]>([]);
  const [viewport, setViewport] = useState(typeof window === "undefined" ? 800 : window.innerHeight);
  useEffect(() => {
    const resized = () => setViewport(window.innerHeight);
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  // Typing rebuilds the document; wait for a pause so the frame does not flicker or lose its scroll position.
  const [settled, setSettled] = useState(html);
  useEffect(() => { const timer = setTimeout(() => setSettled(html), 250); return () => clearTimeout(timer); }, [html]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setAvailable(entries[0].contentRect.width));
    if (holder.current) observer.observe(holder.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    function heard(event: MessageEvent) {
      const height = (event.data as { peHeight?: unknown } | null)?.peHeight;
      if (event.source !== frame.current?.contentWindow || typeof height !== "number" || height <= 0) return;
      const now = Date.now();
      recent.current = [...recent.current.filter(time => now - time < 2000), now];
      // A burst of updates means the size is oscillating; settle on the larger height instead of following it.
      if (recent.current.length > 8) setMeasured(previous => Math.max(previous ?? 0, height));
      else setMeasured(previous => previous !== null && Math.abs(previous - height) < 2 ? previous : height);
    }
    window.addEventListener("message", heard);
    return () => window.removeEventListener("message", heard);
  }, []);
  const height = measured ?? fallbackHeight;
  const heightLimit = fitHeight === undefined ? Infinity : Math.max(200, viewport - fitHeight);
  const scale = Math.min(1, available / width, heightLimit / height);
  return <div ref={holder} style={{ overflow: "hidden", minWidth: 0 }}>
    <div style={{ width: width * scale, height: height * scale, position: "relative", margin: "0 auto" }}>
      <iframe ref={frame} title={title} sandbox="allow-scripts" allow="clipboard-write" srcDoc={settled} style={{ position: "absolute", top: 0, left: 0, border: 0, width, height, transform: `scale(${scale})`, transformOrigin: "top left", background: "#f5f5f5" }} />
    </div>
  </div>;
}

export function PromotionPreview({ value, products, endsAt, productOptions = [], onProductChange, selectedProductId = "", loading = false, sample = false, offerNote, discountCode, visibilityNotices = [], placement: requestedPlacement, onPlacementChange, allowEnlarge = true }: { placement?: Placement; onPlacementChange?: (placement: Placement) => void; value: WebsiteDraft; products: PreviewProduct[]; endsAt?: string | null; productOptions?: PreviewProduct[]; onProductChange?: (id: string) => void; selectedProductId?: string; loading?: boolean; sample?: boolean; offerNote?: string; discountCode?: string | null; visibilityNotices?: VisibilityNotice[]; allowEnlarge?: boolean }) {
  const [localPlacement, setLocalPlacement] = useState<Placement>("collection");
  const placement = requestedPlacement ?? localPlacement;
  const setPlacement = (next: Placement) => { setLocalPlacement(next); onPlacementChange?.(next); };
  const [device, setDevice] = useState<Device>("desktop");
  const [enlarged, setEnlarged] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); }, [endsAt]);
  const enabled = placements.filter(p => value[p.flag]);
  const active = enabled.some(p => p.id === placement) ? placement : enabled[0]?.id;
  const width = devices.find(item => item.id === device)!.width;
  const block = active ? promotionBlock(value, active) : null;
  // Only used until the frame reports its real height.
  const fallbackHeight = active === "product" ? device === "mobile" ? 1100 : 850 : active === "collection" ? (block?.style.bannerHeight ?? 280) + 180 : active === "badge" ? device === "mobile" ? 950 : 660 : 200;
  const markup = active ? renderToStaticMarkup(<PromotionMarkup value={value} placement={active} products={products} endsAt={endsAt} now={now} mobile={device === "mobile"} offerNote={offerNote} discountCode={discountCode} />) : "";
  const document = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${promotionCss}${previewCss}</style></head><body>${markup}<script>${promotionUiScript}</script>${reportHeight}</body></html>`;
  const frameTitle = `${device} ${active} promotion preview`;
  return <s-section heading="Website preview" accessibilityLabel="Website preview">
    <s-stack direction="block" gap="base">
      {allowEnlarge && active && <div style={{ display: "flex", justifyContent: "flex-end" }}><s-button type="button" variant="tertiary" onClick={() => setEnlarged(true)}>View larger</s-button></div>}
      <PromotionVisibilityNotice notices={visibilityNotices} />
      {enabled.length > 0 && <s-stack direction="inline" gap="small-200">{enabled.map(p => <s-button type="button" variant={active === p.id ? "primary" : "secondary"} key={p.id} aria-pressed={active === p.id} onClick={() => setPlacement(p.id)}>{p.title}</s-button>)}</s-stack>}
      {enabled.length > 0 && <s-stack direction="inline" gap="small-200">{devices.map(item => <s-button type="button" variant={device === item.id ? "primary" : "secondary"} key={item.id} aria-pressed={device === item.id} onClick={() => setDevice(item.id)}>{item.label}</s-button>)}</s-stack>}
      {onProductChange && <PolarisSelect label="Preview product" value={selectedProductId} onChange={event => onProductChange(event.currentTarget.value)}><s-option value="">Use eligible products</s-option>{productOptions.map(p => <s-option key={p.id} value={p.id}>{p.title}</s-option>)}</PolarisSelect>}
      {loading && <s-text color="subdued">Loading eligible products…</s-text>}
      {sample && <s-text color="subdued">Example product. Select qualifying products or collections to preview eligibility.</s-text>}
      {active
        ? <PreviewStage document={document} width={width} title={frameTitle} fallbackHeight={fallbackHeight} fitHeight={allowEnlarge ? 420 : undefined} />
        : <s-banner tone="info">Select a website block to preview it.</s-banner>}
      <s-text color="subdued">Design preview at {width}px. Whether visitors see it depends on the customer, schedule, qualifying products and priority. Theme fonts and surrounding page content may differ.</s-text>
    </s-stack>
    {allowEnlarge && <ModalOverlay open={enlarged} heading="Website preview" size="large" onClose={() => setEnlarged(false)}>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small-200">{devices.map(item => <s-button type="button" variant={device === item.id ? "primary" : "secondary"} key={item.id} aria-pressed={device === item.id} onClick={() => setDevice(item.id)}>{item.label}</s-button>)}</s-stack>
        <PreviewStage document={document} width={width} title={`Large ${frameTitle}`} fallbackHeight={fallbackHeight} />
      </s-stack>
      <s-button slot="secondary-actions" onClick={() => setEnlarged(false)}>Close</s-button>
    </ModalOverlay>}
  </s-section>;
}
