const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { readFileSync } = require("node:fs");

// The storefront file is a plain browser script, so run its source with a CommonJS `module`.
const scriptPath = path.resolve(__dirname, "../extensions/promotion-engine/assets/shipping-countdown.js");
const m = { exports: {} };
new Function("module", "exports", readFileSync(scriptPath, "utf8"))(m, m.exports);
const logic = m.exports;

// October 2026: Fri 23, Sat 24, Sun 25 (the clocks go back at 02:00 BST), Mon 26, Tue 27, Wed 28, Thu 29, Fri 30, Sat 31, then Mon 2 Nov.
// December: Thu 24, Fri 25, Sat 26, Sun 27, Mon 28, Tue 29, Wed 30, Thu 31, then Fri 1 Jan 2027, Mon 4 Jan.
const at = iso => Date.parse(iso);
const weekdays = [false, true, true, true, true, true, false];
const config = (extra = {}) => ({ cutoffTime: "14:00", shippingDays: weekdays, bankHolidays: [], delayDays: 0, ...extra });
const monFri = { days: [false, true, true, true, true, true, false] };
const monSat = { days: [false, true, true, true, true, true, true] };
const everyDay = { days: [true, true, true, true, true, true, true] };
const next = { minDays: 1, maxDays: 1 };

test("dates are written the way the shop wants them: weekday, day with its ordinal, month", () => {
  assert.equal(logic.formatDeliveryDate("2026-10-28", true), "Wed 28th Oct");
  assert.equal(logic.formatDeliveryDate("2026-10-28"), "Wed 28th Oct", "the month is always there");
  assert.equal(logic.formatDeliveryDate("2026-10-28", false), "Wed 28th Oct", "there is no way to leave it out");
  const days = Array.from({ length: 31 }, (_, i) => logic.formatDeliveryDate(`2026-10-${String(i + 1).padStart(2, "0")}`).split(" ")[1]);
  assert.deepEqual(days.slice(0, 4), ["1st", "2nd", "3rd", "4th"]);
  assert.deepEqual(days.slice(10, 13), ["11th", "12th", "13th"], "11 to 13 are all th");
  assert.deepEqual(days.slice(20, 24), ["21st", "22nd", "23rd", "24th"]);
  assert.deepEqual(days.slice(29), ["30th", "31st"]);
  assert.equal(logic.formatDeliveryDate("2026-09-01", true), "Tue 1st Sep");
  assert.equal(logic.formatDeliveryDate("2027-01-04", true), "Mon 4th Jan");
});

test("a carrier delivers on its own days, and on bank holidays only if it says so", () => {
  const holidays = ["2026-10-26"];
  assert.equal(logic.isDeliveryDay("2026-10-27", monFri, holidays), true);
  assert.equal(logic.isDeliveryDay("2026-10-24", monFri, holidays), false, "Saturday");
  assert.equal(logic.isDeliveryDay("2026-10-24", monSat, holidays), true, "a Saturday carrier");
  assert.equal(logic.isDeliveryDay("2026-10-25", monSat, holidays), false, "but not Sunday");
  assert.equal(logic.isDeliveryDay("2026-10-25", everyDay, holidays), true, "a Sunday carrier");
  assert.equal(logic.isDeliveryDay("2026-10-26", monFri, holidays), false, "a bank holiday Monday");
  assert.equal(logic.isDeliveryDay("2026-10-26", { ...monFri, onBankHolidays: true }, holidays), true, "unless the carrier delivers on them");
  assert.equal(logic.isDeliveryDay("2026-10-27", { days: [false, false, false, false, false, false, false] }, []), false);
});

