import test from "node:test";
import assert from "node:assert/strict";
import { defaultShippingConfig, defaultShippingStyle, isIsoDate, parseBankHolidays, validateShippingConfig } from "../app/modules/shipping/config";
import { mergeBankHolidays, upcomingBankHolidays } from "../app/modules/shipping/bankHolidays.server";

const valid = (changes: Record<string, unknown> = {}) => ({ ...defaultShippingConfig, ...changes });
const errorsOf = (input: unknown) => { const check = validateShippingConfig(input); assert.equal(check.ok, false); return check.ok ? [] : check.errors; };

test("the defaults are valid and stay as they are", () => {
  const check = validateShippingConfig(defaultShippingConfig);
  assert.equal(check.ok, true);
  assert.deepEqual(check.ok && check.config, defaultShippingConfig);
});

test("the cut-off must be a 24-hour HH:MM time", () => {
  for (const good of ["00:00", "09:05", "15:00", "23:59"]) assert.equal(validateShippingConfig(valid({ cutoffTime: good })).ok, true, good);
  for (const bad of ["", "24:00", "9:05", "15:60", "3pm", "15:00:00"]) assert.match(errorsOf(valid({ cutoffTime: bad })).join(" "), /Cut-off time/, bad);
});

test("bank holidays must be real ISO dates, and are cleaned, de-duplicated and sorted", () => {
  const check = validateShippingConfig(valid({ bankHolidays: ["2026-12-28", "2026-12-25", "2026-12-25"] }));
  assert.deepEqual(check.ok && check.config.bankHolidays, ["2026-12-25", "2026-12-28"]);
  assert.match(errorsOf(valid({ bankHolidays: ["25/12/2026"] })).join(" "), /YYYY-MM-DD/);
  assert.match(errorsOf(valid({ bankHolidays: ["2026-02-30"] })).join(" "), /Not valid: 2026-02-30/);
  assert.equal(isIsoDate("2028-02-29"), true);
  assert.equal(isIsoDate("2027-02-29"), false);
  assert.deepEqual(parseBankHolidays("2026-12-28\n2026-12-25, 2026-12-25\r\n bad \n"), { dates: ["2026-12-25", "2026-12-28"], invalid: ["bad"] });
});

test("at least one shipping day, and delay days between 0 and 60", () => {
  assert.match(errorsOf(valid({ shippingDays: [false, false, false, false, false, false, false] })).join(" "), /at least one shipping day/);
  assert.equal(validateShippingConfig(valid({ delayDays: 0 })).ok, true);
  assert.equal(validateShippingConfig(valid({ delayDays: 60 })).ok, true);
  for (const bad of [-1, 61, 1.5, "x"]) assert.match(errorsOf(valid({ delayDays: bad })).join(" "), /Delay days/, String(bad));
  assert.match(errorsOf(valid({ delayDays: 2, delayMessage: " " })).join(" "), /Delay message cannot be empty/);
});

test("free shipping is a switch and three wordings: the thresholds come from Shopify, never from here", () => {
  const free = (changes: Record<string, unknown>) => valid({ freeShipping: { ...defaultShippingConfig.freeShipping, ...changes } });
  assert.equal(validateShippingConfig(free({})).ok, true);
  assert.equal(validateShippingConfig(free({ enabled: false, textUnder: "" })).ok, true, "nothing to say when it is off");
  assert.match(errorsOf(free({ textUnder: " " })).join(" "), /Message under the threshold cannot be empty/);
  assert.match(errorsOf(free({ textUnder: "x".repeat(301) })).join(" "), /300 characters/);
  const old = validateShippingConfig(free({ thresholds: { GBP: 5000 } }));
  assert.equal(old.ok && "thresholds" in old.config.freeShipping, false, "a threshold saved by an earlier version is dropped");
  assert.deepEqual(Object.keys(defaultShippingConfig.freeShipping).sort(), ["enabled", "textAdd", "textOver", "textUnder"]);
  assert.match(defaultShippingConfig.freeShipping.textUnder, /\{country\}.*\{threshold\}/, "the default wording names the country");
});

test("the warning notice needs valid dates with the end on or after the start, and its colours must be hex", () => {
  const warning = (changes: Record<string, unknown>) => valid({ warning: { ...defaultShippingConfig.warning, enabled: true, startDate: "2026-12-01", endDate: "2026-12-24", message: "Last orders", ...changes } });
  assert.equal(validateShippingConfig(warning({})).ok, true);
  assert.equal(validateShippingConfig(warning({ startDate: "2026-12-24" })).ok, true, "one day is allowed");
  assert.match(errorsOf(warning({ endDate: "2026-11-30" })).join(" "), /end date cannot be before/);
  assert.match(errorsOf(warning({ startDate: "" })).join(" "), /start date must be a valid date/);
  assert.match(errorsOf(warning({ endDate: "24/12/2026" })).join(" "), /end date must be a valid date/);
  assert.match(errorsOf(warning({ message: "" })).join(" "), /Warning message cannot be empty/);
  assert.match(errorsOf(warning({ borderColor: "orange" })).join(" "), /border colour/);
  assert.equal(validateShippingConfig(valid({ warning: { ...defaultShippingConfig.warning, enabled: false, startDate: "", endDate: "", message: "" } })).ok, true, "empty is fine while it is off");
});

