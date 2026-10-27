const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { readFileSync } = require("node:fs");

// The storefront file is a plain browser script (the package treats .js as modules), so run its source with a CommonJS `module`.
const scriptPath = path.resolve(__dirname, "../extensions/promotion-engine/assets/shipping-countdown.js");
const load = () => { const m = { exports: {} }; new Function("module", "exports", readFileSync(scriptPath, "utf8"))(m, m.exports); return m.exports; };
const logic = load();

// Instants are written in UTC on purpose: London is UTC+1 in summer time (BST) and UTC+0 in winter (GMT).
// BST ended at 02:00 BST on Sun 25 Oct 2026 and began at 01:00 GMT on Sun 29 Mar 2026.
const at = iso => Date.parse(iso);
const weekdays = [false, true, true, true, true, true, false];
const base = { cutoffTime: "15:00", shippingDays: weekdays, bankHolidays: [], delayDays: 0, delayMessage: "", hideIfUnavailable: false, availability: { outOfStock: { mode: "message", message: "Out" }, backorder: { mode: "message", message: "Back" } } };
const view = (iso, config = {}, variant = null) => logic.dispatchView(at(iso), { ...base, ...config }, variant);
const countdown = (iso, config = {}) => { const v = view(iso, config); assert.equal(v.kind, "countdown", iso); return `${v.countdown} | ${v.date}`; };

test("before the cut-off on a shipping day, the order goes today", () => {
  assert.equal(countdown("2026-10-20T09:00:00Z"), "5 hours | Tuesday 20 Oct");
  assert.equal(countdown("2026-10-20T13:59:00Z"), "1 minute | Tuesday 20 Oct");
  assert.equal(countdown("2026-10-20T13:59:30Z"), "less than 1 minute | Tuesday 20 Oct");
});

test("after the cut-off the order goes on the next shipping day, and Friday after cut-off goes on Monday", () => {
  assert.equal(countdown("2026-10-20T14:00:00Z"), "1 day | Wednesday 21 Oct", "cut-off is 15:00 BST, so 14:00Z is exactly on it: the order misses today");
  assert.equal(countdown("2026-10-20T15:00:00Z"), "23 hours | Wednesday 21 Oct");
  assert.equal(countdown("2026-10-23T15:00:00Z"), "3 days | Monday 26 Oct");
  assert.equal(countdown("2026-10-24T10:00:00Z"), "2 days 5 hours | Monday 26 Oct", "Saturday morning");
});

test("a bank holiday Monday moves dispatch to Tuesday", () => {
  assert.equal(countdown("2026-10-23T15:00:00Z", { bankHolidays: ["2026-10-26"] }), "4 days | Tuesday 27 Oct");
});

test("the Christmas, Boxing Day and New Year run", () => {
  const holidays = { bankHolidays: ["2026-12-25", "2026-12-28", "2027-01-01"] };
  assert.equal(countdown("2026-12-24T10:00:00Z", holidays), "5 hours | Thursday 24 Dec");
  assert.equal(countdown("2026-12-24T16:00:00Z", holidays), "4 days 23 hours | Tuesday 29 Dec");
  assert.equal(countdown("2026-12-30T16:00:00Z", holidays), "23 hours | Thursday 31 Dec");
  assert.equal(countdown("2026-12-31T16:00:00Z", holidays), "3 days 23 hours | Monday 4 Jan");
});

test("clock changes: the countdown counts real elapsed time", () => {
  // Sat 24 Oct 14:00 BST to Mon 26 Oct 15:00 GMT is 50 hours, not the 49 a wall clock would say.
  assert.equal(countdown("2026-10-24T13:00:00Z"), "2 days 2 hours | Monday 26 Oct");
  // Fri 27 Mar 16:00 GMT to Mon 30 Mar 15:00 BST is 70 hours, not 71.
  assert.equal(countdown("2026-03-27T16:00:00Z"), "2 days 22 hours | Monday 30 Mar");
  // 23:30Z on Sat 24 Oct is already 00:30 BST on Sunday 25 Oct in London.
  assert.equal(logic.londonParts(at("2026-10-24T23:30:00Z")).date, "2026-10-25");
  assert.equal(countdown("2026-10-24T23:30:00Z"), "1 day 15 hours | Monday 26 Oct");
});

