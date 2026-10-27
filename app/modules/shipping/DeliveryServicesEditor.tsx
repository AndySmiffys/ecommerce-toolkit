import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { FetcherWithComponents } from "react-router";
import { useEmbeddedAppUrl } from "../navigation/embeddedAppUrl";
import { PromotionSaveBar } from "../promotions/components/PromotionSaveBar";
import { SaveNotices } from "../promotions/components/SaveNotices";
import { PolarisCheckbox, PolarisCheckboxList, PolarisNumberField } from "../promotions/components/PolarisControls";
import { dayNames, defaultDeliverySettings, defaultServiceSetting, defaultShippingConfig, validateShippingConfig, type DeliveryServiceSetting } from "./config";
import { transitText } from "./delivery/deliveryModel";
import { serviceCatalogue, type PublishedServices } from "./delivery/deliveryServices";
import { shippingLogic } from "./logic";

export type ServicesResult = { ok: boolean; intent: string; errors: string[]; services?: DeliveryServiceSetting[] };

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
export function serviceForms(settings: DeliveryServiceSetting[], services: PublishedServices | null): ServiceForm[] {
  const catalogue = services ? serviceCatalogue(services) : [];
  return [
    ...catalogue.map(item => serviceForm(settings.find(setting => setting.name === item.name) ?? defaultServiceSetting(item.name))),
    ...settings.filter(setting => !catalogue.some(item => item.name === setting.name)).map(serviceForm),
  ];
}

/** What is saved: only the services that differ from the defaults. */
export const settingsFromForms = (forms: ServiceForm[]) => forms.filter(item => !isDefaultService(item));

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
export function DeliveryServicesEditor({ services, settings, shopCutoff, enabled, fetcher }: {
  services: PublishedServices | null;
  settings: DeliveryServiceSetting[];
  shopCutoff: string;
  /** Whether delivery options are switched on in Shipping countdown. */
  enabled: boolean;
  fetcher: FetcherWithComponents<ServicesResult>;
}) {
  const appUrl = useEmbeddedAppUrl();
  const shopify = useAppBridge();
  const [baseline, setBaseline] = useState(() => serviceForms(settings, services));
  const [form, setForm] = useState(baseline);
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(false);
  const catalogue = useMemo(() => (services ? serviceCatalogue(services) : []), [services]);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const saving = fetcher.state !== "idle" && sent.current;

  // A fresh read of Shopify, or settings saved elsewhere, replace the list, unless there are unsaved changes here.
  const source = JSON.stringify([settings, services]);
  const seen = useRef(source);
  useEffect(() => {
    if (source === seen.current) return;
    seen.current = source;
    if (!dirty) { const next = serviceForms(settings, services); setBaseline(next); setForm(next); }
  }, [source, dirty, settings, services]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !sent.current) return;
    sent.current = false;
    if (!fetcher.data.ok) { setError(fetcher.data.errors.join(" ")); return; }
    setError(null);
    const next = serviceForms(fetcher.data.services ?? settings, services);
    setBaseline(next); setForm(next);
    shopify.toast.show("Delivery services saved");
  }, [fetcher.state, fetcher.data, shopify, settings, services]);

  // The same checks the server makes, so Save only offers what will be accepted.
  const check = useMemo(() => validateShippingConfig({ ...defaultShippingConfig, delivery: { ...defaultDeliverySettings, enabled: false, services: settingsFromForms(form) } }), [form]);
  const problems = check.ok ? [] : check.errors;
  const change = (name: string, changes: Partial<ServiceForm>) => setForm(current => current.map(item => (item.name === name ? { ...item, ...changes } : item)));
  const save = () => { if (check.ok) { sent.current = true; fetcher.submit({ intent: "saveServices", services: JSON.stringify(check.config.delivery.services) }, { method: "post" }); } };

  return <>
    <PromotionSaveBar dirty={dirty} saving={saving} issue={problems[0] ?? null} showWhileIncomplete onSave={save} onDiscard={() => { setForm(baseline); setError(null); }} />
    <s-stack direction="block" gap="base">
      <SaveNotices error={error} issue={problems.length ? problems[0] : null} onDismissError={() => setError(null)} />
      <s-text color="subdued">Each service is a shipping option above, with its price and delivery time read from Shopify. Here you add what Shopify does not hold: whether it is guaranteed, the days the carrier delivers, and a cut-off if it differs. Delivery times count only the days each carrier delivers, and skip bank holidays.</s-text>
      {!enabled && <s-banner tone="info" heading="Delivery options are switched off on the product page">Turn them on, and set the wording, in <s-link href={appUrl("/app/shipping-countdown")}>Shipping countdown</s-link>. You can set the services up here first.</s-banner>}
      {services === null
        ? <s-banner tone="info" heading="Delivery services have not been read from Shopify yet">Reload this page and the app will read your shipping options.</s-banner>
        : form.length === 0
          ? <s-banner tone="warning" heading="No delivery services found">Your Shopify shipping settings have no fixed-rate options for the general profile.</s-banner>
          : form.map(item => <ServiceCard key={item.name} form={item} entry={catalogue.find(entry => entry.name === item.name)} orphan={!catalogue.some(entry => entry.name === item.name)} currency={services?.currency ?? "GBP"} shopCutoff={shopCutoff} onChange={changes => change(item.name, changes)} onRemove={() => setForm(current => current.filter(other => other.name !== item.name))} />)}
    </s-stack>
  </>;
}
