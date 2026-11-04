import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { FetcherWithComponents } from "react-router";
import { useEmbeddedAppUrl } from "../navigation/embeddedAppUrl";
import { PromotionSaveBar } from "../promotions/components/PromotionSaveBar";
import { SaveNotices } from "../promotions/components/SaveNotices";
import { PolarisCheckbox, PolarisCheckboxList, PolarisNumberField, PolarisSelect } from "../promotions/components/PolarisControls";
import { dayNames, defaultDeliverySettings, defaultServiceSetting, defaultShippingConfig, validateShippingConfig, type DeliveryServiceSetting, type DeliverySettings } from "./config";
import { transitText } from "./delivery/deliveryModel";
import { serviceCatalogue, serviceKey, type PublishedServices } from "./delivery/deliveryServices";
import { shippingLogic } from "./logic";

export type ServicesResult = { ok: boolean; intent: string; errors: string[]; services?: DeliveryServiceSetting[]; sort?: DeliverySettings["sort"] };

/** One delivery service in the form: its settings, with the delivery time as text so it can be typed. */
export type ServiceForm = { name: string; label: string; show: boolean; guaranteed: boolean; cutoffTime: string; days: boolean[]; onBankHolidays: boolean; transitMin: string; transitMax: string };

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
export function serviceForms(settings: DeliveryServiceSetting[], services: PublishedServices | null, sort: DeliverySettings["sort"] = "soonest"): ServiceForm[] {
  const catalogue = services ? serviceCatalogue(services) : [];
  const saved = (name: string) => settings.find(setting => serviceKey(setting.name) === serviceKey(name));
  const forms = catalogue.map(item => serviceForm({ ...(saved(item.name) ?? defaultServiceSetting(item.name)), name: item.name }));
  if (sort === "manual") {
    // The order set: services in the order they are listed in the saved settings, then any that are not listed, in Shopify's order.
    const position = (form: ServiceForm) => { const at = settings.findIndex(setting => serviceKey(setting.name) === serviceKey(form.name)); return at < 0 ? settings.length : at; };
    forms.sort((a, b) => position(a) - position(b));
  }
  return [...forms, ...settings.filter(setting => !catalogue.some(item => serviceKey(item.name) === serviceKey(setting.name))).map(serviceForm)];
}

/**
 * What is saved. Normally only the services that differ from the defaults. In a set order every service is saved, in that order, because
 * where a service sits is itself a setting; services Shopify no longer has are only kept if they differ from the defaults.
 */
export const settingsFromForms = (forms: ServiceForm[], manual = false, isOrphan: (name: string) => boolean = () => false) => forms.filter(item => (manual && !isOrphan(item.name)) || !isDefaultService(item));

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


/**
 * Every delivery service Shopify offers, with what the app adds to each. It sits on the Shipping page, beside the shipping options the services
 * come from, and saves on its own: the wording and the on and off switch are in Shipping countdown.
 */
