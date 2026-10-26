import { useEffect, useMemo, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { FetcherWithComponents } from "react-router";
import { useEmbeddedAppUrl } from "../navigation/embeddedAppUrl";
import { PromotionSaveBar } from "../promotions/components/PromotionSaveBar";
import { SaveNotices } from "../promotions/components/SaveNotices";
import { DateField } from "../promotions/components/DateTimeField";
import { PolarisCheckbox, PolarisCheckboxList, PolarisNumberField, PolarisRadioList } from "../promotions/components/PolarisControls";
import { dayNames, fromMinorUnits, parseBankHolidays, toMinorUnits, validateShippingConfig, type ShippingCountdownConfig } from "./config";
import { shippingLogic } from "./logic";

export type ShippingResult = { ok: boolean; intent: string; errors: string[]; config?: ShippingCountdownConfig; dates?: string[] };

type Form = {
  cutoffTime: string; days: boolean[]; holidays: string; delayDays: string; delayMessage: string;
  hideIfUnavailable: boolean; showShippingDays: boolean; shippingDaysPrefix: string; noShippingText: string; errorText: string;
  countdownPrefix: string; countdownSuffix: string;
  freeEnabled: boolean; thresholds: Array<{ code: string; amount: string }>; textUnder: string; textAdd: string; textOver: string;
  preorderMode: "message" | "hide"; preorderMessage: string;
  warnEnabled: boolean; warnStart: string; warnEnd: string; warnMessage: string; warnText: string; warnBackground: string; warnBorder: string;
};

const toForm = (c: ShippingCountdownConfig): Form => ({
  cutoffTime: c.cutoffTime, days: c.shippingDays, holidays: c.bankHolidays.join("\n"), delayDays: String(c.delayDays), delayMessage: c.delayMessage,
  hideIfUnavailable: c.hideIfUnavailable, showShippingDays: c.showShippingDays, shippingDaysPrefix: c.shippingDaysPrefix, noShippingText: c.noShippingText,
  errorText: c.errorText, countdownPrefix: c.countdownPrefix, countdownSuffix: c.countdownSuffix,
  freeEnabled: c.freeShipping.enabled, thresholds: Object.entries(c.freeShipping.thresholds).map(([code, amount]) => ({ code, amount: fromMinorUnits(amount) })),
  textUnder: c.freeShipping.textUnder, textAdd: c.freeShipping.textAdd, textOver: c.freeShipping.textOver,
  preorderMode: c.availability.preorderMode, preorderMessage: c.availability.preorderMessage,
  warnEnabled: c.warning.enabled, warnStart: c.warning.startDate, warnEnd: c.warning.endDate, warnMessage: c.warning.message,
  warnText: c.warning.textColor, warnBackground: c.warning.backgroundColor, warnBorder: c.warning.borderColor,
});

/** The settings the form describes, plus anything in it that cannot even be read as a setting (the rest is checked by the shared validator). */
function toInput(f: Form) {
  const problems: string[] = [];
  const holidays = parseBankHolidays(f.holidays);
  if (holidays.invalid.length) problems.push(`Bank holidays must be dates written YYYY-MM-DD. Not valid: ${holidays.invalid.slice(0, 3).join(", ")}.`);
  const thresholds: Record<string, number> = {};
  for (const row of f.thresholds) {
    const code = row.code.trim().toUpperCase();
    if (!code && !row.amount.trim()) continue;
    const minor = toMinorUnits(row.amount);
    if (minor === null) { problems.push(`The ${code || "new"} threshold must be an amount such as 50 or 49.50.`); continue; }
    if (thresholds[code] !== undefined) problems.push(`${code} has more than one threshold.`);
    thresholds[code] = minor;
  }
  return {
    problems,
    input: {
      version: 1, cutoffTime: f.cutoffTime, shippingDays: f.days, bankHolidays: holidays.dates, delayDays: f.delayDays.trim() === "" ? 0 : Number(f.delayDays), delayMessage: f.delayMessage,
      hideIfUnavailable: f.hideIfUnavailable, showShippingDays: f.showShippingDays, shippingDaysPrefix: f.shippingDaysPrefix, noShippingText: f.noShippingText, errorText: f.errorText,
      countdownPrefix: f.countdownPrefix, countdownSuffix: f.countdownSuffix,
      freeShipping: { enabled: f.freeEnabled, thresholds, textUnder: f.textUnder, textAdd: f.textAdd, textOver: f.textOver },
      availability: { preorderMode: f.preorderMode, preorderMessage: f.preorderMessage },
      warning: { enabled: f.warnEnabled, startDate: f.warnStart, endDate: f.warnEnd, message: f.warnMessage, textColor: f.warnText, backgroundColor: f.warnBackground, borderColor: f.warnBorder },
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

const when = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * The shipping countdown's settings. Everything the theme block shows is decided here: the block itself only has its look. The preview
 * runs the storefront's own logic file, so what it says is what shoppers get.
 */
export function ShippingCountdownPage({ initial, saved, today, fetcher }: { initial: ShippingCountdownConfig; saved: boolean; today: string; fetcher: FetcherWithComponents<ShippingResult> }) {
  const appUrl = useEmbeddedAppUrl();
  const shopify = useAppBridge();
  const [baseline, setBaseline] = useState(() => toForm(initial));
  const [form, setForm] = useState(baseline);
  const [error, setError] = useState<string | null>(null);
  const [firstSave, setFirstSave] = useState(!saved);
  const sent = useRef<string | null>(null);
  const [sampleDate, setSampleDate] = useState("");
  const [sampleTime, setSampleTime] = useState("");
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); }, []);
  const set = (changes: Partial<Form>) => setForm(current => ({ ...current, ...changes }));

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
  const free = config?.freeShipping.enabled ? Object.entries(config.freeShipping.thresholds).find(([, amount]) => amount > 0) : undefined;
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
          {view === null
            ? <s-banner tone="warning">Fix the problem above to see a preview.</s-banner>
            : <div style={{ border: "6px double #28a745", borderRadius: 8, padding: "16px 24px", background: "#f8f9fa", display: "grid", gap: 8, textAlign: "center" }}>
              {warningShowing && config && <div style={{ border: `6px double ${config.warning.borderColor}`, background: config.warning.backgroundColor, color: config.warning.textColor, padding: "12px 16px", borderRadius: 8 }}>⚠️ {config.warning.message}</div>}
              {free && <s-text type="strong">{shippingLogic.fillThreshold(config!.freeShipping.textUnder, free[1], free[0])}</s-text>}
              <s-text>
                {view.kind === "countdown" && <>{config!.countdownPrefix} <s-text type="strong">{view.countdown}</s-text> {config!.countdownSuffix} <s-text type="strong">{view.date}</s-text></>}
                {view.kind === "delay" && <>{shippingLogic.parseHighlight(config!.delayMessage).map((piece, index) => piece.highlight ? <s-text key={index} type="strong">{piece.text}</s-text> : <span key={index}>{piece.text}</span>)} <s-text type="strong">{view.date}</s-text></>}
                {view.kind === "none" && config!.noShippingText}
                {view.kind === "error" && config!.errorText}
                {view.kind === "hidden" && "The block is hidden: no dispatch day is available and Hide when unavailable is on."}
                {view.kind === "preorder" && config!.availability.preorderMessage}
              </s-text>
              {config!.showShippingDays && <s-text color="subdued">{config!.shippingDaysPrefix} {[1, 2, 3, 4, 5, 6, 0].filter(index => config!.shippingDays[index]).map(index => dayNames[index]).join(", ")}</s-text>}
            </div>}
          <s-text color="subdued">The preview uses the same logic as the product page, with London time. Colours, sizes and spacing are set on the block in the theme editor.</s-text>
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
          <PolarisCheckbox label="Show the free shipping message" checked={form.freeEnabled} onChange={event => set({ freeEnabled: event.currentTarget.checked })} />
          {form.freeEnabled && <>
            <s-stack direction="block" gap="small-300">
              <s-text type="strong">Free shipping threshold, per currency</s-text>
              <s-text color="subdued">Enter the fixed amount for each currency you sell in. Nothing is converted, and a shopper whose cart currency is not listed sees no free shipping message.</s-text>
            </s-stack>
            {form.thresholds.map((row, index) => <s-grid key={index} gridTemplateColumns="1fr 2fr auto" gap="base" alignItems="end">
              <TextField label="Currency" value={row.code} maxLength={3} onChange={value => set({ thresholds: form.thresholds.map((item, at) => at === index ? { ...item, code: value.toUpperCase() } : item) })} />
              <TextField label="Spend at least" value={row.amount} onChange={value => set({ thresholds: form.thresholds.map((item, at) => at === index ? { ...item, amount: value } : item) })} details={index === 0 ? "In that currency, such as 50 or 49.50." : undefined} />
              <s-button type="button" variant="tertiary" tone="critical" onClick={() => set({ thresholds: form.thresholds.filter((_, at) => at !== index) })}>Remove</s-button>
            </s-grid>)}
            <div><s-button type="button" variant="secondary" onClick={() => set({ thresholds: [...form.thresholds, { code: "", amount: "" }] })}>Add a currency</s-button></div>
            <TextField label="Message when under the threshold" value={form.textUnder} onChange={value => set({ textUnder: value })} details="{threshold} becomes the amount, for example “Free delivery on orders over {threshold}”." />
            <TextField label="Message when this item would reach it" value={form.textAdd} onChange={value => set({ textAdd: value })} details="Uses the selected variant and quantity." />
            <TextField label="Message when the cart has reached it" value={form.textOver} onChange={value => set({ textOver: value })} />
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
    </s-stack>
  </s-page>;
}
