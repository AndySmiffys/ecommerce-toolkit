import { getStatusTone } from "../design/statusTone";
import { ShippingCountryPicker } from "./ShippingCountryPicker";
import type { ShippingCountries } from "../services/shippingCountries.server";
import { FormStep } from "./FormStep";
import { buildDiscountMutation } from "../design/discountMutation";
import { summarisePromotion } from "../design/promotionSummary";
import { PolarisSelect, PolarisCheckbox } from "./PolarisControls";
import { PromotionSaveBar } from "./PromotionSaveBar";
import { PromotionCodeList } from "./PromotionCodeList";
import { validateCodeOptions, type CodeBatchSummary } from "../design/codeGeneration";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import { useEffect, useId, useRef, useState } from "react";
import { useFetcher, useSearchParams, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { CreateDiscountDraft } from "../services/createPromotion.server";
import type { EditorDiscountDraft } from "../design/editorDraft";
import { toLocalDateTime } from "../design/editorDraft";
import type { LinkResource, ResourceSearchItem, EligibilityResource, PromotionActionData } from "../design/editorTypes";
import { defaultDesign, validateWebsite, type Placement, type WebsiteDraft } from "../design/design";
import { customerVisibilityMessage, storefrontVisibilityNotices } from "../design/storefrontVisibility";
import { PromotionWebsiteEditor } from "./PromotionWebsiteEditor";
import { PromotionPreview, type PreviewProduct } from "./PromotionPreview";
import type { action as previewAction } from "../../../routes/app.promotion-preview";
function RadioOption({ name, value, label, checked, onChange }: { name: string; value: string; label: string; checked: boolean; onChange: () => void }) {
  return <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}><input type="radio" name={name} value={value} checked={checked} onChange={onChange} style={{ margin: 0, accentColor: "#202223" }} /><span>{label}</span></label>;
}
function ScheduleDateTimeField({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [month, setMonth] = useState({ year: 2000, month: 0 });
  const fieldRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !fieldRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function toggle() {
    if (open) {
      close();
      return;
    }
    const initial = value || min || "";
    const date = initial ? new Date(initial) : new Date();
    setDraft(initial);
    setMonth({ year: date.getFullYear(), month: date.getMonth() });
    setOpen(true);
  }

  const datePart = draft.slice(0, 10);
  const hour = draft.slice(11, 13) || "00";
  const minute = draft.slice(14, 16) || "00";
  const valid = Boolean(datePart) && (!min || draft >= min);
  const firstDay = (new Date(month.year, month.month, 1).getDay() + 6) % 7;
  const days = new Date(month.year, month.month + 1, 0).getDate();
  const monthTitle = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" })
    .format(new Date(month.year, month.month, 1));
  const summary = value
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "Select date and time";
  const controlStyle = { padding: "8px", border: "1px solid #c9c9c9", borderRadius: "8px", background: "#fff", color: "#202223", font: "inherit", cursor: "pointer" };

  function moveMonth(offset: number) {
    const date = new Date(month.year, month.month + offset, 1);
    setMonth({ year: date.getFullYear(), month: date.getMonth() });
  }

  return (
    <div style={{ display: "grid", gap: "5px", fontSize: "12px", color: "#303030" }}>
      <span id={id + "-label"}>{label}</span>
      <div ref={fieldRef} style={{ position: "relative" }}>
        {open && (
          <div ref={dialogRef} id={id + "-editor"} role="dialog" aria-labelledby={id + "-title"} tabIndex={-1}
            style={{ position: "absolute", zIndex: 50, bottom: "calc(100% + 8px)", left: 0, width: "min(340px, 100%)", maxHeight: "60vh", overflowY: "auto", boxSizing: "border-box", padding: "16px", border: "1px solid #c9c9c9", borderRadius: "12px", background: "#fff", boxShadow: "0 10px 28px rgba(0,0,0,.16)" }}>
            <div id={id + "-title"} style={{ fontSize: "13px", fontWeight: 600, marginBottom: "12px" }}>{label}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
              <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)} style={controlStyle}>‹</button>
              <span aria-live="polite" style={{ fontWeight: 600 }}>{monthTitle}</span>
              <button type="button" aria-label="Next month" onClick={() => moveMonth(1)} style={controlStyle}>›</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "3px" }}>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <span key={day} style={{ textAlign: "center", fontSize: "10px", color: "#616161", padding: "5px 0" }}>{day}</span>)}
              {Array.from({ length: firstDay }, (_, index) => <span key={"blank-" + index} />)}
              {Array.from({ length: days }, (_, index) => {
                const day = index + 1;
                const dayValue = String(month.year).padStart(4, "0") + "-" + String(month.month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
                const disabled = Boolean(min && dayValue < min.slice(0, 10));
                const selected = dayValue === datePart;
                return <button key={dayValue} type="button" disabled={disabled} aria-pressed={selected}
                  aria-label={new Intl.DateTimeFormat("en-GB", { dateStyle: "full" }).format(new Date(month.year, month.month, day))}
                  onClick={() => setDraft(dayValue + "T" + hour + ":" + minute)}
                  style={{ ...controlStyle, padding: "7px 0", borderColor: selected ? "#202223" : "transparent", background: selected ? "#202223" : "#fff", color: selected ? "#fff" : disabled ? "#b5b5b5" : "#202223", cursor: disabled ? "default" : "pointer" }}>{day}</button>;
              })}
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "end", marginTop: "14px" }}>
              <label htmlFor={id + "-hour"} style={{ display: "grid", gap: "5px", flex: 1 }}>Hour
                <select id={id + "-hour"} disabled={!datePart} value={hour} onChange={event => setDraft(datePart + "T" + event.currentTarget.value + ":" + minute)} style={controlStyle}>
                  {Array.from({ length: 24 }, (_, index) => { const option = String(index).padStart(2, "0"); return <option key={option} value={option}>{option}</option>; })}
                </select>
              </label>
              <label htmlFor={id + "-minute"} style={{ display: "grid", gap: "5px", flex: 1 }}>Minute
                <select id={id + "-minute"} disabled={!datePart} value={minute} onChange={event => setDraft(datePart + "T" + hour + ":" + event.currentTarget.value)} style={controlStyle}>
                  {Array.from({ length: 60 }, (_, index) => { const option = String(index).padStart(2, "0"); return <option key={option} value={option}>{option}</option>; })}
                </select>
              </label>
              <span style={{ color: "#616161", paddingBottom: "9px", fontSize: "11px" }}>Local time</span>
            </div>
            {datePart && !valid && <p role="alert" style={{ color: "#b42318", margin: "10px 0 0" }}>End date and time must be on or after the start.</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "14px" }}>
              <button type="button" onClick={close} style={controlStyle}>Cancel</button>
              <button type="button" disabled={!valid} onClick={() => { onChange(draft); close(); }}
                style={{ ...controlStyle, background: valid ? "#202223" : "#eee", color: valid ? "#fff" : "#999", cursor: valid ? "pointer" : "default" }}>Done</button>
            </div>
          </div>
        )}
        <button ref={triggerRef} type="button" aria-labelledby={id + "-label"} aria-haspopup="dialog" aria-expanded={open}
          aria-controls={open ? id + "-editor" : undefined} onClick={toggle}
          style={{ ...controlStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", width: "100%", minHeight: "42px", padding: "8px 10px", fontSize: "13px", textAlign: "left", boxSizing: "border-box" }}>
          <span suppressHydrationWarning>{summary}</span><span style={{ color: "#616161", fontSize: "11px" }}>Local time</span>
        </button>
      </div>
    </div>
  );
}