export function DeliveryServicesEditor({ services, settings, sort, shopCutoff, enabled, fetcher }: {
  services: PublishedServices | null;
  settings: DeliveryServiceSetting[];
  /** How the options are ordered on the product page. */
  sort: DeliverySettings["sort"];
  shopCutoff: string;
  /** Whether delivery options are switched on in Shipping countdown. */
  enabled: boolean;
  fetcher: FetcherWithComponents<ServicesResult>;
}) {
  const appUrl = useEmbeddedAppUrl();
  const shopify = useAppBridge();
  const [baseline, setBaseline] = useState(() => serviceForms(settings, services, sort));
  const [form, setForm] = useState(baseline);
  const [mode, setMode] = useState(sort);
  const [baselineMode, setBaselineMode] = useState(sort);
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(false);
  const catalogue = useMemo(() => (services ? serviceCatalogue(services) : []), [services]);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline) || mode !== baselineMode;
  const saving = fetcher.state !== "idle" && sent.current;

  // A fresh read of Shopify, or settings saved elsewhere, replace the list, unless there are unsaved changes here.
  const source = JSON.stringify([settings, services, sort]);
  const seen = useRef(source);
  useEffect(() => {
    if (source === seen.current) return;
    seen.current = source;
    if (!dirty) { const next = serviceForms(settings, services, sort); setBaseline(next); setForm(next); setMode(sort); setBaselineMode(sort); }
  }, [source, dirty, settings, services, sort]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !sent.current) return;
    sent.current = false;
    if (!fetcher.data.ok) { setError(fetcher.data.errors.join(" ")); return; }
    setError(null);
    const saved = fetcher.data.sort ?? mode;
    const next = serviceForms(fetcher.data.services ?? settings, services, saved);
    setBaseline(next); setForm(next); setMode(saved); setBaselineMode(saved);
    shopify.toast.show("Delivery services saved");
  }, [fetcher.state, fetcher.data, shopify, settings, services, mode]);

  // The same checks the server makes, so Save only offers what will be accepted.
  const isOrphan = (name: string) => !catalogue.some(entry => serviceKey(entry.name) === serviceKey(name));
  const check = useMemo(() => validateShippingConfig({ ...defaultShippingConfig, delivery: { ...defaultDeliverySettings, enabled: false, sort: mode, services: settingsFromForms(form, mode === "manual", name => !catalogue.some(entry => serviceKey(entry.name) === serviceKey(name))) } }), [form, mode, catalogue]);
  const problems = check.ok ? [] : check.errors;
  const change = (name: string, changes: Partial<ServiceForm>) => setForm(current => current.map(item => (item.name === name ? { ...item, ...changes } : item)));
  const save = () => { if (check.ok) { sent.current = true; fetcher.submit({ intent: "saveServices", services: JSON.stringify(check.config.delivery.services), sort: check.config.delivery.sort }, { method: "post" }); } };
  // Moves a service up or down among the services Shopify has. Settings for ones it no longer has stay at the end.
  const move = (name: string, by: -1 | 1) => setForm(current => {
    const at = current.findIndex(item => item.name === name);
    const to = at + by;
    if (at < 0 || to < 0 || to >= current.length || isOrphan(current[to].name)) return current;
    const next = [...current];
    [next[at], next[to]] = [next[to], next[at]];
    return next;
  });

  return <>
    <PromotionSaveBar dirty={dirty} saving={saving} issue={problems[0] ?? null} showWhileIncomplete onSave={save} onDiscard={() => { setForm(baseline); setMode(baselineMode); setError(null); }} />
    <s-stack direction="block" gap="base">
      <SaveNotices error={error} issue={problems.length ? problems[0] : null} onDismissError={() => setError(null)} />
      <s-text color="subdued">Each service is a shipping option above, with its price and delivery time read from Shopify. Here you add what Shopify does not hold: whether it is guaranteed, the days the carrier delivers, and a cut-off if it differs. Delivery times count only the days each carrier delivers, and skip bank holidays.</s-text>
      {!enabled && <s-banner tone="info" heading="Delivery options are switched off on the product page">Turn them on, and set the wording, in <s-link href={appUrl("/app/shipping-countdown")}>Shipping countdown</s-link>. You can set the services up here first.</s-banner>}
      {services === null
        ? <s-banner tone="info" heading="Delivery services have not been read from Shopify yet">Reload this page and the app will read your shipping options.</s-banner>
        : form.length === 0
          ? <s-banner tone="warning" heading="No delivery services found">Your Shopify shipping settings have no fixed-rate options for the general profile.</s-banner>
          : <>
            <PolarisSelect label="Order in the dropdown" value={mode} onChange={event => setMode(event.currentTarget.value === "manual" ? "manual" : "soonest")}>
              <s-option value="soonest">Soonest delivery first, then cheapest</s-option>
              <s-option value="manual">The order set below</s-option>
            </PolarisSelect>
            {mode === "manual" && <s-text color="subdued">Use Move up and Move down to put the services in the order you want them listed. A service Shopify adds later is listed after these.</s-text>}
            {form.map((item, index) => {
              const orphan = isOrphan(item.name);
              const card = <ServiceCard key={item.name} form={item} entry={catalogue.find(entry => serviceKey(entry.name) === serviceKey(item.name))} orphan={orphan} currency={services?.currency ?? "GBP"} shopCutoff={shopCutoff} onChange={changes => change(item.name, changes)} onRemove={() => setForm(current => current.filter(other => other.name !== item.name))} />;
              if (mode !== "manual" || orphan) return card;
              const movable = form.filter(other => !isOrphan(other.name)).length;
              return <div key={item.name} data-position={index + 1} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 8, alignItems: "start" }}>
                <div style={{ display: "grid", gap: 2, justifyItems: "center", paddingTop: 4 }}>
                  <s-text color="subdued">{index + 1}</s-text>
                  <s-button type="button" variant="tertiary" accessibilityLabel={`Move ${item.label.trim() || item.name} up`} disabled={index === 0 || undefined} onClick={() => move(item.name, -1)}>Move up</s-button>
                  <s-button type="button" variant="tertiary" accessibilityLabel={`Move ${item.label.trim() || item.name} down`} disabled={index >= movable - 1 || undefined} onClick={() => move(item.name, 1)}>Move down</s-button>
                </div>
                {card}
              </div>;
            })}
          </>}
    </s-stack>
  </>;
}
