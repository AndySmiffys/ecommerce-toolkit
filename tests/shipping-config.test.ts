import test from "node:test";
import assert from "node:assert/strict";
import { defaultShippingConfig, fromMinorUnits, isIsoDate, parseBankHolidays, toMinorUnits, validateShippingConfig } from "../app/modules/shipping/config";
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

test("free shipping needs a threshold per currency of zero or more, in whole pence", () => {
  const free = (thresholds: unknown, enabled = true) => valid({ freeShipping: { ...defaultShippingConfig.freeShipping, enabled, thresholds } });
  assert.equal(validateShippingConfig(free({ GBP: 5000 })).ok, true);
  assert.equal(validateShippingConfig(free({ gbp: 4950, eur: 6000 })).ok && true, true);
  const lower = validateShippingConfig(free({ gbp: 4950 }));
  assert.deepEqual(lower.ok && lower.config.freeShipping.thresholds, { GBP: 4950 }, "codes are upper-cased");
  assert.match(errorsOf(free({ GBP: -1 })).join(" "), /GBP threshold/);
  assert.match(errorsOf(free({ GBP: 49.5 })).join(" "), /GBP threshold/);
  assert.match(errorsOf(free({ POUNDS: 5000 })).join(" "), /three-letter/);
  assert.match(errorsOf(free({})).join(" "), /threshold for at least one currency/);
  assert.equal(validateShippingConfig(free({}, false)).ok, true, "no threshold is fine when it is off");
});

test("pounds typed in the app become whole pence, and back", () => {
  assert.equal(toMinorUnits("50"), 5000);
  assert.equal(toMinorUnits("49.5"), 4950);
  assert.equal(toMinorUnits("49.50"), 4950);
  assert.equal(toMinorUnits("0.05"), 5);
  assert.equal(toMinorUnits("49.999"), null);
  assert.equal(toMinorUnits("-1"), null);
  assert.equal(toMinorUnits(""), null);
  assert.equal(toMinorUnits("abc"), null);
  assert.equal(fromMinorUnits(5000), "50");
  assert.equal(fromMinorUnits(4950), "49.50");
  assert.equal(fromMinorUnits(5), "0.05");
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