test("text is trimmed and limited, and nothing unexpected is carried through", () => {
  const check = validateShippingConfig({ ...defaultShippingConfig, countdownPrefix: "  Order in the next  ", evil: "<script>", freeShipping: { ...defaultShippingConfig.freeShipping, extra: 1 } });
  assert.equal(check.ok && check.config.countdownPrefix, "Order in the next");
  assert.equal(check.ok && "evil" in check.config, false);
  assert.equal(check.ok && "extra" in check.config.freeShipping, false);
  assert.match(errorsOf(valid({ errorText: "x".repeat(301) })).join(" "), /300 characters/);
  assert.equal(validateShippingConfig(null).ok, true, "nothing saved gives the defaults");
});

test("the gov.uk list keeps England and Wales dates from today on, and merges without repeats", () => {
  const payload = { "england-and-wales": { events: [{ date: "2026-08-31" }, { date: "2026-12-25" }, { date: "2026-12-28" }, { date: "nonsense" }, {}] }, scotland: { events: [{ date: "2026-12-26" }] } };
  assert.deepEqual(upcomingBankHolidays(payload, "2026-10-26"), ["2026-12-25", "2026-12-28"]);
  assert.deepEqual(upcomingBankHolidays(payload, "2026-12-25"), ["2026-12-25", "2026-12-28"], "today counts");
  assert.throws(() => upcomingBankHolidays({}, "2026-10-26"), /format/);
  assert.deepEqual(mergeBankHolidays(["2026-12-28", "2027-01-01"], ["2026-12-25", "2026-12-28"]), ["2026-12-25", "2026-12-28", "2027-01-01"]);
});

test("the appearance has the old block's look by default and is checked field by field", () => {
  assert.deepEqual(defaultShippingStyle, { align: "center", showIcon: true, textSize: 16, fontWeight: "500", padding: "standard", margin: 16, radius: 8, border: "double", borderWidth: 6, background: "#f8f9fa", text: "#333333", accent: "#d63384", dispatch: "#28a745", muted: "#666666", icon: "#007bff" });
  const look = (changes: Record<string, unknown>) => valid({ style: { ...defaultShippingStyle, ...changes } });
  const good = validateShippingConfig(look({ align: "right", textSize: "20", border: "solid", padding: "compact", background: "#FFFFFF" }));
  assert.equal(good.ok && good.config.style.textSize, 20, "numbers typed as text are accepted");
  assert.equal(good.ok && good.config.style.background, "#ffffff", "colours are lower-cased");
  assert.equal(validateShippingConfig(look({})).ok, true);
  for (const [field, bad, label] of [["align", "middle", /Alignment/], ["fontWeight", "800", /Font weight/], ["padding", "huge", /Padding/], ["border", "dotted", /Border is/], ["textSize", 11, /Text size/], ["textSize", 25, /Text size/], ["textSize", "", /Text size/], ["margin", -1, /Space above/], ["radius", 21, /Corner radius/], ["borderWidth", 0, /Border width/], ["borderWidth", 11, /Border width/], ["accent", "red", /Countdown colour/], ["icon", "#12345", /Icon colour/]] as const) {
    assert.match(errorsOf(look({ [field]: bad })).join(" "), label, `${field}=${String(bad)}`);
  }
  const old = validateShippingConfig({ ...defaultShippingConfig, style: undefined });
  assert.deepEqual(old.ok && old.config.style, defaultShippingStyle, "settings saved before the appearance existed get the original look");
  const stripped = validateShippingConfig(look({ nonsense: "x" }));
  assert.equal(stripped.ok && "nonsense" in stripped.config.style, false);
});

test("out of stock and zero stock with continue selling each have their own wording and a hide option", () => {
  const stock = (changes: Record<string, unknown>) => valid({ availability: { ...defaultShippingConfig.availability, ...changes } });
  assert.deepEqual(Object.keys(defaultShippingConfig.availability).sort(), ["backorder", "outOfStock"]);
  assert.notEqual(defaultShippingConfig.availability.outOfStock.message, defaultShippingConfig.availability.backorder.message, "they say different things");
  assert.equal(validateShippingConfig(stock({})).ok, true);
  assert.equal(validateShippingConfig(stock({ outOfStock: { mode: "hide", message: "" } })).ok, true, "no message needed when hiding");
  assert.match(errorsOf(stock({ outOfStock: { mode: "message", message: " " } })).join(" "), /Out of stock message cannot be empty/);
  assert.match(errorsOf(stock({ backorder: { mode: "message", message: "" } })).join(" "), /Back-order message cannot be empty/);
  assert.match(errorsOf(stock({ backorder: { mode: "message", message: "x".repeat(601) } })).join(" "), /600 characters/);
  const odd = validateShippingConfig(stock({ outOfStock: { mode: "nonsense", message: "Gone" } }));
  assert.equal(odd.ok && odd.config.availability.outOfStock.mode, "message", "an unknown mode is treated as showing the message");
});

test("settings saved with the single pre-order message keep their wording for zero stock with continue selling", () => {
  const old = validateShippingConfig({ ...defaultShippingConfig, availability: { preorderMode: "message", preorderMessage: "Pre-order: date at checkout" } });
  assert.equal(old.ok && old.config.availability.backorder.message, "Pre-order: date at checkout");
  assert.equal(old.ok && old.config.availability.outOfStock.message, defaultShippingConfig.availability.outOfStock.message, "out of stock gets the new default");
  const hidden = validateShippingConfig({ ...defaultShippingConfig, availability: { preorderMode: "hide" } });
  assert.equal(hidden.ok && hidden.config.availability.backorder.mode, "hide");
  assert.equal(old.ok && "preorderMessage" in old.config.availability, false, "the old fields are not carried forward");
});
