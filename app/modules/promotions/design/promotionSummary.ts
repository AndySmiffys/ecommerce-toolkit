export type SummaryInput = {
  discountType: "product" | "order" | "bxgy" | "shipping";
  method: "code" | "automatic";
  discountCode: string;
  codeMode: "single" | "bulk";
  codeCount: string;
  automaticTitle: string;
  valueType: "percentage" | "fixed";
  discountValue: string;
  appliesTo: "products" | "collections";
  productCount: number;
  collectionCount: number;
  buyRequirement: "quantity" | "amount";
  buyQuantity: string;
  buyAmount: string;
  getQuantity: string;
  rewardType: "percentage" | "amount" | "free";
  rewardValue: string;
  countryMode: string;
  countryCount: number;
  minimumRequirement: "none" | "amount" | "quantity";
  minimumPurchaseAmount: string;
  minimumQuantity: string;
  limitTotalUses: boolean;
  totalUsageLimit: string;
  limitOncePerCustomer: boolean;
  combines: boolean;
  eligibility: "all" | "segments" | "customers";
  eligibilityCount: number;
  startDateTime: string;
  hasEndDate: boolean;
  endDateTime: string;
};

export type PromotionSummary = {
  /** One sentence, for example "20% off 3 selected collections · code SPOOKY20 · ends 31 Oct 2026". */
  overview: string;
  type: string;
  value: string;
  who: string;
  schedule: string;
  advanced: string;
};

const noun = (count: number, singular: string, plural = singular + "s") => count === 1 ? singular : plural;
const money = (amount: string) => `£${amount.trim()}`;

/** Local date-times arrive as "2026-10-20T09:00:00"; show the time only when it is not midnight. */
export function summaryDate(local: string): string {
  const date = new Date(local);
  if (!local || !Number.isFinite(date.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
  return date.getHours() || date.getMinutes() ? `${day}, ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date)}` : day;
}

function target(count: number, kind: "products" | "collections") {
  return count ? `${count} selected ${noun(count, kind === "products" ? "product" : "collection", kind)}` : `no ${kind} selected yet`;
}

function valueText(input: SummaryInput): string {
  const amount = input.discountValue.trim();
  const off = amount ? `${input.valueType === "percentage" ? `${amount}%` : money(amount)} off` : "Discount value not set";
  switch (input.discountType) {
    case "order": return `${off} the order`;
    case "product": {
      const count = input.appliesTo === "products" ? input.productCount : input.collectionCount;
      return amount ? `${off} ${target(count, input.appliesTo)}` : `${off} (${target(count, input.appliesTo)})`;
    }
    case "bxgy": {
      const buy = input.buyRequirement === "quantity" ? `Buy ${input.buyQuantity || "?"}` : `Spend ${input.buyAmount.trim() ? money(input.buyAmount) : "?"}`;
      const reward = input.rewardType === "free" ? "free" : input.rewardValue.trim() ? `at ${input.rewardType === "percentage" ? `${input.rewardValue.trim()}%` : money(input.rewardValue)} off` : "at a reduced price";
      return `${buy}, get ${input.getQuantity || "?"} ${reward}`;
    }
    case "shipping": return input.countryMode === "selected" ? `Free shipping to ${input.countryCount} selected ${noun(input.countryCount, "country", "countries")}` : "Free shipping to all countries";
  }
}

function typeText(input: SummaryInput): string {
  if (input.method === "automatic") return input.automaticTitle.trim() ? `${input.automaticTitle.trim()}, applied automatically` : "Automatic discount, title not set";
  if (input.codeMode === "bulk") return `${input.codeCount || "?"} individual codes`;
  return input.discountCode.trim() ? `Code ${input.discountCode.trim()}` : "Code not set";
}

function whoText(input: SummaryInput): string {
  if (input.eligibility === "all") return "All customers";
  return `${input.eligibilityCount} selected ${input.eligibility === "segments" ? noun(input.eligibilityCount, "customer segment") : noun(input.eligibilityCount, "customer")}`;
}

function scheduleText(input: SummaryInput): string {
  const start = summaryDate(input.startDateTime);
  const end = input.hasEndDate ? summaryDate(input.endDateTime) : "";
  return `${start ? `Starts ${start}` : "Starts when saved"}${input.hasEndDate ? end ? `, ends ${end}` : ", end date not set" : ", no end date"}`;
}

function advancedParts(input: SummaryInput): string[] {
  const parts: string[] = [];
  if (input.minimumRequirement === "amount" && input.minimumPurchaseAmount.trim()) parts.push(`minimum spend ${money(input.minimumPurchaseAmount)}`);
  if (input.minimumRequirement === "quantity" && input.minimumQuantity.trim()) parts.push(`minimum ${input.minimumQuantity.trim()} items`);
  if (input.limitTotalUses && input.totalUsageLimit.trim()) parts.push(`${input.totalUsageLimit.trim()} uses in total`);
  if (input.limitOncePerCustomer) parts.push("once per customer");
  if (input.combines) parts.push("combines with other discounts");
  return parts;
}

export function summarisePromotion(input: SummaryInput): PromotionSummary {
  const type = typeText(input);
  const value = valueText(input);
  const who = whoText(input);
  const schedule = scheduleText(input);
  const advanced = advancedParts(input);
  const overview = [value, input.method === "code" ? (input.codeMode === "bulk" ? type : type.toLowerCase()) : "applied automatically", ...(input.eligibility === "all" ? [] : [who.toLowerCase()]), ...advanced.slice(0, 2), schedule.charAt(0).toLowerCase() + schedule.slice(1)].join(" · ");
  return { overview, type, value, who, schedule, advanced: advanced.length ? advanced.join(", ") : "No extra limits" };
}
