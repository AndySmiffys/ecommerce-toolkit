import { PolarisSelect } from "../PolarisControls";
import { FormSection } from "./shared";
import type { DiscountForm } from "./useDiscountForm";

export function ProductValue({ form }: { form: DiscountForm }) {
const { resourceFetcher, valueType, setValueType, discountValue, setDiscountValue, appliesTo, setAppliesTo, resourceSearch, setResourceSearch, selectedProducts, selectedCollections, browseDiscountResources, addSearchedResource, removeSelectedResource } = form;
return <>
<FormSection title="Discount value">
<s-stack direction="block" gap="base">
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
max={valueType === "percentage" ? 100 : undefined}
step={valueType === "percentage" ? 1 : 0.01}
value={discountValue}
prefix={valueType === "fixed" ? "£" : undefined}
suffix={valueType === "percentage" ? "%" : undefined}
onInput={(event) =>
setDiscountValue(event.currentTarget.value)
}
/>
</div>

<PolarisSelect
label="Applies to"
value={appliesTo}
onChange={(event) => {
setAppliesTo(
event.currentTarget.value as "products" | "collections",
);
setResourceSearch("");
}}
>
<s-option value="collections">Specific collections</s-option>
<s-option value="products">Specific products</s-option>
</PolarisSelect>

<div>
<div
style={{
display: "grid",
gridTemplateColumns: "minmax(0, 1fr) auto",
gap: "8px",
alignItems: "end",
}}
>
<s-text-field
label={appliesTo === "collections" ? "Search collections" : "Search products"}
labelAccessibilityVisibility="exclusive"
placeholder={appliesTo === "collections" ? "Search collections" : "Search products"}
value={resourceSearch}
onInput={(event) =>
setResourceSearch(event.currentTarget.value)
}
/>
<s-button
type="button"
variant="secondary"
onClick={browseDiscountResources}
>
Browse
</s-button>
</div>

{resourceSearch.trim().length >= 2 && (
<div
style={{
marginTop: "6px",
overflow: "hidden",
border: "1px solid #dedede",
borderRadius: "8px",
background: "#ffffff",
}}
>
{resourceFetcher.state !== "idle" && (
<div
style={{
padding: "10px 12px",
color: "#616161",
fontSize: "12px",
}}
>
Searching…
</div>
)}

{resourceFetcher.state === "idle" &&
resourceFetcher.data?.resources?.length === 0 && (
<div
style={{
padding: "10px 12px",
color: "#616161",
fontSize: "12px",
}}
>
No matching {appliesTo === "products" ? "products" : "collections"}.
</div>
)}

{resourceFetcher.data?.resources?.map((resource) => (
<s-clickable key={resource.id} border="base" borderRadius="base" padding="small" accessibilityLabel={`Add ${resource.title}`} onClick={() => addSearchedResource(resource)}>
<s-stack direction="inline" gap="base" alignItems="center">
{resource.imageUrl && <s-thumbnail src={resource.imageUrl} alt="" size="small-200" />}
<s-text type="strong">{resource.title}</s-text>
</s-stack>
</s-clickable>
))}
</div>
)}

{(appliesTo === "products"
? selectedProducts
: selectedCollections
).length > 0 && (
<div
style={{
display: "grid",
gap: "6px",
marginTop: "10px",
}}
>
{(appliesTo === "products"
? selectedProducts
: selectedCollections
).map((resource) => (
<div
key={resource.id}
style={{
display: "flex",
alignItems: "center",
justifyContent: "space-between",
gap: "10px",
padding: "8px 10px",
border: "1px solid #e3e3e3",
borderRadius: "8px",
background: "#fafafa",
}}
>
<div
style={{
minWidth: 0,
overflow: "hidden",
}}
>
<div
style={{
overflow: "hidden",
textOverflow: "ellipsis",
whiteSpace: "nowrap",
fontSize: "12px",
fontWeight: 600,
}}
>
{resource.title}
</div>
{appliesTo === "products" && resource.variants && (
<div
style={{
marginTop: "2px",
color: "#616161",
fontSize: "11px",
}}
>
{resource.selectedVariantIds?.length ?? 0} of{" "}
{resource.variants.length} variants selected
</div>
)}
</div>
<div
style={{
display: "flex",
alignItems: "center",
gap: "10px",
flex: "0 0 auto",
}}
>
{appliesTo === "products" && (
<s-button type="button" variant="tertiary" onClick={browseDiscountResources}>Edit variants</s-button>
)}
<s-button type="button" variant="tertiary" tone="critical" onClick={() => removeSelectedResource(resource.id)}>Remove</s-button>
</div>
</div>
))}
</div>
)}
</div>
</s-stack>
</FormSection>
</>;
}