test("transit days count only the days the carrier delivers", () => {
  const add = (dispatch, days, service, holidays = []) => logic.addDeliveryDays(dispatch, days, service, holidays);
  assert.equal(add("2026-10-23", 1, monFri), "2026-10-26", "Friday dispatch, next working day: Monday");
  assert.equal(add("2026-10-23", 2, monFri), "2026-10-27");
  assert.equal(add("2026-10-23", 5, monFri), "2026-10-30");
  assert.equal(add("2026-10-26", 1, monFri), "2026-10-27");
  assert.equal(add("2026-10-30", 1, monFri), "2026-11-02", "across the month end");
  assert.equal(add("2026-10-23", 1, monSat), "2026-10-24", "a Saturday carrier delivers the next day");
  assert.equal(add("2026-10-23", 2, monSat), "2026-10-26", "and then skips Sunday");
  assert.equal(add("2026-10-23", 6, monSat), "2026-10-30");
  assert.equal(add("2026-10-23", 1, everyDay), "2026-10-24");
  assert.equal(add("2026-10-23", 2, everyDay), "2026-10-25", "a Sunday carrier");
  assert.equal(add("2026-10-23", 3, everyDay), "2026-10-26");
  // A bank holiday Monday.
  assert.equal(add("2026-10-23", 1, monFri, ["2026-10-26"]), "2026-10-27");
  assert.equal(add("2026-10-23", 2, monFri, ["2026-10-26"]), "2026-10-28");
  assert.equal(add("2026-10-23", 1, { ...monFri, onBankHolidays: true }, ["2026-10-26"]), "2026-10-26");
  // Zero days: the first delivery day on or after dispatch.
  assert.equal(add("2026-10-23", 0, monFri), "2026-10-23");
  assert.equal(add("2026-10-24", 0, monFri), "2026-10-26");
  assert.equal(add("2026-12-25", 0, monFri, ["2026-12-25", "2026-12-28"]), "2026-12-29");
  assert.equal(add("2026-10-23", 1, { days: [false, false, false, false, false, false, false] }), null, "a service that delivers on no day gives no date");
  assert.equal(add("2026-10-23", 3.7, monFri), "2026-10-28", "whole days");
  assert.equal(add("2026-10-23", -2, monFri), "2026-10-23", "never before dispatch");
});

test("Christmas and New Year: weekends, Christmas Day, the substitute Boxing Day and New Year's Day are all skipped", () => {
  const holidays = ["2026-12-25", "2026-12-28", "2027-01-01"];
  const add = (days, service) => logic.addDeliveryDays("2026-12-24", days, service, holidays);
  assert.deepEqual([1, 2, 3, 4].map(n => add(n, monFri)), ["2026-12-29", "2026-12-30", "2026-12-31", "2027-01-04"]);
  assert.deepEqual([1, 2, 3].map(n => add(n, monSat)), ["2026-12-26", "2026-12-29", "2026-12-30"], "a Saturday carrier delivers on Boxing Day's Saturday, but not the Monday holiday");
  assert.deepEqual([1, 2].map(n => add(n, { ...monFri, onBankHolidays: true })), ["2026-12-25", "2026-12-28"]);
});

test("an order placed now is dispatched by the service's cut-off and then travels its transit time", () => {
  const estimate = (iso, service, transit, extra) => logic.deliveryEstimate(at(iso), config(extra), service, transit);
  // Monday morning, before the 14:00 cut-off (the clocks are on GMT from Sunday 25 October).
  const early = estimate("2026-10-26T09:00:00Z", monFri, next);
  assert.deepEqual([early.dispatchDate, early.from, early.to], ["2026-10-26", "2026-10-27", "2026-10-27"]);
  assert.equal(early.msUntilCutoff, 5 * 3600000, "the time left to order, for the same-day dispatch");
  // After it, dispatch is tomorrow.
  const late = estimate("2026-10-26T15:00:00Z", monFri, next);
  assert.deepEqual([late.dispatchDate, late.to], ["2026-10-27", "2026-10-28"]);
  // Friday before the cut-off (still on BST): a Saturday carrier delivers on Saturday, a weekday one on Monday.
  assert.equal(estimate("2026-10-23T10:00:00Z", monSat, next).to, "2026-10-24");
  assert.equal(estimate("2026-10-23T10:00:00Z", monFri, next).to, "2026-10-26");
  assert.equal(estimate("2026-10-23T10:00:00Z", everyDay, next).to, "2026-10-24");
  // Friday after it: dispatch moves to Monday, so everyone's next day is Tuesday.
  for (const service of [monFri, monSat, everyDay]) assert.equal(estimate("2026-10-23T13:30:00Z", service, next).to, "2026-10-27");
  // A range of delivery times gives both ends.
  const range = estimate("2026-10-26T09:00:00Z", monFri, { minDays: 2, maxDays: 4 });
  assert.deepEqual([range.from, range.to], ["2026-10-28", "2026-10-30"]);
});

