import { useDiscountForm } from "./editor/useDiscountForm";
import { TypeStep } from "./editor/TypeStep";
import { ValueStep } from "./editor/ValueStep";
import { WhoStep } from "./editor/WhoStep";
import { ScheduleStep } from "./editor/ScheduleStep";
import { AdvancedStep } from "./editor/AdvancedStep";
import { EligibilityPickerModal } from "./editor/EligibilityPickerModal";
import { editorCss } from "./editor/editorStyles";
import { formatPreviewPrice, stepOrder } from "./editor/shared";
import { getStatusTone } from "../design/statusTone";
import type { ShippingCountries } from "../services/shippingCountries.server";
import { FormStep } from "./FormStep";
import { stepForIssue } from "../design/saveIssueStep";
import { firstIssue, stepIssues } from "../design/stepValidation";
import { summarisePromotion } from "../design/promotionSummary";
import { ModalOverlay } from "./ModalOverlay";
import { PromotionSaveBar } from "./PromotionSaveBar";
import { SaveNotices } from "./SaveNotices";
import { validateCodeOptions, type CodeBatchSummary } from "../design/codeGeneration";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import { cloneElement, useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import type { EditorDiscountDraft } from "../design/editorDraft";
import type { LinkResource, PromotionActionData } from "../design/editorTypes";
import { type Placement, type WebsiteDraft } from "../design/design";
import { storefrontVisibilityNotices } from "../design/storefrontVisibility";
import { PromotionWebsiteEditor } from "./PromotionWebsiteEditor";
import { PromotionPreview, type PreviewProduct } from "./PromotionPreview";
import type { action as previewAction } from "../../../routes/app.promotion-preview";




export function PromotionEditor({ products, initialDiscount, initialWebsite, promotionId, shopifyStatus, codeBatch, shippingCountries }: { products: LinkResource[]; initialDiscount?: EditorDiscountDraft; initialWebsite?: WebsiteDraft; promotionId?: string; shopifyStatus?: string; codeBatch?: CodeBatchSummary | null; shippingCountries?: ShippingCountries | null }) {
const form = useDiscountForm({ initialDiscount, initialWebsite });
const { shopify, discountType, config, method, setMethod, discountCode, setDiscountCode, codeMode, setCodeMode, codeCount, setCodeCount, codePrefix, setCodePrefix, codeSuffix, setCodeSuffix, codeListTitle, setCodeListTitle, isCodeList, automaticTitle, setAutomaticTitle, valueType, setValueType, discountValue, setDiscountValue, appliesTo, setAppliesTo, setResourceSearch, selectedProducts, setSelectedProducts, selectedCollections, setSelectedCollections, buySelection, setBuySelection, getSelection, setGetSelection, usesPerOrder, setUsesPerOrder, countryMode, setCountryMode, countryCodes, setCountryCodes, excludeShippingPrice, setExcludeShippingPrice, maximumShippingPrice, setMaximumShippingPrice, buyRequirement, setBuyRequirement, buyQuantity, setBuyQuantity, buyAmount, setBuyAmount, buyAppliesTo, setBuyAppliesTo, getQuantity, setGetQuantity, getAppliesTo, setGetAppliesTo, rewardType, setRewardType, rewardValue, setRewardValue, maxUsesPerOrder, setMaxUsesPerOrder, minimumRequirement, setMinimumRequirement, minimumPurchaseAmount, setMinimumPurchaseAmount, minimumQuantity, setMinimumQuantity, limitTotalUses, setLimitTotalUses, totalUsageLimit, setTotalUsageLimit, limitOncePerCustomer, setLimitOncePerCustomer, combineProductDiscounts, setCombineProductDiscounts, combineOrderDiscounts, setCombineOrderDiscounts, combineShippingDiscounts, setCombineShippingDiscounts, productCombinationMode, setProductCombinationMode, selectedCombinationTags, setSelectedCombinationTags, startDateTime, setStartDateTime, hasEndDate, setHasEndDate, endDateTime, setEndDateTime, eligibility, setEligibility, setEligibilitySearch, selectedEligibility, setSelectedEligibility, setShowEligibilityPicker, websiteEnabled, showProductPage, showCollectionPage, showProductBadge, showHeaderBanner, websiteDraft, updateWebsite, discountDraft } = form;
const creationRequestKey = useRef<string>();
const [previewProductId, setPreviewProductId] = useState("");
const [isPreviewDrawerOpen, setIsPreviewDrawerOpen] = useState(false);
  const appUrl = useEmbeddedAppUrl();

const createFetcher = useFetcher<PromotionActionData>();
const previewFetcher = useFetcher<typeof previewAction>();
const navigate = useNavigate();
const [assetsBusy, setAssetsBusy] = useState(false);
const [submissionError, setSubmissionError] = useState("");
const [dismissedResponse, setDismissedResponse] = useState<PromotionActionData>();
const saveInFlight = useRef(false);
useEffect(() => { if (createFetcher.state === "idle") saveInFlight.current = false; }, [createFetcher.state]);
const [createdDiscountId, setCreatedDiscountId] = useState<string | undefined>();
const codeListLocked = Boolean(createdDiscountId || createFetcher.data?.codeListLocked);



const summary = summarisePromotion({ discountType, method, discountCode, codeMode, codeCount, automaticTitle, valueType, discountValue, appliesTo, productCount: selectedProducts.length, collectionCount: selectedCollections.length, buyRequirement, buyQuantity, buyAmount, getQuantity, rewardType, rewardValue, countryMode, countryCount: countryCodes.split(",").map(code => code.trim()).filter(Boolean).length, minimumRequirement, minimumPurchaseAmount, minimumQuantity, limitTotalUses, totalUsageLimit, limitOncePerCustomer, combines: combineProductDiscounts || combineOrderDiscounts || combineShippingDiscounts, eligibility, eligibilityCount: selectedEligibility.length, startDateTime, hasEndDate, endDateTime });
const selectedBlocks = [showHeaderBanner, showCollectionPage, showProductPage, showProductBadge].filter(Boolean).length;
const websiteSummary = selectedBlocks ? `${websiteEnabled ? "Enabled" : "Draft"}, ${selectedBlocks} ${selectedBlocks === 1 ? "block" : "blocks"} selected` : "Not set up yet";
const [openStep, setOpenStep] = useState<string | null>("type");
// A step only shows Complete or Needs attention once it has been opened. A saved promotion already has every step filled in.
const [visitedSteps, setVisitedSteps] = useState<string[]>(() => promotionId ? stepOrder : ["type"]);
useEffect(() => { if (openStep) setVisitedSteps(current => current.includes(openStep) ? current : [...current, openStep]); }, [openStep]);
const stepTitles: Record<string, string> = { type: "Type and method", value: discountType === "shipping" ? "Countries" : "Discount value", who: "Who can use it", schedule: "Schedule", advanced: "Advanced options", website: "Website promotion" };
const stepProps = (id: string) => {
  const index = stepOrder.indexOf(id); const following = stepOrder[index + 1];
  return { id, number: index + 1, title: stepTitles[id], status: !visitedSteps.includes(id) ? undefined : issuesByStep[id as keyof typeof issuesByStep] ? (openStep === id ? undefined : "attention" as const) : ["type", "value", "who", "schedule"].includes(id) ? "complete" as const : undefined, locked: firstBlockedStep !== -1 && index > firstBlockedStep, open: openStep === id, onToggle: (open: boolean) => setOpenStep(current => open ? id : current === id ? null : current), next: following ? { label: `Continue to ${stepTitles[following].toLowerCase()}`, onClick: () => setOpenStep(following), disabled: Boolean(issuesByStep[id as keyof typeof issuesByStep]), hint: issuesByStep[id as keyof typeof issuesByStep] ? `Complete this step to continue: ${issuesByStep[id as keyof typeof issuesByStep]}` : undefined } : undefined };
};

const [visibilityNow, setVisibilityNow] = useState(() => Date.now());
useEffect(() => { const timer = setInterval(() => setVisibilityNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
const visibilityNotices = storefrontVisibilityNotices(websiteDraft, {
  eligibility, eligibilityCount: selectedEligibility.length,
  startsAt: startDateTime || null, endsAt: hasEndDate ? endDateTime || null : null,
  codeList: isCodeList,
  productTarget: discountType === "product" ? appliesTo : discountType === "bxgy" ? getAppliesTo : null,
}, visibilityNow);
const eligibleSelection = JSON.stringify({ productIds: discountType === "product" && appliesTo === "products" ? selectedProducts.map(p=>p.id) : discountType === "bxgy" && getAppliesTo === "products" ? getSelection.map(p=>p.id) : [], collectionIds: discountType === "product" && appliesTo === "collections" ? selectedCollections.map(p=>p.id) : discountType === "bxgy" && getAppliesTo === "collections" ? getSelection.map(p=>p.id) : [] });
const previewSubmitRef = useRef(previewFetcher.submit); previewSubmitRef.current = previewFetcher.submit;
useEffect(() => { previewSubmitRef.current({ selection: eligibleSelection }, { method: "post", action: "/app/promotion-preview" }); }, [eligibleSelection]);
const productOptions: PreviewProduct[] = products.map(p=>({ id:p.id, title:p.title, image:p.featuredImage?.url, price:formatPreviewPrice(p) }));
const eligibleProducts = previewFetcher.data?.key === eligibleSelection ? previewFetcher.data.products : [];
const previewProducts = previewProductId ? productOptions.filter(p=>p.id===previewProductId) : eligibleProducts;
const [previewPlacement, setPreviewPlacement] = useState<Placement | undefined>();
const websitePreview = <PromotionPreview placement={previewPlacement} onPlacementChange={setPreviewPlacement} visibilityNotices={visibilityNotices} discountCode={method === "code" && !isCodeList ? discountCode : null} offerNote={isCodeList ? "Use your individual code at checkout." : method === "code" ? discountCode ? `Use code: ${discountCode}` : "Add a discount code" : "Applied automatically at checkout."} value={websiteDraft} products={previewProducts} endsAt={hasEndDate ? endDateTime : null} productOptions={productOptions} onProductChange={setPreviewProductId} selectedProductId={previewProductId} loading={previewFetcher.state !== "idle"} sample={eligibleSelection === '{"productIds":[],"collectionIds":[]}' && discountType !== "order" && discountType !== "shipping"} />;
const discountSnapshot = JSON.stringify(discountDraft);
const [savedDiscountSnapshot, setSavedDiscountSnapshot] = useState(discountSnapshot);
const submittedDiscountSnapshot = useRef(discountSnapshot);
// Include inactive fields so Discard restores the complete form as well as the saved payload.
const editorFields = { method, discountCode, codeMode, codeCount, codePrefix, codeSuffix, codeListTitle, automaticTitle, valueType, discountValue, appliesTo, selectedProducts, selectedCollections, buySelection, getSelection, usesPerOrder, countryMode, countryCodes, excludeShippingPrice, maximumShippingPrice, buyRequirement, buyQuantity, buyAmount, buyAppliesTo, getQuantity, getAppliesTo, rewardType, rewardValue, maxUsesPerOrder, minimumRequirement, minimumPurchaseAmount, minimumQuantity, limitTotalUses, totalUsageLimit, limitOncePerCustomer, combineProductDiscounts, combineOrderDiscounts, combineShippingDiscounts, productCombinationMode, selectedCombinationTags, startDateTime, hasEndDate, endDateTime, eligibility, selectedEligibility };
const snapshot = JSON.stringify({ discount: discountDraft, website: websiteDraft, fields: editorFields });
const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
const submittedSnapshot = useRef(snapshot);
const handledResponse = useRef<PromotionActionData | undefined>();
const hasUnsavedChanges = snapshot !== savedSnapshot;
const saveBarRef = useRef<UISaveBarElement>(null);

async function discardChanges() {
if (assetsBusy || createFetcher.state !== "idle" || (!promotionId && codeListLocked && !createdDiscountId)) return;
await saveBarRef.current?.hide();
// A partially created discount already exists in Shopify. Discard only its unsaved design.
if (!promotionId && createdDiscountId) { navigate(appUrl(`/app/promotions/${createdDiscountId.split("/").pop()}`)); return; }
const saved = JSON.parse(savedSnapshot) as { fields: typeof editorFields; website: WebsiteDraft };
setMethod(saved.fields.method);
setDiscountCode(saved.fields.discountCode);
setCodeMode(saved.fields.codeMode);
setCodeCount(saved.fields.codeCount);
setCodePrefix(saved.fields.codePrefix);
setCodeSuffix(saved.fields.codeSuffix);
setCodeListTitle(saved.fields.codeListTitle);
setAutomaticTitle(saved.fields.automaticTitle);
setValueType(saved.fields.valueType);
setDiscountValue(saved.fields.discountValue);
setAppliesTo(saved.fields.appliesTo);
setSelectedProducts(saved.fields.selectedProducts);
setSelectedCollections(saved.fields.selectedCollections);
setBuySelection(saved.fields.buySelection);
setGetSelection(saved.fields.getSelection);
setUsesPerOrder(saved.fields.usesPerOrder);
setCountryMode(saved.fields.countryMode);
setCountryCodes(saved.fields.countryCodes);
setExcludeShippingPrice(saved.fields.excludeShippingPrice);
setMaximumShippingPrice(saved.fields.maximumShippingPrice);
setBuyRequirement(saved.fields.buyRequirement);
setBuyQuantity(saved.fields.buyQuantity);
setBuyAmount(saved.fields.buyAmount);
setBuyAppliesTo(saved.fields.buyAppliesTo);
setGetQuantity(saved.fields.getQuantity);
setGetAppliesTo(saved.fields.getAppliesTo);
setRewardType(saved.fields.rewardType);
setRewardValue(saved.fields.rewardValue);
setMaxUsesPerOrder(saved.fields.maxUsesPerOrder);
setMinimumRequirement(saved.fields.minimumRequirement);
setMinimumPurchaseAmount(saved.fields.minimumPurchaseAmount);
setMinimumQuantity(saved.fields.minimumQuantity);
setLimitTotalUses(saved.fields.limitTotalUses);
setTotalUsageLimit(saved.fields.totalUsageLimit);
setLimitOncePerCustomer(saved.fields.limitOncePerCustomer);
setCombineProductDiscounts(saved.fields.combineProductDiscounts);
setCombineOrderDiscounts(saved.fields.combineOrderDiscounts);
setCombineShippingDiscounts(saved.fields.combineShippingDiscounts);
setProductCombinationMode(saved.fields.productCombinationMode);
setSelectedCombinationTags(saved.fields.selectedCombinationTags);
setStartDateTime(saved.fields.startDateTime);
setHasEndDate(saved.fields.hasEndDate);
setEndDateTime(saved.fields.endDateTime);
setEligibility(saved.fields.eligibility);
setSelectedEligibility(saved.fields.selectedEligibility);
updateWebsite(saved.website);
setDismissedResponse(createFetcher.data);
setSubmissionError("");
setResourceSearch("");
setEligibilitySearch("");
setShowEligibilityPicker(false);
}


// Process each settled response once, including saves whose pending render is batched.
// The response identity guard prevents repeated state updates.
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => {
if (createFetcher.state !== "idle" || !createFetcher.data || handledResponse.current === createFetcher.data) return;
saveInFlight.current = false;
handledResponse.current = createFetcher.data;
if (createFetcher.data?.savedId) setCreatedDiscountId(createFetcher.data.savedId);
if (createFetcher.data?.success) { if (promotionId) { setSavedSnapshot(submittedSnapshot.current); setSavedDiscountSnapshot(submittedDiscountSnapshot.current); shopify.toast.show("Promotion saved"); } else if (createFetcher.data.redirectId) {
setSavedSnapshot(submittedSnapshot.current);
const destination = appUrl(`/app/promotions/${createFetcher.data.redirectId}`);
shopify.toast.show("Promotion created");
void Promise.resolve(saveBarRef.current?.hide()).then(() => navigate(destination));
} }
});

// Everything Shopify would reject is caught here first, so Save only appears for a complete discount.
const toIso = (local: string) => { const date = new Date(local); return local && Number.isFinite(date.getTime()) ? date.toISOString() : null; };
const issuesByStep = stepIssues({ draft: discountDraft, startsAt: toIso(startDateTime), endsAt: hasEndDate ? toIso(endDateTime) : null, hasEndDate, endDateTime, website: websiteDraft, isCodeList, checkRules: !promotionId || discountSnapshot !== savedDiscountSnapshot, creating: !promotionId });
const saveIssueInfo = firstIssue(issuesByStep);
const firstBlockedStep = stepOrder.findIndex(step => issuesByStep[step as keyof typeof issuesByStep]);
// If an earlier step becomes incomplete while a later one is open, go back to it.
useEffect(() => {
const openIndex = openStep ? stepOrder.indexOf(openStep) : -1;
if (firstBlockedStep !== -1 && openIndex > firstBlockedStep) setOpenStep(stepOrder[firstBlockedStep]);
}, [openStep, firstBlockedStep]);
const saveIssue = saveIssueInfo?.message ?? null;
// A problem Shopify reports after saving opens the step it belongs to.
useEffect(() => {
const message = createFetcher.data?.error;
const step = message ? stepForIssue(message) : null;
if (step) setOpenStep(step);
}, [createFetcher.data]);

function savePromotion() {
if (saveInFlight.current || createFetcher.state !== "idle" || assetsBusy) return;
if (isCodeList && !promotionId) { try { validateCodeOptions(discountDraft); } catch (error) { setSubmissionError(error instanceof Error ? error.message : "Check the code list settings."); return; } }
if (isCodeList && websiteEnabled) { setSubmissionError("Keep code lists in website Draft status. Distribute the individual codes using the CSV download."); return; }
if (hasEndDate && !endDateTime) { setSubmissionError("Choose an end date and time, or turn off the end date."); return; }
setSubmissionError("");
setDismissedResponse(createFetcher.data);
saveInFlight.current = true;
const discount = { ...discountDraft, startsAt: startDateTime ? new Date(startDateTime).toISOString() : null, endsAt: hasEndDate && endDateTime ? new Date(endDateTime).toISOString() : null };
creationRequestKey.current ??= window.crypto.randomUUID();
submittedSnapshot.current = snapshot;
submittedDiscountSnapshot.current = discountSnapshot;
createFetcher.submit({ intent: promotionId ? "updatePromotion" : "createPromotion", payload:JSON.stringify({ requestKey: creationRequestKey.current, discount, website:websiteDraft, savedId:createdDiscountId, updateRules: discountSnapshot !== savedDiscountSnapshot }) }, { method:"post" });
}

return (
<s-page heading={promotionId ? "Edit promotion" : "Create discount"} inlineSize="large">
<s-link slot="breadcrumb-actions" href={appUrl("/app/promotions")}>Promotions</s-link>
<s-button slot="secondary-actions" data-preview-toggle="" onClick={() => setIsPreviewDrawerOpen(true)}>Preview</s-button>
{promotionId && <s-button slot="secondary-actions" href={`shopify:admin/discounts/${promotionId.split("/").pop()}`} target="_blank">Edit in Shopify</s-button>}
<PromotionSaveBar ref={saveBarRef} dirty={hasUnsavedChanges} saving={createFetcher.state !== "idle"} busy={assetsBusy} discardDisabled={!promotionId && codeListLocked && !createdDiscountId} issue={saveIssue} showWhileIncomplete={Boolean(promotionId)} onSave={savePromotion} onDiscard={discardChanges} />
<SaveNotices error={submissionError || (createFetcher.data !== dismissedResponse ? createFetcher.data?.error : undefined)} issue={promotionId && hasUnsavedChanges ? saveIssue : null} onDismissError={() => { setSubmissionError(""); setDismissedResponse(createFetcher.data); }} />
<div
style={{
width: "100%",
maxWidth: "none",
margin: 0,
}}
>
<s-stack direction="block" gap="large">
{promotionId && <div><s-badge tone={getStatusTone(shopifyStatus)}>{shopifyStatus || "Promotion"}</s-badge></div>}

<div
className="create-discount-layout"
style={{
display: "grid",
gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
gap: "24px",
alignItems: "start",
}}
>
<aside
className="desktop-preview-panel"
style={{
position: "sticky",
top: "20px",
maxHeight: "calc(100vh - 40px)",
overflowY: "auto",
scrollbarGutter: "stable",
alignSelf: "start",
}}
>
{websitePreview}
</aside>

<div>
<div
style={{
marginBottom: "10px",
color: "#202223",
fontSize: "14px",
fontWeight: 650,
}}
>
{config.title}
</div>

<s-stack direction="block" gap="large">
<div role="status" aria-label="Promotion summary" style={{ position: "sticky", top: 0, zIndex: 5, padding: "12px 16px", border: "1px solid #dedede", borderRadius: 12, background: "#f7f7f7", display: "grid", gap: 2 }}>
<span style={{ fontSize: 12, color: "#616161" }}>Summary</span>
<span style={{ fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>{summary.overview}</span>
{saveIssueInfo && <span style={{ fontSize: 12, color: "#8a5a00", overflowWrap: "anywhere" }}>To save: {saveIssueInfo.message} <s-button type="button" variant="tertiary" onClick={() => setOpenStep(saveIssueInfo.step)}>Go to {stepTitles[saveIssueInfo.step].toLowerCase()}</s-button></span>}
</div>
<FormStep {...stepProps("type")} summary={summary.type}>
<TypeStep form={form} promotionId={promotionId} codeListLocked={codeListLocked} codeBatch={codeBatch} />
</FormStep>

<FormStep {...stepProps("value")} summary={summary.value}>
<ValueStep form={form} shippingCountries={shippingCountries} />
</FormStep>

<FormStep {...stepProps("who")} summary={summary.who}>
<WhoStep form={form} />
</FormStep>

<FormStep {...stepProps("schedule")} summary={summary.schedule}>
<ScheduleStep form={form} />
</FormStep>

<FormStep {...stepProps("advanced")} optional summary={summary.advanced}>
<AdvancedStep form={form} />
</FormStep>



<FormStep {...stepProps("website")} optional summary={websiteSummary}>
<PromotionWebsiteEditor onActiveBlockChange={setPreviewPlacement} publicationDisabled={isCodeList} value={websiteDraft} onChange={value => updateWebsite(isCodeList ? { ...value, websiteEnabled: false } : value)} endsAt={hasEndDate ? endDateTime : null} onBusyChange={setAssetsBusy} />
</FormStep>
{previewFetcher.data?.error && <s-banner tone="warning">{previewFetcher.data.error}</s-banner>}
{!promotionId && createdDiscountId && <s-button href={appUrl(`/app/promotions/${createdDiscountId.split("/").pop()}`)} variant="secondary">Open saved promotion</s-button>}


</s-stack>
</div>

</div>


<ModalOverlay open={isPreviewDrawerOpen} heading="Storefront preview" size="large" onClose={() => setIsPreviewDrawerOpen(false)}>
<s-stack direction="block" gap="base">
<s-text color="subdued">Updates live as you change the promotion.</s-text>
{cloneElement(websitePreview, { allowEnlarge: false })}
</s-stack>
<s-button slot="secondary-actions" onClick={() => setIsPreviewDrawerOpen(false)}>Close</s-button>
</ModalOverlay>

<EligibilityPickerModal form={form} />

<style>{editorCss}</style>
</s-stack>
</div>
</s-page>
);
}
