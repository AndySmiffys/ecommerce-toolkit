import { PolarisSelect, PolarisCheckbox, PolarisRadioList, PolarisCheckboxList } from "../PolarisControls";
import { FormSection } from "./shared";
import type { DiscountForm } from "./useDiscountForm";

export function AdvancedStep({ form }: { form: DiscountForm }) {
const { discountType, method, discountCode, isCodeList, automaticTitle, minimumRequirement, setMinimumRequirement, minimumPurchaseAmount, setMinimumPurchaseAmount, minimumQuantity, setMinimumQuantity, limitTotalUses, setLimitTotalUses, totalUsageLimit, setTotalUsageLimit, limitOncePerCustomer, setLimitOncePerCustomer, combineProductDiscounts, setCombineProductDiscounts, combineOrderDiscounts, setCombineOrderDiscounts, combineShippingDiscounts, setCombineShippingDiscounts, productCombinationMode, setProductCombinationMode, selectedCombinationTags, setSelectedCombinationTags } = form;
return <>
{discountType !== "bxgy" && (
<FormSection title="Minimum purchase requirements" heading>
<PolarisRadioList label="Minimum purchase requirements" value={minimumRequirement} options={[{ value: "none", label: "No minimum requirements" }, { value: "amount", label: "Minimum purchase amount" }, { value: "quantity", label: "Minimum quantity of items" }]} onChange={value => setMinimumRequirement(value as "none" | "amount" | "quantity")} />
{minimumRequirement === "amount" && (
<div style={{ maxWidth: "220px" }}>
<s-number-field label="Minimum purchase amount" labelAccessibilityVisibility="exclusive" min={0} step={0.01} prefix="£" value={minimumPurchaseAmount} onInput={(event) => setMinimumPurchaseAmount(event.currentTarget.value)} details="Customers must spend at least this amount to use the discount." />
</div>
)}
{minimumRequirement === "quantity" && (
<div style={{ maxWidth: "220px" }}>
<s-number-field label="Minimum quantity of items" labelAccessibilityVisibility="exclusive" min={1} step={1} value={minimumQuantity} onInput={(event) => setMinimumQuantity(event.currentTarget.value)} details="Customers must add at least this many eligible items to use the discount." />
</div>
)}
</FormSection>
)}

{method === "code" && (
<FormSection title="Maximum discount uses" heading>
<div
style={{
display: "grid",
gap: "10px",
}}
>
<div
style={{
display: "grid",
gap: "8px",
}}
>
<PolarisCheckbox
label={isCodeList ? "Limit the number of times each code can be used" : "Limit number of times this discount can be used in total"}
checked={limitTotalUses}
onChange={(event) =>
setLimitTotalUses(event.currentTarget.checked)
}
/>

{limitTotalUses && (
<div
style={{
maxWidth: "220px",
marginLeft: "24px",
}}
>
<s-number-field
label="Maximum discount uses"
labelAccessibilityVisibility="exclusive"
min={1}
step={1}
value={totalUsageLimit}
onInput={(event) =>
setTotalUsageLimit(event.currentTarget.value)
}
details={isCodeList ? "This limit applies separately to every code, not across the whole list. Set 1 for single-use codes." : "Set the total number of times this discount can be used."}
/>
</div>
)}
</div>

<PolarisCheckbox
disabled={method !== "code"}
label={isCodeList ? "Limit each code to one use per customer" : "Limit to one use per customer"}
checked={limitOncePerCustomer}
onChange={(event) =>
setLimitOncePerCustomer(event.currentTarget.checked)
}
/>
</div>
</FormSection>
)}

<section aria-label="Combinations" style={{ display: "grid", gap: 12, borderTop: "1px solid #e3e3e3", paddingTop: 16 }}>
<s-heading>Combinations</s-heading>
<s-text color="subdued">Allow this discount to combine with other discounts in the customer&apos;s cart.</s-text>
<PolarisCheckbox label="Product discounts" details="Multiple can apply per order" checked={combineProductDiscounts} onChange={event => { setCombineProductDiscounts(event.currentTarget.checked); if (!event.currentTarget.checked) setSelectedCombinationTags([]); }} />
{combineProductDiscounts && (
<PolarisSelect label="Product discount combination" value={productCombinationMode} onChange={event => { const value = event.currentTarget.value as "best" | "multiple"; setProductCombinationMode(value); if (value === "best") setSelectedCombinationTags([]); }}>
<s-option value="best">One per product (best value wins)</s-option>
<s-option value="multiple">Multiple per product</s-option>
</PolarisSelect>
)}
{combineProductDiscounts && productCombinationMode === "multiple" && (
<PolarisCheckboxList label="Combine on the same product with discounts tagged" values={selectedCombinationTags} options={["FREE SHIPPING", "ORDER", "PRODUCT", "BXGY", "CUSTOMER TARGET"].map(tag => ({ value: tag, label: tag }))} onChange={setSelectedCombinationTags} />
)}
<PolarisCheckbox label="Order discounts" details="Multiple can apply per order" checked={combineOrderDiscounts} onChange={event => setCombineOrderDiscounts(event.currentTarget.checked)} />
<PolarisCheckbox label="Shipping discounts" details="Only one can apply per order (best value wins)" checked={combineShippingDiscounts} onChange={event => setCombineShippingDiscounts(event.currentTarget.checked)} />
<s-text color="subdued">
{method === "code" ? discountCode || "This discount" : automaticTitle || "This discount"}{" "}
{!combineProductDiscounts && !combineOrderDiscounts && !combineShippingDiscounts ? "won't combine with other product, order, or shipping discounts in the customer's cart." : "can be combined with the discounts ticked above in the customer's cart."}
</s-text>
</section>
</>;
}
