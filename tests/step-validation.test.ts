import test from "node:test";
import assert from "node:assert/strict";
import { defaultDesign, type WebsiteDraft } from "../app/modules/promotions/design/design";
import type { CreateDiscountDraft } from "../app/modules/promotions/design/discountMutation";
import { firstIssue, placeholderDraft, stepIssues, type StepValidationInput } from "../app/modules/promotions/design/stepValidation";

const website: WebsiteDraft = {
  included: true, websiteEnabled: false, showProductPage: false, showCollectionPage: false, showProductBadge: false, showCountdown: false, showHeaderBanner: false,
  headline: "", body: "", badgeText: "", countdownText: "", buttonText: "", buttonUrl: "", backgroundColour: "#ffffff", textColour: "#000000", badgeColour: "#d72c0d", priority: 0, design: defaultDesign(),
};
function input(draft: CreateDiscountDraft, change: Partial<StepValidationInput> = {}): StepValidationInput {
  return { draft, startsAt: null, endsAt: null, hasEndDate: false, endDateTime: "", website, isCodeList: false, checkRules: true, creating: true, ...change };
}
const draft = (structure: Pick<CreateDiscountDraft, "discountType" | "method">, change: Partial<CreateDiscountDraft> = {}) => ({ ...placeholderDraft({ ...structure, codeMode: "single" }), ...change });

test("a complete discount of every type has no problems in any step", () => {
  for (const discountType of ["product", "order", "bxgy", "shipping"] as const) for (const method of ["code", "automatic"] as const) {
    assert.deepEqual(stepIssues(input(draft({ discountType, method }))), {}, `${discountType} ${method}`);
  }
});

test("each step reports only its own problems, and several steps can have one at once", () => {
  const product = { discountType: "product", method: "code" } as const;
  assert.deepEqual(Object.keys(stepIssues(input(draft(product, { discountCode: "" })))), ["type"]);
  assert.deepEqual(Object.keys(stepIssues(input(draft({ discountType: "product", method: "automatic" }, { automaticTitle: " " })))), ["type"]);
  assert.deepEqual(Object.keys(stepIssues(input(draft(product, { discountValue: "" })))), ["value"]);
  assert.deepEqual(Object.keys(stepIssues(input(draft(product, { selectedCollections: [], appliesTo: "collections" })))), ["value"]);
  assert.deepEqual(Object.keys(stepIssues(input(draft(product, { eligibility: "segments", selectedEligibility: [] })))), ["who"]);
  assert.deepEqual(Object.keys(stepIssues(input(draft(product, { minimumRequirement: "amount", minimumPurchaseAmount: "" })))), ["advanced"]);
  assert.deepEqual(Object.keys(stepIssues(input(draft(product, { limitTotalUses: true, totalUsageLimit: "" })))), ["advanced"]);
  assert.deepEqual(Object.keys(stepIssues(input(draft(product, { combineProductDiscounts: true, productCombinationMode: "multiple", selectedCombinationTags: [] })))), ["advanced"]);
  const several = stepIssues(input(draft(product, { discountCode: "", discountValue: "", eligibility: "customers", selectedEligibility: [] })));
  assert.deepEqual(Object.keys(several).sort(), ["type", "value", "who"].sort());
  assert.equal(firstIssue(several)?.step, "type");
  assert.equal(firstIssue({ who: "x", schedule: "y" })?.step, "who");
  assert.equal(firstIssue({}), null);
});

test("the schedule step checks the dates and the end date field", () => {
  const product = draft({ discountType: "product", method: "code" });
  assert.deepEqual(Object.keys(stepIssues(input(product, { startsAt: "2026-10-20T00:00:00.000Z", endsAt: "2026-10-19T00:00:00.000Z", hasEndDate: true, endDateTime: "2026-10-19T00:00:00" }))), ["schedule"]);
  assert.deepEqual(Object.keys(stepIssues(input(product, { hasEndDate: true, endDateTime: "" }))), ["schedule"]);
  assert.deepEqual(stepIssues(input(product, { startsAt: "2026-10-20T00:00:00.000Z", endsAt: "2026-10-31T23:59:00.000Z", hasEndDate: true, endDateTime: "2026-10-31T23:59:00" })), {});
});

test("shipping and buy x get y have their own value checks", () => {
  assert.deepEqual(Object.keys(stepIssues(input(draft({ discountType: "shipping", method: "code" }, { countryMode: "selected", countries: [] })))), ["value"]);
  assert.deepEqual(Object.keys(stepIssues(input(draft({ discountType: "shipping", method: "code" }, { excludeShippingPrice: true, maximumShippingPrice: "" })))), ["value"]);
  assert.deepEqual(Object.keys(stepIssues(input(draft({ discountType: "bxgy", method: "code" }, { buySelection: [] })))), ["value"]);
  assert.deepEqual(Object.keys(stepIssues(input(draft({ discountType: "bxgy", method: "code" }, { rewardType: "percentage", rewardValue: "150" })))), ["value"]);
});

test("generated code lists check their settings, and the website step follows the website rules", () => {
  const list = { ...draft({ discountType: "order", method: "code" }), codeMode: "bulk" as const, codeCount: "0", codeListTitle: "Halloween" };
  assert.deepEqual(Object.keys(stepIssues(input(list, { isCodeList: true }))), ["type"]);
  assert.deepEqual(stepIssues(input({ ...list, codeCount: "100" }, { isCodeList: true })), {});
  assert.deepEqual(Object.keys(stepIssues(input({ ...list, codeCount: "100" }, { isCodeList: true, website: { ...website, websiteEnabled: true } }))), ["website"]);
  assert.deepEqual(Object.keys(stepIssues(input(draft({ discountType: "product", method: "code" }), { website: { ...website, showCountdown: true, showHeaderBanner: true, design: { ...defaultDesign(), blocks: undefined }, buttonUrl: "javascript:alert(1)" } }))), ["website"]);
});

test("an existing promotion is only checked against the discount rules when they changed", () => {
  const broken = draft({ discountType: "product", method: "code" }, { discountValue: "" });
  assert.deepEqual(stepIssues(input(broken, { checkRules: false, creating: false })), {});
  assert.deepEqual(Object.keys(stepIssues(input(broken, { checkRules: true, creating: false }))), ["value"]);
});
