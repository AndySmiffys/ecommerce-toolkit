import { useEffect, useRef, type ComponentProps, type RefObject } from "react";

// React 18 does not bind change events or custom-element properties reliably.
// Keep Polaris markup and styling while wiring the native DOM controls directly.
function useNativeChange<T extends "s-select" | "s-checkbox">(ref: RefObject<HTMLElementTagNameMap[T]>, handler?: ((event: Event & { currentTarget: HTMLElementTagNameMap[T] }) => void) | null) {
  const latest = useRef(handler); latest.current = handler;
  useEffect(() => {
    const element = ref.current;
    const change = (event: Event) => latest.current?.(event as Event & { currentTarget: HTMLElementTagNameMap[T] });
    element?.addEventListener("change", change);
    return () => element?.removeEventListener("change", change);
  }, [ref]);
}
function afterDefinition(tag: string, sync: () => void) {
  let active = true;
  if (window.customElements.get(tag)) sync();
  else void window.customElements.whenDefined(tag).then(() => { if (active) sync(); });
  return () => { active = false; };
}
export function PolarisSelect({ onChange, disabled, ...props }: Omit<ComponentProps<"s-select">, "ref">) {
  const ref = useRef<HTMLElementTagNameMap["s-select"]>(null);
  useNativeChange<"s-select">(ref, onChange);
  useEffect(() => afterDefinition("s-select", () => { if (ref.current) { ref.current.disabled = Boolean(disabled); if (props.value !== undefined) ref.current.value = props.value; } }));
  return <s-select {...props} disabled={disabled || undefined} ref={ref} />;
}
export function PolarisCheckbox({ onChange, checked, disabled, ...props }: Omit<ComponentProps<"s-checkbox">, "ref">) {
  const ref = useRef<HTMLElementTagNameMap["s-checkbox"]>(null);
  useNativeChange<"s-checkbox">(ref, onChange);
  useEffect(() => afterDefinition("s-checkbox", () => { if (ref.current) { ref.current.disabled = Boolean(disabled); ref.current.checked = Boolean(checked); } }));
  return <s-checkbox {...props} checked={checked || undefined} disabled={disabled || undefined} ref={ref} />;
}

export function PolarisNumberField({ onInput, onChange, disabled, ...props }: Omit<ComponentProps<"s-number-field">, "ref">) {
  const ref = useRef<HTMLElementTagNameMap["s-number-field"]>(null);
  const handlers = useRef({ onInput, onChange }); handlers.current = { onInput, onChange };
  useEffect(() => {
    const element = ref.current;
    const input = (event: Event) => handlers.current.onInput?.(event as Event & { currentTarget: HTMLElementTagNameMap["s-number-field"] });
    const change = (event: Event) => handlers.current.onChange?.(event as Event & { currentTarget: HTMLElementTagNameMap["s-number-field"] });
    element?.addEventListener("input", input);
    element?.addEventListener("change", change);
    return () => { element?.removeEventListener("input", input); element?.removeEventListener("change", change); };
  }, []);
  useEffect(() => afterDefinition("s-number-field", () => {
    if (ref.current) {
      ref.current.disabled = Boolean(disabled);
      if (props.value !== undefined) ref.current.value = props.value;
    }
  }));
  return <s-number-field {...props} disabled={disabled || undefined} ref={ref} />;
}

/** Shopify's native radio group: a single-select choice list. */
export function PolarisRadioList({ label, value, options, disabled, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; disabled?: boolean; onChange: (value: string) => void }) {
  const ref = useRef<HTMLElementTagNameMap["s-choice-list"]>(null);
  const latest = useRef(onChange); latest.current = onChange;
  useEffect(() => {
    const element = ref.current;
    const changed = () => { const next = element?.values?.[0]; if (next !== undefined) latest.current(next); };
    element?.addEventListener("change", changed);
    return () => element?.removeEventListener("change", changed);
  }, []);
  useEffect(() => afterDefinition("s-choice-list", () => { if (ref.current) ref.current.values = [value]; }));
  return <s-choice-list ref={ref} label={label} labelAccessibilityVisibility="exclusive" disabled={disabled || undefined}>
    {options.map(option => <s-choice key={option.value} value={option.value} selected={option.value === value || undefined}>{option.label}</s-choice>)}
  </s-choice-list>;
}

/** Shopify's native checkbox group: a multi-select choice list. */
export function PolarisCheckboxList({ label, values, options, onChange }: { label: string; values: string[]; options: Array<{ value: string; label: string }>; onChange: (values: string[]) => void }) {
  const ref = useRef<HTMLElementTagNameMap["s-choice-list"]>(null);
  const latest = useRef(onChange); latest.current = onChange;
  useEffect(() => {
    const element = ref.current;
    const changed = () => latest.current([...(element?.values ?? [])]);
    element?.addEventListener("change", changed);
    return () => element?.removeEventListener("change", changed);
  }, []);
  useEffect(() => afterDefinition("s-choice-list", () => { if (ref.current) ref.current.values = values; }));
  return <s-choice-list ref={ref} multiple label={label} labelAccessibilityVisibility="exclusive">
    {options.map(option => <s-choice key={option.value} value={option.value} selected={values.includes(option.value) || undefined}>{option.label}</s-choice>)}
  </s-choice-list>;
}
