import test from "node:test";
import assert from "node:assert/strict";
import { summarisePromotion, summaryDate, type SummaryInput } from "../app/modules/promotions/design/promotionSummary";

const base: SummaryInput = {
  discountType: "product", method: "code", discountCode: "SPOOKY20", codeMode: "single", codeCount: "100", automaticTitle: "",
  valueType: "percentage", discountValue: "20", appliesTo: "collections", productCount: 0, collectionCount: 3,
  buyRequirement: "quantity", buyQuantity: "2", buyAmount: "", getQuantity: "1", rewardType: "free", rewardValue: "",
  countryMode: "all", countryCount: 0, minimumRequirement: "none", minimumPurchaseAmount: "", minimumQuantity: "",
  limitTotalUses: false, totalUsageLimit: "", limitOncePerCustomer: false, combines: false,
  eligibility: "all", eligibilityCount: 0, startDateTime: "2026-10-20T00:00:00", hasEndDate: true, endDateTime: "2026-10-31T23:59:00",
};
const summary = (change: Partial<SummaryInput>) => summarisePromotion({ ...base, ...change });

test("a product code discount reads as one plain sentence", () => {
  const result = summary({});
  assert.equal(result.overview, "20% off 3 selected collections · code spooky20 · starts 20 Oct 2026, ends 31 Oct 2026, 23:59");
  assert.equal(result.type, "Code SPOOKY20");
  assert.equal(result.who, "All customers");
  assert.equal(result.advanced, "No extra limits");
});

test("each discount type describes its own offer", () => {
  assert.equal(summary({ discountType: "order", valueType: "fixed", discountValue: "5" }).value, "£5 off the order");
  assert.equal(summary({ appliesTo: "products", productCount: 1 }).value, "20% off 1 selected product");
  assert.equal(summary({ appliesTo: "products", productCount: 0 }).value, "20% off no products selected yet");
  assert.equal(summary({ discountType: "bxgy" }).value, "Buy 2, get 1 free");
  assert.equal(summary({ discountType: "bxgy", buyRequirement: "amount", buyAmount: "50", rewardType: "percentage", rewardValue: "10" }).value, "Spend £50, get 1 at 10% off");
  assert.equal(summary({ discountType: "shipping" }).value, "Free shipping to all countries");
  assert.equal(summary({ discountType: "shipping", countryMode: "selected", countryCount: 1 }).value, "Free shipping to 1 selected country");
  assert.equal(summary({ discountType: "shipping", countryMode: "selected", countryCount: 4 }).value, "Free shipping to 4 selected countries");
  assert.equal(summary({ discountValue: "" }).value, "Discount value not set (3 selected collections)");
});

test("method, audience, limits and schedule are all reflected, and gaps are called out", () => {
  assert.equal(summary({ method: "automatic", automaticTitle: "Halloween sale" }).type, "Halloween sale, applied automatically");
  assert.equal(summary({ method: "automatic", automaticTitle: "" }).type, "Automatic discount, title not set");
  assert.equal(summary({ discountCode: "" }).type, "Code not set");
  assert.equal(summary({ codeMode: "bulk", codeCount: "500" }).type, "500 individual codes");
  assert.equal(summary({ eligibility: "segments", eligibilityCount: 2 }).who, "2 selected customer segments");
  assert.equal(summary({ eligibility: "customers", eligibilityCount: 1 }).who, "1 selected customer");
  const limited = summary({ minimumRequirement: "amount", minimumPurchaseAmount: "30", limitTotalUses: true, totalUsageLimit: "100", limitOncePerCustomer: true, combines: true });
  assert.equal(limited.advanced, "minimum spend £30, 100 uses in total, once per customer, combines with other discounts");
  assert.match(limited.overview, /minimum spend £30 · 100 uses in total · starts/);
  assert.equal(summary({ limitTotalUses: true, totalUsageLimit: "1" }).advanced, "1 use in total", "a single use is not plural");
  assert.equal(summary({ startDateTime: "", hasEndDate: false }).schedule, "Starts when saved, no end date");
  assert.equal(summary({ hasEndDate: true, endDateTime: "" }).schedule, "Starts 20 Oct 2026, end date not set");
});

test("dates show the time only when it matters", () => {
  assert.equal(summaryDate("2026-10-20T00:00:00"), "20 Oct 2026");
  assert.equal(summaryDate("2026-10-20T09:30:00"), "20 Oct 2026, 09:30");
  assert.equal(summaryDate(""), "");
  assert.equal(summaryDate("not a date"), "");
});
