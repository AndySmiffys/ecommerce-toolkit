import { useEffect, useRef } from "react";
import { PolarisSelect } from "./PolarisControls";

const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

/** Shopify's native date field. React 18 does not bind its events, so they are wired directly. */
export function DateField({ label, value, error, onChange }: { label: string; value: string; error?: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLElementTagNameMap["s-date-field"]>(null);
  const latest = useRef(onChange); latest.current = onChange;
  useEffect(() => {
    const element = ref.current;
    const changed = () => { const next = String(element?.value ?? ""); if (!next || /^\d{4}-\d{2}-\d{2}$/.test(next)) latest.current(next); };
    element?.addEventListener("input", changed);
    element?.addEventListener("change", changed);
    return () => { element?.removeEventListener("input", changed); element?.removeEventListener("change", changed); };
  }, []);
  useEffect(() => { if (ref.current && String(ref.current.value) !== value) ref.current.value = value; });
  return <s-date-field ref={ref} label={label} value={value} error={error} />;
}

/**
 * A date and a time, built from Shopify's native date field and selects. The value is
 * a local date-time such as "2026-10-20T09:30:00", or an empty string when no date is set.
 */
export function DateTimeField({ label, value, onChange, min }: { label: string; value: string; onChange: (value: string) => void; min?: string }) {
  const date = value.slice(0, 10);
  const hour = value.slice(11, 13) || "00";
  const minute = value.slice(14, 16) || "00";
  const before = Boolean(value && min && value < min);
  function change(nextDate: string, nextHour: string, nextMinute: string) {
    onChange(nextDate ? `${nextDate}T${nextHour}:${nextMinute}:00` : "");
  }
  return <s-grid gridTemplateColumns="2fr 1fr 1fr" gap="base" alignItems="start">
    <DateField label={`${label}: date`} value={date} error={before ? "Choose a time after the start." : undefined} onChange={next => change(next, hour, minute)} />
    <PolarisSelect label="Hour" disabled={!date} value={hour} onChange={event => change(date, event.currentTarget.value, minute)}>
      {hours.map(item => <s-option key={item} value={item}>{item}</s-option>)}
    </PolarisSelect>
    <PolarisSelect label="Minute" disabled={!date} value={minute} onChange={event => change(date, hour, event.currentTarget.value)}>
      {minutes.map(item => <s-option key={item} value={item}>{item}</s-option>)}
    </PolarisSelect>
  </s-grid>;
}
