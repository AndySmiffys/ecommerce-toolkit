import type { EditorDiscountDraft } from "../../design/editorDraft";
import { useEffect, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { CreateDiscountDraft } from "../../services/createPromotion.server";
import { toLocalDateTime } from "../../design/editorDraft";
import type { ResourceSearchItem, EligibilityResource, PromotionActionData } from "../../design/editorTypes";
import { defaultDesign, type WebsiteDraft } from "../../design/design";
import { typeConfig, type DiscountType } from "./shared";

/** All of the discount and website fields of the promotion form, and the handlers its sections use. */
export function useDiscountForm({ initialDiscount, initialWebsite }: { initialDiscount?: EditorDiscountDraft; initialWebsite?: WebsiteDraft }) {
const d = initialDiscount;
const w = initialDiscount?.method === "code" && initialDiscount.codeMode === "bulk" && initialWebsite ? { ...initialWebsite, websiteEnabled: false } : initialWebsite;
const shopify = useAppBridge();
const resourceFetcher = useFetcher<PromotionActionData>();
const eligibilityFetcher = useFetcher<PromotionActionData>();
const resourceSubmit = resourceFetcher.submit;
const eligibilitySubmit = eligibilityFetcher.submit;
const [searchParams] = useSearchParams();
const rawType = d?.discountType || searchParams.get("type");
const discountType: DiscountType =
rawType === "product" ||
rawType === "bxgy" ||
rawType === "order" ||
rawType === "shipping"
? rawType
: "product";

const config = typeConfig[discountType];
const [method, setMethod] = useState<"code" | "automatic">(d?.method ?? "code");
const [discountCode, setDiscountCode] = useState(d?.discountCode ?? "");
const [codeMode, setCodeMode] = useState<"single" | "bulk">(d?.codeMode ?? "single");
const [codeCount, setCodeCount] = useState(d?.codeCount ?? "100");
const [codePrefix, setCodePrefix] = useState(d?.codePrefix ?? "");
const [codeSuffix, setCodeSuffix] = useState(d?.codeSuffix ?? "");
const [codeListTitle, setCodeListTitle] = useState(d?.codeListTitle ?? "");
const isCodeList = method === "code" && codeMode === "bulk";
function changeCodeMode(mode: "single" | "bulk") {
setCodeMode(mode);
if (mode === "bulk") { setWebsiteEnabled(false); setLimitTotalUses(true); setTotalUsageLimit("1"); }
else { setLimitTotalUses(false); setTotalUsageLimit(""); }
}
const [automaticTitle, setAutomaticTitle] = useState(d?.automaticTitle ?? "");
const [valueType, setValueType] = useState<"percentage" | "fixed">(d?.valueType ?? "percentage");
const [discountValue, setDiscountValue] = useState(d?.discountValue ?? "");
const [appliesTo, setAppliesTo] = useState<"products" | "collections">(d?.appliesTo ?? "collections");
const [resourceSearch, setResourceSearch] = useState("");
const [selectedProducts, setSelectedProducts] = useState<ResourceSearchItem[]>(d?.selectedProducts ?? []);
const [selectedCollections, setSelectedCollections] = useState<ResourceSearchItem[]>(d?.selectedCollections ?? []);
const [buySelection, setBuySelection] = useState<ResourceSearchItem[]>(d?.buySelection ?? []);
const [getSelection, setGetSelection] = useState<ResourceSearchItem[]>(d?.getSelection ?? []);
const [usesPerOrder, setUsesPerOrder] = useState(d?.usesPerOrder ?? "1");
const [countryMode, setCountryMode] = useState(d?.countryMode ?? "all");
const [countryCodes, setCountryCodes] = useState(d?.countries.join(", ") ?? "");
const [excludeShippingPrice, setExcludeShippingPrice] = useState(d?.excludeShippingPrice ?? false);
const [maximumShippingPrice, setMaximumShippingPrice] = useState(d?.maximumShippingPrice ?? "");
const [buyRequirement, setBuyRequirement] = useState<"quantity" | "amount">(d?.buyRequirement ?? "quantity");
const [buyQuantity, setBuyQuantity] = useState(d?.buyQuantity ?? "1");
const [buyAmount, setBuyAmount] = useState(d?.buyAmount ?? "");
const [buyAppliesTo, setBuyAppliesTo] = useState<"products" | "collections">(d?.buyAppliesTo ?? "products");
const [getQuantity, setGetQuantity] = useState(d?.getQuantity ?? "1");
const [getAppliesTo, setGetAppliesTo] = useState<"products" | "collections">(d?.getAppliesTo ?? "products");
const [rewardType, setRewardType] = useState<"percentage" | "amount" | "free">(d?.rewardType ?? "percentage");
const [rewardValue, setRewardValue] = useState(d?.rewardValue ?? "");
const [maxUsesPerOrder, setMaxUsesPerOrder] = useState(d?.maxUsesPerOrder ?? false);
const [minimumRequirement, setMinimumRequirement] = useState<
"none" | "amount" | "quantity"
>(d?.minimumRequirement ?? "none");
const [minimumPurchaseAmount, setMinimumPurchaseAmount] = useState(d?.minimumPurchaseAmount ?? "");
const [minimumQuantity, setMinimumQuantity] = useState(d?.minimumQuantity ?? "");
const [limitTotalUses, setLimitTotalUses] = useState(d?.limitTotalUses ?? false);
const [totalUsageLimit, setTotalUsageLimit] = useState(d?.totalUsageLimit ?? "");
const [limitOncePerCustomer, setLimitOncePerCustomer] = useState(d?.limitOncePerCustomer ?? false);

const [combineProductDiscounts, setCombineProductDiscounts] = useState(d?.combineProductDiscounts ?? false);
const [combineOrderDiscounts, setCombineOrderDiscounts] = useState(d?.combineOrderDiscounts ?? false);
const [combineShippingDiscounts, setCombineShippingDiscounts] = useState(d?.combineShippingDiscounts ?? false);
const [productCombinationMode, setProductCombinationMode] = useState<"best" | "multiple">(d?.productCombinationMode ?? "best");
const [selectedCombinationTags, setSelectedCombinationTags] = useState<string[]>(d?.selectedCombinationTags ?? []);
const [startDateTime, setStartDateTime] = useState(toLocalDateTime(d?.startsAt));
const [hasEndDate, setHasEndDate] = useState(Boolean(d?.endsAt));
const [endDateTime, setEndDateTime] = useState(toLocalDateTime(d?.endsAt));
const [eligibility, setEligibility] = useState<"all" | "segments" | "customers">(d?.eligibility ?? "all");
const [eligibilitySearch, setEligibilitySearch] = useState("");
const [selectedEligibility, setSelectedEligibility] = useState<EligibilityResource[]>(d?.selectedEligibility ?? []);
const [showEligibilityPicker, setShowEligibilityPicker] = useState(false);
const [eligibilityPickerSearch, setEligibilityPickerSearch] = useState("");
const [websiteEnabled, setWebsiteEnabled] = useState(w?.websiteEnabled ?? false);
const [showProductPage, setShowProductPage] = useState(w?.showProductPage ?? false);
const [showCollectionPage, setShowCollectionPage] = useState(w?.showCollectionPage ?? false);
const [showProductBadge, setShowProductBadge] = useState(w?.showProductBadge ?? false);
const [showCountdown, setShowCountdown] = useState(w?.showCountdown ?? false);
const [showHeaderBanner, setShowHeaderBanner] = useState(w?.showHeaderBanner ?? false);
const [headline, setHeadline] = useState(w?.headline ?? "");
const [body, setBody] = useState(w?.body ?? "");
const [badgeText, setBadgeText] = useState(w?.badgeText ?? "");
const [countdownText, setCountdownText] = useState(w?.countdownText ?? "");
const [buttonText, setButtonText] = useState(w?.buttonText ?? "");
const [buttonUrl, setButtonUrl] = useState(w?.buttonUrl ?? "");
const [backgroundColour, setBackgroundColour] = useState(w?.backgroundColour ?? "#ffffff");
const [textColour, setTextColour] = useState(w?.textColour ?? "#000000");
const [badgeColour, setBadgeColour] = useState(w?.badgeColour ?? "#d72c0d");
const [design, setDesign] = useState(w?.design ?? defaultDesign());
const [priority, setPriority] = useState(w?.priority ?? 0);

function generateDiscountCode() {
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = Array.from({ length: 10 }, () =>
alphabet[Math.floor(Math.random() * alphabet.length)],
).join("");

setDiscountCode(code);
}


useEffect(() => {
const query = resourceSearch.trim();

if (query.length < 2) {
return;
}

const timeout = window.setTimeout(() => {
resourceSubmit(
{
intent: "searchResources",
resourceType: appliesTo === "products" ? "product" : "collection",
query,
},
{
method: "post",
},
);
}, 250);

return () => window.clearTimeout(timeout);
}, [resourceSearch, appliesTo, resourceSubmit]);

async function browseDiscountResources() {
const type = appliesTo === "products" ? "product" : "collection";
const currentSelection =
appliesTo === "products" ? selectedProducts : selectedCollections;

const selected = await shopify.resourcePicker({
type,
action: "select",
multiple: true,
selectionIds: currentSelection.map((item) => ({
id: item.id,
...(type === "product" && item.selectedVariantIds?.length
? {
variants: item.selectedVariantIds.map((id) => ({ id })),
}
: {}),
})),
...(type === "product"
? {
filter: {
variants: true,
},
}
: {}),
});

if (!selected) {
return;
}

const mapped = selected.map((item) => {
const variants =
"variants" in item && Array.isArray(item.variants)
? item.variants.flatMap((variant) => variant.id ? [{ id: variant.id, title: variant.title ?? "Variant" }] : [])
: undefined;

return {
id: item.id,
title: item.title,
handle: item.handle,
imageUrl:
"images" in item && Array.isArray(item.images)
? item.images[0]?.originalSrc ?? null
: null,
variants,
selectedVariantIds: variants?.map((variant) => variant.id),
};
});

if (appliesTo === "products") {
setSelectedProducts(mapped);
} else {
setSelectedCollections(mapped);
}

setResourceSearch("");
}

function addSearchedResource(resource: ResourceSearchItem) {
const selectedResource =
appliesTo === "products"
? {
...resource,
selectedVariantIds:
resource.selectedVariantIds ??
resource.variants?.map((variant) => variant.id) ??
[],
}
: resource;

if (appliesTo === "products") {
setSelectedProducts((current) =>
current.some((item) => item.id === resource.id)
? current
: [...current, selectedResource],
);
} else {
setSelectedCollections((current) =>
current.some((item) => item.id === resource.id)
? current
: [...current, selectedResource],
);
}

setResourceSearch("");
}

function removeSelectedResource(id: string) {
if (appliesTo === "products") {
setSelectedProducts((current) =>
current.filter((item) => item.id !== id),
);
} else {
setSelectedCollections((current) =>
current.filter((item) => item.id !== id),
);
}
}


useEffect(() => {
const query = eligibilitySearch.trim();

if (eligibility === "all" || query.length < 2) {
return;
}

const timeout = window.setTimeout(() => {
eligibilitySubmit(
{
intent: "searchEligibility",
eligibilityType: eligibility,
query,
},
{
method: "post",
},
);
}, 250);

return () => window.clearTimeout(timeout);
}, [eligibilitySearch, eligibility, eligibilitySubmit]);

function openEligibilityPicker() {
setEligibilityPickerSearch("");
setShowEligibilityPicker(true);

eligibilitySubmit(
{
intent: "searchEligibility",
eligibilityType: eligibility,
query: "",
},
{
method: "post",
},
);
}

function searchEligibilityPicker(value: string) {
setEligibilityPickerSearch(value);

eligibilitySubmit(
{
intent: "searchEligibility",
eligibilityType: eligibility,
query: value,
},
{
method: "post",
},
);
}

function toggleEligibilityResource(resource: EligibilityResource) {
setSelectedEligibility((current) =>
current.some((item) => item.id === resource.id)
? current.filter((item) => item.id !== resource.id)
: [...current, resource],
);
}

function removeEligibilityResource(id: string) {
setSelectedEligibility((current) =>
current.filter((item) => item.id !== id),
);
}
const websiteDraft: WebsiteDraft = { websiteEnabled, showProductPage, showCollectionPage, showProductBadge, showCountdown, showHeaderBanner, headline, body, badgeText, countdownText, buttonText, buttonUrl, backgroundColour, textColour, badgeColour, priority, design };
function updateWebsite(value: WebsiteDraft) {
setWebsiteEnabled(value.websiteEnabled); setShowProductPage(value.showProductPage); setShowCollectionPage(value.showCollectionPage); setShowProductBadge(value.showProductBadge); setShowCountdown(value.showCountdown); setShowHeaderBanner(value.showHeaderBanner);
setHeadline(value.headline); setBody(value.body); setBadgeText(value.badgeText); setCountdownText(value.countdownText); setButtonText(value.buttonText); setButtonUrl(value.buttonUrl); setBackgroundColour(value.backgroundColour); setTextColour(value.textColour); setBadgeColour(value.badgeColour); setPriority(value.priority); setDesign(value.design);
}
async function browseBxgy(scope: "buy" | "get") {
const type = (scope === "buy" ? buyAppliesTo : getAppliesTo) === "products" ? "product" : "collection";
const selected = await shopify.resourcePicker({ type, action: "select", multiple: true });
if (!selected) return;
const mapped: ResourceSearchItem[] = selected.map(item=>({ id:item.id, title:item.title, handle:item.handle, selectedVariantIds: "variants" in item && Array.isArray(item.variants) ? item.variants.flatMap(v=>v.id ? [v.id] : []) : undefined }));
(scope === "buy" ? setBuySelection : setGetSelection)(mapped);
}
const discountDraft: CreateDiscountDraft = { codeMode: method === "code" ? codeMode : "single", codeCount, codePrefix, codeSuffix, codeListTitle, discountType, method, discountCode, automaticTitle, valueType, discountValue, appliesTo, selectedProducts, selectedCollections, buyRequirement, buyQuantity, buyAmount, buyAppliesTo, buySelection, getQuantity, getAppliesTo, getSelection, rewardType, rewardValue, maxUsesPerOrder, usesPerOrder, minimumRequirement, minimumPurchaseAmount, minimumQuantity, limitTotalUses, totalUsageLimit, limitOncePerCustomer, combineProductDiscounts, combineOrderDiscounts, combineShippingDiscounts, productCombinationMode, selectedCombinationTags, startsAt: startDateTime || null, endsAt: hasEndDate && endDateTime ? endDateTime : null, eligibility, selectedEligibility, countryMode: countryMode as "all" | "selected", excludeShippingPrice, countries: countryMode === "selected" ? countryCodes.split(",").map(c=>c.trim().toUpperCase()).filter(Boolean) : [], maximumShippingPrice: excludeShippingPrice ? maximumShippingPrice : "" };

return { d, w, shopify, resourceFetcher, eligibilityFetcher, resourceSubmit, eligibilitySubmit, searchParams, rawType, discountType, config, method, setMethod, discountCode, setDiscountCode, codeMode, setCodeMode, codeCount, setCodeCount, codePrefix, setCodePrefix, codeSuffix, setCodeSuffix, codeListTitle, setCodeListTitle, isCodeList, changeCodeMode, automaticTitle, setAutomaticTitle, valueType, setValueType, discountValue, setDiscountValue, appliesTo, setAppliesTo, resourceSearch, setResourceSearch, selectedProducts, setSelectedProducts, selectedCollections, setSelectedCollections, buySelection, setBuySelection, getSelection, setGetSelection, usesPerOrder, setUsesPerOrder, countryMode, setCountryMode, countryCodes, setCountryCodes, excludeShippingPrice, setExcludeShippingPrice, maximumShippingPrice, setMaximumShippingPrice, buyRequirement, setBuyRequirement, buyQuantity, setBuyQuantity, buyAmount, setBuyAmount, buyAppliesTo, setBuyAppliesTo, getQuantity, setGetQuantity, getAppliesTo, setGetAppliesTo, rewardType, setRewardType, rewardValue, setRewardValue, maxUsesPerOrder, setMaxUsesPerOrder, minimumRequirement, setMinimumRequirement, minimumPurchaseAmount, setMinimumPurchaseAmount, minimumQuantity, setMinimumQuantity, limitTotalUses, setLimitTotalUses, totalUsageLimit, setTotalUsageLimit, limitOncePerCustomer, setLimitOncePerCustomer, combineProductDiscounts, setCombineProductDiscounts, combineOrderDiscounts, setCombineOrderDiscounts, combineShippingDiscounts, setCombineShippingDiscounts, productCombinationMode, setProductCombinationMode, selectedCombinationTags, setSelectedCombinationTags, startDateTime, setStartDateTime, hasEndDate, setHasEndDate, endDateTime, setEndDateTime, eligibility, setEligibility, eligibilitySearch, setEligibilitySearch, selectedEligibility, setSelectedEligibility, showEligibilityPicker, setShowEligibilityPicker, eligibilityPickerSearch, setEligibilityPickerSearch, websiteEnabled, setWebsiteEnabled, showProductPage, setShowProductPage, showCollectionPage, setShowCollectionPage, showProductBadge, setShowProductBadge, showCountdown, setShowCountdown, showHeaderBanner, setShowHeaderBanner, headline, setHeadline, body, setBody, badgeText, setBadgeText, countdownText, setCountdownText, buttonText, setButtonText, buttonUrl, setButtonUrl, backgroundColour, setBackgroundColour, textColour, setTextColour, badgeColour, setBadgeColour, design, setDesign, priority, setPriority, generateDiscountCode, browseDiscountResources, addSearchedResource, removeSelectedResource, openEligibilityPicker, searchEligibilityPicker, toggleEligibilityResource, removeEligibilityResource, websiteDraft, updateWebsite, browseBxgy, discountDraft };
}
export type DiscountForm = ReturnType<typeof useDiscountForm>;
