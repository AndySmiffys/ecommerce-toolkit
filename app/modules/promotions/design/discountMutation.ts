import { normalizeSharedCode, type CodeOptions } from "./codeGeneration";

type Selection = { id: string; selectedVariantIds?: string[]; variants?: Array<{ id: string }> };
export type CreateDiscountDraft = CodeOptions & {
  discountType: "product" | "order" | "bxgy" | "shipping";
  method: "code" | "automatic"; discountCode: string; automaticTitle: string;
  valueType: "percentage" | "fixed"; discountValue: string;
  appliesTo: "products" | "collections"; selectedProducts: Selection[]; selectedCollections: Selection[];
  buyRequirement: "quantity" | "amount"; buyQuantity: string; buyAmount: string;
  buyAppliesTo: "products" | "collections"; buySelection: Selection[];
  getQuantity: string; getAppliesTo: "products" | "collections"; getSelection: Selection[];
  rewardType: "percentage" | "amount" | "free"; rewardValue: string;
  maxUsesPerOrder: boolean; usesPerOrder: string;
  minimumRequirement: "none" | "amount" | "quantity"; minimumPurchaseAmount: string; minimumQuantity: string;
  limitTotalUses: boolean; totalUsageLimit: string; limitOncePerCustomer: boolean;
  combineProductDiscounts: boolean; combineOrderDiscounts: boolean; combineShippingDiscounts: boolean;
  productCombinationMode: "best" | "multiple"; selectedCombinationTags: string[];
  startsAt: string | null; endsAt: string | null;
  eligibility: "all" | "segments" | "customers"; selectedEligibility: Array<{ id: string }>;
  countries: string[]; countryMode?: "all" | "selected"; excludeShippingPrice?: boolean; maximumShippingPrice: string;
};
function positive(value: string, label: string, integer = false): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || (integer && (!Number.isSafeInteger(n) || n > 2147483647))) throw new Error(`Enter a valid ${label}.`);
  return n;
}
function ids(values: string[], type: string): string[] {
  if (!Array.isArray(values) || values.length > 250 || values.some(id => typeof id !== "string" || !new RegExp(`^gid://shopify/${type}/\\d+$`).test(id))) throw new Error(`Invalid ${type} selection.`);
  return [...new Set(values)];
}
function items(type: string, resources: Selection[]) {
  if (!Array.isArray(resources) || !resources.length) throw new Error(`Select ${type} for the discount.`);
  if (type === "collections") return { collections: { add: ids(resources.map(r => r.id), "Collection") } };
  if (type !== "products") throw new Error("Invalid resource type.");
  const products = resources.filter(r => !r.variants?.length && !r.selectedVariantIds?.length).map(r => r.id);
  const variants = resources.flatMap(r => r.selectedVariantIds ?? []);
  if (!products.length && !variants.length) throw new Error("Select at least one product variant.");
  return { products: { productsToAdd: ids(products, "Product"), productVariantsToAdd: ids(variants, "ProductVariant") } };
}
export function buildDiscountMutation(d: CreateDiscountDraft, now = new Date()): { query: string; variables: Record<string, unknown> } {
  if (!["product", "order", "bxgy", "shipping"].includes(d.discountType) || !["code", "automatic"].includes(d.method)) throw new Error("Choose a valid discount type and method.");
  const code = d.method === "code";
  const redeemCode = code ? normalizeSharedCode(d.discountCode) : null;
  const title = (code ? d.codeMode === "bulk" ? d.codeListTitle : redeemCode : d.automaticTitle)?.trim();
  if (!title || title.length > 255) throw new Error(code ? "Enter a discount code (up to 255 characters)." : "Enter a discount title (up to 255 characters).");
  const startsAt = d.startsAt || now.toISOString();
  if (!Number.isFinite(Date.parse(startsAt)) || (d.endsAt && (!Number.isFinite(Date.parse(d.endsAt)) || Date.parse(d.endsAt) <= Date.parse(startsAt)))) throw new Error("The end must be after the promotion start.");
  const context = d.eligibility === "all" ? { all: "ALL" } : d.eligibility === "customers" ? { customers: { add: ids(d.selectedEligibility.map(r => r.id), "Customer") } } : d.eligibility === "segments" ? { customerSegments: { add: ids(d.selectedEligibility.map(r => r.id), "Segment") } } : null;
  if (!context || (d.eligibility !== "all" && !d.selectedEligibility.length)) throw new Error("Select the eligible customers or segments.");
  const combinesWith = { productDiscounts: Boolean(d.combineProductDiscounts), orderDiscounts: Boolean(d.combineOrderDiscounts), shippingDiscounts: Boolean(d.combineShippingDiscounts), ...(d.combineProductDiscounts && d.productCombinationMode === "multiple" ? { productDiscountsWithTagsOnSameCartLine: { add: d.selectedCombinationTags } } : {}) };
  if (d.combineProductDiscounts && d.productCombinationMode === "multiple" && (!Array.isArray(d.selectedCombinationTags) || !d.selectedCombinationTags.length)) throw new Error("Select combination tags for discounts on the same product.");
  const input: Record<string, unknown> = { title, startsAt, endsAt: d.endsAt || null, context, combinesWith, tags: [d.discountType === "shipping" ? "FREE SHIPPING" : d.discountType.toUpperCase()] };
  if (code) Object.assign(input, { code: redeemCode, appliesOncePerCustomer: Boolean(d.limitOncePerCustomer), usageLimit: d.limitTotalUses ? positive(d.totalUsageLimit, "usage limit", true) : null });
  if (d.discountType !== "bxgy") {
    if (d.minimumRequirement === "amount") input.minimumRequirement = { subtotal: { greaterThanOrEqualToSubtotal: String(positive(d.minimumPurchaseAmount, "minimum amount")) } };
    else if (d.minimumRequirement === "quantity") input.minimumRequirement = { quantity: { greaterThanOrEqualToQuantity: String(positive(d.minimumQuantity, "minimum quantity", true)) } };
    else if (d.minimumRequirement !== "none") throw new Error("Invalid minimum requirement.");
  }
  let type: string, mutation: string, argument: string;
  if (d.discountType === "shipping") {
    if (!Array.isArray(d.countries) || d.countries.some(c => !/^[A-Z]{2}$/.test(c))) throw new Error("Enter two-letter country codes, separated by commas.");
    if (d.countryMode === "selected" && !d.countries.length) throw new Error("Select at least one country.");
    if (d.excludeShippingPrice && !d.maximumShippingPrice) throw new Error("Enter a maximum shipping rate.");
    Object.assign(input, { destination: d.countries.length ? { countries: { add: d.countries } } : { all: true }, maximumShippingPrice: d.maximumShippingPrice ? String(positive(d.maximumShippingPrice, "maximum shipping price")) : null });
    type = code ? "DiscountCodeFreeShippingInput" : "DiscountAutomaticFreeShippingInput";
    mutation = code ? "discountCodeFreeShippingCreate" : "discountAutomaticFreeShippingCreate";
    argument = code ? "freeShippingCodeDiscount" : "freeShippingAutomaticDiscount";
  } else if (d.discountType === "bxgy") {
    const percentage = d.rewardType === "free" ? 1 : positive(d.rewardValue, "reward value") / 100;
    if (d.rewardType === "percentage" && percentage > 1) throw new Error("The reward percentage must be 100 or less.");
    const effect = d.rewardType === "amount" ? { amount: String(positive(d.rewardValue, "reward amount")) } : { percentage };
    Object.assign(input, {
      customerBuys: { items: items(d.buyAppliesTo, d.buySelection), value: d.buyRequirement === "amount" ? { amount: String(positive(d.buyAmount, "purchase amount")) } : { quantity: String(positive(d.buyQuantity, "purchase quantity", true)) } },
      customerGets: { items: items(d.getAppliesTo, d.getSelection), value: { discountOnQuantity: { quantity: String(positive(d.getQuantity, "reward quantity", true)), effect } } },
      usesPerOrderLimit: d.maxUsesPerOrder ? (code ? positive(d.usesPerOrder, "uses per order", true) : String(positive(d.usesPerOrder, "uses per order", true))) : null,
    });
    type = code ? "DiscountCodeBxgyInput" : "DiscountAutomaticBxgyInput";
    mutation = code ? "discountCodeBxgyCreate" : "discountAutomaticBxgyCreate";
    argument = code ? "bxgyCodeDiscount" : "automaticBxgyDiscount";
  } else {
    const amount = positive(d.discountValue, "discount value");
    if (d.valueType === "percentage" && amount > 100) throw new Error("The percentage must be 100 or less.");
    if (!["percentage", "fixed"].includes(d.valueType)) throw new Error("Invalid discount value type.");
    input.customerGets = { items: d.discountType === "order" ? { all: true } : items(d.appliesTo, d.appliesTo === "products" ? d.selectedProducts : d.selectedCollections), value: d.valueType === "percentage" ? { percentage: amount / 100 } : { discountAmount: { amount: String(amount), appliesOnEachItem: d.discountType === "product" } } };
    type = code ? "DiscountCodeBasicInput" : "DiscountAutomaticBasicInput";
    mutation = code ? "discountCodeBasicCreate" : "discountAutomaticBasicCreate";
    argument = code ? "basicCodeDiscount" : "automaticBasicDiscount";
  }
  return { query: `mutation CreatePromotion($input: ${type}!) { result: ${mutation}(${argument}: $input) { ${code ? "codeDiscountNode" : "automaticDiscountNode"} { id } userErrors { field message } } }`, variables: { input } };
}
