import { createElement, Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { FetcherWithComponents } from "react-router";
import { useEmbeddedAppUrl } from "../navigation/embeddedAppUrl";
import { PromotionSaveBar } from "../promotions/components/PromotionSaveBar";
import { SaveNotices } from "../promotions/components/SaveNotices";
import { DateField, DateTimeField } from "../promotions/components/DateTimeField";
import { FormStep } from "../promotions/components/FormStep";
import { ModalOverlay } from "../promotions/components/ModalOverlay";
import { editorCss } from "../promotions/components/editor/editorStyles";
import { PolarisCheckbox, PolarisCheckboxList, PolarisNumberField, PolarisRadioList, PolarisSelect } from "../promotions/components/PolarisControls";
import { contrastRatio } from "../promotions/design/design";
import blockCss from "../../../extensions/promotion-engine/assets/shipping-countdown.css?raw";
import { dayNames, defaultServiceSetting, defaultShippingConfig, deliveryPlaceholders, freePlaceholders, parseBankHolidays, unknownPlaceholders, validateShippingConfig, type DeliveryServiceSetting, type ShippingCountdownConfig } from "./config";
import { formatMinor, transitText } from "./delivery/deliveryModel";
import { serviceCatalogue, servicesFor, type PublishedServices } from "./delivery/deliveryServices";
import { freeDeliveryFor, type FreeDeliveryTable } from "./delivery/freeService";
import { shippingLogic, type DeliveryOption, type StockVariant } from "./logic";
import { RichTextField } from "./RichTextField";
import { styleAttributes } from "./appearance";

export type ShippingResult = { ok: boolean; intent: string; errors: string[]; config?: ShippingCountdownConfig; dates?: string[] };

type ServiceForm = { name: string; label: string; show: boolean; guaranteed: boolean; cutoffTime: string; days: boolean[]; onBankHolidays: boolean; transitMin: string; transitMax: string };
type DeliveryForm = { enabled: boolean; heading: string; guaranteedText: string; estimatedText: string; showMonth: boolean; services: ServiceForm[] };

type Form = {
  cutoffTime: string; days: boolean[]; holidays: string; delayDays: string; delayMessage: string;
  hideIfUnavailable: boolean; showShippingDays: boolean; shippingDaysPrefix: string; noShippingText: string; errorText: string;
  countdownPrefix: string; countdownSuffix: string;
  freeEnabled: boolean; textUnder: string; textAdd: string; textOver: string;
  outMode: "message" | "hide"; outMessage: string; backMode: "message" | "hide"; backMessage: string;
  warnEnabled: boolean; warnStart: string; warnEnd: string; warnMessage: string; warnText: string; warnBackground: string; warnBorder: string;
  delivery: DeliveryForm;
  look: { align: string; showIcon: boolean; textSize: string; fontWeight: string; padding: string; margin: string; lineGap: string; radius: string; border: string; borderWidth: string; background: string; text: string; accent: string; dispatch: string; muted: string; icon: string };
};

const serviceForm = (setting: DeliveryServiceSetting): ServiceForm => ({ ...setting, transitMin: setting.transitMin === null ? "" : String(setting.transitMin), transitMax: setting.transitMax === null ? "" : String(setting.transitMax) });

/** A service nobody changed: the defaults, so nothing is saved for it. */
function isDefaultService(f: ServiceForm) {
  const d = defaultServiceSetting(f.name);
  return f.label.trim() === "" && f.show === d.show && f.guaranteed === d.guaranteed && f.cutoffTime.trim() === "" && f.onBankHolidays === d.onBankHolidays
    && f.transitMin.trim() === "" && f.transitMax.trim() === "" && f.days.every((day, index) => day === d.days[index]);
}

/**
 * The form for saved settings. Every delivery service Shopify offers is listed, with its saved settings or the defaults; settings saved for a
 * service Shopify no longer has are kept at the end, so they can be seen and removed.
 */
const toForm = (c: ShippingCountdownConfig, services: PublishedServices | null = null): Form => ({
  cutoffTime: c.cutoffTime, days: c.shippingDays, holidays: c.bankHolidays.join("\n"), delayDays: String(c.delayDays), delayMessage: c.delayMessage,
  hideIfUnavailable: c.hideIfUnavailable, showShippingDays: c.showShippingDays, shippingDaysPrefix: c.shippingDaysPrefix, noShippingText: c.noShippingText,
  errorText: c.errorText, countdownPrefix: c.countdownPrefix, countdownSuffix: c.countdownSuffix,
  freeEnabled: c.freeShipping.enabled,
  textUnder: c.freeShipping.textUnder, textAdd: c.freeShipping.textAdd, textOver: c.freeShipping.textOver,
  outMode: c.availability.outOfStock.mode, outMessage: c.availability.outOfStock.message, backMode: c.availability.backorder.mode, backMessage: c.availability.backorder.message,
  warnEnabled: c.warning.enabled, warnStart: c.warning.startDate, warnEnd: c.warning.endDate, warnMessage: c.warning.message,
  warnText: c.warning.textColor, warnBackground: c.warning.backgroundColor, warnBorder: c.warning.borderColor,
  delivery: {
    enabled: c.delivery.enabled, heading: c.delivery.heading, guaranteedText: c.delivery.guaranteedText, estimatedText: c.delivery.estimatedText, showMonth: c.delivery.showMonth,
    services: [
      ...(services ? serviceCatalogue(services) : []).map(item => serviceForm(c.delivery.services.find(setting => setting.name === item.name) ?? defaultServiceSetting(item.name))),
      ...c.delivery.services.filter(setting => !(services ? serviceCatalogue(services) : []).some(item => item.name === setting.name)).map(serviceForm),
    ],
  },
  look: { ...c.style, textSize: String(c.style.textSize), margin: String(c.style.margin), lineGap: String(c.style.lineGap), radius: String(c.style.radius), borderWidth: String(c.style.borderWidth) },
});

/** The settings the form describes, plus anything in it that cannot even be read as a setting (the rest is checked by the shared validator). */
function toInput(f: Form) {
  const problems: string[] = [];
  const holidays = parseBankHolidays(f.holidays);
  if (holidays.invalid.length) problems.push(`Bank holidays must be dates written YYYY-MM-DD. Not valid: ${holidays.invalid.slice(0, 3).join(", ")}.`);
  return {
    problems,
    input: {
      version: 1, cutoffTime: f.cutoffTime, shippingDays: f.days, bankHolidays: holidays.dates, delayDays: f.delayDays.trim() === "" ? 0 : Number(f.delayDays), delayMessage: f.delayMessage,
      hideIfUnavailable: f.hideIfUnavailable, showShippingDays: f.showShippingDays, shippingDaysPrefix: f.shippingDaysPrefix, noShippingText: f.noShippingText, errorText: f.errorText,
      countdownPrefix: f.countdownPrefix, countdownSuffix: f.countdownSuffix,
      freeShipping: { enabled: f.freeEnabled, textUnder: f.textUnder, textAdd: f.textAdd, textOver: f.textOver },
      availability: { outOfStock: { mode: f.outMode, message: f.outMessage }, backorder: { mode: f.backMode, message: f.backMessage } },
      warning: { enabled: f.warnEnabled, startDate: f.warnStart, endDate: f.warnEnd, message: f.warnMessage, textColor: f.warnText, backgroundColor: f.warnBackground, borderColor: f.warnBorder },
      style: f.look,
      delivery: { enabled: f.delivery.enabled, heading: f.delivery.heading, guaranteedText: f.delivery.guaranteedText, estimatedText: f.delivery.estimatedText, showMonth: f.delivery.showMonth, services: f.delivery.services.filter(item => !isDefaultService(item)) },
    },
  };
}

function TextField({ label, value, onChange, details, maxLength, multiline = false, error }: { label: string; value: string; onChange: (value: string) => void; details?: string; maxLength?: number; multiline?: boolean; error?: string }) {
  return multiline
    ? <s-text-area label={label} value={value} rows={3} maxLength={maxLength} details={details} error={error} onInput={event => onChange(event.currentTarget.value)} />
    : <s-text-field label={label} value={value} maxLength={maxLength} details={details} error={error} onInput={event => onChange(event.currentTarget.value)} />;
}

// Shopify's native colour field; only complete six-digit colours are passed on while someone is typing.
function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
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
  return <s-color-field ref={ref} label={label} value={value} />;
}

