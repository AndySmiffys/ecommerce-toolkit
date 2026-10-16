import { PolarisSelect } from "../PolarisControls";
import { FormSection } from "./shared";
import type { DiscountForm } from "./useDiscountForm";

export function OrderValue({ form }: { form: DiscountForm }) {
const { valueType, setValueType, discountValue, setDiscountValue } = form;
return <>
<FormSection title="Discount value">
<div
className="discount-value-row"
style={{
display: "grid",
gridTemplateColumns: "minmax(0, 1fr) 170px",
gap: "8px",
alignItems: "end",
}}
>
<PolarisSelect
label="Discount type"
value={valueType}
onChange={(event) =>
setValueType(
event.currentTarget.value as "percentage" | "fixed",
)
}
>
<s-option value="percentage">Percentage</s-option>
<s-option value="fixed">Fixed amount</s-option>
</PolarisSelect>

<s-number-field
label="Value"
labelAccessibilityVisibility="exclusive"
min={0}
step={0.01}
value={discountValue}
prefix={valueType === "fixed" ? "£" : undefined}
suffix={valueType === "percentage" ? "%" : undefined}
onInput={(event) =>
setDiscountValue(event.currentTarget.value)
}
/>
</div>
</FormSection>
</>;
}
