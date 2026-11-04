import type { CreateDiscountDraft } from "../services/createPromotion.server";
import type { ShopifyDiscountNode } from "../types/discount";
import type { ResourceSearchItem, EligibilityResource } from "./editorTypes";
import { isSupportedShopifyDiscountTypename } from "../adapters/shopifyDiscountRegistry";

export type EditorDiscountDraft = Omit<CreateDiscountDraft, "selectedProducts" | "selectedCollections" | "buySelection" | "getSelection" | "selectedEligibility"> & {
  selectedProducts: ResourceSearchItem[]; selectedCollections: ResourceSearchItem[];
  buySelection: ResourceSearchItem[]; getSelection: ResourceSearchItem[];
  selectedEligibility: EligibilityResource[];
};
type Items = NonNullable<ShopifyDiscountNode["discount"]["customerGets"]>["items"];
export function toLocalDateTime(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
function selections(items?: Items): { type: "products" | "collections"; resources: ResourceSearchItem[] } {
  if (!items) return { type: "products", resources: [] };
  if ([items.products, items.productVariants, items.collections].some(c => c?.pageInfo?.hasNextPage)) throw new Error("This discount has more selected items than the editor can load. Edit its rules in Shopify; website styling can still be edited here.");
  if (items.__typename === "DiscountCollections") return { type: "collections", resources: (items.collections?.nodes ?? []).map(c => ({ id: c.id, title: c.title, handle: "" })) };
  const products: ResourceSearchItem[] = (items.products?.nodes ?? []).map(p => ({ id: p.id, title: p.title, handle: "" }));
  for (const variant of items.productVariants?.nodes ?? []) {
    if (!variant.product) throw new Error("A selected variant has no product. Edit this discount's rules in Shopify.");
    const product = products.find(p => p.id === variant.product!.id);
    // Whole-product selection already includes this variant. Do not narrow it.
    if (product && !product.selectedVariantIds) continue;
    if (product) { product.selectedVariantIds!.push(variant.id); product.variants!.push({ id: variant.id, title: variant.title }); }
    else products.push({ id: variant.product.id, title: variant.product.title, handle: "", selectedVariantIds: [variant.id], variants: [{ id: variant.id, title: variant.title }] });
  }
  return { type: "products", resources: products };
}
export function discountToEditorDraft(node: ShopifyDiscountNode): EditorDiscountDraft {
  const d = node.discount;
  if (!isSupportedShopifyDiscountTypename(d.__typename)) throw new Error("This discount is managed by another app. Edit its rules in Shopify; website styling can still be edited here.");
  const discountType = d.__typename.includes("Bxgy") ? "bxgy" : d.__typename.includes("FreeShipping") ? "shipping" : d.discountClasses?.includes("ORDER") ? "order" : "product";
  if (discountType === "product" && d.customerGets?.items.__typename === "AllDiscountItems") throw new Error("All-product discounts must be edited in Shopify; website styling can still be edited here.");
  if (d.context && !["DiscountBuyerSelectionAll", "DiscountCustomers", "DiscountCustomerSegments"].includes(d.context.__typename)) throw new Error("This discount uses eligibility that must be edited in Shopify; website styling can still be edited here.");
  const gets = selections(d.customerGets?.items), buys = selections(d.customerBuys?.items);
  const value = d.customerGets?.value;
  const effect = value?.effect;
  const rewardType = effect?.__typename === "DiscountAmount" ? "amount" : effect?.percentage === 1 ? "free" : "percentage";
  const context = d.context;
  const eligibility = context?.__typename === "DiscountCustomers" ? "customers" : context?.__typename === "DiscountCustomerSegments" ? "segments" : "all";
  if ((context?.customers?.length ?? 0) > 250 || (context?.segments?.length ?? 0) > 250) throw new Error("This discount has more selected buyers than the editor can save. Edit its rules in Shopify.");
  const tags = d.combinesWith?.productDiscountsWithTagsOnSameCartLine ?? [];
  return {
    codeMode: (d.codesCount?.count ?? d.codes?.nodes.length ?? 0) > 1 ? "bulk" : "single", codeCount: String(d.codesCount?.count ?? d.codes?.nodes.length ?? 1), codeListTitle: d.title ?? "",
    discountType, method: d.__typename.includes("Automatic") ? "automatic" : "code", discountCode: d.codes?.nodes[0]?.code ?? "", automaticTitle: d.title ?? "",
    valueType: value?.__typename === "DiscountAmount" ? "fixed" : "percentage", discountValue: value?.amount?.amount ?? (value?.percentage !== undefined ? String(Number((value.percentage * 100).toFixed(8))) : ""),
    appliesTo: gets.type, selectedProducts: gets.type === "products" ? gets.resources : [], selectedCollections: gets.type === "collections" ? gets.resources : [],
    buyRequirement: d.customerBuys?.value.__typename === "DiscountPurchaseAmount" ? "amount" : "quantity", buyQuantity: d.customerBuys?.value.quantity ?? "1", buyAmount: d.customerBuys?.value.amount ?? "", buyAppliesTo: buys.type, buySelection: buys.resources,
    getQuantity: value?.quantity?.quantity ?? "1", getAppliesTo: gets.type, getSelection: gets.resources, rewardType, rewardValue: effect?.amount?.amount ?? (effect?.percentage !== undefined ? String(Number((effect.percentage * 100).toFixed(8))) : ""),
    maxUsesPerOrder: d.usesPerOrderLimit != null, usesPerOrder: String(d.usesPerOrderLimit ?? "1"),
    minimumRequirement: d.minimumRequirement?.__typename === "DiscountMinimumSubtotal" ? "amount" : d.minimumRequirement?.__typename === "DiscountMinimumQuantity" ? "quantity" : "none", minimumPurchaseAmount: d.minimumRequirement?.greaterThanOrEqualToSubtotal?.amount ?? "", minimumQuantity: d.minimumRequirement?.greaterThanOrEqualToQuantity ?? "",
    limitTotalUses: d.usageLimit != null, totalUsageLimit: String(d.usageLimit ?? ""), limitOncePerCustomer: d.appliesOncePerCustomer ?? false,
    combineProductDiscounts: d.combinesWith?.productDiscounts ?? false, combineOrderDiscounts: d.combinesWith?.orderDiscounts ?? false, combineShippingDiscounts: d.combinesWith?.shippingDiscounts ?? false, productCombinationMode: tags.length ? "multiple" : "best", selectedCombinationTags: tags,
    startsAt: d.startsAt ?? null, endsAt: d.endsAt ?? null, eligibility,
    selectedEligibility: eligibility === "customers" ? (context?.customers ?? []).map(c => ({ id: c.id, name: c.displayName })) : (context?.segments ?? []).map(c => ({ id: c.id, name: c.name })),
    countries: d.destinationSelection?.countries ?? [], countryMode: d.destinationSelection?.allCountries === false || d.destinationSelection?.countries?.length ? "selected" : "all", excludeShippingPrice: d.maximumShippingPrice != null, maximumShippingPrice: d.maximumShippingPrice?.amount ?? "",
  };
}