test("a service can have its own cut-off, and the shop's applies when it has none", () => {
  const to = (cutoffTime, iso = "2026-10-26T15:30:00Z") => logic.deliveryEstimate(at(iso), config(), { ...monFri, cutoffTime }, next).to;
  assert.equal(to("16:00"), "2026-10-27", "15:30 is before this service's 16:00, so it goes today");
  assert.equal(to("12:00"), "2026-10-28", "and after this one's 12:00");
  assert.equal(to(""), "2026-10-28", "no cut-off of its own: the shop's 14:00, which has passed");
  assert.equal(to(undefined), "2026-10-28");
  assert.equal(logic.deliveryEstimate(at("2026-10-26T15:30:00Z"), config({ cutoffTime: "17:00" }), { ...monFri, cutoffTime: "" }, next).to, "2026-10-27", "the shop's cut-off can be changed too");
});

test("cut-offs are exact to the second, and follow London's clock through both changes", () => {
  const dispatch = iso => logic.deliveryEstimate(at(iso), config(), monFri, next).dispatchDate;
  assert.equal(dispatch("2026-10-26T13:59:59Z"), "2026-10-26", "14:00 GMT is 14:00Z");
  assert.equal(dispatch("2026-10-26T14:00:00Z"), "2026-10-27");
  assert.equal(dispatch("2026-03-30T12:59:59Z"), "2026-03-30", "14:00 BST is 13:00Z");
  assert.equal(dispatch("2026-03-30T13:00:00Z"), "2026-03-31");
  assert.equal(dispatch("2026-10-24T13:00:00Z"), "2026-10-26", "a Saturday is not a dispatch day");
});

test("a warehouse delay moves dispatch, whatever the cut-off, and delivery follows it", () => {
  const delayed = logic.deliveryEstimate(at("2026-10-26T09:00:00Z"), config({ delayDays: 2 }), { ...monFri, cutoffTime: "16:00" }, next);
  assert.equal(delayed.dispatchDate, "2026-10-28", "the second dispatch day after today");
  assert.equal(delayed.to, "2026-10-29");
  const late = logic.deliveryEstimate(at("2026-10-26T20:00:00Z"), config({ delayDays: 1 }), monFri, next);
  assert.equal(late.dispatchDate, "2026-10-27", "after the cut-off makes no difference");
  assert.equal(logic.deliveryEstimate(at("2026-10-26T09:00:00Z"), config({ delayDays: 1, shippingDays: [false, false, false, false, false, false, false] }), monFri, next), null, "no dispatch day, no date");
});

test("no date is given when it cannot be worked out", () => {
  const now = at("2026-10-26T09:00:00Z");
  assert.equal(logic.deliveryEstimate(now, config(), monFri, null), null, "no delivery time");
  assert.equal(logic.deliveryEstimate(now, config(), monFri, undefined), null);
  assert.equal(logic.deliveryEstimate(now, config(), { days: [false, false, false, false, false, false, false] }, next), null, "a carrier that delivers on no day");
  assert.equal(logic.deliveryEstimate(now, config({ cutoffTime: "" }), monFri, next), null, "no cut-off anywhere");
  assert.equal(logic.deliveryEstimate(now, config({ cutoffTime: "25:61" }), { ...monFri, cutoffTime: "" }, next), null);
  assert.ok(logic.deliveryEstimate(now, config({ cutoffTime: "" }), { ...monFri, cutoffTime: "15:00" }, next), "a cut-off of its own is enough");
  // A service saying nothing is a weekday, non-guaranteed one.
  assert.equal(logic.deliveryEstimate(now, config(), {}, next).to, "2026-10-27");
  assert.equal(logic.deliveryEstimate(now, config(), undefined, next).to, "2026-10-27");
});

