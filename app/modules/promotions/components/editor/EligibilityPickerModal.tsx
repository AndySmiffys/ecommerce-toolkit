import { ModalOverlay } from "../ModalOverlay";
import { PolarisCheckboxList } from "../PolarisControls";
import type { DiscountForm } from "./useDiscountForm";

/** Choose the customers or customer segments that can use the discount. */
export function EligibilityPickerModal({ form }: { form: DiscountForm }) {
const { eligibilityFetcher, eligibility, selectedEligibility, showEligibilityPicker, setShowEligibilityPicker, eligibilityPickerSearch, searchEligibilityPicker, toggleEligibilityResource } = form;
return <ModalOverlay open={showEligibilityPicker} heading={eligibility === "segments" ? "Select customer segments" : "Select customers"} onClose={() => setShowEligibilityPicker(false)}>
<s-stack direction="block" gap="base">
<s-search-field
label={eligibility === "segments" ? "Search segments" : "Search customers"}
labelAccessibilityVisibility="exclusive"
placeholder={eligibility === "segments" ? "Search segments" : "Search customers"}
value={eligibilityPickerSearch}
onInput={(event) => searchEligibilityPicker(event.currentTarget.value)}
/>
{eligibilityFetcher.state !== "idle" && <s-text color="subdued">Loading…</s-text>}
{eligibilityFetcher.state === "idle" && Boolean(eligibilityFetcher.data?.eligibilityResources?.length) && (
<PolarisCheckboxList
label={eligibility === "segments" ? "Customer segments" : "Customers"}
values={selectedEligibility.map((item) => item.id)}
options={(eligibilityFetcher.data?.eligibilityResources ?? []).map((resource) => ({ value: resource.id, label: resource.secondary ? `${resource.name} (${resource.secondary})` : resource.name }))}
onChange={(values) => {
for (const resource of eligibilityFetcher.data?.eligibilityResources ?? []) {
if (values.includes(resource.id) !== selectedEligibility.some((item) => item.id === resource.id)) toggleEligibilityResource(resource);
}
}}
/>
)}
{eligibilityFetcher.state === "idle" && eligibilityFetcher.data?.eligibilityResources?.length === 0 && (
<s-text color="subdued">No {eligibility === "segments" ? "segments" : "customers"} found.</s-text>
)}
</s-stack>
<s-button slot="secondary-actions" onClick={() => setShowEligibilityPicker(false)}>Cancel</s-button>
<s-button slot="primary-actions" variant="primary" onClick={() => setShowEligibilityPicker(false)}>Done</s-button>
</ModalOverlay>;
}
