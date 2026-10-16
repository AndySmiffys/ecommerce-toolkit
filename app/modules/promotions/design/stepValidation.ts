import { validateCodeOptions } from "./codeGeneration";
import { validateWebsite, type WebsiteDraft } from "./design";
import { buildDiscountMutation, type CreateDiscountDraft } from "./discountMutation";
import type { StepId } from "./saveIssueStep";

export const stepOrder: StepId[] = ["type", "value", "who", "schedule", "advanced", "website"];

// The fields each step of the form owns. A step is checked with its own fields and
// known-good placeholders for everything else, so one step's problem never hides another's.
const stepFields: Record<"type" | "value" | "who" | "schedule" | "advanced", Array<keyof CreateDiscountDraft>> = {
  type: ["method", "discountCode", "codeMode", "codeCount", "codePrefix", "codeSuffix", "codeListTitle", "automaticTitle"],
  value: ["valueType", "discountValue", "appliesTo", "selectedProducts", "selectedCollections", "buyRequirement", "buyQuantity", "buyAmount", "buyAppliesTo", "buySelection", "getQuantity", "getAppliesTo", "getSelection", "rewardType", "rewardValue", "maxUsesPerOrder", "usesPerOrder", "countries", "countryMode", "excludeShippingPrice", "maximumShippingPrice"],
  who: ["eligibility", "selectedEligibility"],
  schedule: ["startsAt", "endsAt"],
  advanced: ["minimumRequirement", "minimumPurchaseAmount", "minimumQuantity", "limitTotalUses", "totalUsageLimit", "limitOncePerCustomer", "combineProductDiscounts", "combineOrderDiscounts", "combineShippingDiscounts", "productCombinationMode", "selectedCombinationTags"],
};

/** A complete discount of the same type and method, used to check one step on its own. */
export function placeholderDraft(structure: Pick<CreateDiscountDraft, "discountType" | "method" | "codeMode">): CreateDiscountDraft {
  const collection = { id: "gid://shopify/Collection/1" };
  return {
    ...structure, discountCode: "CODE", automaticTitle: "Title", codeCount: "100", codePrefix: "", codeSuffix: "", codeListTitle: "List",
    valueType: "percentage", discountValue: "10", appliesTo: "collections", selectedProducts: [], selectedCollections: [collection],
    buyRequirement: "quantity", buyQuantity: "1", buyAmount: "", buyAppliesTo: "collections", buySelection: [collection],
    getQuantity: "1", getAppliesTo: "collections", getSelection: [{ id: "gid://shopify/Collection/2" }], rewardType: "free", rewardValue: "",
    maxUsesPerOrder: false, usesPerOrder: "1", minimumRequirement: "none", minimumPurchaseAmount: "", minimumQuantity: "",
    limitTotalUses: false, totalUsageLimit: "", limitOncePerCustomer: false,
    combineProductDiscounts: false, combineOrderDiscounts: false, combineShippingDiscounts: false, productCombinationMode: "best", selectedCombinationTags: [],
    startsAt: null, endsAt: null, eligibility: "all", selectedEligibility: [], countries: [], countryMode: "all", excludeShippingPrice: false, maximumShippingPrice: "",
  };
}

export type StepValidationInput = {
  draft: CreateDiscountDraft;
  /** The start and end as ISO strings, as they will be saved. */
  startsAt: string | null;
  endsAt: string | null;
  hasEndDate: boolean;
  endDateTime: string;
  website: WebsiteDraft;
  isCodeList: boolean;
  /** Existing promotions skip the discount rules unless those were changed. */
  checkRules: boolean;
  /** A new code list is also checked for its generation settings. */
  creating: boolean;
};
export type StepIssues = Partial<Record<StepId, string>>;

/** The first problem in each step of the form, for every step that has one. */
export function stepIssues(input: StepValidationInput): StepIssues {
  const issues: StepIssues = {};
  const { draft } = input;
  if (input.checkRules) {
    const base = placeholderDraft({ discountType: draft.discountType, method: draft.method, codeMode: draft.codeMode });
    const check = (step: keyof typeof stepFields, overrides: Partial<CreateDiscountDraft> = {}) => {
      const pick = Object.fromEntries(stepFields[step].map(field => [field, draft[field]])) as Partial<CreateDiscountDraft>;
      const stepDraft = { ...base, ...pick, ...overrides };
      try {
        if (step === "type" && input.isCodeList && input.creating) validateCodeOptions(stepDraft);
        // Code lists are given real codes later, so a placeholder stands in for the shared code.
        buildDiscountMutation(input.isCodeList ? { ...stepDraft, discountCode: "CODE" } : stepDraft);
      } catch (error) { issues[step] = error instanceof Error ? error.message : "Check this step."; }
    };
    check("type");
    check("value");
    check("who");
    check("schedule", { startsAt: input.startsAt, endsAt: input.endsAt });
    check("advanced");
  }
  if (input.hasEndDate && !input.endDateTime && !issues.schedule) issues.schedule = "Choose an end date and time, or turn off the end date.";
  if (input.isCodeList && input.website.websiteEnabled) issues.website = "Keep code lists in website Draft status. Distribute the individual codes using the CSV download.";
  else {
    const websiteIssue = validateWebsite(input.website, input.hasEndDate ? input.endDateTime : null)[0];
    if (websiteIssue) issues.website = websiteIssue;
  }
  return issues;
}

/** The first step, in form order, that has a problem. */
export function firstIssue(issues: StepIssues): { step: StepId; message: string } | null {
  const step = stepOrder.find(id => issues[id]);
  return step ? { step, message: issues[step]! } : null;
}