test("the delivery message is filled in with the latest date, the earliest, and the service's name", () => {
  const values = { date: "Wed 28th Oct", from: "Tue 27th Oct", service: "DPD Next Day" };
  assert.equal(logic.fillDelivery("Delivery by {date}", values), "Delivery by Wed 28th Oct");
  assert.equal(logic.fillDelivery("{service}: {from} to {date}. {date}!", values), "DPD Next Day: Tue 27th Oct to Wed 28th Oct. Wed 28th Oct!");
  assert.equal(logic.fillDelivery("No placeholders", values), "No placeholders");
  assert.equal(logic.fillDelivery("By {date}", {}), "By ", "nothing known, nothing written");
});

test("prices are written from the price bands, in the shopper's currency", () => {
  const price = (tiers, extra = {}) => logic.servicePrice({ tiers, ...extra }, "GBP");
  assert.equal(price([{ from: 0, price: 499 }]), "£4.99");
  assert.equal(price([{ from: 0, price: 699 }, { from: 3000, price: 499 }]), "£6.99, or £4.99 on orders of £30 or more");
  assert.equal(price([{ from: 3000, price: 499 }, { from: 0, price: 699 }]), "£6.99, or £4.99 on orders of £30 or more", "in order of the bands, however they were read");
  assert.equal(price([{ from: 0, price: 399 }, { from: 3000, price: 0 }]), "£3.99, or free on orders of £30 or more");
  assert.equal(price([{ from: 0, price: 0 }]), "Free");
  assert.equal(price([{ from: 3000, price: 299 }]), "£2.99 on orders of £30 or more", "a service with no band for small baskets says so");
  assert.equal(price([{ from: 0, price: 399 }, { from: 4950, price: 0 }]), "£3.99, or free on orders of £49.50 or more", "pence are kept");
  assert.equal(price([{ from: 0, price: 699 }, { from: 0, price: 499 }], { complex: true }), "From £4.99", "when the price also depends on weight");
  assert.equal(price([{ from: 0, price: 0 }, { from: 0, price: 500 }], { complex: true }), "Free");
  assert.equal(price([]), "");
  assert.equal(logic.servicePrice({}, "GBP"), "");
  assert.equal(logic.servicePrice({ tiers: [{ from: 0, price: 1000 }] }, "EUR"), "€10");
});

const services = () => [
  { name: "DPD Next Working Day", tiers: [{ from: 0, price: 699 }, { from: 3000, price: 499 }], transit: { minDays: 1, maxDays: 1 } },
  { name: "Amazon 2 Day", tiers: [{ from: 0, price: 399 }, { from: 3000, price: 0 }], transit: { minDays: 2, maxDays: 2 } },
  { name: "Economy 2 Day", tiers: [{ from: 0, price: 299 }], transit: { minDays: 2, maxDays: 2 } },
  { name: "Collection", tiers: [{ from: 0, price: 0 }] },
];
const delivery = (extra = {}) => ({ enabled: true, guaranteedText: "Delivery by {date}", estimatedText: "Delivery by {date} (Non-Guaranteed)", services: [], ...extra });
const options = (deliveryExtra, variant = null, list = services(), configExtra = {}) => logic.deliveryOptions(at("2026-10-26T09:00:00Z"), config({ delivery: delivery(deliveryExtra), ...configExtra }), list, "GBP", variant);

test("the dropdown lists each service with its price and date, soonest first, and says which are not guaranteed", () => {
  const list = options({ services: [{ name: "DPD Next Working Day", guaranteed: true }] });
  assert.deepEqual(list.map(item => [item.label, item.text, item.price]), [
    ["DPD Next Working Day", "Delivery by Tue 27th Oct", "£6.99, or £4.99 on orders of £30 or more"],
    ["Amazon 2 Day", "Delivery by Wed 28th Oct (Non-Guaranteed)", "£3.99, or free on orders of £30 or more"],
    ["Economy 2 Day", "Delivery by Wed 28th Oct (Non-Guaranteed)", "£2.99"],
  ]);
  assert.deepEqual(list.map(item => item.guaranteed), [true, false, false]);
  assert.equal(list.some(item => item.name === "Collection"), false, "no delivery time, no date, so it is left out");
});

