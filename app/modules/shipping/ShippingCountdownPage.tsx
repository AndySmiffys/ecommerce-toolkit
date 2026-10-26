import { createElement, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { FetcherWithComponents } from "react-router";
import { useEmbeddedAppUrl } from "../navigation/embeddedAppUrl";
import { PromotionSaveBar } from "../promotions/components/PromotionSaveBar";
import { SaveNotices } from "../promotions/components/SaveNotices";
import { DateField } from "../promotions/components/DateTimeField";
import { PolarisCheckbox, PolarisCheckboxList, PolarisNumberField, PolarisRadioList, PolarisSelect } from "../promotions/components/PolarisControls";
import { contrastRatio } from "../promotions/design/design";
import blockCss from "../../../extensions/promotion-engine/assets/shipping-countdown.css?raw";
import { dayNames, defaultShippingConfig, parseBankHolidays, validateShippingConfig, type ShippingCountdownConfig } from "./config";
import { formatMinor } from "./delivery/deliveryModel";
import { freeDeliveryFor, type FreeDeliveryTable } from "./delivery/freeService";
import { shippingLogic } from "./logic";
import { styleAttributes } from "./appearance";

export type ShippingResult = { ok: boolean; intent: string; errors: string[]; config?: ShippingCountdownConfig; dates?: string[] };

type Form = {
  cutoffTime: string; days: boolean[]; holidays: string; delayDays: string; delayMessage: string;
  hideIfUnavailable: boolean; showShippingDays: boolean; shippingDaysPrefix: string; noShippingText: string; errorText: string;
  countdownPrefix: string; countdownSuffix: string;
  freeEnabled: boolean; textUnder: string; textAdd: string; textOver: string;
  preorderMode: "message" | "hide"; preorderMessage: string;
  warnEnabled: boolean; warnStart: string; warnEnd: string; warnMessage: string; warnText: string; warnBackground: string; warnBorder: string;
  look: { align: string; showIcon: boolean; textSize: string; fontWeight: string; padding: string; margin: string; radius: string; border: string; borderWidth: string; background: string; text: string; accent: string; dispatch: string; muted: string; icon: string };
};

const toForm = (c: ShippingCountdownConfig): Form => ({
  cutoffTime: c.cutoffTime, days: c.shippingDays, holidays: c.bankHolidays.join("\n"), delayDays: String(c.delayDays), delayMessage: c.delayMessage,
  hideIfUnavailable: c.hideIfUnavailable, showShippingDays: c.showShippingDays, shippingDaysPrefix: c.shippingDaysPrefix, noShippingText: c.noShippingText,
  errorText: c.errorText, countdownPrefix: c.countdownPrefix, countdownSuffix: c.countdownSuffix,
  freeEnabled: c.freeShipping.enabled,
  textUnder: c.freeShipping.textUnder, textAdd: c.freeShipping.textAdd, textOver: c.freeShipping.textOver,
  preorderMode: c.availability.preorderMode, preorderMessage: c.availability.preorderMessage,
  warnEnabled: c.warning.enabled, warnStart: c.warning.startDate, warnEnd: c.warning.endDate, warnMessage: c.warning.message,
  warnText: c.warning.textColor, warnBackground: c.warning.backgroundColor, warnBorder: c.warning.borderColor,
  look: { ...c.style, textSize: String(c.style.textSize), margin: String(c.style.margin), radius: String(c.style.radius), borderWidth: String(c.style.borderWidth) },
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
      availability: { preorderMode: f.preorderMode, preorderMessage: f.preorderMessage },
      warning: { enabled: f.warnEnabled, startDate: f.warnStart, endDate: f.warnEnd, message: f.warnMessage, textColor: f.warnText, backgroundColor: f.warnBackground, borderColor: f.warnBorder },
      style: f.look,
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

/** The block exactly as the product page builds it (same markup, same stylesheet, same variables), so the look can be judged here. */
function ShippingPreview({ config, view, freeText, warningShowing }: { config: ShippingCountdownConfig; view: Dispatch; freeText: string; warningShowing: boolean }) {
  const { data, vars } = styleAttributes(config.style);
  const days = [1, 2, 3, 4, 5, 6, 0].filter(index => config.shippingDays[index]).map(index => dayNames[index]).join(", ");
  const warningVars = { "--sc-warn-text": config.warning.textColor, "--sc-warn-bg": config.warning.backgroundColor, "--sc-warn-border": config.warning.borderColor } as CSSProperties;
  return <>
    <style>{blockCss}</style>
    {createElement("shipping-countdown", { className: "sc", ...data, style: vars as CSSProperties },
      warningShowing && <div className="sc__warning" style={warningVars}>⚠️ {config.warning.message}</div>,
      <div className="sc__content">
        {config.style.showIcon && <svg className="sc__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></svg>}
        {freeText && <p className="sc__free">{freeText}</p>}
        <p className="sc__main">
          {view.kind === "countdown" && <>{config.countdownPrefix} <span className="sc__countdown">{view.countdown}</span> {config.countdownSuffix} <span className="sc__dispatch">{view.date}</span></>}
          {view.kind === "delay" && <>{shippingLogic.parseHighlight(config.delayMessage).map((piece, index) => piece.highlight ? <span key={index} className="sc__countdown">{piece.text}</span> : <span key={index}>{piece.text}</span>)} <span className="sc__dispatch">{view.date}</span></>}
          {view.kind === "none" && <span className="sc__expired">{config.noShippingText}</span>}
          {view.kind === "error" && config.errorText}
          {view.kind === "hidden" && "The block is hidden: no dispatch day is available and Hide when unavailable is on."}
          {view.kind === "preorder" && config.availability.preorderMessage}
        </p>
        {config.showShippingDays && days && <p className="sc__days">{config.shippingDaysPrefix} {days}</p>}
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

const when = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * The shipping countdown's settings. Everything the theme block shows is decided here: the block itself only has its look. The preview
 * runs the storefront's own logic file, so what it says is what shoppers get.
 */
export function ShippingCountdownPage({ initial, saved, today, delivery, fetcher }: { initial: ShippingCountdownConfig; saved: boolean; today: string; delivery: FreeDeliveryTable | null; fetcher: FetcherWithComponents<ShippingResult> }) {
  const appUrl = useEmbeddedAppUrl();
  const shopify = useAppBridge();
  const [baseline, setBaseline] = useState(() => toForm(initial));
  const [form, setForm] = useState(baseline);
  const [error, setError] = useState<string | null>(null);
  const [firstSave, setFirstSave] = useState(!saved);
  const sent = useRef<string | null>(null);
  const [previewCountry, setPreviewCountry] = useState(() => (delivery?.countries.GB ? "GB" : Object.keys(delivery?.countries ?? {})[0] ?? "*"));
  const [sampleDate, setSampleDate] = useState("");
  const [sampleTime, setSampleTime] = useState("");
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); }, []);
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
      const next = toForm(fetcher.data.config);
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
  }, [fetcher.state, fetcher.data, shopify]);

  const send = (values: Record<string, string>) => { sent.current = values.intent; fetcher.submit(values, { method: "post" }); };
  const save = () => { if (check.ok && problems.length === 0) send({ intent: "save", config: JSON.stringify(check.config) }); };

  // The preview: the real logic, at the moment chosen (London time), or now.
  const sampleOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(sampleTime);
  const sampleMs = now === null ? null : sampleDate ? shippingLogic.londonTimeToUtc(sampleDate, sampleOk ? Number(sampleTime.slice(0, 2)) : 12, sampleOk ? Number(sampleTime.slice(3)) : 0) : now;
  const config = check.ok && problems.length === 0 ? check.config : null;
  const view = config && sampleMs !== null ? shippingLogic.dispatchView(sampleMs, config, null) : null;
  const entry = delivery ? (previewCountry === "*" ? delivery.restOfWorld : freeDeliveryFor(delivery, previewCountry)) : null;
  const freeText = config && delivery && entry?.free
    ? shippingLogic.freeShippingMessage(config.freeShipping, { threshold: entry.thresholdMinor, thresholdCurrency: delivery.currency, country: previewCountry === "*" ? "your country" : countryName(previewCountry), cartCurrency: delivery.currency, cartTotal: 0, itemPrice: 0, quantity: 1 }).text
    : "";
  const warningShowing = Boolean(config && sampleMs !== null && shippingLogic.warningVisible(sampleMs, config.warning));

  return <s-page heading="Shipping countdown" inlineSize="large">
    <s-link slot="breadcrumb-actions" href={appUrl("/app")}>Home</s-link>
    <PromotionSaveBar dirty={dirty} saving={saving} issue={errors[0] ?? null} showWhileIncomplete onSave={save} onDiscard={() => { setForm(baseline); setError(null); setFirstSave(false); }} />
    <s-stack direction="block" gap="base">
      <SaveNotices error={error} issue={errors.length ? errors[0] : null} onDismissError={() => setError(null)} />
      {!saved && <s-banner tone="info" heading="Nothing is saved yet">These are starting values. Check each section, then save. The product page block shows nothing until settings are saved.</s-banner>}

      <s-section heading="Preview">
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="1fr 1fr" gap="base" alignItems="start">
            <DateField label="Date to preview (London). Leave empty for now" value={sampleDate} onChange={setSampleDate} />
            <TextField label="Time to preview (24-hour)" value={sampleTime} onChange={setSampleTime} details="For example 16:30. Used only with a date." />
          </s-grid>
          {delivery && <PolarisSelect label="Country to preview" value={previewCountry} onChange={event => setPreviewCountry(event.currentTarget.value)}>
            {Object.keys(delivery.countries).sort((a, b) => countryName(a).localeCompare(countryName(b), "en-GB")).map(code => <s-option key={code} value={code}>{countryName(code)}</s-option>)}
            {delivery.restOfWorld && <s-option value="*">Everywhere else</s-option>}
          </PolarisSelect>}
          {view === null || config === null
            ? <s-banner tone="warning">Fix the problem above to see a preview.</s-banner>
            : <ShippingPreview config={config} view={view} freeText={freeText} warningShowing={warningShowing} />}
          <s-text color="subdued">The preview is the product page&rsquo;s own markup and stylesheet, with the same logic and London time.</s-text>
        </s-stack>
      </s-section>

      <s-section heading="Dispatch">
        <s-stack direction="block" gap="base">
          <TextField label="Daily cut-off time" value={form.cutoffTime} onChange={value => set({ cutoffTime: value })} details="24-hour London time, for example 15:00. Orders placed before it go out the same day." error={/^([01]\d|2[0-3]):[0-5]\d$/.test(form.cutoffTime.trim()) ? undefined : "Use a 24-hour time such as 15:00."} />
          <PolarisCheckboxList label="Days orders are dispatched" values={form.days.map((on, index) => on ? String(index) : "").filter(Boolean)}
            options={[1, 2, 3, 4, 5, 6, 0].map(index => ({ value: String(index), label: dayNames[index] }))}
            onChange={values => set({ days: Array.from({ length: 7 }, (_, index) => values.includes(String(index))) })} />
          <PolarisCheckbox label="Show the dispatch days under the message" checked={form.showShippingDays} onChange={event => set({ showShippingDays: event.currentTarget.checked })} />
          <TextField label="Shipping days prefix" value={form.shippingDaysPrefix} onChange={value => set({ shippingDaysPrefix: value })} details="Shown before the list of days, for example “We ship on:”." />
          <TextField label="Countdown prefix" value={form.countdownPrefix} onChange={value => set({ countdownPrefix: value })} details="Before the time left, for example “Order in the next”." />
          <TextField label="Countdown suffix" value={form.countdownSuffix} onChange={value => set({ countdownSuffix: value })} details="Between the time left and the dispatch day, for example “for dispatch on”." />
          <TextField label="No dispatch day text" value={form.noShippingText} onChange={value => set({ noShippingText: value })} details="Shown when no dispatch day is found in the next 30 days." />
          <TextField label="Error text" value={form.errorText} onChange={value => set({ errorText: value })} details="Shown if the settings cannot be read." />
          <PolarisCheckbox label="Hide the block when no dispatch day is available" checked={form.hideIfUnavailable} onChange={event => set({ hideIfUnavailable: event.currentTarget.checked })} />
        </s-stack>
      </s-section>

      <s-section heading="Bank holidays">
        <s-stack direction="block" gap="base">
          <TextField label="Bank holidays (no dispatch)" multiline value={form.holidays} onChange={value => set({ holidays: value })} details="One date per line, written YYYY-MM-DD, for example 2026-12-25." />
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button type="button" variant="secondary" loading={importing || undefined} disabled={importing || undefined} onClick={() => send({ intent: "import" })}>Import UK bank holidays</s-button>
            <s-text color="subdued">Adds upcoming England and Wales dates from gov.uk. Dates already listed are kept. Save to apply.</s-text>
          </s-stack>
          {(() => { const list = parseBankHolidays(form.holidays).dates; const next = list.filter(date => date >= today); return <s-text color="subdued">{list.length} date{list.length === 1 ? "" : "s"} listed{next.length ? `, next: ${when(next[0])}` : ""}{list.length > 0 && next.length === 0 ? ". All of them are in the past, so import the new ones" : ""}.</s-text>; })()}
        </s-stack>
      </s-section>

      <s-section heading="Warehouse delay">
        <s-stack direction="block" gap="base">
          <PolarisNumberField label="Delay in dispatch days" min={0} max={60} step={1} value={form.delayDays} details="0 is off. Otherwise the countdown is replaced by dispatch from the Nth dispatch day after today, whatever the time of day." onInput={event => set({ delayDays: event.currentTarget.value })} />
          <TextField label="Delay message" multiline value={form.delayMessage} onChange={value => set({ delayMessage: value })} maxLength={600} details="The dispatch date follows this text. Wrap words in [highlight] and [/highlight] to colour them like the countdown." />
        </s-stack>
      </s-section>

      <s-section heading="Free shipping">
        <s-stack direction="block" gap="base">
          <PolarisCheckbox label="Show the free delivery message" checked={form.freeEnabled} onChange={event => set({ freeEnabled: event.currentTarget.checked })} />
          {form.freeEnabled && <>
            <DeliveryFromShopify delivery={delivery} appUrl={appUrl} />
            <TextField label="Message when under the threshold" value={form.textUnder} onChange={value => set({ textUnder: value })} details="{threshold} becomes the amount and {country} the shopper's country, for example “Free delivery to {country} on orders over {threshold}”." />
            <TextField label="Message when this item would reach it" value={form.textAdd} onChange={value => set({ textAdd: value })} details="Uses the selected variant and quantity." />
            <TextField label="Message when the cart has reached it" value={form.textOver} onChange={value => set({ textOver: value })} details="Also shown where delivery is always free." />
          </>}
        </s-stack>
      </s-section>

      <s-section heading="Pre-order and sold-out variants">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">When the chosen variant is sold out, or is sold while out of stock, no dispatch date is promised.</s-text>
          <PolarisRadioList label="What to show" value={form.preorderMode} options={[{ value: "message", label: "Show a message instead" }, { value: "hide", label: "Hide the dispatch line" }]} onChange={value => set({ preorderMode: value === "hide" ? "hide" : "message" })} />
          {form.preorderMode === "message" && <TextField label="Message" multiline value={form.preorderMessage} onChange={value => set({ preorderMessage: value })} maxLength={600} />}
        </s-stack>
      </s-section>

      <s-section heading="Warning notice">
        <s-stack direction="block" gap="base">
          <PolarisCheckbox label="Show a warning notice, for example a Christmas cut-off" checked={form.warnEnabled} onChange={event => set({ warnEnabled: event.currentTarget.checked })} />
          {form.warnEnabled && <>
            <s-grid gridTemplateColumns="1fr 1fr" gap="base" alignItems="start">
              <DateField label="First day shown" value={form.warnStart} onChange={value => set({ warnStart: value })} />
              <DateField label="Last day shown" value={form.warnEnd} onChange={value => set({ warnEnd: value })} />
            </s-grid>
            <TextField label="Message" multiline value={form.warnMessage} onChange={value => set({ warnMessage: value })} maxLength={600} details="Shown above the dispatch message on both days and every day between, by London's date." />
            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              <ColourField label="Text colour" value={form.warnText} onChange={value => set({ warnText: value })} />
              <ColourField label="Background colour" value={form.warnBackground} onChange={value => set({ warnBackground: value })} />
              <ColourField label="Border colour" value={form.warnBorder} onChange={value => set({ warnBorder: value })} />
            </s-grid>
          </>}
        </s-stack>
      </s-section>
      <s-section heading="Appearance">
        <s-stack direction="block" gap="base">
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
          </s-grid>
          <PolarisCheckbox label="Show the clock icon" checked={form.look.showIcon} onChange={event => setLook({ showIcon: event.currentTarget.checked })} />
          <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
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
        </s-stack>
      </s-section>
    </s-stack>
  </s-page>;
}
