import { useState } from "react";
import { PolarisCheckbox } from "./PolarisControls";
import type { ShippingCountries } from "../services/shippingCountries.server";

export function ShippingCountryPicker({ shipping, value, onChange }: { shipping?: ShippingCountries | null; value: string; onChange: (value: string) => void }) {
  const [search, setSearch] = useState("");
  const selected = [...new Set(value.split(",").map(code => code.trim().toUpperCase()).filter(Boolean))];
  const available = shipping?.countries ?? [];
  const unavailable = selected.filter(code => !available.some(country => country.code === code));
  const names = new Intl.DisplayNames(["en-GB"], { type: "region" });
  function toggle(code: string, checked: boolean) { onChange((checked ? [...new Set([...selected, code])] : selected.filter(item => item !== code)).join(", ")); }
  return <div style={{ display: "grid", gap: 12 }}>
    {shipping?.error ? <s-banner tone="warning">{shipping.error}</s-banner> : !shipping ? <s-banner tone="warning">Reopen this page to load your shipping countries.</s-banner> : <>
      <s-text-field label="Search shipping countries" value={search} onInput={event => setSearch(event.currentTarget.value)} placeholder="Search by country or shipping option" />
      <s-text color="subdued">{selected.length} {selected.length === 1 ? "country" : "countries"} selected. Countries below have active options in your Shopify shipping profiles.</s-text>
      <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid #e3e3e3", borderRadius: 8, padding: 12, display: "grid", gap: 12 }}>
        {available.filter(country => `${country.name} ${country.code} ${country.shippingOptions.join(" ")}`.toLowerCase().includes(search.toLowerCase().trim())).map(country => <div key={country.code}>
          <PolarisCheckbox label={`${country.name} (${country.code})`} checked={selected.includes(country.code)} onChange={event => toggle(country.code, event.currentTarget.checked)} />
          <s-text color="subdued">{country.shippingOptions.join("; ")}</s-text>
        </div>)}
        {!available.length && <s-paragraph>No countries with active shipping options were found. Configure shipping in Shopify first.</s-paragraph>}
        {available.length > 0 && !available.some(country => `${country.name} ${country.code} ${country.shippingOptions.join(" ")}`.toLowerCase().includes(search.toLowerCase().trim())) && <s-paragraph>No matching countries.</s-paragraph>}
      </div>
    </>}
    {unavailable.length > 0 && <div style={{ display: "grid", gap: 8 }}><s-paragraph>Existing selections below are retained, but their shipping availability could not be confirmed. You can remove them.</s-paragraph>{unavailable.map(code => <PolarisCheckbox key={code} label={`${/^[A-Z]{2}$/.test(code) ? names.of(code) || code : code} (${code}) — existing selection`} checked onChange={event => toggle(code, event.currentTarget.checked)} />)}</div>}
    <s-text color="subdued">Checkout availability depends on products, address, active markets and rate conditions. The offer applies to qualifying shipping rates in your chosen countries; use the maximum rate setting to exclude expensive options.</s-text>
  </div>;
}