test("a service is not guaranteed unless it was set to be, and Shopify's delivery time is used unless one was typed in", () => {
  const plain = options({ services: [] });
  assert.ok(plain.every(item => item.guaranteed === false && /\(Non-Guaranteed\)$/.test(item.text)), "nothing is promised that was not chosen");
  const typed = options({ services: [{ name: "Amazon 2 Day", transitMin: 3, transitMax: 3 }] });
  assert.equal(typed.find(item => item.name === "Amazon 2 Day").text, "Delivery by Thu 29th Oct (Non-Guaranteed)", "typed in the app: three days, not Shopify's two");
  const onlyOne = options({ services: [{ name: "Amazon 2 Day", transitMin: 3, transitMax: null }] });
  assert.equal(onlyOne.find(item => item.name === "Amazon 2 Day").text, "Delivery by Wed 28th Oct (Non-Guaranteed)", "half a typed time is ignored");
  const added = options({ services: [{ name: "Collection", transitMin: 1, transitMax: 2 }] });
  assert.equal(added.find(item => item.name === "Collection").text, "Delivery by Wed 28th Oct (Non-Guaranteed)", "a time typed in gives one to a service Shopify has none for");
});

test("each service uses its own delivery days, cut-off and bank holidays", () => {
  const saturday = options({ services: [{ name: "DPD Next Working Day", days: [false, true, true, true, true, true, true] }] }, null, services(), {});
  assert.equal(saturday[0].to, "2026-10-27");
  const friday = logic.deliveryOptions(at("2026-10-23T10:00:00Z"), config({ delivery: delivery({ services: [{ name: "DPD Next Working Day", days: [false, true, true, true, true, true, true] }, { name: "Amazon 2 Day" }] }) }), services().slice(0, 2), "GBP", null);
  assert.deepEqual(friday.map(item => [item.label, item.to]), [["DPD Next Working Day", "2026-10-24"], ["Amazon 2 Day", "2026-10-27"]], "a Saturday carrier next day, a weekday one two business days");
  const cutoff = logic.deliveryOptions(at("2026-10-26T15:30:00Z"), config({ delivery: delivery({ services: [{ name: "DPD Next Working Day", cutoffTime: "16:00" }] }) }), services().slice(0, 2), "GBP", null);
  assert.deepEqual(cutoff.map(item => [item.label, item.to]), [["DPD Next Working Day", "2026-10-27"], ["Amazon 2 Day", "2026-10-29"]], "its own cut-off has not passed; the shop's has");
  const holiday = logic.deliveryOptions(at("2026-10-23T10:00:00Z"), config({ bankHolidays: ["2026-10-26"], delivery: delivery({ services: [{ name: "DPD Next Working Day", onBankHolidays: true }] }) }), services().slice(0, 1), "GBP", null);
  assert.equal(holiday[0].to, "2026-10-26", "a carrier that delivers on bank holidays");
});

test("services can be left out, renamed, and described their own way", () => {
  assert.deepEqual(options({ services: [{ name: "Economy 2 Day", show: false }] }).map(item => item.name), ["DPD Next Working Day", "Amazon 2 Day"]);
  const renamed = options({ estimatedText: "{service}: by {date}", guaranteedText: "{service}: by {date}", services: [{ name: "DPD Next Working Day", label: "DPD Next Day" }] });
  assert.equal(renamed[0].text, "DPD Next Day: by Tue 27th Oct");
  assert.equal(renamed[0].label, "DPD Next Day");
  assert.equal(renamed[0].name, "DPD Next Working Day", "still known by Shopify's name");
  assert.equal(options({ showMonth: false })[0].text, "Delivery by Tue 27th Oct (Non-Guaranteed)", "a leftover month setting changes nothing");
  assert.equal(options({ estimatedText: "Arrives {from} to {date}", services: [] }).find(item => item.name === "Amazon 2 Day").text, "Arrives Wed 28th Oct to Wed 28th Oct");
});