test("London's date and clock come from Europe/London, near midnight and across both changes", () => {
  const p = iso => { const x = logic.londonParts(at(iso)); return `${x.date} ${String(x.hour).padStart(2, "0")}:${String(x.minute).padStart(2, "0")}`; };
  assert.equal(p("2026-06-30T23:30:00Z"), "2026-07-01 00:30");
  assert.equal(p("2026-12-31T23:59:00Z"), "2026-12-31 23:59");
  assert.equal(p("2026-03-29T00:59:00Z"), "2026-03-29 00:59");
  assert.equal(p("2026-03-29T01:00:00Z"), "2026-03-29 02:00", "01:00 GMT became 02:00 BST");
  assert.equal(p("2026-10-25T00:59:00Z"), "2026-10-25 01:59");
  assert.equal(p("2026-10-25T01:00:00Z"), "2026-10-25 01:00", "02:00 BST became 01:00 GMT");
  assert.equal(logic.londonTimeToUtc("2026-07-01", 0, 0), at("2026-06-30T23:00:00Z"));
  assert.equal(logic.londonTimeToUtc("2026-12-01", 15, 0), at("2026-12-01T15:00:00Z"));
});

test("a visitor's own time zone changes nothing", () => {
  const probes = ["2026-10-20T09:00:00Z", "2026-10-23T15:00:00Z", "2026-10-24T23:30:00Z", "2026-03-27T16:00:00Z", "2026-12-24T16:00:00Z", "2026-06-30T23:30:00Z"];
  const here = JSON.stringify(probes.map(iso => view(iso)));
  const script = `const m={exports:{}};new Function("module","exports",require("fs").readFileSync(${JSON.stringify(scriptPath)},"utf8"))(m,m.exports);const l=m.exports;` +
    `const c=${JSON.stringify(base)};console.log(JSON.stringify(${JSON.stringify(probes)}.map(i=>l.dispatchView(Date.parse(i),c,null))))`;
  for (const zone of ["America/Los_Angeles", "Australia/Brisbane", "Pacific/Kiritimati"]) {
    const run = spawnSync(process.execPath, ["-e", script], { env: { ...process.env, TZ: zone }, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), here, zone);
  }
});

test("warehouse delay counts the Nth shipping day from today and ignores the cut-off", () => {
  const delayed = (iso, delayDays, extra = {}) => { const v = view(iso, { delayDays, delayMessage: "Delayed", ...extra }); assert.equal(v.kind, "delay"); return v.date; };
  assert.equal(delayed("2026-10-21T15:00:00Z", 1), "Thursday 22 Oct", "after the cut-off, still tomorrow");
  assert.equal(delayed("2026-10-21T08:00:00Z", 1), "Thursday 22 Oct", "before the cut-off, the same");
  assert.equal(delayed("2026-10-23T08:00:00Z", 2), "Tuesday 27 Oct", "across a weekend");
  assert.equal(delayed("2026-10-23T08:00:00Z", 2, { bankHolidays: ["2026-10-26"] }), "Wednesday 28 Oct", "and a bank holiday");
  assert.equal(delayed("2026-10-24T08:00:00Z", 1), "Monday 26 Oct", "from a Saturday");
  assert.equal(logic.delayedDispatch(at("2026-10-20T09:00:00Z"), { ...base, delayDays: 0 }), null);
});

test("with no shipping days at all nothing hangs and no date is promised", () => {
  const none = { shippingDays: [false, false, false, false, false, false, false] };
  assert.equal(view("2026-10-20T09:00:00Z", none).kind, "none");
  assert.equal(view("2026-10-20T09:00:00Z", { ...none, hideIfUnavailable: true }).kind, "hidden");
  assert.equal(view("2026-10-20T09:00:00Z", { ...none, delayDays: 3 }).kind, "none");
  assert.equal(view("2026-10-20T09:00:00Z", { cutoffTime: "" }).kind, "error");
  assert.equal(view("2026-10-20T09:00:00Z", { cutoffTime: "25:00" }).kind, "error");
});

test("the search for a dispatch day stops after 30 days", () => {
  const days = Array.from({ length: 40 }, (_, i) => logic.addDays("2026-10-20", i));
  assert.equal(logic.nextDispatch(at("2026-10-20T09:00:00Z"), { ...base, bankHolidays: days.slice(0, 31) }), null);
  assert.equal(logic.nextDispatch(at("2026-10-20T09:00:00Z"), { ...base, bankHolidays: days.slice(0, 30) }).date, "2026-11-19");
});

test("the countdown wording", () => {
  const m = 60000, h = 60 * m, d = 24 * h;
  const t = logic.countdownText;
  assert.equal(t(0), "less than 1 minute");
  assert.equal(t(59999), "less than 1 minute");
  assert.equal(t(m), "1 minute");
  assert.equal(t(2 * m), "2 minutes");
  assert.equal(t(h), "1 hour");
  assert.equal(t(h + 21 * m), "1 hour 21 minutes");
  assert.equal(t(2 * h + m), "2 hours 1 minute");
  assert.equal(t(d - m), "23 hours 59 minutes");
  assert.equal(t(d), "1 day");
  assert.equal(t(d + 3 * h + 40 * m), "1 day 3 hours");
  assert.equal(t(2 * d), "2 days");
  assert.equal(t(3 * d + h), "3 days 1 hour");
});

