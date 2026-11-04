import { customerVisibilityMessage } from "../../design/storefrontVisibility";
import { PolarisSelect } from "../PolarisControls";
import { FormSection } from "./shared";
import type { DiscountForm } from "./useDiscountForm";

export function WhoStep({ form }: { form: DiscountForm }) {
const { eligibilityFetcher, eligibility, setEligibility, eligibilitySearch, setEligibilitySearch, selectedEligibility, setSelectedEligibility, openEligibilityPicker, toggleEligibilityResource, removeEligibilityResource } = form;
return <>
<FormSection title="Eligibility">
<s-stack direction="block" gap="base">
<PolarisSelect
label="Eligibility"
value={eligibility}
onChange={(event) => {
setEligibility(
event.currentTarget.value as
| "all"
| "segments"
| "customers",
);
setEligibilitySearch("");
setSelectedEligibility([]);
}}
>
<s-option value="all">All customers</s-option>
<s-option value="segments">
Specific customer segments
</s-option>
<s-option value="customers">
Specific customers
</s-option>
</PolarisSelect>

{eligibility !== "all" && <s-banner tone="warning">{customerVisibilityMessage(eligibility)}</s-banner>}

{eligibility !== "all" && (
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
label={
eligibility === "segments"
? "Search customer segments"
: "Search customers"
}
labelAccessibilityVisibility="exclusive"
placeholder={
eligibility === "segments"
? "Search customer segments"
: "Search customers"
}
value={eligibilitySearch}
onInput={(event) =>
setEligibilitySearch(event.currentTarget.value)
}
/>

<s-button
type="button"
variant="secondary"
onClick={openEligibilityPicker}
>
Browse
</s-button>
</div>

{eligibilitySearch.trim().length >= 2 && (
<div
style={{
marginTop: "6px",
overflow: "hidden",
border: "1px solid #e3e3e3",
borderRadius: "8px",
background: "#ffffff",
}}
>
{eligibilityFetcher.state !== "idle" && (
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

{eligibilityFetcher.state === "idle" &&
eligibilityFetcher.data?.eligibilityResources?.length === 0 && (
<div
style={{
padding: "10px 12px",
color: "#616161",
fontSize: "12px",
}}
>
No matching {eligibility === "segments" ? "segments" : "customers"}.
</div>
)}

{eligibilityFetcher.data?.eligibilityResources?.map((resource) => (
<s-clickable key={resource.id} border="base" borderRadius="base" padding="small" accessibilityLabel={`Add ${resource.name}`} onClick={() => { toggleEligibilityResource(resource); setEligibilitySearch(""); }}>
<s-stack direction="block" gap="small-300">
<s-text type="strong">{resource.name}</s-text>
{resource.secondary && <s-text color="subdued">{resource.secondary}</s-text>}
</s-stack>
</s-clickable>
))}
</div>
)}

{selectedEligibility.length > 0 && (
<div
style={{
display: "grid",
gap: "6px",
marginTop: "10px",
}}
>
{selectedEligibility.map((resource) => (
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
<div style={{ minWidth: 0 }}>
<div
style={{
overflow: "hidden",
textOverflow: "ellipsis",
whiteSpace: "nowrap",
fontSize: "12px",
fontWeight: 600,
}}
>
{resource.name}
</div>
{resource.secondary && (
<div
style={{
marginTop: "2px",
overflow: "hidden",
textOverflow: "ellipsis",
whiteSpace: "nowrap",
color: "#616161",
fontSize: "11px",
}}
>
{resource.secondary}
</div>
)}
</div>

<s-button type="button" variant="tertiary" tone="critical" onClick={() => removeEligibilityResource(resource.id)}>Remove</s-button>
</div>
))}
</div>
)}

<div
style={{
marginTop: "8px",
color: "#616161",
fontSize: "12px",
lineHeight: 1.45,
}}
>
{eligibility === "segments"
? "Select the customer segments that can use this discount."
: "Select the individual customers that can use this discount."}
</div>
</div>
)}
</s-stack>
</FormSection>
</>;
}