test("services with the same delivery date are ordered by price, then name", () => {
  const list = options({}, null, [
    { name: "B two day", tiers: [{ from: 0, price: 399 }], transit: { minDays: 2, maxDays: 2 } },
    { name: "A two day", tiers: [{ from: 0, price: 399 }], transit: { minDays: 2, maxDays: 2 } },
    { name: "Cheap two day", tiers: [{ from: 0, price: 199 }], transit: { minDays: 2, maxDays: 2 } },
    { name: "Dear next day", tiers: [{ from: 0, price: 999 }], transit: { minDays: 1, maxDays: 1 } },
  ]);
  assert.deepEqual(list.map(item => item.name), ["Dear next day", "Cheap two day", "A two day", "B two day"]);
  assert.deepEqual(options({}, null, [{ name: "Free one", tiers: [{ from: 0, price: 0 }], transit: next }, { name: "Paid one", tiers: [{ from: 0, price: 300 }], transit: next }]).map(item => item.name), ["Free one", "Paid one"]);
});

test("nothing is promised for a variant that cannot be dispatched now, or when the dropdown is off", () => {
  assert.equal(options({}, null).length, 3);
  assert.equal(options({}, { available: true, policy: "deny", managed: true, qty: 5 }).length, 3, "in stock");
  assert.deepEqual(options({}, { available: false }), [], "out of stock");
  assert.deepEqual(options({}, { available: true, policy: "continue", managed: true, qty: 0 }), [], "zero stock with continue selling");
  assert.equal(options({}, { available: true, policy: "continue", managed: false, qty: 0 }).length, 3, "stock that is not tracked is never zero");
  assert.deepEqual(options({ enabled: false }), []);
  assert.deepEqual(logic.deliveryOptions(at("2026-10-26T09:00:00Z"), config(), services(), "GBP", null), [], "no delivery settings at all");
  assert.deepEqual(options({}, null, []), []);
  assert.deepEqual(logic.deliveryOptions(at("2026-10-26T09:00:00Z"), config({ delivery: delivery() }), undefined, "GBP", null), [], "no services read at all");
  assert.deepEqual(options({}, null, services(), { cutoffTime: "" }), [], "no cut-off anywhere, so no dates");
});

test("a delay in the warehouse is reflected in every delivery date", () => {
  const list = options({}, null, services(), { delayDays: 2 });
  assert.deepEqual(list.map(item => [item.name, item.dispatchDate, item.to]), [["DPD Next Working Day", "2026-10-28", "2026-10-29"], ["Amazon 2 Day", "2026-10-28", "2026-10-30"], ["Economy 2 Day", "2026-10-28", "2026-10-30"]]);
});

void readFileSync;

test("a service is matched to its settings whatever the spacing and capitals of its name", () => {
  const list = services => logic.deliveryOptions(at("2026-10-26T09:00:00Z"), config({ delivery: delivery({ services }) }), services_(), "GBP", null);
  const services_ = () => [{ name: "DPD  Next Working Day", tiers: [{ from: 0, price: 699 }], transit: { minDays: 1, maxDays: 1 } }];
  assert.equal(list([{ name: "dpd next working day ", guaranteed: true, label: "DPD Next Day" }])[0].text, "Delivery by Tue 27th Oct", "set as guaranteed, though typed differently");
  assert.equal(list([{ name: "dpd next working day ", guaranteed: true, label: "DPD Next Day" }])[0].label, "DPD Next Day");
  assert.match(list([{ name: "Something else", guaranteed: true }])[0].text, /\(Non-Guaranteed\)$/, "a different name is a different service");
});