test("dispatch dates are written the en-GB way", () => {
  assert.equal(logic.formatDispatchDate("2026-10-26"), "Monday 26 Oct");
  assert.equal(logic.formatDispatchDate("2026-09-01"), "Tuesday 1 Sep");
  assert.equal(logic.formatDispatchDate("2027-01-04"), "Monday 4 Jan");
});

test("the delay message highlights what is inside [highlight] tags and nothing else", () => {
  assert.deepEqual(logic.parseHighlight("We are behind. [highlight]Dispatch from[/highlight]"), [{ text: "We are behind. ", highlight: false }, { text: "Dispatch from", highlight: true }]);
  assert.deepEqual(logic.parseHighlight("<b>plain</b>"), [{ text: "<b>plain</b>", highlight: false }], "markup stays as text");
  assert.deepEqual(logic.parseHighlight("[highlight]a[/highlight] and [highlight]b[/highlight]").map(p => p.text), ["a", " and ", "b"]);
  assert.deepEqual(logic.parseHighlight(""), []);
});

test("the threshold is written in full, with pence only when there are some", () => {
  assert.equal(logic.formatMoney(5000, "GBP"), "£50");
  assert.equal(logic.formatMoney(4950, "GBP"), "£49.50");
  assert.equal(logic.formatMoney(5005, "GBP"), "£50.05");
  assert.equal(logic.formatMoney(6000, "EUR"), "€60");
  assert.equal(logic.fillThreshold("Spend {threshold}, get free delivery over {threshold}", 4950, "GBP"), "Spend £49.50, get free delivery over £49.50");
  assert.equal(logic.fillThreshold("No placeholder", 5000, "GBP"), "No placeholder");
  assert.equal(logic.fillThreshold("Free to {country} over {threshold}, yes {country}", 5000, "GBP", "Ireland"), "Free to Ireland over £50, yes Ireland", "the country goes in everywhere it is asked for");
  assert.equal(logic.fillThreshold("Free to {country}", 5000, "GBP"), "Free to ", "no country, no text");
  assert.equal(logic.fillThreshold("Get {rate} over {threshold}. That is {rate}.", 5000, "GBP", "Ireland", "Free standard delivery"), "Get Free standard delivery over £50. That is Free standard delivery.", "the delivery option's name goes in everywhere it is asked for");
  assert.equal(logic.fillThreshold("Get {rate}", 5000, "GBP", "Ireland"), "Get ", "no name, no text");
});

test("free shipping: under, add this item, over, always free, and a cart in another currency", () => {
  const free = { enabled: true, textUnder: "Free to {country} over {threshold}", textAdd: "Add this", textOver: "You get free delivery" };
  const message = (input, rule = free) => logic.freeShippingMessage(rule, { threshold: 5000, thresholdCurrency: "GBP", country: "United Kingdom", cartCurrency: "GBP", cartTotal: 0, itemPrice: 1000, quantity: 1, ...input });
  assert.deepEqual(message({}), { state: "under", text: "Free to United Kingdom over £50" });
  assert.deepEqual(message({ cartTotal: 4500 }), { state: "add", text: "Add this" });
  assert.equal(message({ cartTotal: 4500, itemPrice: 400 }).state, "under");
  assert.equal(message({ cartTotal: 4500, itemPrice: 300, quantity: 2 }).state, "add", "the price is multiplied by the quantity");
  assert.equal(message({ cartTotal: 0, itemPrice: 5000 }).state, "add", "one item alone can reach the threshold");
  assert.equal(message({ cartTotal: 5000 }).state, "over");
  assert.equal(message({ cartTotal: 9999 }).text, "You get free delivery");
  assert.deepEqual(message({ threshold: 0 }), { state: "over", text: "You get free delivery" }, "always free: nothing to spend");
  const named = { ...free, textUnder: "Spend {threshold} for {rate}", textAdd: "Add this for {rate}", textOver: "You unlocked {rate}" };
  assert.equal(message({ rate: "Free standard delivery" }, named).text, "Spend £50 for Free standard delivery");
  assert.equal(message({ rate: "Free standard delivery", cartTotal: 4500 }, named).text, "Add this for Free standard delivery");
  assert.equal(message({ rate: "Free standard delivery", cartTotal: 6000 }, named).text, "You unlocked Free standard delivery");
  assert.deepEqual(message({ threshold: 7500 }), { state: "under", text: "Free to United Kingdom over £75" }, "a threshold set for another country");
  assert.deepEqual(message({ cartCurrency: "EUR" }), { state: "hidden", text: "" }, "nothing is converted");
  assert.deepEqual(message({ threshold: null }), { state: "hidden", text: "" }, "no free delivery for this country");
  assert.deepEqual(message({ threshold: undefined }), { state: "hidden", text: "" });
  assert.deepEqual(message({ thresholdCurrency: "" }), { state: "hidden", text: "" });
  assert.equal(message({}, { ...free, enabled: false }).state, "hidden");
  assert.equal(message({ itemPrice: 0 }).state, "under");
});

