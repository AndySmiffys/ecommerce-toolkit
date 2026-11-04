import { buildDiscountMutation, type CreateDiscountDraft } from "./createPromotion.server";
import type { ShopifyAdminClient } from "./discount.server";
import type { ShopifyDiscountNode } from "../types/discount";
import { discountToEditorDraft } from "../design/editorDraft";

type ItemInput = { all?: boolean; collections?: { add?: string[]; remove?: string[] }; products?: { productsToAdd?: string[]; productsToRemove?: string[]; productVariantsToAdd?: string[]; productVariantsToRemove?: string[] } };
type GetsInput = { items: ItemInput; value: { discountAmount?: { amount: string; appliesOnEachItem: boolean } } };
type Items = NonNullable<ShopifyDiscountNode["discount"]["customerGets"]>["items"];
function removeMissingItems(next: ItemInput, previous?: Items) {
  if (!previous || next.all) return;
  const oldCollections = previous.collections?.nodes.map(c => c.id) ?? [];
  const oldProducts = previous.products?.nodes.map(p => p.id) ?? [];
  const oldVariants = previous.productVariants?.nodes.map(v => v.id) ?? [];
  const collectionsToRemove = oldCollections.filter(id => !next.collections?.add?.includes(id));
  const productsToRemove = oldProducts.filter(id => !next.products?.productsToAdd?.includes(id));
  const variantsToRemove = oldVariants.filter(id => !next.products?.productVariantsToAdd?.includes(id));
  if (collectionsToRemove.length) next.collections = { ...next.collections, remove: collectionsToRemove };
  if (productsToRemove.length || variantsToRemove.length) next.products = { ...next.products, productsToRemove, productVariantsToRemove: variantsToRemove };
}
export function buildUpdateDiscountMutation(node: ShopifyDiscountNode, draft: CreateDiscountDraft) {
  const previous = discountToEditorDraft(node);
  if (previous.discountType !== draft.discountType || previous.method !== draft.method) throw new Error("An existing discount's type and method cannot be changed.");
  if (draft.method === "code" && draft.discountCode !== previous.discountCode) throw new Error("Manage changes to existing discount codes in Shopify.");
  if (!draft.startsAt) throw new Error("Keep or select a start date for this promotion.");
  const request = buildDiscountMutation(draft);
  const input = request.variables.input as Record<string, unknown>;
  // Preserve codes, names and searchable tags not represented by this editor.
  delete input.tags;
  delete input.code;
  if (draft.method === "code") input.title = previous.codeMode !== "bulk" && node.discount.title?.toUpperCase() === draft.discountCode.toUpperCase() ? draft.discountCode.trim().toUpperCase() : node.discount.title;
  if (draft.discountType !== "bxgy" && draft.minimumRequirement === "none") input.minimumRequirement = null;
  // Subscription purchase flags are deliberately absent from customerGets updates.
  const gets = input.customerGets as GetsInput | undefined;
  if (gets) {
    removeMissingItems(gets.items, node.discount.customerGets?.items);
    if (gets.value.discountAmount && node.discount.customerGets?.value.__typename === "DiscountAmount") gets.value.discountAmount.appliesOnEachItem = node.discount.customerGets.value.appliesOnEachItem ?? false;
  }
  const buys = input.customerBuys as { items: ItemInput } | undefined;
  if (buys) removeMissingItems(buys.items, node.discount.customerBuys?.items);
  const context = input.context as { customers?: { add: string[]; remove?: string[] }; customerSegments?: { add: string[]; remove?: string[] } };
  if (context.customers) context.customers.remove = (node.discount.context?.customers ?? []).map(c => c.id).filter(id => !context.customers!.add.includes(id));
  if (context.customerSegments) context.customerSegments.remove = (node.discount.context?.segments ?? []).map(s => s.id).filter(id => !context.customerSegments!.add.includes(id));
  if (draft.discountType === "shipping") {
    const destination = input.destination as { countries?: { add: string[]; remove?: string[] } };
    if (destination.countries) destination.countries.remove = (node.discount.destinationSelection?.countries ?? []).filter(code => !destination.countries!.add.includes(code));
    // The editor does not change purchase types. Omit these fields to retain the
    // existing settings and avoid rejecting shops without subscription support.
    delete input.appliesOnOneTimePurchase;
    delete input.appliesOnSubscription;
  }
  if (draft.combineProductDiscounts) {
    const combinesWith = input.combinesWith as Record<string, unknown>;
    const add = draft.productCombinationMode === "multiple" ? draft.selectedCombinationTags : [];
    const remove = (node.discount.combinesWith?.productDiscountsWithTagsOnSameCartLine ?? []).filter(tag => !add.includes(tag));
    if (add.length || remove.length) combinesWith.productDiscountsWithTagsOnSameCartLine = { add, remove };
  }
  if (!/^gid:\/\/shopify\/DiscountNode\/\d+$/.test(node.id)) throw new Error("Invalid existing discount ID.");
  const id = `gid://shopify/${draft.method === "code" ? "DiscountCodeNode" : "DiscountAutomaticNode"}/${node.id.split("/").pop()}`;
  return { query: request.query.replace("mutation CreatePromotion($input:", "mutation UpdatePromotion($id: ID!, $input:").replace(/Create\(/, "Update(id: $id, "), variables: { ...request.variables, input, id } };
}
export async function updateShopifyPromotion(admin: ShopifyAdminClient, node: ShopifyDiscountNode, draft: CreateDiscountDraft) {
  const request = buildUpdateDiscountMutation(node, draft);
  const response = await admin.graphql(request.query, { variables: request.variables });
  const result = await response.json();
  const errors = [...(result.errors ?? []), ...(result.data?.result?.userErrors ?? [])];
  if (errors.length) throw new Error(errors.map((error: { message: string }) => error.message).join(", "));
  const id = result.data?.result?.codeDiscountNode?.id ?? result.data?.result?.automaticDiscountNode?.id;
  if (!id || id.split("/").pop() !== node.id.split("/").pop()) throw new Error("Shopify did not confirm the promotion update.");
  return node.id;
}