test("each delivery option has its message with the dates marked, for writing them in the dispatch colour", () => {
  const list = logic.deliveryOptions(at("2026-10-26T09:00:00Z"), config({ delivery: delivery({ estimatedText: "By {date} (from {from}) {service}", services: [{ name: "Amazon 2 Day", guaranteed: false }] }) }), [{ name: "Amazon 2 Day", tiers: [{ from: 0, price: 399 }], transit: { minDays: 1, maxDays: 2 } }], "GBP", null);
  assert.equal(list[0].text, "By Wed 28th Oct (from Tue 27th Oct) Amazon 2 Day", "the plain message is as before");
  assert.equal(list[0].marked, "By \uE000Wed 28th Oct\uE001 (from \uE000Tue 27th Oct\uE001) Amazon 2 Day", "the dates, and only the dates, are marked");
  assert.equal(logic.fillDelivery("By {date}", { date: "Wed 28th Oct" }), "By Wed 28th Oct", "unmarked unless asked");
  assert.equal(logic.fillDelivery("By {date}", { date: "Wed 28th Oct" }, true), "By \uE000Wed 28th Oct\uE001");
  assert.equal(logic.fillDelivery("By {date}", {}, true), "By ", "no date, no marks");
});

test("in a set order the options are listed as the app lists them, not soonest first, and new ones come last", () => {
  const all = [
    { name: "Cheap 2 Day", tiers: [{ from: 0, price: 199 }], transit: { minDays: 2, maxDays: 2 } },
    { name: "DPD Next Day", tiers: [{ from: 0, price: 699 }], transit: { minDays: 1, maxDays: 1 } },
    { name: "Amazon 2 Day", tiers: [{ from: 0, price: 399 }], transit: { minDays: 2, maxDays: 2 } },
    { name: "Evening", tiers: [{ from: 0, price: 899 }], transit: { minDays: 1, maxDays: 1 } },
  ];
  const names = (deliveryExtra, list = all) => logic.deliveryOptions(at("2026-10-26T09:00:00Z"), config({ delivery: delivery(deliveryExtra) }), list, "GBP", null).map(item => item.name);
  const listed = name => ({ name });
  assert.deepEqual(names({}), ["DPD Next Day", "Evening", "Cheap 2 Day", "Amazon 2 Day"], "soonest first, then cheapest, as before");
  assert.deepEqual(names({ sort: "soonest", services: [listed("Amazon 2 Day"), listed("Cheap 2 Day")] }), ["DPD Next Day", "Evening", "Cheap 2 Day", "Amazon 2 Day"], "an order that is not switched on changes nothing");
  assert.deepEqual(names({ sort: "manual", services: [listed("Amazon 2 Day"), listed("DPD Next Day"), listed("Cheap 2 Day"), listed("Evening")] }), ["Amazon 2 Day", "DPD Next Day", "Cheap 2 Day", "Evening"], "the order set, even though the 2 day service arrives later");
  assert.deepEqual(names({ sort: "manual", services: [listed("Evening"), listed("Amazon 2 Day")] }), ["Evening", "Amazon 2 Day", "Cheap 2 Day", "DPD Next Day"], "services not listed follow, in the order Shopify gives them");
  assert.deepEqual(names({ sort: "manual", services: [] }), ["Cheap 2 Day", "DPD Next Day", "Amazon 2 Day", "Evening"], "nothing listed: Shopify's order");
  assert.deepEqual(names({ sort: "manual", services: [listed("  AMAZON  2 day "), listed("dpd next day")] }), ["Amazon 2 Day", "DPD Next Day", "Cheap 2 Day", "Evening"], "names are matched ignoring spaces and capitals");
  assert.deepEqual(names({ sort: "manual", services: [{ name: "Amazon 2 Day", show: false }, listed("DPD Next Day")] }), ["DPD Next Day", "Cheap 2 Day", "Evening"], "a hidden service is not listed, wherever it sits");
  assert.deepEqual(names({ sort: "manual", services: [listed("Old courier"), listed("Evening")] }), ["Evening", "Cheap 2 Day", "DPD Next Day", "Amazon 2 Day"], "a name that is not there any more is ignored");
  assert.deepEqual(names({ sort: "manual", services: [listed("Evening")] }, [{ name: "No time", tiers: [{ from: 0, price: 100 }] }, ...all]), ["Evening", "Cheap 2 Day", "DPD Next Day", "Amazon 2 Day"], "one with no delivery time is still left out");
});