type Dispatch = ReturnType<typeof shippingLogic.dispatchView>;

/** A message with its bold and highlighted words, the way the product page writes it. */
function Rich({ text }: { text: string }) {
  return <>{shippingLogic.parseRich(text).map((run, index) => {
    let node: ReactNode = run.text;
    if (run.bold) node = <strong>{node}</strong>;
    if (run.highlight) node = <span className="sc__countdown">{node}</span>;
    return <Fragment key={index}>{node}</Fragment>;
  })}</>;
}

/** The block exactly as the product page builds it (same markup, same stylesheet, same variables), so the look can be judged here. */
function ShippingPreview({ config, view, freeText, warningShowing, options }: { config: ShippingCountdownConfig; view: Dispatch; freeText: string; warningShowing: boolean; options: DeliveryOption[] }) {
  const { data, vars } = styleAttributes(config.style);
  const days = [1, 2, 3, 4, 5, 6, 0].filter(index => config.shippingDays[index]).map(index => dayNames[index]).join(", ");
  // A custom element takes `class`, not `className`, which React would write out as a literal "classname" attribute.
  const hostAttributes: Record<string, string> = { class: "sc" };
  const warningVars = { "--sc-warn-text": config.warning.textColor, "--sc-warn-bg": config.warning.backgroundColor, "--sc-warn-border": config.warning.borderColor } as CSSProperties;
  return <>
    <style>{blockCss}</style>
    {createElement("shipping-countdown", { ...hostAttributes, ...data, style: vars as CSSProperties },
      warningShowing && <div className="sc__warning" style={warningVars}>⚠️ <Rich text={config.warning.message} /></div>,
      <div className="sc__content">
        {config.style.showIcon && <svg className="sc__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></svg>}
        {freeText && <p className="sc__free"><Rich text={freeText} /></p>}
        <p className="sc__main">
          {view.kind === "countdown" && <><Rich text={config.countdownPrefix} /> <span className="sc__countdown">{view.countdown}</span> <Rich text={config.countdownSuffix} /> <span className="sc__dispatch">{view.date}</span></>}
          {view.kind === "delay" && <><Rich text={config.delayMessage} /> <span className="sc__dispatch">{view.date}</span></>}
          {view.kind === "none" && <span className="sc__expired"><Rich text={config.noShippingText} /></span>}
          {view.kind === "error" && <Rich text={config.errorText} />}
          {view.kind === "hidden" && "The block is hidden: no dispatch day is available and Hide when unavailable is on."}
          {view.kind === "outofstock" && <Rich text={config.availability.outOfStock.message} />}
          {view.kind === "backorder" && <Rich text={config.availability.backorder.message} />}
        </p>
        {config.showShippingDays && days && <p className="sc__days"><Rich text={config.shippingDaysPrefix} /> {days}</p>}
        {config.delivery.enabled && options.length > 0 && <details className="sc__delivery" open>
          <summary className="sc__delivery-heading"><Rich text={config.delivery.heading} /></summary>
          <ul className="sc__delivery-list">
            {options.map(option => <li key={option.name} className="sc__option">
              <span className="sc__option-name">{option.label}</span>
              <span className="sc__option-price">{option.price}</span>
              <span className="sc__option-date"><Rich text={option.text} /></span>
            </li>)}
          </ul>
        </details>}
      </div>)}
  </>;
}

/** Text that is hard to read on its background, so a colour choice can be questioned before it reaches the shop. */
function contrastNotes(config: ShippingCountdownConfig) {
  const { style, warning } = config;
  const pairs: Array<[string, string, string]> = [
    ["Text", style.text, style.background], ["Time left", style.accent, style.background], ["Dispatch day", style.dispatch, style.background],
    ["Secondary text", style.muted, style.background], ...(style.showIcon ? [["Icon", style.icon, style.background] as [string, string, string]] : []),
    ...(warning.enabled ? [["Warning text", warning.textColor, warning.backgroundColor] as [string, string, string]] : []),
  ];
  return pairs.map(([label, foreground, background]) => ({ label, ratio: contrastRatio(foreground, background) })).filter(item => item.ratio < (item.label === "Icon" ? 3 : 4.5));
}

const regionNames = new Intl.DisplayNames(["en-GB"], { type: "region" });
const countryName = (code: string) => { try { return regionNames.of(code) || code; } catch { return code; } };

/** What Shopify's shipping settings say about free delivery, as last published for the product page. It is read-only here: it is changed in Shopify. */
function DeliveryFromShopify({ delivery, appUrl }: { delivery: FreeDeliveryTable | null; appUrl: (path: string) => string }) {
  if (!delivery) {
    return <s-banner tone="info" heading="Free delivery has not been read from Shopify yet">Open the Shipping page and the app will read your shipping settings. Until then no free delivery message is shown on the product page.</s-banner>;
  }
  const line = (entry: ReturnType<typeof freeDeliveryFor>) => !entry || !entry.free ? "No free delivery" : entry.thresholdMinor === 0 ? "Always free" : `Free over ${formatMinor(entry.thresholdMinor, delivery.currency)}`;
  const codes = Object.keys(delivery.countries).sort((a, b) => countryName(a).localeCompare(countryName(b), "en-GB"));
  const free = codes.filter(code => delivery.countries[code].free);
  return <s-stack direction="block" gap="small-300">
    <s-text type="strong">From your Shopify shipping settings</s-text>
    <s-text color="subdued">The product page tells each shopper about free delivery for their own country. Change the rates or thresholds in Shopify and this follows.</s-text>
    {free.length === 0 && !delivery.restOfWorld?.free && <s-banner tone="warning" heading="No free delivery found">None of your shipping zones offers free delivery, so no message is shown. The Shipping page recommends how to add it.</s-banner>}
    {free.slice(0, 12).map(code => <s-text key={code}>{countryName(code)}: {line(delivery.countries[code])}</s-text>)}
    {free.length > 12 && <s-text color="subdued">and {free.length - 12} more countries</s-text>}
    {delivery.restOfWorld?.free && <s-text>Everywhere else: {line(delivery.restOfWorld)}</s-text>}
    <s-stack direction="inline" gap="base"><s-link href={appUrl("/app/shipping")}>Review your shipping</s-link><s-link href="shopify://admin/settings/shipping">Shipping settings in Shopify</s-link></s-stack>
  </s-stack>;
}

/** The placeholders that can go in a message, with what each becomes for the example being previewed. Click one to copy it. */
function PlaceholderList({ examples, onCopy, placeholders = freePlaceholders, heading = "Placeholders you can use in these messages", exampleHeading = "For the country in the preview" }: {
  examples: Record<string, string>; onCopy: (placeholder: string) => void; placeholders?: ReadonlyArray<{ name: string; meaning: string; example: string }>; heading?: string; exampleHeading?: string;
}) {
  return <s-stack direction="block" gap="small-300">
    <s-text type="strong">{heading}</s-text>
    <s-text color="subdued">Click a placeholder to copy it, then paste it into a message. The product page fills it in for each shopper, and each can be used more than once.</s-text>
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Placeholder</s-table-header>
        <s-table-header>What it becomes</s-table-header>
        <s-table-header>{exampleHeading}</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {placeholders.map(item => <s-table-row key={item.name}>
          <s-table-cell><s-button type="button" variant="tertiary" accessibilityLabel={`Copy {${item.name}}`} onClick={() => onCopy(`{${item.name}}`)}>{`{${item.name}}`}</s-button></s-table-cell>
          <s-table-cell>{item.meaning}</s-table-cell>
          <s-table-cell>{examples[item.name] ?? item.example}</s-table-cell>
        </s-table-row>)}
      </s-table-body>
    </s-table>
  </s-stack>;
}

/** "Mon–Fri", "Mon–Sat", "Every day", or the days listed, for a summary line. */
function describeDays(days: boolean[]): string {
  const order = [1, 2, 3, 4, 5, 6, 0].filter(index => days[index]);
  if (order.length === 7) return "Every day";
  if (!order.length) return "No delivery days";
  const names = order.map(index => dayNames[index].slice(0, 3));
  const positions = order.map(index => (index + 6) % 7);
  const contiguous = positions.every((position, at) => at === 0 || position === positions[at - 1] + 1);
  return contiguous && order.length > 2 ? `${names[0]}–${names[names.length - 1]}` : names.join(", ");
}

const cardStyle: CSSProperties = { border: "1px solid #e3e3e3", borderRadius: 12, background: "#fff", minWidth: 0 };

/** One delivery service: what Shopify says about it, and what the app adds. Closed, it summarises its settings. */
function ServiceCard({ form, entry, orphan, currency, shopCutoff, onChange, onRemove }: {
  form: ServiceForm; entry: { zones: string[]; service: NonNullable<ReturnType<typeof serviceCatalogue>[number]["service"]> } | undefined; orphan: boolean; currency: string; shopCutoff: string; onChange: (changes: Partial<ServiceForm>) => void; onRemove: () => void;
}) {
  const typed = form.transitMin.trim() !== "" && form.transitMax.trim() !== "";
  const time = typed ? `${form.transitMin === form.transitMax ? form.transitMin : `${form.transitMin} to ${form.transitMax}`} business days (set here)` : entry?.service.transit ? `${transitText(entry.service.transit)} (Shopify)` : "no delivery time";
  const summary = `${form.guaranteed ? "Guaranteed" : "Non-guaranteed"} · ${describeDays(form.days)} · ${form.cutoffTime.trim() ? `cut-off ${form.cutoffTime.trim()}` : "the shop's cut-off"} · ${time}`;
  return <details data-service={form.name} style={cardStyle}>
    <summary style={{ cursor: "pointer", padding: 12, display: "grid", gap: 2 }}>
      <span style={{ fontWeight: 600, fontSize: 13, display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {form.label.trim() || form.name}
        {!form.show && <s-badge>Hidden</s-badge>}
        {orphan && <s-badge tone="warning">Not in Shopify now</s-badge>}
        {!entry?.service.transit && !typed && !orphan && <s-badge tone="warning">No delivery time</s-badge>}
      </span>
      <span style={{ fontSize: 12, color: "#616161" }}>{summary}</span>
    </summary>
    <div style={{ padding: "0 12px 12px", display: "grid", gap: 12 }}>
      {entry
        ? <s-text color="subdued">Shopify shipping option “{form.name}”, offered in {entry.zones.join(", ")}. {entry.service.tiers.length ? `Price: ${shippingLogic.servicePrice(entry.service, currency)}.` : ""} {entry.service.transit ? `Delivery time in Shopify: ${transitText(entry.service.transit)}.` : "Shopify has no delivery time for it, or it could not be read."}</s-text>
        : <s-banner tone="warning" heading="This option is no longer in your Shopify shipping settings">Its name may have changed in Shopify, which detaches these settings. It is not shown on the product page. Remove it, or set the same options up under its new name.</s-banner>}
      <PolarisCheckbox label="Show in the delivery options" checked={form.show} onChange={event => onChange({ show: event.currentTarget.checked })} />
      <s-text-field label="Name on the product page" value={form.label} placeholder={form.name} maxLength={120} details="Leave empty to use the Shopify name. Shorten it if it says things that are set here instead, such as the cut-off or “Non Guaranteed”." onInput={event => onChange({ label: event.currentTarget.value })} />
      <PolarisCheckbox label="Guaranteed by the carrier" checked={form.guaranteed} details="Leave off unless the carrier guarantees it. A guaranteed service says “Delivery by …”. Every other service adds “(Non-Guaranteed)”, so the shop never promises more than you chose." onChange={event => onChange({ guaranteed: event.currentTarget.checked })} />
      <PolarisCheckboxList label="Days the carrier delivers" values={form.days.map((on, index) => (on ? String(index) : "")).filter(Boolean)}
        options={[1, 2, 3, 4, 5, 6, 0].map(index => ({ value: String(index), label: dayNames[index] }))}
        onChange={values => onChange({ days: Array.from({ length: 7 }, (_, index) => values.includes(String(index))) })} />
      <PolarisCheckbox label="Delivers on bank holidays" checked={form.onBankHolidays} onChange={event => onChange({ onBankHolidays: event.currentTarget.checked })} />
      <s-text-field label="Cut-off time for this service" value={form.cutoffTime} placeholder={shopCutoff} details="24-hour London time. Leave empty to use the shop's cut-off." error={!form.cutoffTime.trim() || /^([01]\d|2[0-3]):[0-5]\d$/.test(form.cutoffTime.trim()) ? undefined : "Use a 24-hour time such as 14:00."} onInput={event => onChange({ cutoffTime: event.currentTarget.value })} />
      <s-grid gridTemplateColumns="1fr 1fr" gap="base" alignItems="start">
        <PolarisNumberField label="Shortest delivery time (business days)" min={0} max={60} step={1} value={form.transitMin} details={entry?.service.transit ? `Shopify has ${transitText(entry.service.transit)}. Fill in both to use your own.` : "Fill in both, or neither."} onInput={event => onChange({ transitMin: event.currentTarget.value })} />
        <PolarisNumberField label="Longest delivery time (business days)" min={0} max={60} step={1} value={form.transitMax} onInput={event => onChange({ transitMax: event.currentTarget.value })} />
      </s-grid>
      {orphan && <div><s-button type="button" variant="tertiary" tone="critical" onClick={onRemove}>Remove these settings</s-button></div>}
    </div>
  </details>;
}

/** Shown under a message that uses something in braces that is not a placeholder. */
const placeholderError = (text: string) => {
  const unknown = unknownPlaceholders(text);
  return unknown.length ? `${unknown.join(", ")} is not a placeholder. Use ${freePlaceholders.map(item => `{${item.name}}`).join(", ")}.` : undefined;
};

const when = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const stockScenarios: Record<string, { label: string; variant: StockVariant | null }> = {
  in: { label: "In stock", variant: null },
  out: { label: "Out of stock", variant: { available: false } },
  backorder: { label: "Zero stock, continue selling", variant: { available: true, policy: "continue", managed: true, qty: 0 } },
};

const stepOrder = ["appearance", "dispatch", "holidays", "delivery", "free", "stock", "delay", "warning"] as const;
type StepId = (typeof stepOrder)[number];
const stepTitles: Record<StepId, string> = { appearance: "Appearance", dispatch: "Dispatch", holidays: "Bank holidays", delivery: "Delivery services", delay: "Warehouse delay", free: "Free shipping", stock: "Out of stock and back-order", warning: "Warning notice" };

/** A card with the preview's own look, matching the promotion editor's preview panel. */
const panelStyle: CSSProperties = { border: "1px solid #e3e3e3", borderRadius: 12, background: "#fff", boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)", padding: 16, display: "grid", gap: 16, minWidth: 0 };

/**
 * The shipping countdown's settings, laid out like the promotion editor: the preview stays in view on the left and the settings are
 * numbered step cards on the right. Everything the theme block shows is decided here. The preview runs the storefront's own logic file, so
 * what it says is what shoppers get.
 */
export function ShippingCountdownPage({ initial, saved, today, delivery, services, fetcher }: { initial: ShippingCountdownConfig; saved: boolean; today: string; delivery: FreeDeliveryTable | null; services?: PublishedServices | null; fetcher: FetcherWithComponents<ShippingResult> }) {
  const appUrl = useEmbeddedAppUrl();
  const shopify = useAppBridge();
  const published = services ?? null;
  const [baseline, setBaseline] = useState(() => toForm(initial, published));
  const [form, setForm] = useState(baseline);
  const [error, setError] = useState<string | null>(null);
  const [firstSave, setFirstSave] = useState(!saved);
  const sent = useRef<string | null>(null);
  const [openStep, setOpenStep] = useState<StepId | null>("appearance");
  const [previewOpen, setPreviewOpen] = useState(false);
  // Countries to preview: those in either published table (free delivery, delivery services), and "everywhere else" when either has it.
  const previewCodes = [...new Set([...Object.keys(delivery?.countries ?? {}), ...Object.keys(published?.countries ?? {})])];
  const hasRestOfWorld = Boolean(delivery?.restOfWorld || published?.restOfWorld);
  const [previewCountry, setPreviewCountry] = useState(() => (previewCodes.includes("GB") ? "GB" : previewCodes[0] ?? "*"));
  // A chosen London day and time, as "2026-12-24T16:30:00", or empty to follow the real clock.
  const [sample, setSample] = useState("");
  const [stock, setStock] = useState("in");
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const set = (changes: Partial<Form>) => setForm(current => ({ ...current, ...changes }));
  const setLook = (changes: Partial<Form["look"]>) => setForm(current => ({ ...current, look: { ...current.look, ...changes } }));

  const { problems, input } = useMemo(() => toInput(form), [form]);
  const check = useMemo(() => validateShippingConfig(input), [input]);
  const errors = [...problems, ...(check.ok ? [] : check.errors)];
  const dirty = firstSave || JSON.stringify(form) !== JSON.stringify(baseline);
  const saving = fetcher.state !== "idle" && sent.current === "save";
  const importing = fetcher.state !== "idle" && sent.current === "import";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !sent.current) return;
    const intent = sent.current;
    sent.current = null;
    if (!fetcher.data.ok) { setError(fetcher.data.errors.join(" ")); return; }
    setError(null);
    if (intent === "save" && fetcher.data.config) {
      const next = toForm(fetcher.data.config, published);
      setBaseline(next); setForm(next); setFirstSave(false);
      shopify.toast.show("Shipping countdown saved");
    }
    if (intent === "import") {
      const found = fetcher.data.dates ?? [];
      setForm(current => {
        const existing = parseBankHolidays(current.holidays).dates;
        const added = found.filter(date => !existing.includes(date));
        shopify.toast.show(added.length ? `Added ${added.length} bank holiday${added.length === 1 ? "" : "s"}` : "No new bank holidays to add");
        return { ...current, holidays: [...new Set([...existing, ...found])].sort().join("\n") };
      });
    }
  }, [fetcher.state, fetcher.data, shopify, published]);

  async function copyPlaceholder(placeholder: string) {
    try { await window.navigator.clipboard.writeText(placeholder); shopify.toast.show(`Copied ${placeholder}`); }
    catch { shopify.toast.show("Could not copy. Type it in braces instead.", { isError: true }); }
  }

  const setDelivery = (changes: Partial<DeliveryForm>) => setForm(current => ({ ...current, delivery: { ...current.delivery, ...changes } }));
  const setService = (name: string, changes: Partial<ServiceForm>) => setForm(current => ({ ...current, delivery: { ...current.delivery, services: current.delivery.services.map(item => (item.name === name ? { ...item, ...changes } : item)) } }));
  const catalogue = published ? serviceCatalogue(published) : [];
  const deliveryPlaceholderError = (text: string) => {
    const unknown = unknownPlaceholders(text, deliveryPlaceholders);
    return unknown.length ? `${unknown.join(", ")} is not a placeholder. Use ${deliveryPlaceholders.map(item => `{${item.name}}`).join(", ")}.` : undefined;
  };

  const send = (values: Record<string, string>) => { sent.current = values.intent; fetcher.submit(values, { method: "post" }); };
  const save = () => { if (check.ok && problems.length === 0) send({ intent: "save", config: JSON.stringify(check.config) }); };

  // The preview: the real logic, at the day and time chosen (London), or now.
  const sampleMs = now === null ? null : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(sample) ? shippingLogic.londonTimeToUtc(sample.slice(0, 10), Number(sample.slice(11, 13)), Number(sample.slice(14, 16))) : now;
  const config = check.ok && problems.length === 0 ? check.config : null;
  const scenario = stockScenarios[stock] ?? stockScenarios.in;
  const view = config && sampleMs !== null ? shippingLogic.dispatchView(sampleMs, config, scenario.variant) : null;
  const entry = delivery ? (previewCountry === "*" ? delivery.restOfWorld : freeDeliveryFor(delivery, previewCountry)) : null;
  const freeText = config && delivery && entry?.free && stock !== "out"
    ? shippingLogic.freeShippingMessage(config.freeShipping, { threshold: entry.thresholdMinor, thresholdCurrency: delivery.currency, country: previewCountry === "*" ? "your country" : countryName(previewCountry), rate: entry.rate, cartCurrency: delivery.currency, cartTotal: 0, itemPrice: 0, quantity: 1 }).text
    : "";
  const examples: Record<string, string> = delivery && entry?.free
    ? { threshold: formatMinor(entry.thresholdMinor, delivery.currency), country: previewCountry === "*" ? "your country" : countryName(previewCountry), rate: entry.rate }
    : {};
  const serviceList = published ? (previewCountry === "*" ? servicesFor({ ...published, countries: {} }, "") : servicesFor(published, previewCountry)) : [];
  const deliveryLines = config && published && sampleMs !== null && config.delivery.enabled ? shippingLogic.deliveryOptions(sampleMs, config, serviceList, published.currency, scenario.variant) : [];
  const deliveryExamples: Record<string, string> = deliveryLines[0]
    ? { date: shippingLogic.formatDeliveryDate(deliveryLines[0].to, form.delivery.showMonth), from: shippingLogic.formatDeliveryDate(deliveryLines[0].from, form.delivery.showMonth), service: deliveryLines[0].label }
    : {};
  const warningShowing = Boolean(config && sampleMs !== null && shippingLogic.warningVisible(sampleMs, config.warning));
  const shownAt = sampleMs === null ? "" : new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(sampleMs);

  const previewPanel = <div style={panelStyle}>
    <s-stack direction="block" gap="small-300">
      <s-heading>Storefront preview</s-heading>
      <s-text color="subdued">The product page&rsquo;s own markup, stylesheet and logic, in London time. It updates as you change a setting.</s-text>
    </s-stack>
    <s-stack direction="block" gap="base">
      <DateTimeField label="Preview day and time (London)" value={sample} onChange={setSample} />
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-text color="subdued">{sample ? `Showing ${shownAt}` : `Showing now: ${shownAt}`}</s-text>
        {sample && <s-button type="button" variant="tertiary" onClick={() => setSample("")}>Use the current time</s-button>}
      </s-stack>
      <PolarisSelect label="Stock of the chosen variant" value={stock} onChange={event => setStock(event.currentTarget.value)}>
        {Object.entries(stockScenarios).map(([id, item]) => <s-option key={id} value={id}>{item.label}</s-option>)}
      </PolarisSelect>
      {previewCodes.length > 0 && <PolarisSelect label="Country of the shopper" value={previewCountry} onChange={event => setPreviewCountry(event.currentTarget.value)}>
        {[...previewCodes].sort((a, b) => countryName(a).localeCompare(countryName(b), "en-GB")).map(code => <s-option key={code} value={code}>{countryName(code)}</s-option>)}
        {hasRestOfWorld && <s-option value="*">Everywhere else</s-option>}
      </PolarisSelect>}
    </s-stack>
    {view === null || config === null
      ? <s-banner tone="warning">Fix the problem shown above the settings to see a preview.</s-banner>
      : <div style={{ border: "1px solid #e3e3e3", borderRadius: 8, padding: 16, background: "#fff", display: "grid", gap: 4 }}>
        <span style={{ fontSize: 13, color: "#616161" }}>Product page</span>
        <span style={{ fontWeight: 600 }}>Example product</span>
        <span>£9.99</span>
        <ShippingPreview config={config} view={view} freeText={freeText} warningShowing={warningShowing} options={deliveryLines} />
        <span aria-hidden="true" style={{ background: "#202223", color: "#fff", borderRadius: 8, padding: "10px 16px", textAlign: "center", fontSize: 14 }}>Add to basket</span>
      </div>}
  </div>;

  const step = (id: StepId, summary: string, children: ReactNode) => (
    <FormStep id={id} number={stepOrder.indexOf(id) + 1} title={stepTitles[id]} summary={summary} open={openStep === id} onToggle={open => setOpenStep(open ? id : current => (current === id ? null : current))}>
      {children}
    </FormStep>
  );
  const dispatchDays = [1, 2, 3, 4, 5, 6, 0].filter(index => form.days[index]).map(index => dayNames[index].slice(0, 3)).join(", ");
  const holidayCount = parseBankHolidays(form.holidays).dates.length;
  const stockSummary = `Out of stock: ${form.outMode === "hide" ? "hidden" : "message"} · Zero stock, continue selling: ${form.backMode === "hide" ? "hidden" : "message"}`;

  return <s-page heading="Shipping countdown" inlineSize="large">
    <s-link slot="breadcrumb-actions" href={appUrl("/app")}>Home</s-link>
    <s-button slot="secondary-actions" data-preview-toggle="" onClick={() => setPreviewOpen(true)}>Preview</s-button>
    <PromotionSaveBar dirty={dirty} saving={saving} issue={errors[0] ?? null} showWhileIncomplete onSave={save} onDiscard={() => { setForm(baseline); setError(null); setFirstSave(false); }} />
    <s-stack direction="block" gap="base">
      <SaveNotices error={error} issue={errors.length ? errors[0] : null} onDismissError={() => setError(null)} />
      {!saved && <s-banner tone="info" heading="Nothing is saved yet">These are starting values. Check each step, then save. The product page block shows nothing until settings are saved.</s-banner>}

      <div className="create-discount-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
        <aside className="desktop-preview-panel" style={{ position: "sticky", top: 20, maxHeight: "calc(100vh - 40px)", overflowY: "auto", scrollbarGutter: "stable", padding: 3, alignSelf: "start" }}>
          {previewPanel}
        </aside>

        <div>
          <s-stack direction="block" gap="large">
            {step("appearance", `${{ left: "Left", center: "Centre", right: "Right" }[form.look.align] ?? form.look.align} · ${form.look.textSize}px text · ${form.look.border === "none" ? "no border" : `${form.look.border} border`}`, <>
              <s-text color="subdued">How the block looks on the product page. The theme editor only decides where it goes.</s-text>
              <s-grid gridTemplateColumns="1fr 1fr" gap="base" alignItems="start">
                <PolarisSelect label="Text alignment" value={form.look.align} onChange={event => setLook({ align: event.currentTarget.value })}>
                  <s-option value="left">Left</s-option><s-option value="center">Centre</s-option><s-option value="right">Right</s-option>
                </PolarisSelect>
                <PolarisSelect label="Font weight" value={form.look.fontWeight} onChange={event => setLook({ fontWeight: event.currentTarget.value })}>
                  <s-option value="400">Normal</s-option><s-option value="500">Medium</s-option><s-option value="600">Semibold</s-option><s-option value="700">Bold</s-option>
                </PolarisSelect>
                <PolarisNumberField label="Text size (px)" min={12} max={24} step={1} value={form.look.textSize} details="The days line and the icon scale with it." onInput={event => setLook({ textSize: event.currentTarget.value })} />
                <PolarisSelect label="Padding" value={form.look.padding} onChange={event => setLook({ padding: event.currentTarget.value })}>
                  <s-option value="compact">Compact</s-option><s-option value="standard">Standard</s-option><s-option value="roomy">Roomy</s-option>
                </PolarisSelect>
                <PolarisSelect label="Border" value={form.look.border} onChange={event => setLook({ border: event.currentTarget.value })}>
                  <s-option value="double">Double</s-option><s-option value="solid">Solid</s-option><s-option value="none">None</s-option>
                </PolarisSelect>
                <PolarisNumberField label="Border width (px)" min={1} max={10} step={1} disabled={form.look.border === "none"} value={form.look.borderWidth} onInput={event => setLook({ borderWidth: event.currentTarget.value })} />
                <PolarisNumberField label="Corner radius (px)" min={0} max={20} step={1} value={form.look.radius} onInput={event => setLook({ radius: event.currentTarget.value })} />
                <PolarisNumberField label="Space above and below (px)" min={0} max={40} step={1} value={form.look.margin} onInput={event => setLook({ margin: event.currentTarget.value })} />
                <PolarisNumberField label="Space between lines (px)" min={0} max={24} step={1} value={form.look.lineGap} details="The same gap between every line in the block." onInput={event => setLook({ lineGap: event.currentTarget.value })} />
              </s-grid>
              <PolarisCheckbox label="Show the clock icon" checked={form.look.showIcon} onChange={event => setLook({ showIcon: event.currentTarget.checked })} />
              <section aria-label="Colours" style={{ display: "grid", gap: 12, borderTop: "1px solid #e3e3e3", paddingTop: 16 }}>
                <s-heading>Colours</s-heading>
                <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                  <ColourField label="Background" value={form.look.background} onChange={value => setLook({ background: value })} />
                  <ColourField label="Text" value={form.look.text} onChange={value => setLook({ text: value })} />
                  <ColourField label="Time left" value={form.look.accent} onChange={value => setLook({ accent: value })} />
                  <ColourField label="Dispatch day and border" value={form.look.dispatch} onChange={value => setLook({ dispatch: value })} />
                  <ColourField label="Secondary text" value={form.look.muted} onChange={value => setLook({ muted: value })} />
                  <ColourField label="Icon" value={form.look.icon} onChange={value => setLook({ icon: value })} />
                </s-grid>
                {config && contrastNotes(config).length > 0 && <s-banner tone="warning" heading="Some text may be hard to read">
                  {contrastNotes(config).map(item => `${item.label} on its background is ${item.ratio.toFixed(1)} to 1`).join("; ")}. Aim for at least 4.5 to 1 for text, or 3 to 1 for the icon.
                </s-banner>}
                <div><s-button type="button" variant="tertiary" onClick={() => set({ look: toForm(defaultShippingConfig).look })}>Reset appearance to the original look</s-button></div>
              </section>
            </>)}

            {step("dispatch", `Cut-off ${form.cutoffTime || "not set"} · ${dispatchDays || "no days chosen"}`, <>
              <TextField label="Daily cut-off time" value={form.cutoffTime} onChange={value => set({ cutoffTime: value })} details="24-hour London time, for example 15:00. Orders placed before it go out the same day." error={/^([01]\d|2[0-3]):[0-5]\d$/.test(form.cutoffTime.trim()) ? undefined : "Use a 24-hour time such as 15:00."} />
              <PolarisCheckboxList label="Days orders are dispatched" values={form.days.map((on, index) => on ? String(index) : "").filter(Boolean)}
                options={[1, 2, 3, 4, 5, 6, 0].map(index => ({ value: String(index), label: dayNames[index] }))}
                onChange={values => set({ days: Array.from({ length: 7 }, (_, index) => values.includes(String(index))) })} />
              <PolarisCheckbox label="Show the dispatch days under the message" checked={form.showShippingDays} onChange={event => set({ showShippingDays: event.currentTarget.checked })} />
              <RichTextField accent={form.look.accent} label="Shipping days prefix" value={form.shippingDaysPrefix} onChange={value => set({ shippingDaysPrefix: value })} details="Shown before the list of days, for example “We ship on:”." />
              <RichTextField accent={form.look.accent} label="Countdown prefix" value={form.countdownPrefix} onChange={value => set({ countdownPrefix: value })} details="Before the time left, for example “Order in the next”." />
              <RichTextField accent={form.look.accent} label="Countdown suffix" value={form.countdownSuffix} onChange={value => set({ countdownSuffix: value })} details="Between the time left and the dispatch day, for example “for dispatch on”." />
              <RichTextField accent={form.look.accent} label="No dispatch day text" value={form.noShippingText} onChange={value => set({ noShippingText: value })} details="Shown when no dispatch day is found in the next 30 days." />
              <RichTextField accent={form.look.accent} label="Error text" value={form.errorText} onChange={value => set({ errorText: value })} details="Shown if the settings cannot be read." />
              <PolarisCheckbox label="Hide the block when no dispatch day is available" checked={form.hideIfUnavailable} onChange={event => set({ hideIfUnavailable: event.currentTarget.checked })} />
            </>)}

            {step("holidays", holidayCount ? `${holidayCount} date${holidayCount === 1 ? "" : "s"} listed` : "None listed", <>
              <TextField label="Bank holidays (no dispatch)" multiline value={form.holidays} onChange={value => set({ holidays: value })} details="One date per line, written YYYY-MM-DD, for example 2026-12-25." />
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button type="button" variant="secondary" loading={importing || undefined} disabled={importing || undefined} onClick={() => send({ intent: "import" })}>Import UK bank holidays</s-button>
                <s-text color="subdued">Adds upcoming England and Wales dates from gov.uk. Dates already listed are kept. Save to apply.</s-text>
              </s-stack>
              {(() => { const list = parseBankHolidays(form.holidays).dates; const next = list.filter(date => date >= today); return <s-text color="subdued">{list.length} date{list.length === 1 ? "" : "s"} listed{next.length ? `, next: ${when(next[0])}` : ""}{list.length > 0 && next.length === 0 ? ". All of them are in the past, so import the new ones" : ""}.</s-text>; })()}
            </>)}

            {step("delivery", form.delivery.enabled ? `On, ${form.delivery.services.filter(item => item.show).length} service${form.delivery.services.filter(item => item.show).length === 1 ? "" : "s"} shown` : "Off", <>
              <PolarisCheckbox label="Show delivery options on the product page" checked={form.delivery.enabled} details="A dropdown under the dispatch message listing each service for the shopper's country, with its price and the date it should arrive." onChange={event => setDelivery({ enabled: event.currentTarget.checked })} />
              {form.delivery.enabled && <>
                <s-text color="subdued">Each service is a shipping option from your Shopify shipping settings, with its price and delivery time read from there. Here you add what Shopify does not hold: whether it is guaranteed, the days the carrier delivers, and a cut-off if it differs. Delivery times count only the days each carrier delivers, and skip bank holidays.</s-text>
                <RichTextField accent={form.look.accent} label="Dropdown heading" value={form.delivery.heading} onChange={value => setDelivery({ heading: value })} details="For example “Delivery options”." />
                <RichTextField accent={form.look.accent} label="Message for a guaranteed service" lines={2} value={form.delivery.guaranteedText} onChange={value => setDelivery({ guaranteedText: value })} error={deliveryPlaceholderError(form.delivery.guaranteedText)} details="For example “Delivery by {date}”." />
                <RichTextField accent={form.look.accent} label="Message for a service that is not guaranteed" lines={2} value={form.delivery.estimatedText} onChange={value => setDelivery({ estimatedText: value })} error={deliveryPlaceholderError(form.delivery.estimatedText)} details="For example “Delivery by {date} (Non-Guaranteed)”. This is what every service says unless you set it as guaranteed." />
                <PlaceholderList placeholders={deliveryPlaceholders} examples={deliveryExamples} onCopy={copyPlaceholder} heading="Placeholders you can use in the delivery messages" exampleHeading="For the first service in the preview" />
                <PolarisCheckbox label="Show the month in dates" checked={form.delivery.showMonth} details="“Wed 28th Oct” instead of “Wed 28th”." onChange={event => setDelivery({ showMonth: event.currentTarget.checked })} />
                <section aria-label="Services" style={{ display: "grid", gap: 8, borderTop: "1px solid #e3e3e3", paddingTop: 16 }}>
                  <s-heading>Services</s-heading>
                  {published === null
                    ? <s-banner tone="info" heading="Delivery services have not been read from Shopify yet">Open the Shipping page and the app will read your shipping options. Until then no delivery options are shown on the product page.</s-banner>
                    : form.delivery.services.length === 0
                      ? <s-banner tone="warning" heading="No delivery services found">Your Shopify shipping settings have no fixed-rate options for the general profile. The Shipping page shows what was read.</s-banner>
                      : form.delivery.services.map(item => <ServiceCard key={item.name} form={item} entry={catalogue.find(entry => entry.name === item.name)} orphan={!catalogue.some(entry => entry.name === item.name)} currency={published.currency} shopCutoff={form.cutoffTime || "the shop's cut-off"} onChange={changes => setService(item.name, changes)} onRemove={() => setDelivery({ services: form.delivery.services.filter(other => other.name !== item.name) })} />)}
                  <div><s-link href={appUrl("/app/shipping")}>Review your shipping</s-link></div>
                </section>
              </>}
            </>)}

            {step("free", form.freeEnabled ? "On, read from your Shopify shipping settings" : "Off", <>
              <PolarisCheckbox label="Show the free delivery message" checked={form.freeEnabled} onChange={event => set({ freeEnabled: event.currentTarget.checked })} />
              {form.freeEnabled && <>
                <DeliveryFromShopify delivery={delivery} appUrl={appUrl} />
                <PlaceholderList examples={examples} onCopy={copyPlaceholder} />
                <RichTextField accent={form.look.accent} label="Message when under the threshold" value={form.textUnder} onChange={value => set({ textUnder: value })} error={placeholderError(form.textUnder)} details="For example “Free delivery to {country} on orders over {threshold}”." />
                <RichTextField accent={form.look.accent} label="Message when this item would reach it" value={form.textAdd} onChange={value => set({ textAdd: value })} error={placeholderError(form.textAdd)} details="Uses the selected variant and quantity. An out of stock variant never counts. For example “Add this item to get {rate}”." />
                <RichTextField accent={form.look.accent} label="Message when the cart has reached it" value={form.textOver} onChange={value => set({ textOver: value })} error={placeholderError(form.textOver)} details="Also shown where delivery is always free. For example “You have unlocked {rate}!”." />
              </>}
            </>)}

            {step("stock", stockSummary, <>
              <s-text color="subdued">No dispatch date is promised for either of these, because it cannot be dispatched now. Choose what shoppers see instead.</s-text>
              <section aria-label="Out of stock" style={{ display: "grid", gap: 12 }}>
                <s-heading>Out of stock</s-heading>
                <s-text color="subdued">The chosen variant is unavailable: it has no stock and cannot be bought.</s-text>
                <PolarisRadioList label="What to show" value={form.outMode} options={[{ value: "message", label: "Show a message instead" }, { value: "hide", label: "Hide the dispatch line" }]} onChange={value => set({ outMode: value === "hide" ? "hide" : "message" })} />
                {form.outMode === "message" && <RichTextField accent={form.look.accent} label="Message" lines={3} value={form.outMessage} onChange={value => set({ outMessage: value })} />}
              </section>
              <section aria-label="Zero stock, continue selling" style={{ display: "grid", gap: 12, borderTop: "1px solid #e3e3e3", paddingTop: 16 }}>
                <s-heading>Zero stock, continue selling</s-heading>
                <s-text color="subdued">The chosen variant has no stock, but &ldquo;Continue selling when out of stock&rdquo; is on, so it can still be bought (a back-order or pre-order). Stock must be tracked for Shopify to report zero.</s-text>
                <PolarisRadioList label="What to show" value={form.backMode} options={[{ value: "message", label: "Show a message instead" }, { value: "hide", label: "Hide the dispatch line" }]} onChange={value => set({ backMode: value === "hide" ? "hide" : "message" })} />
                {form.backMode === "message" && <RichTextField accent={form.look.accent} label="Message" lines={3} value={form.backMessage} onChange={value => set({ backMessage: value })} />}
              </section>
            </>)}

            {step("delay", Number(form.delayDays) > 0 ? `On: dispatch from ${form.delayDays} dispatch day${Number(form.delayDays) === 1 ? "" : "s"} away` : "Off", <>
              <PolarisNumberField label="Delay in dispatch days" min={0} max={60} step={1} value={form.delayDays} details="0 is off. Otherwise the countdown is replaced by dispatch from the Nth dispatch day after today, whatever the time of day." onInput={event => set({ delayDays: event.currentTarget.value })} />
              <RichTextField accent={form.look.accent} label="Delay message" lines={3} value={form.delayMessage} onChange={value => set({ delayMessage: value })} details="The dispatch date follows this text. Select words and use Highlight to colour them like the countdown." />
            </>)}

            {step("warning", form.warnEnabled ? (form.warnStart && form.warnEnd ? `${when(form.warnStart)} to ${when(form.warnEnd)}` : "On, dates not set") : "Off", <>
              <PolarisCheckbox label="Show a warning notice, for example a Christmas cut-off" checked={form.warnEnabled} onChange={event => set({ warnEnabled: event.currentTarget.checked })} />
              {form.warnEnabled && <>
                <s-grid gridTemplateColumns="1fr 1fr" gap="base" alignItems="start">
                  <DateField label="First day shown" value={form.warnStart} onChange={value => set({ warnStart: value })} />
                  <DateField label="Last day shown" value={form.warnEnd} onChange={value => set({ warnEnd: value })} />
                </s-grid>
                <RichTextField accent={form.look.accent} label="Message" lines={3} value={form.warnMessage} onChange={value => set({ warnMessage: value })} details="Shown above the dispatch message on both days and every day between, by London's date." />
                <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
                  <ColourField label="Text colour" value={form.warnText} onChange={value => set({ warnText: value })} />
                  <ColourField label="Background colour" value={form.warnBackground} onChange={value => set({ warnBackground: value })} />
                  <ColourField label="Border colour" value={form.warnBorder} onChange={value => set({ warnBorder: value })} />
                </s-grid>
              </>}
            </>)}
          </s-stack>
        </div>
      </div>

      <ModalOverlay open={previewOpen} heading="Storefront preview" size="large" onClose={() => setPreviewOpen(false)}>
        {previewPanel}
        <s-button slot="secondary-actions" onClick={() => setPreviewOpen(false)}>Close</s-button>
      </ModalOverlay>
      <style>{editorCss}</style>
    </s-stack>
  </s-page>;
}