type DiscountType = "product" | "bxgy" | "order" | "shipping";

const typeConfig: Record<
DiscountType,
{
title: string;
typeLabel: string;
description: string;
}
> = {
product: {
title: "Amount off products",
typeLabel: "Product discount",
description: "Discount specific products or collections of products",
},
bxgy: {
title: "Buy X get Y",
typeLabel: "Product discount",
description: "Discount specific products or collections of products",
},
order: {
title: "Amount off order",
typeLabel: "Order discount",
description: "Discount the total order amount",
},
shipping: {
title: "Free shipping",
typeLabel: "Shipping discount",
description: "Offer free shipping on an order",
},
};

function formatPreviewPrice(product?: LinkResource): string {
const money = product?.priceRangeV2?.minVariantPrice;

if (!money) {
return "Price unavailable";
}

const amount = Number.parseFloat(money.amount);

if (!Number.isFinite(amount)) {
return money.amount;
}

return new Intl.NumberFormat("en-GB", {
style: "currency",
currency: money.currencyCode || "GBP",
}).format(amount);
}

function FormSection({
title,
heading = false,
children,
}: {
title: string;
heading?: boolean;
children: React.ReactNode;
}) {
return <section aria-label={title} style={{ display: "grid", gap: 12, minWidth: 0 }}>{heading && <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{title}</h3>}{children}</section>;
}

