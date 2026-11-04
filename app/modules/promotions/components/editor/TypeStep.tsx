import { PolarisSelect, PolarisRadioList } from "../PolarisControls";
import { FormSection } from "./shared";
import { PromotionCodeList } from "../PromotionCodeList";
import type { CodeBatchSummary } from "../../design/codeGeneration";
import type { DiscountForm } from "./useDiscountForm";

export function TypeStep({ form, promotionId, codeListLocked, codeBatch }: { form: DiscountForm; promotionId?: string; codeListLocked: boolean; codeBatch?: CodeBatchSummary | null }) {
const { method, setMethod, discountCode, setDiscountCode, codeMode, codeCount, setCodeCount, codePrefix, setCodePrefix, codeSuffix, setCodeSuffix, codeListTitle, setCodeListTitle, isCodeList, changeCodeMode, automaticTitle, setAutomaticTitle, generateDiscountCode } = form;
return <>
<FormSection title="Method">
{promotionId && <s-text color="subdued">The existing discount type and method are retained. Manage changes to discount codes in Shopify.</s-text>}
<s-stack direction="block" gap="base">
<div>
<div
style={{
marginBottom: "8px",
color: "#303030",
fontSize: "12px",
fontWeight: 650,
}}
>
Method
</div>

<PolarisRadioList label="Discount method" value={method} disabled={Boolean(promotionId || codeListLocked)} options={[{ value: "code", label: "Discount code" }, { value: "automatic", label: "Automatic discount" }]} onChange={value => setMethod(value as "code" | "automatic")} />
</div>

{method === "code" && <PolarisSelect label="Code format" disabled={Boolean(promotionId || codeListLocked)} value={codeMode} onChange={event => changeCodeMode(event.currentTarget.value as "single" | "bulk")}>
<s-option value="single">One shared code for all customers</s-option>
<s-option value="bulk">Generate a list of individual codes</s-option>
</PolarisSelect>}
{isCodeList ? <div style={{ display: "grid", gap: 12 }}>
{promotionId ? codeBatch ? <PromotionCodeList initialBatch={codeBatch} /> : <s-banner tone="info">This discount has {codeCount} individual codes. Manage and export its existing codes in Shopify. Individual codes are not published on the website.</s-banner> : <>
<s-text-field label="Code list name" value={codeListTitle} disabled={codeListLocked} onInput={event => setCodeListTitle(event.currentTarget.value)} details="A name for the promotion in Shopify. Customers enter their individual code." />
<s-number-field label="Number of codes" min={1} max={10000} step={1} value={codeCount} disabled={codeListLocked} onInput={event => setCodeCount(event.currentTarget.value)} details="Generate from 1 to 10,000 different codes." />
<s-text-field label="Prefix (optional)" value={codePrefix} maxLength={32} disabled={codeListLocked} onInput={event => setCodePrefix(event.currentTarget.value.toUpperCase())} details="Letters, numbers, hyphens or underscores. For example: HALLOWEEN-" />
<s-text-field label="Suffix (optional)" value={codeSuffix} maxLength={32} disabled={codeListLocked} onInput={event => setCodeSuffix(event.currentTarget.value.toUpperCase())} details="Added after the random characters. For example: -2026" />
<s-text color="subdued">Format: <s-text type="strong">{codePrefix}XXXXXXXXXXXX{codeSuffix}</s-text> Each X is a random letter or number. Codes default to one use each; adjust this under Maximum discount uses.</s-text>
<s-banner tone="info">Keep this promotion in website Draft status. After creation, the app generates the list in batches and provides a CSV download for customer distribution. Reopening the promotion resumes unfinished generation.</s-banner>
</>}
</div> : method === "code" ? (
<div>
<div
style={{
display: "flex",
alignItems: "center",
justifyContent: "space-between",
gap: "12px",
marginBottom: "6px",
}}
>
<span
style={{
color: "#303030",
fontSize: "12px",
fontWeight: 650,
}}
>
Discount code
</span>

<s-button type="button" variant="tertiary" disabled={Boolean(promotionId || codeListLocked) || undefined} onClick={generateDiscountCode}>Generate random code</s-button>
</div>

<s-text-field
label="Discount code"
labelAccessibilityVisibility="exclusive"
disabled={Boolean(promotionId || codeListLocked)} placeholder="Enter discount code"
value={discountCode}
onInput={(event) =>
setDiscountCode(event.currentTarget.value.toUpperCase())
}
details={promotionId ? "The existing code is retained. Manage discount codes in Shopify." : "All eligible customers use this same code. Usage limits are configured below. Shopify may display app-created codes in a code-list panel."}
/>
</div>
) : (
<s-text-field
label="Title"
placeholder="Enter discount title"
value={automaticTitle}
onInput={(event) =>
setAutomaticTitle(event.currentTarget.value)
}
details="Customers will see this title in their cart and at checkout."
/>
)}
</s-stack>
</FormSection>
</>;
}
