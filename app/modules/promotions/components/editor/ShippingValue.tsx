import { PolarisSelect, PolarisCheckbox } from "../PolarisControls";
import { FormSection } from "./shared";
import { ShippingCountryPicker } from "../ShippingCountryPicker";
import type { ShippingCountries } from "../../services/shippingCountries.server";
import type { DiscountForm } from "./useDiscountForm";

export function ShippingValue({ form, shippingCountries }: { form: DiscountForm; shippingCountries?: ShippingCountries | null }) {
const { countryMode, setCountryMode, countryCodes, setCountryCodes, excludeShippingPrice, setExcludeShippingPrice, maximumShippingPrice, setMaximumShippingPrice } = form;
return <>
<FormSection title="Countries">
<s-stack direction="block" gap="base">
<PolarisSelect label="Countries" value={countryMode} onChange={event=>setCountryMode(event.currentTarget.value as "all" | "selected")}>
<s-option value="all">All countries with available shipping</s-option>
<s-option value="selected">Selected countries</s-option>
</PolarisSelect>
{countryMode === "selected" && <ShippingCountryPicker shipping={shippingCountries} value={countryCodes} onChange={setCountryCodes} />}
<PolarisCheckbox label="Exclude shipping rates over a certain amount" checked={excludeShippingPrice} onChange={event=>setExcludeShippingPrice(event.currentTarget.checked)} />
{excludeShippingPrice && <s-number-field label="Maximum shipping rate" min={0.01} prefix="£" value={maximumShippingPrice} onInput={event=>setMaximumShippingPrice(event.currentTarget.value)} />}
</s-stack>
</FormSection>
</>;
}