export function PromotionEditor({ products, initialDiscount, initialWebsite, promotionId, shopifyStatus, codeBatch, shippingCountries }: { products: LinkResource[]; initialDiscount?: EditorDiscountDraft; initialWebsite?: WebsiteDraft; promotionId?: string; shopifyStatus?: string; codeBatch?: CodeBatchSummary | null; shippingCountries?: ShippingCountries | null }) {
const d = initialDiscount;
const w = initialDiscount?.method === "code" && initialDiscount.codeMode === "bulk" && initialWebsite ? { ...initialWebsite, websiteEnabled: false } : initialWebsite;
  const appUrl = useEmbeddedAppUrl();

const shopify = useAppBridge();
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
const creationRequestKey = useRef<string>();
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
const [showCombinationPicker, setShowCombinationPicker] = useState(false);
const combinationFieldRef = useRef<HTMLDivElement>(null);
const combinationTriggerRef = useRef<HTMLButtonElement>(null);
const combinationDialogRef = useRef<HTMLDivElement>(null);
useEffect(() => {
if (!showCombinationPicker) return;
combinationDialogRef.current?.focus();
function closeOnOutsideClick(event: PointerEvent) {
if (event.target instanceof Node && !combinationFieldRef.current?.contains(event.target)) {
setShowCombinationPicker(false);
setShowCombinationTags(false);
}
}
function closeOnEscape(event: KeyboardEvent) {
if (event.key === "Escape") {
setShowCombinationPicker(false);
setShowCombinationTags(false);
combinationTriggerRef.current?.focus();
}
}
document.addEventListener("pointerdown", closeOnOutsideClick);
document.addEventListener("keydown", closeOnEscape);
return () => {
document.removeEventListener("pointerdown", closeOnOutsideClick);
document.removeEventListener("keydown", closeOnEscape);
};
}, [showCombinationPicker]);

const [combineProductDiscounts, setCombineProductDiscounts] = useState(d?.combineProductDiscounts ?? false);
const [combineOrderDiscounts, setCombineOrderDiscounts] = useState(d?.combineOrderDiscounts ?? false);
const [combineShippingDiscounts, setCombineShippingDiscounts] = useState(d?.combineShippingDiscounts ?? false);
const [productCombinationMode, setProductCombinationMode] = useState<"best" | "multiple">(d?.productCombinationMode ?? "best");
const [showCombinationTags, setShowCombinationTags] = useState(false);
const [combinationTagSearch, setCombinationTagSearch] = useState("");
const [selectedCombinationTags, setSelectedCombinationTags] = useState<string[]>(d?.selectedCombinationTags ?? []);
const [startDateTime, setStartDateTime] = useState(toLocalDateTime(d?.startsAt));
const [hasEndDate, setHasEndDate] = useState(Boolean(d?.endsAt));
const [endDateTime, setEndDateTime] = useState(toLocalDateTime(d?.endsAt));
const [eligibility, setEligibility] = useState<"all" | "segments" | "customers">(d?.eligibility ?? "all");
const [eligibilitySearch, setEligibilitySearch] = useState("");
const [selectedEligibility, setSelectedEligibility] = useState<EligibilityResource[]>(d?.selectedEligibility ?? []);
const [showEligibilityPicker, setShowEligibilityPicker] = useState(false);
const [eligibilityPickerSearch, setEligibilityPickerSearch] = useState("");
const [included, setIncluded] = useState(w?.included ?? true);
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
const [previewProductId, setPreviewProductId] = useState("");
const [isPreviewDrawerOpen, setIsPreviewDrawerOpen] = useState(false);

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

const summary = summarisePromotion({ discountType, method, discountCode, codeMode, codeCount, automaticTitle, valueType, discountValue, appliesTo, productCount: selectedProducts.length, collectionCount: selectedCollections.length, buyRequirement, buyQuantity, buyAmount, getQuantity, rewardType, rewardValue, countryMode, countryCount: countryCodes.split(",").map(code => code.trim()).filter(Boolean).length, minimumRequirement, minimumPurchaseAmount, minimumQuantity, limitTotalUses, totalUsageLimit, limitOncePerCustomer, combines: combineProductDiscounts || combineOrderDiscounts || combineShippingDiscounts, eligibility, eligibilityCount: selectedEligibility.length, startDateTime, hasEndDate, endDateTime });
const selectedBlocks = [showHeaderBanner, showCollectionPage, showProductPage, showProductBadge].filter(Boolean).length;
const websiteSummary = selectedBlocks ? `${websiteEnabled ? "Enabled" : "Draft"}, ${selectedBlocks} ${selectedBlocks === 1 ? "block" : "blocks"} selected` : "Not set up yet";
const [openStep, setOpenStep] = useState<string | null>("type");
const stepOrder = ["type", "value", "who", "schedule", "advanced", "website"];
const stepTitles: Record<string, string> = { type: "Type and method", value: discountType === "shipping" ? "Countries" : "Discount value", who: "Who can use it", schedule: "Schedule", advanced: "Advanced options", website: "Website promotion" };
const stepProps = (id: string) => {
  const index = stepOrder.indexOf(id); const following = stepOrder[index + 1];
  return { id, number: index + 1, title: stepTitles[id], open: openStep === id, onToggle: (open: boolean) => setOpenStep(current => open ? id : current === id ? null : current), next: following ? { label: `Continue to ${stepTitles[following].toLowerCase()}`, onClick: () => setOpenStep(following) } : undefined };
};

const [visibilityNow, setVisibilityNow] = useState(() => Date.now());
useEffect(() => { const timer = setInterval(() => setVisibilityNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
const websiteDraft: WebsiteDraft = { included, websiteEnabled, showProductPage, showCollectionPage, showProductBadge, showCountdown, showHeaderBanner, headline, body, badgeText, countdownText, buttonText, buttonUrl, backgroundColour, textColour, badgeColour, priority, design };
const visibilityNotices = storefrontVisibilityNotices(websiteDraft, {
  eligibility, eligibilityCount: selectedEligibility.length,
  startsAt: startDateTime || null, endsAt: hasEndDate ? endDateTime || null : null,
  codeList: isCodeList,
  productTarget: discountType === "product" ? appliesTo : discountType === "bxgy" ? getAppliesTo : null,
}, visibilityNow);
function updateWebsite(value: WebsiteDraft) {
setIncluded(value.included); setWebsiteEnabled(value.websiteEnabled); setShowProductPage(value.showProductPage); setShowCollectionPage(value.showCollectionPage); setShowProductBadge(value.showProductBadge); setShowCountdown(value.showCountdown); setShowHeaderBanner(value.showHeaderBanner);
setHeadline(value.headline); setBody(value.body); setBadgeText(value.badgeText); setCountdownText(value.countdownText); setButtonText(value.buttonText); setButtonUrl(value.buttonUrl); setBackgroundColour(value.backgroundColour); setTextColour(value.textColour); setBadgeColour(value.badgeColour); setPriority(value.priority); setDesign(value.design);
}
const eligibleSelection = JSON.stringify({ productIds: discountType === "product" && appliesTo === "products" ? selectedProducts.map(p=>p.id) : discountType === "bxgy" && getAppliesTo === "products" ? getSelection.map(p=>p.id) : [], collectionIds: discountType === "product" && appliesTo === "collections" ? selectedCollections.map(p=>p.id) : discountType === "bxgy" && getAppliesTo === "collections" ? getSelection.map(p=>p.id) : [] });
const previewSubmitRef = useRef(previewFetcher.submit); previewSubmitRef.current = previewFetcher.submit;
useEffect(() => { previewSubmitRef.current({ selection: eligibleSelection }, { method: "post", action: "/app/promotion-preview" }); }, [eligibleSelection]);
const productOptions: PreviewProduct[] = products.map(p=>({ id:p.id, title:p.title, image:p.featuredImage?.url, price:formatPreviewPrice(p) }));
const eligibleProducts = previewFetcher.data?.key === eligibleSelection ? previewFetcher.data.products : [];
const previewProducts = previewProductId ? productOptions.filter(p=>p.id===previewProductId) : eligibleProducts;
const [previewPlacement, setPreviewPlacement] = useState<Placement | undefined>();
const websitePreview = <PromotionPreview placement={previewPlacement} onPlacementChange={setPreviewPlacement} visibilityNotices={visibilityNotices} discountCode={method === "code" && !isCodeList ? discountCode : null} offerNote={isCodeList ? "Use your individual code at checkout." : method === "code" ? discountCode ? `Use code: ${discountCode}` : "Add a discount code" : "Applied automatically at checkout."} value={websiteDraft} products={previewProducts} endsAt={hasEndDate ? endDateTime : null} productOptions={productOptions} onProductChange={setPreviewProductId} selectedProductId={previewProductId} loading={previewFetcher.state !== "idle"} sample={eligibleSelection === '{"productIds":[],"collectionIds":[]}' && discountType !== "order" && discountType !== "shipping"} />;
async function browseBxgy(scope: "buy" | "get") {
const type = (scope === "buy" ? buyAppliesTo : getAppliesTo) === "products" ? "product" : "collection";
const selected = await shopify.resourcePicker({ type, action: "select", multiple: true });
if (!selected) return;
const mapped: ResourceSearchItem[] = selected.map(item=>({ id:item.id, title:item.title, handle:item.handle, selectedVariantIds: "variants" in item && Array.isArray(item.variants) ? item.variants.flatMap(v=>v.id ? [v.id] : []) : undefined }));
(scope === "buy" ? setBuySelection : setGetSelection)(mapped);
}
const discountDraft: CreateDiscountDraft = { codeMode: method === "code" ? codeMode : "single", codeCount, codePrefix, codeSuffix, codeListTitle, discountType, method, discountCode, automaticTitle, valueType, discountValue, appliesTo, selectedProducts, selectedCollections, buyRequirement, buyQuantity, buyAmount, buyAppliesTo, buySelection, getQuantity, getAppliesTo, getSelection, rewardType, rewardValue, maxUsesPerOrder, usesPerOrder, minimumRequirement, minimumPurchaseAmount, minimumQuantity, limitTotalUses, totalUsageLimit, limitOncePerCustomer, combineProductDiscounts, combineOrderDiscounts, combineShippingDiscounts, productCombinationMode, selectedCombinationTags, startsAt: startDateTime || null, endsAt: hasEndDate && endDateTime ? endDateTime : null, eligibility, selectedEligibility, countryMode: countryMode as "all" | "selected", excludeShippingPrice, countries: countryMode === "selected" ? countryCodes.split(",").map(c=>c.trim().toUpperCase()).filter(Boolean) : [], maximumShippingPrice: excludeShippingPrice ? maximumShippingPrice : "" };
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

async function discardChanges() {
if (assetsBusy || createFetcher.state !== "idle" || (!promotionId && codeListLocked && !createdDiscountId)) return;
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
setShowCombinationPicker(false);
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
if (createFetcher.data?.success) { if (promotionId) { setSavedSnapshot(submittedSnapshot.current); setSavedDiscountSnapshot(submittedDiscountSnapshot.current); } else if (createFetcher.data.redirectId) {
setSavedSnapshot(submittedSnapshot.current);
const destination = appUrl(`/app/promotions/${createFetcher.data.redirectId}`);
shopify.toast.show("Promotion created");
navigate(destination);
} }
});

// Everything Shopify would reject is caught here first, so Save only appears for a complete discount.
const saveIssue = (() => {
if (isCodeList && websiteEnabled) return "Keep code lists in website Draft status. Distribute the individual codes using the CSV download.";
if (hasEndDate && !endDateTime) return "Choose an end date and time, or turn off the end date.";
if (!promotionId || discountSnapshot !== savedDiscountSnapshot) {
try {
if (isCodeList && !promotionId) validateCodeOptions(discountDraft);
buildDiscountMutation({ ...discountDraft, discountCode: isCodeList ? "CODE" : discountDraft.discountCode, startsAt: startDateTime ? new Date(startDateTime).toISOString() : null, endsAt: hasEndDate && endDateTime ? new Date(endDateTime).toISOString() : null });
} catch (error) { return error instanceof Error ? error.message : "Check the discount settings."; }
}
return validateWebsite(websiteDraft, hasEndDate ? endDateTime : null)[0] ?? null;
})();

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
{promotionId && <s-button slot="secondary-actions" href={`shopify:admin/discounts/${promotionId.split("/").pop()}`} target="_blank">Edit in Shopify</s-button>}
<PromotionSaveBar dirty={hasUnsavedChanges} saving={createFetcher.state !== "idle"} busy={assetsBusy} discardDisabled={!promotionId && codeListLocked && !createdDiscountId} issue={saveIssue} error={submissionError || (createFetcher.data !== dismissedResponse ? createFetcher.data?.error : undefined)} savedToken={promotionId && createFetcher.data?.success ? createFetcher.data : null} showWhileIncomplete={Boolean(promotionId)} onSave={savePromotion} onDiscard={discardChanges} />
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
{saveIssue && <span style={{ fontSize: 12, color: "#8a5a00", overflowWrap: "anywhere" }}>To save: {saveIssue}</span>}
</div>
<FormStep {...stepProps("type")} summary={summary.type}>
<FormSection title="Method">
{promotionId && <p style={{ margin: "0 0 12px", color: "#616161", fontSize: 12 }}>The existing discount type and method are retained. Manage changes to discount codes in Shopify.</p>}
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

<div
role="group"
aria-label="Discount method"
style={{
display: "inline-flex",
padding: "2px",
borderRadius: "8px",
background: "#f1f1f1",
}}
>
<button
type="button"
aria-pressed={method === "code"}
disabled={Boolean(promotionId || codeListLocked)} onClick={() => setMethod("code")}
style={{
border: 0,
borderRadius: "7px",
padding: "7px 11px",
background: method === "code" ? "#ffffff" : "transparent",
boxShadow:
method === "code"
? "0 1px 2px rgba(0, 0, 0, 0.12)"
: "none",
color: "#202223",
font: "inherit",
fontSize: "12px",
fontWeight: 600,
cursor: "pointer",
}}
>
Discount code
</button>

<button
type="button"
aria-pressed={method === "automatic"}
disabled={Boolean(promotionId || codeListLocked)} onClick={() => setMethod("automatic")}
style={{
border: 0,
borderRadius: "7px",
padding: "7px 11px",
background:
method === "automatic" ? "#ffffff" : "transparent",
boxShadow:
method === "automatic"
? "0 1px 2px rgba(0, 0, 0, 0.12)"
: "none",
color: "#202223",
font: "inherit",
fontSize: "12px",
fontWeight: 600,
cursor: "pointer",
}}
>
Automatic discount
</button>
</div>
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
<p style={{ margin: 0, color: "#616161", fontSize: 13 }}>Format: <strong>{codePrefix}XXXXXXXXXXXX{codeSuffix}</strong><br />Each X is a random letter or number. Codes default to one use each; adjust this under Maximum discount uses.</p>
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

<button
type="button"
disabled={Boolean(promotionId || codeListLocked)} onClick={generateDiscountCode}
style={{
border: 0,
padding: 0,
background: "transparent",
color: "#005bd3",
font: "inherit",
fontSize: "12px",
cursor: "pointer",
}}
>
Generate random code
</button>
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
</FormStep>

<FormStep {...stepProps("value")} summary={summary.value}>
{discountType === "product" && (
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
<button
key={resource.id}
type="button"
onClick={() => addSearchedResource(resource)}
style={{
display: "flex",
alignItems: "center",
gap: "10px",
width: "100%",
padding: "9px 12px",
border: 0,
borderTop: "1px solid #f1f1f1",
background: "#ffffff",
color: "#202223",
textAlign: "left",
font: "inherit",
cursor: "pointer",
}}
>
{resource.imageUrl && (
<img
src={resource.imageUrl}
alt=""
style={{
width: "34px",
height: "34px",
borderRadius: "6px",
objectFit: "cover",
flex: "0 0 auto",
}}
/>
)}
<span style={{ fontSize: "12px", fontWeight: 600 }}>
{resource.title}
</span>
</button>
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
<button
type="button"
onClick={browseDiscountResources}
style={{
border: 0,
background: "transparent",
color: "#005bd3",
font: "inherit",
fontSize: "11px",
cursor: "pointer",
}}
>
Edit variants
</button>
)}
<button
type="button"
onClick={() => removeSelectedResource(resource.id)}
style={{
border: 0,
background: "transparent",
color: "#8a1f11",
font: "inherit",
fontSize: "11px",
cursor: "pointer",
}}
>
Remove
</button>
</div>
</div>
))}
</div>
)}
</div>
</s-stack>
</FormSection>
)}