test("a cut-off is said the way people say it", () => {
  const say = text => logic.formatCutoff(text);
  assert.deepEqual(["14:00", "14:15", "09:30", "00:00", "12:00", "12:05", "23:59", "00:10"].map(say), ["2pm", "2:15pm", "9:30am", "12am", "12pm", "12:05pm", "11:59pm", "12:10am"]);
  assert.equal(say(""), "");
  assert.equal(say("25:00"), "");
  assert.equal(say(undefined), "");
});

test("{cutoff} in a delivery message is the service's own cut-off, or the shop's when it has none", () => {
  const list = options({ estimatedText: "Order before {cutoff}: {date}", services: [{ name: "Amazon 2 Day", cutoffTime: "11:30" }] });
  assert.deepEqual(list.map(item => [item.label, item.cutoff, item.text]), [
    ["DPD Next Working Day", "2pm", "Order before 2pm: Tue 27th Oct"],
    ["Amazon 2 Day", "11:30am", "Order before 11:30am: Wed 28th Oct"],
    ["Economy 2 Day", "2pm", "Order before 2pm: Wed 28th Oct"],
  ]);
  assert.equal(list[0].marked, "Order before 2pm: \uE000Tue 27th Oct\uE001", "only dates are coloured, not the time");
  assert.equal(logic.fillDelivery("By {cutoff} {cutoff}", { cutoff: "2pm" }), "By 2pm 2pm", "more than once");
  assert.equal(logic.fillDelivery("By {cutoff}", {}), "By ", "no cut-off, nothing");
});

const banner = (extra = {}) => ({ enabled: true, message: "Order in the next {time} for dispatch on {date}", ...extra });
const bannerAt = (iso, configExtra = {}) => logic.bannerView(at(iso), config({ delayMessage: "Busy. [highlight]Dispatch from[/highlight]", banner: banner(), ...configExtra }));

test("the header banner says the time left and the dispatch day, with each marked for its own colour", () => {
  assert.deepEqual(bannerAt("2026-10-27T09:00:00Z"), { kind: "message", marked: "Order in the next \uE0025 hours\uE003 for dispatch on \uE000Tuesday 27 Oct\uE001" }, "before the 14:00 cut-off");
  assert.deepEqual(logic.parseRich(bannerAt("2026-10-27T09:00:00Z").marked).map(run => [run.text, run.time ?? false, run.date ?? false]), [["Order in the next ", false, false], ["5 hours", true, false], [" for dispatch on ", false, false], ["Tuesday 27 Oct", false, true]]);
  assert.match(bannerAt("2026-10-27T15:00:00Z").marked, /\uE000Wednesday 28 Oct\uE001/, "after the cut-off, the next shipping day");
  assert.equal(bannerAt("2026-10-27T09:00:00Z", { banner: banner({ message: "Ships {date}. {date} again" }) }).marked, "Ships \uE000Tuesday 27 Oct\uE001. \uE000Tuesday 27 Oct\uE001 again", "each placeholder can be used more than once");
  assert.equal(bannerAt("2026-10-27T09:00:00Z", { banner: banner({ message: "[bold]{time}[/bold]" }) }).marked, "[bold]\uE0025 hours\uE003[/bold]", "and formatted");
});

test("in a delay the header banner shows the delay message and the date; with nothing true to say it is hidden", () => {
  assert.deepEqual(bannerAt("2026-10-27T09:00:00Z", { delayDays: 2 }), { kind: "message", marked: "Busy. [highlight]Dispatch from[/highlight] \uE000Thursday 29 Oct\uE001" });
  assert.deepEqual(bannerAt("2026-10-27T09:00:00Z", { banner: banner({ enabled: false }) }), { kind: "hidden" }, "switched off");
  assert.deepEqual(bannerAt("2026-10-27T09:00:00Z", { banner: undefined }), { kind: "hidden" }, "settings saved before the banner existed");
  assert.deepEqual(bannerAt("2026-10-27T09:00:00Z", { shippingDays: [false, false, false, false, false, false, false] }), { kind: "hidden" }, "no dispatch day: not 'no dispatch' on every page");
  assert.deepEqual(bannerAt("2026-10-27T09:00:00Z", { cutoffTime: "soon" }), { kind: "hidden" }, "an error is never shown in the header");
});