test("out of stock and zero stock with continue selling are told apart, and neither gets a dispatch date", () => {
  const ok = { id: 1, price: 1000, available: true, policy: "deny", managed: true, qty: 5 };
  assert.equal(logic.stockState(ok), "in");
  assert.equal(logic.stockState(null), "in");
  assert.equal(logic.stockState({ ...ok, available: false }), "out");
  assert.equal(logic.stockState({ ...ok, available: false, policy: "continue" }), "out", "unavailable is unavailable");
  assert.equal(logic.stockState({ ...ok, policy: "continue", qty: 0 }), "backorder");
  assert.equal(logic.stockState({ ...ok, policy: "continue", qty: -3 }), "backorder");
  assert.equal(logic.stockState({ ...ok, policy: "continue", qty: 2 }), "in");
  assert.equal(logic.stockState({ ...ok, policy: "deny", qty: 0 }), "in", "not selling past zero is out of stock only once Shopify says unavailable");
  assert.equal(logic.stockState({ ...ok, policy: "continue", managed: false, qty: 0 }), "in", "stock is not tracked");
  assert.equal(logic.stockState({ ...ok, policy: "continue", qty: null }), "in", "stock is unknown");
  const day = "2026-10-20T09:00:00Z";
  assert.equal(view(day, {}, { ...ok, available: false }).kind, "outofstock");
  assert.equal(view(day, {}, { ...ok, policy: "continue", qty: 0 }).kind, "backorder");
  assert.equal(view(day, { availability: { outOfStock: { mode: "hide", message: "" }, backorder: { mode: "message", message: "Back" } } }, { ...ok, available: false }).kind, "hidden");
  assert.equal(view(day, { availability: { outOfStock: { mode: "hide", message: "" }, backorder: { mode: "message", message: "Back" } } }, { ...ok, policy: "continue", qty: 0 }).kind, "backorder", "hiding one does not hide the other");
  assert.equal(view(day, { availability: { outOfStock: { mode: "message", message: "Out" }, backorder: { mode: "hide", message: "" } } }, { ...ok, policy: "continue", qty: 0 }).kind, "hidden");
  assert.equal(view(day, { delayDays: 2, delayMessage: "x" }, { ...ok, available: false }).kind, "outofstock", "no date promised in delay mode either");
  assert.equal(view(day, { delayDays: 2, delayMessage: "x" }, { ...ok, policy: "continue", qty: 0 }).kind, "backorder");
});

test("the warning notice shows for London's own date, both ends included", () => {
  const warning = { enabled: true, startDate: "2026-12-01", endDate: "2026-12-24", message: "Last orders" };
  const on = iso => logic.warningVisible(at(iso), warning);
  assert.equal(on("2026-11-30T23:59:00Z"), false);
  assert.equal(on("2026-12-01T00:00:00Z"), true);
  assert.equal(on("2026-12-24T23:59:00Z"), true);
  assert.equal(on("2026-12-25T00:00:00Z"), false);
  const summer = { ...warning, startDate: "2026-06-01", endDate: "2026-06-30" };
  assert.equal(logic.warningVisible(at("2026-06-30T23:30:00Z"), summer), false, "already 1 July in London");
  assert.equal(logic.warningVisible(at("2026-05-31T23:30:00Z"), summer), true, "already 1 June in London");
  assert.equal(logic.warningVisible(at("2026-12-10T12:00:00Z"), { ...warning, enabled: false }), false);
  assert.equal(logic.warningVisible(at("2026-12-10T12:00:00Z"), { ...warning, message: "" }), false);
});

test("calendar arithmetic is on dates, not instants", () => {
  assert.equal(logic.addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(logic.addDays("2026-03-29", 1), "2026-03-30");
  assert.equal(logic.addDays("2026-10-25", 1), "2026-10-26");
  assert.equal(logic.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(logic.addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(logic.weekday("2026-10-26"), 1);
  assert.equal(logic.parseCutoff("09:05"), 545);
  assert.equal(logic.parseCutoff("24:00"), null);
  assert.equal(logic.parseCutoff("9:05"), null);
});
