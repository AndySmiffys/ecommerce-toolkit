import { PolarisSelect, PolarisCheckbox, PolarisRadioList } from "../PolarisControls";
import { FormSection } from "./shared";
import type { DiscountForm } from "./useDiscountForm";

export function BxgyValue({ form }: { form: DiscountForm }) {
const { buySelection, setBuySelection, getSelection, setGetSelection, usesPerOrder, setUsesPerOrder, buyRequirement, setBuyRequirement, buyQuantity, setBuyQuantity, buyAmount, setBuyAmount, buyAppliesTo, setBuyAppliesTo, getQuantity, setGetQuantity, getAppliesTo, setGetAppliesTo, rewardType, setRewardType, rewardValue, setRewardValue, maxUsesPerOrder, setMaxUsesPerOrder, browseBxgy } = form;
return <>
<FormSection title="Discount value">
<s-stack direction="block" gap="large">
<div>
<div
style={{
marginBottom: "10px",
fontSize: "13px",
fontWeight: 650,
}}
>
Customer buys
</div>

<s-stack direction="block" gap="base">
<PolarisRadioList label="Customer buys" value={buyRequirement} options={[{ value: "quantity", label: "Minimum quantity of items" }, { value: "amount", label: "Minimum purchase amount" }]} onChange={value => setBuyRequirement(value as "quantity" | "amount")} />

<div
className="bxgy-pair-row"
style={{
display: "grid",
gridTemplateColumns: "120px minmax(0, 1fr)",
gap: "8px",
}}
>
{buyRequirement === "quantity" ? (
<s-number-field
label="Quantity"
min={1}
step={1}
value={buyQuantity}
onInput={(event) =>
setBuyQuantity(event.currentTarget.value)
}
/>
) : (
<s-number-field
label="Amount"
min={0}
step={0.01}
prefix="£"
value={buyAmount}
onInput={(event) =>
setBuyAmount(event.currentTarget.value)
}
/>
)}

<PolarisSelect
label="Any items from"
value={buyAppliesTo}
onChange={(event) =>
(setBuySelection([]), setBuyAppliesTo(event.currentTarget.value as "products" | "collections"))
}
>
<s-option value="products">Specific products</s-option>
<s-option value="collections">Specific collections</s-option>
</PolarisSelect>
</div>

<div><s-button type="button" variant="secondary" onClick={()=>browseBxgy("buy")}>Select buy items</s-button><s-unordered-list>{buySelection.map(item=><s-list-item key={item.id}>{item.title}</s-list-item>)}</s-unordered-list></div>
</s-stack>
</div>

<div
style={{
paddingTop: "16px",
borderTop: "1px solid #e3e3e3",
}}
>
<div
style={{
marginBottom: "4px",
fontSize: "13px",
fontWeight: 650,
}}
>
Customer gets
</div>
<div
style={{
marginBottom: "12px",
color: "#616161",
fontSize: "12px",
lineHeight: 1.45,
}}
>
Customers must add the quantity of items specified below to their cart.
</div>

<s-stack direction="block" gap="base">
<div
className="bxgy-pair-row"
style={{
display: "grid",
gridTemplateColumns: "120px minmax(0, 1fr)",
gap: "8px",
}}
>
<s-number-field
label="Quantity"
min={1}
step={1}
value={getQuantity}
onInput={(event) =>
setGetQuantity(event.currentTarget.value)
}
/>

<PolarisSelect
label="Any items from"
value={getAppliesTo}
onChange={(event) =>
(setGetSelection([]), setGetAppliesTo(event.currentTarget.value as "products" | "collections"))
}
>
<s-option value="products">Specific products</s-option>
<s-option value="collections">Specific collections</s-option>
</PolarisSelect>
</div>

<div><s-button type="button" variant="secondary" onClick={()=>browseBxgy("get")}>Select get items</s-button><s-unordered-list>{getSelection.map(item=><s-list-item key={item.id}>{item.title}</s-list-item>)}</s-unordered-list></div>

<div
style={{
paddingTop: "4px",
}}
>
<div
style={{
marginBottom: "8px",
color: "#303030",
fontSize: "12px",
fontWeight: 650,
}}
>
At a discounted value
</div>

<s-stack direction="block" gap="small">
<PolarisRadioList label="Discounted value" value={rewardType} options={[{ value: "percentage", label: "Percentage" }, { value: "amount", label: "Amount off each" }, { value: "free", label: "Free" }]} onChange={value => setRewardType(value as "percentage" | "amount" | "free")} />
{rewardType === "percentage" && (
<div style={{ maxWidth: "150px" }}>
<s-number-field label="Percentage" labelAccessibilityVisibility="exclusive" min={0} max={100} step={0.01} suffix="%" value={rewardValue} onInput={(event) => setRewardValue(event.currentTarget.value)} />
</div>
)}
{rewardType === "amount" && (
<div style={{ maxWidth: "150px" }}>
<s-number-field label="Amount" labelAccessibilityVisibility="exclusive" min={0} step={0.01} prefix="£" value={rewardValue} onInput={(event) => setRewardValue(event.currentTarget.value)} />
</div>
)}
</s-stack>
</div>

<div
style={{
paddingTop: "14px",
borderTop: "1px solid #e3e3e3",
}}
>
<PolarisCheckbox
label="Set a maximum number of uses per order"
checked={maxUsesPerOrder}
onChange={(event) =>
setMaxUsesPerOrder(event.currentTarget.checked)
}
/>
{maxUsesPerOrder && <s-number-field label="Maximum uses per order" min={1} step={1} value={usesPerOrder} onInput={event=>setUsesPerOrder(event.currentTarget.value)} />}
</div>
</s-stack>
</div>
</s-stack>
</FormSection>
</>;
}