{discountType === "order" && (
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
)}

{discountType === "bxgy" && (
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
<RadioOption
name="buyRequirement"
value="quantity"
label="Minimum quantity of items"
checked={buyRequirement === "quantity"}
onChange={() => setBuyRequirement("quantity")}
/>
<RadioOption
name="buyRequirement"
value="amount"
label="Minimum purchase amount"
checked={buyRequirement === "amount"}
onChange={() => setBuyRequirement("amount")}
/>

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

<div><s-button type="button" variant="secondary" onClick={()=>browseBxgy("buy")}>Select buy items</s-button><ul>{buySelection.map(item=><li key={item.id}>{item.title}</li>)}</ul></div>
</s-stack>
</div>

<div
style={{
paddingTop: "16px",
borderTop: "1px solid #eeeeee",
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

<div><s-button type="button" variant="secondary" onClick={()=>browseBxgy("get")}>Select get items</s-button><ul>{getSelection.map(item=><li key={item.id}>{item.title}</li>)}</ul></div>

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
<RadioOption
name="rewardType"
value="percentage"
label="Percentage"
checked={rewardType === "percentage"}
onChange={() => setRewardType("percentage")}
/>
{rewardType === "percentage" && (
<div style={{ maxWidth: "150px", marginLeft: "26px" }}>
<s-number-field
label="Percentage"
labelAccessibilityVisibility="exclusive"
min={0}
max={100}
step={0.01}
suffix="%"
value={rewardValue}
onInput={(event) =>
setRewardValue(event.currentTarget.value)
}
/>
</div>
)}

<RadioOption
name="rewardType"
value="amount"
label="Amount off each"
checked={rewardType === "amount"}
onChange={() => setRewardType("amount")}
/>
{rewardType === "amount" && (
<div style={{ maxWidth: "150px", marginLeft: "26px" }}>
<s-number-field
label="Amount"
labelAccessibilityVisibility="exclusive"
min={0}
step={0.01}
prefix="£"
value={rewardValue}
onInput={(event) =>
setRewardValue(event.currentTarget.value)
}
/>
</div>
)}

<RadioOption
name="rewardType"
value="free"
label="Free"
checked={rewardType === "free"}
onChange={() => setRewardType("free")}
/>
</s-stack>
</div>

<div
style={{
paddingTop: "14px",
borderTop: "1px solid #eeeeee",
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
)}

{discountType === "shipping" && (
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
)}
</FormStep>

<FormStep {...stepProps("who")} summary={summary.who}>
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
border: "1px solid #dedede",
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
<button
key={resource.id}
type="button"
onClick={() => {
toggleEligibilityResource(resource);
setEligibilitySearch("");
}}
style={{
display: "block",
width: "100%",
padding: "9px 12px",
border: 0,
borderTop: "1px solid #f1f1f1",
background: "#ffffff",
color: "#202223",
textAlign: "left",
font: "inherit",
cursor: "pointer",
}}
>
<span style={{ display: "block", fontSize: "12px", fontWeight: 600 }}>
{resource.name}
</span>
{resource.secondary && (
<span
style={{
display: "block",
marginTop: "2px",
color: "#616161",
fontSize: "11px",
}}
>
{resource.secondary}
</span>
)}
</button>
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

<button
type="button"
onClick={() => removeEligibilityResource(resource.id)}
style={{
border: 0,
background: "transparent",
color: "#8a1f11",
font: "inherit",
fontSize: "11px",
cursor: "pointer",
}}
>
Remove
</button>
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
</FormStep>

<FormStep {...stepProps("schedule")} summary={summary.schedule}>
<FormSection title="Schedule">
<div style={{display:"grid",gap:"12px"}}>
<ScheduleDateTimeField label="Start date and time" value={startDateTime} onChange={setStartDateTime} />

<PolarisCheckbox
label="Set end date"
checked={hasEndDate}
onChange={(event)=>{
setHasEndDate(event.currentTarget.checked);
if(!event.currentTarget.checked){
setEndDateTime("");
}
}}
/>

{hasEndDate&&(
<ScheduleDateTimeField label="End date and time" value={endDateTime} min={startDateTime||undefined} onChange={setEndDateTime} />
)}
</div>
</FormSection>
</FormStep>

<FormStep {...stepProps("advanced")} optional summary={summary.advanced}>
{discountType !== "bxgy" && (
<FormSection title="Minimum purchase requirements" heading>
<div
style={{
display: "grid",
gap: "10px",
}}
>
{[
{
value: "none",
label: "No minimum requirements",
},
{
value: "amount",
label: "Minimum purchase amount",
},
{
value: "quantity",
label: "Minimum quantity of items",
},
].map((option) => (
<div
key={option.value}
style={{
display: "grid",
gap: "8px",
}}
>
<label
style={{
display: "flex",
alignItems: "center",
gap: "8px",
color: "#202223",
fontSize: "13px",
cursor: "pointer",
}}
>
<input
type="radio"
name="minimumRequirement"
value={option.value}
checked={minimumRequirement === option.value}
onChange={() =>
setMinimumRequirement(
option.value as
| "none"
| "amount"
| "quantity",
)
}
style={{
width: "16px",
height: "16px",
margin: 0,
accentColor: "#202223",
cursor: "pointer",
}}
/>
<span>{option.label}</span>
</label>

{option.value === "amount" &&
minimumRequirement === "amount" && (
<div
style={{
maxWidth: "220px",
marginLeft: "24px",
}}
>
<s-number-field
label="Minimum purchase amount"
labelAccessibilityVisibility="exclusive"
min={0}
step={0.01}
prefix="£"
value={minimumPurchaseAmount}
onInput={(event) =>
setMinimumPurchaseAmount(
event.currentTarget.value,
)
}
details="Customers must spend at least this amount to use the discount."
/>
</div>
)}

{option.value === "quantity" &&
minimumRequirement === "quantity" && (
<div
style={{
maxWidth: "220px",
marginLeft: "24px",
}}
>
<s-number-field
label="Minimum quantity of items"
labelAccessibilityVisibility="exclusive"
min={1}
step={1}
value={minimumQuantity}
onInput={(event) =>
setMinimumQuantity(
event.currentTarget.value,
)
}
details="Customers must add at least this many eligible items to use the discount."
/>
</div>
)}
</div>
))}
</div>
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

<section style={{borderTop:"1px solid #ebebeb",paddingTop:"16px"}}>
<div id="combinations-label" style={{color:"#202223",fontSize:"14px",fontWeight:650,marginBottom:"8px"}}>Combinations</div>
<div ref={combinationFieldRef} style={{position:"relative"}}>
{showCombinationPicker&&(
<div ref={combinationDialogRef} id="combinations-editor" role="dialog" aria-labelledby="combinations-editor-title" tabIndex={-1} style={{position:"absolute",zIndex:30,left:0,bottom:"calc(100% + 8px)",width:"min(390px, 100%)",maxHeight:"min(520px, 60vh)",overflowY:"auto",boxSizing:"border-box",padding:"16px",border:"1px solid #dedede",borderRadius:"12px",background:"#fff",boxShadow:"0 10px 28px rgba(0,0,0,.16)"}}>
<div id="combinations-editor-title" style={{marginBottom:"12px",fontSize:"13px",fontWeight:600}}>Allow this discount to combine with other discounts</div>
{[
["Product discounts","Multiple can apply per order",combineProductDiscounts,setCombineProductDiscounts],
["Order discounts","Multiple can apply per order",combineOrderDiscounts,setCombineOrderDiscounts],
["Shipping discounts","Only one can apply per order (best value wins)",combineShippingDiscounts,setCombineShippingDiscounts],
].map(([label,detail,checked,setChecked])=>(
<label key={String(label)} aria-label={String(label)} htmlFor={`combination-${String(label).split(" ")[0].toLowerCase()}`} style={{display:"flex",alignItems:"flex-start",gap:"10px",padding:"8px 0",cursor:"pointer"}}>
<input id={`combination-${String(label).split(" ")[0].toLowerCase()}`} type="checkbox" checked={Boolean(checked)} onChange={e=>{(setChecked as React.Dispatch<React.SetStateAction<boolean>>)(e.currentTarget.checked);if(label==="Product discounts"&&!e.currentTarget.checked){setShowCombinationTags(false);setSelectedCombinationTags([]);}}} style={{width:"18px",height:"18px",marginTop:"1px"}}/>
<span><span style={{display:"block",fontSize:"13px"}}>{String(label)}</span><span style={{display:"block",marginTop:"2px",color:"#616161",fontSize:"11px"}}>{String(detail)}</span></span>
</label>
))}
{combineProductDiscounts&&(
<>
<div style={{marginTop:"8px",maxWidth:"310px"}}>
<PolarisSelect label="Product discount combination" labelAccessibilityVisibility="exclusive" value={productCombinationMode} onChange={e=>{const value=e.currentTarget.value as "best"|"multiple";setProductCombinationMode(value);if(value==="best"){setShowCombinationTags(false);setSelectedCombinationTags([]);}}}>
<s-option value="best">One per product (best value wins)</s-option>
<s-option value="multiple">Multiple per product</s-option>
</PolarisSelect>
</div>
{productCombinationMode==="multiple"&&(
<div style={{position:"relative",marginTop:"10px"}}>
<div style={{marginBottom:"5px",color:"#303030",fontSize:"12px"}}>Combine on same product with discounts tagged</div>
<button type="button" onClick={()=>setShowCombinationTags(v=>!v)} style={{width:"100%",minHeight:"36px",padding:"7px 10px",border:"1px solid #c9c9c9",borderRadius:"8px",background:"#fff",color:"#202223",textAlign:"left",font:"inherit",fontSize:"12px",cursor:"pointer"}}>+ Select tags{selectedCombinationTags.length?` (${selectedCombinationTags.length})`:""}</button>
{showCombinationTags&&(
<div style={{marginTop:"8px",width:"100%",overflow:"hidden",border:"1px solid #dedede",borderRadius:"10px",background:"#fff",boxShadow:"0 8px 24px rgba(0,0,0,.16)"}}>
<div style={{padding:"8px",borderBottom:"1px solid #eee"}}>
<input type="search" value={combinationTagSearch} onChange={e=>setCombinationTagSearch(e.currentTarget.value)} placeholder="Search discount tags" style={{width:"100%",minHeight:"34px",border:"1px solid #c9c9c9",borderRadius:"7px",padding:"6px 9px",font:"inherit",fontSize:"12px"}}/>
</div>
{["FREE SHIPPING","ORDER","PRODUCT","BXGY","CUSTOMER TARGET"].filter(tag=>tag.toLowerCase().includes(combinationTagSearch.trim().toLowerCase())).map(tag=>(
<label key={tag} style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 10px",borderBottom:"1px solid #f3f3f3",fontSize:"12px",cursor:"pointer"}}>
<input type="checkbox" checked={selectedCombinationTags.includes(tag)} onChange={()=>setSelectedCombinationTags(v=>v.includes(tag)?v.filter(x=>x!==tag):[...v,tag])}/>
<span>{tag}</span>
</label>
))}
</div>
)}
</div>
)}
</>
)}
<div style={{display:"flex",justifyContent:"flex-end",marginTop:"12px"}}>
<button type="button" onClick={()=>{setShowCombinationPicker(false);setShowCombinationTags(false);combinationTriggerRef.current?.focus();}} style={{padding:"7px 14px",border:"1px solid #c9c9c9",borderRadius:"8px",background:"#fff",font:"inherit",fontSize:"12px",cursor:"pointer"}}>Done</button>
</div>
</div>
)}
<button ref={combinationTriggerRef} type="button" aria-labelledby="combinations-label" aria-haspopup="dialog" aria-expanded={showCombinationPicker} aria-controls={showCombinationPicker?"combinations-editor":undefined} onClick={()=>{setShowCombinationPicker(v=>!v);setShowCombinationTags(false);}} style={{display:"block",width:"100%",padding:"12px",border:"1px solid #c9c9c9",borderRadius:"8px",background:"#fff",color:"#202223",font:"inherit",textAlign:"left",cursor:"pointer",fontSize:"13px",lineHeight:1.5}}>
<span style={{display:"block"}}>
<strong>{method==="code"?discountCode||"This discount":automaticTitle||"This discount"}</strong>{" "}
{!combineProductDiscounts&&!combineOrderDiscounts&&!combineShippingDiscounts?"won't combine with other product, order, or shipping discounts in the customer's cart.":"can be combined with the following discounts in the customer's cart:"}
</span>
{combineProductDiscounts&&<span style={{display:"block",marginTop:"8px"}}><strong>Product discounts</strong><span style={{display:"block",color:"#616161",fontSize:"11px"}}>Multiple can apply per order • {productCombinationMode==="best"?"One per product (best value wins)":"Multiple per product"}</span>{productCombinationMode==="multiple"&&<span style={{display:"block",color:"#616161",fontSize:"11px"}}>Tags: {selectedCombinationTags.join(", ")||"None selected"}</span>}</span>}
{combineOrderDiscounts&&<span style={{display:"block",marginTop:"8px"}}><strong>Order discounts</strong><span style={{display:"block",color:"#616161",fontSize:"11px"}}>Multiple can apply per order</span></span>}
{combineShippingDiscounts&&<span style={{display:"block",marginTop:"8px"}}><strong>Shipping discounts</strong><span style={{display:"block",color:"#616161",fontSize:"11px"}}>Only one can apply per order (best value wins)</span></span>}
</button>
</div>
</section>
</FormStep>



<FormStep {...stepProps("website")} optional summary={websiteSummary}>
<PromotionWebsiteEditor onActiveBlockChange={setPreviewPlacement} publicationDisabled={isCodeList} value={websiteDraft} onChange={value => updateWebsite(isCodeList ? { ...value, websiteEnabled: false } : value)} endsAt={hasEndDate ? endDateTime : null} onBusyChange={setAssetsBusy} />
</FormStep>
{previewFetcher.data?.error && <s-banner tone="warning">{previewFetcher.data.error}</s-banner>}
{!promotionId && createdDiscountId && <s-button href={appUrl(`/app/promotions/${createdDiscountId.split("/").pop()}`)} variant="secondary">Open saved promotion</s-button>}


</s-stack>
</div>

</div>


<button
type="button"
className="preview-drawer-toggle"
onClick={() => setIsPreviewDrawerOpen(true)}
aria-label="Open storefront preview"
>
Preview
</button>

{isPreviewDrawerOpen && (
<div
className="preview-drawer-backdrop"
>
<button type="button" aria-label="Close preview backdrop" onClick={()=>setIsPreviewDrawerOpen(false)} style={{position:"absolute",inset:0,border:0,background:"transparent"}} />
<aside
className="preview-drawer"
role="dialog"
aria-modal="true"
aria-label="Storefront preview"
>
<div className="preview-drawer-header">
<div>
<div style={{ fontSize: "14px", fontWeight: 700 }}>
Storefront preview
</div>
<div style={{ marginTop: "2px", color: "#616161", fontSize: "11px" }}>
Updates live as you change the promotion.
</div>
</div>

<button
type="button"
aria-label="Close preview"
onClick={() => setIsPreviewDrawerOpen(false)}
style={{
width: "32px",
height: "32px",
border: "1px solid #dedede",
borderRadius: "8px",
background: "#ffffff",
color: "#202223",
fontSize: "18px",
cursor: "pointer",
}}
>
×
</button>
</div>

<div className="preview-drawer-body">
{websitePreview}
</div>
</aside>
</div>
)}

{showEligibilityPicker && (
<div

style={{
position: "fixed",
inset: 0,
zIndex: 120,
display: "flex",
alignItems: "center",
justifyContent: "center",
padding: "24px",
background: "rgba(0, 0, 0, 0.45)",
}}
>
<button type="button" aria-label="Close customer selector backdrop" onClick={()=>setShowEligibilityPicker(false)} style={{position:"absolute",inset:0,border:0,background:"transparent"}} />
<div
role="dialog"
aria-modal="true"
aria-labelledby="eligibility-picker-title"
style={{
position: "relative",
width: "min(100%, 620px)",
maxHeight: "78vh",
display: "flex",
flexDirection: "column",
overflow: "hidden",
borderRadius: "14px",
background: "#ffffff",
boxShadow: "0 18px 48px rgba(0,0,0,0.24)",
}}
>
<div
style={{
display: "flex",
alignItems: "center",
justifyContent: "space-between",
gap: "12px",
padding: "16px 18px",
borderBottom: "1px solid #eeeeee",
}}
>
<div id="eligibility-picker-title" style={{ fontSize: "16px", fontWeight: 700 }}>
{eligibility === "segments"
? "Select customer segments"
: "Select customers"}
</div>

<button
type="button"
aria-label="Close"
onClick={() => setShowEligibilityPicker(false)}
style={{
width: "32px",
height: "32px",
border: "1px solid #dedede",
borderRadius: "8px",
background: "#ffffff",
fontSize: "18px",
cursor: "pointer",
}}
>
×
</button>
</div>

<div style={{ padding: "12px", borderBottom: "1px solid #eeeeee" }}>
<s-text-field
label={eligibility === "segments" ? "Search segments" : "Search customers"}
labelAccessibilityVisibility="exclusive"
placeholder={eligibility === "segments" ? "Search segments" : "Search customers"}
value={eligibilityPickerSearch}
onInput={(event) => searchEligibilityPicker(event.currentTarget.value)}
/>
</div>

<div style={{ overflowY: "auto", padding: "6px" }}>
{eligibilityFetcher.state !== "idle" && (
<div style={{ padding: "18px", color: "#616161", fontSize: "12px" }}>
Loading…
</div>
)}

{eligibilityFetcher.state === "idle" &&
eligibilityFetcher.data?.eligibilityResources?.map((resource) => {
const selected = selectedEligibility.some(
(item) => item.id === resource.id,
);

return (
<button
key={resource.id}
type="button"
onClick={() => toggleEligibilityResource(resource)}
style={{
display: "flex",
alignItems: "center",
gap: "10px",
width: "100%",
padding: "10px 12px",
border: 0,
borderBottom: "1px solid #f1f1f1",
background: selected ? "#f3f8f4" : "#ffffff",
color: "#202223",
textAlign: "left",
font: "inherit",
cursor: "pointer",
}}
>
<span
aria-hidden="true"
style={{
display: "flex",
alignItems: "center",
justifyContent: "center",
width: "18px",
height: "18px",
flex: "0 0 auto",
border: selected
? "1px solid #202223"
: "1px solid #8c8c8c",
borderRadius: "4px",
background: selected ? "#202223" : "#ffffff",
color: "#ffffff",
fontSize: "11px",
}}
>
{selected ? "✓" : ""}
</span>

<span style={{ minWidth: 0 }}>
<span style={{ display: "block", fontSize: "12px", fontWeight: 600 }}>
{resource.name}
</span>
{resource.secondary && (
<span
style={{
display: "block",
marginTop: "2px",
color: "#616161",
fontSize: "11px",
}}
>
{resource.secondary}
</span>
)}
</span>
</button>
);
})}

{eligibilityFetcher.state === "idle" &&
eligibilityFetcher.data?.eligibilityResources?.length === 0 && (
<div style={{ padding: "18px", color: "#616161", fontSize: "12px" }}>
No {eligibility === "segments" ? "segments" : "customers"} found.
</div>
)}
</div>

<div
style={{
display: "flex",
justifyContent: "flex-end",
gap: "8px",
padding: "12px 16px",
borderTop: "1px solid #eeeeee",
}}
>
<s-button
type="button"
variant="secondary"
onClick={() => setShowEligibilityPicker(false)}
>
Cancel
</s-button>
<s-button
type="button"
variant="primary"
onClick={() => setShowEligibilityPicker(false)}
>
Done
</s-button>
</div>
</div>
</div>
)}


<style>{`
.preview-drawer-toggle {
display: none;
position: fixed;
left: 0;
top: 42%;
z-index: 90;
border: 1px solid #c9c9c9;
border-left: 0;
border-radius: 0 9px 9px 0;
padding: 12px 8px;
background: #dff5e5;
color: #174c2a;
box-shadow: 0 2px 8px rgba(0,0,0,0.12);
font: inherit;
font-size: 11px;
font-weight: 700;
writing-mode: vertical-rl;
cursor: pointer;
}

.preview-drawer-backdrop {
position: fixed;
inset: 0;
z-index: 110;
background: rgba(0,0,0,0.42);
}

.preview-drawer {
position: absolute;
inset: 0 auto 0 0;
width: min(92vw, 560px);
display: flex;
flex-direction: column;
background: #f6f6f7;
box-shadow: 12px 0 32px rgba(0,0,0,0.2);
}

.preview-drawer-header {
display: flex;
align-items: center;
justify-content: space-between;
gap: 12px;
padding: 14px 16px;
border-bottom: 1px solid #dedede;
background: #ffffff;
}

.preview-drawer-body {
overflow-y: auto;
padding: 14px;
}

@media (max-width: 1380px) {
.create-discount-layout {
grid-template-columns: minmax(0, 1fr) !important;
}

.desktop-preview-panel {
display: none;
}

.preview-drawer-toggle {
display: block;
}
}

@media (max-width: 800px) {
.create-discount-layout {
grid-template-columns: 1fr !important;
}

.discount-value-row,
.bxgy-pair-row,
.website-preview-grid,
.website-preview-collection-banner,
.website-preview-product-page,
.link-selector-layout,
.schedule-date-time-row {
grid-template-columns: 1fr !important;
}

.link-selector-layout > div:first-child {
border-right: 0 !important;
border-bottom: 1px solid #eeeeee;
}
}
`}</style>
</s-stack>
</div>
</s-page>
);
}
