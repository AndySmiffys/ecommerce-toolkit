"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// tests/shipping-config.test.ts
var import_node_test = __toESM(require("node:test"), 1);
var import_strict = __toESM(require("node:assert/strict"), 1);

// app/modules/shipping/config.ts
var defaultShippingConfig = {
  version: 1,
  cutoffTime: "15:00",
  shippingDays: [false, true, true, true, true, true, false],
  bankHolidays: [],
  delayDays: 0,
  delayMessage: "Our warehouse is busier than usual. [highlight]Orders are being dispatched from[/highlight]",
  hideIfUnavailable: false,
  showShippingDays: true,
  shippingDaysPrefix: "We ship on:",
  noShippingText: "No dispatch day is available right now.",
  errorText: "Dispatch information is not available right now.",
  countdownPrefix: "Order in the next",
  countdownSuffix: "for dispatch on",
  freeShipping: {
    enabled: true,
    thresholds: { GBP: 5e3 },
    textUnder: "Free delivery on orders over {threshold}",
    textAdd: "Add this item to get free delivery!",
    textOver: "You've got free delivery!"
  },
  availability: { preorderMode: "message", preorderMessage: "Available to pre-order: your dispatch date is shown at checkout." },
  warning: { enabled: false, startDate: "", endDate: "", message: "", textColor: "#8a4b00", backgroundColor: "#fff4e5", borderColor: "#f59e0b" }
};
var limits = { text: 300, message: 600, holidays: 400, currencies: 20 };
function isIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}
function parseBankHolidays(text) {
  const seen = /* @__PURE__ */ new Set();
  const invalid = [];
  for (const raw of text.split(/[\r\n,;]+/)) {
    const item = raw.trim();
    if (!item) continue;
    if (isIsoDate(item)) seen.add(item);
    else invalid.push(item);
  }
  return { dates: [...seen].sort(), invalid };
}
var hexColour = /^#[0-9a-fA-F]{6}$/;
var currencyCode = /^[A-Z]{3}$/;
function toMinorUnits(text) {
  const match = /^\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(text);
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || 0) : null;
}
function fromMinorUnits(minor) {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}
function validateShippingConfig(input) {
  const errors = [];
  const source = input && typeof input === "object" ? input : {};
  const text = (value, label, fallback, max = limits.text, required = false) => {
    const clean = typeof value === "string" ? value.trim() : fallback;
    if (required && !clean) errors.push(`${label} cannot be empty.`);
    if (clean.length > max) errors.push(`${label} must be ${max} characters or fewer.`);
    return clean;
  };
  const flag = (value, fallback) => typeof value === "boolean" ? value : fallback;
  const d = defaultShippingConfig;
  const free = source.freeShipping && typeof source.freeShipping === "object" ? source.freeShipping : {};
  const availability = source.availability && typeof source.availability === "object" ? source.availability : {};
  const warning = source.warning && typeof source.warning === "object" ? source.warning : {};
  const cutoffTime = typeof source.cutoffTime === "string" ? source.cutoffTime.trim() : d.cutoffTime;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoffTime)) errors.push("Cut-off time must be a 24-hour time such as 15:00.");
  const shippingDays = Array.isArray(source.shippingDays) && source.shippingDays.length === 7 ? source.shippingDays.map(Boolean) : d.shippingDays;
  if (!shippingDays.some(Boolean)) errors.push("Choose at least one shipping day.");
  let bankHolidays = [];
  if (Array.isArray(source.bankHolidays)) {
    const bad = source.bankHolidays.filter((item) => typeof item !== "string" || !isIsoDate(item));
    if (bad.length) errors.push(`Bank holidays must be dates written YYYY-MM-DD. Not valid: ${bad.slice(0, 3).join(", ")}.`);
    bankHolidays = [...new Set(source.bankHolidays.filter((item) => typeof item === "string" && isIsoDate(item)))].sort();
  }
  if (bankHolidays.length > limits.holidays) errors.push(`Keep bank holidays to ${limits.holidays} dates or fewer.`);
  const delayRaw = source.delayDays === void 0 ? d.delayDays : Number(source.delayDays);
  if (!Number.isInteger(delayRaw) || delayRaw < 0 || delayRaw > 60) errors.push("Delay days must be a whole number from 0 to 60.");
  const delayDays = Number.isInteger(delayRaw) && delayRaw >= 0 && delayRaw <= 60 ? delayRaw : 0;
  const thresholds = {};
  const thresholdInput = free.thresholds && typeof free.thresholds === "object" ? Object.entries(free.thresholds) : [];
  if (thresholdInput.length > limits.currencies) errors.push(`Keep thresholds to ${limits.currencies} currencies or fewer.`);
  for (const [code, amount] of thresholdInput) {
    const upper = code.trim().toUpperCase();
    if (!currencyCode.test(upper)) {
      errors.push(`"${code}" is not a three-letter currency code such as GBP.`);
      continue;
    }
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
      errors.push(`The ${upper} threshold must be zero or more.`);
      continue;
    }
    thresholds[upper] = amount;
  }
  const freeEnabled = flag(free.enabled, d.freeShipping.enabled);
  if (freeEnabled && !Object.values(thresholds).some((amount) => amount > 0)) errors.push("Enter a free shipping threshold for at least one currency, or turn free shipping off.");
  const preorderMode = availability.preorderMode === "hide" ? "hide" : "message";
  const warningEnabled = flag(warning.enabled, false);
  const startDate = typeof warning.startDate === "string" ? warning.startDate.trim() : "";
  const endDate = typeof warning.endDate === "string" ? warning.endDate.trim() : "";
  const warningMessage = text(warning.message, "Warning message", "", limits.message, warningEnabled);
  if (warningEnabled) {
    if (!isIsoDate(startDate)) errors.push("Warning start date must be a valid date.");
    if (!isIsoDate(endDate)) errors.push("Warning end date must be a valid date.");
    if (isIsoDate(startDate) && isIsoDate(endDate) && endDate < startDate) errors.push("Warning end date cannot be before the start date.");
  } else {
    if (startDate && !isIsoDate(startDate)) errors.push("Warning start date must be a valid date.");
    if (endDate && !isIsoDate(endDate)) errors.push("Warning end date must be a valid date.");
  }
  const colour = (value, label, fallback) => {
    if (value === void 0 || value === "") return fallback;
    if (typeof value !== "string" || !hexColour.test(value)) {
      errors.push(`${label} must be a colour such as #f59e0b.`);
      return fallback;
    }
    return value.toLowerCase();
  };
  const config = {
    version: 1,
    cutoffTime,
    shippingDays,
    bankHolidays,
    delayDays,
    delayMessage: text(source.delayMessage, "Delay message", d.delayMessage, limits.message, delayDays > 0),
    hideIfUnavailable: flag(source.hideIfUnavailable, d.hideIfUnavailable),
    showShippingDays: flag(source.showShippingDays, d.showShippingDays),
    shippingDaysPrefix: text(source.shippingDaysPrefix, "Shipping days prefix", d.shippingDaysPrefix),
    noShippingText: text(source.noShippingText, "No shipping text", d.noShippingText),
    errorText: text(source.errorText, "Error text", d.errorText),
    countdownPrefix: text(source.countdownPrefix, "Countdown prefix", d.countdownPrefix),
    countdownSuffix: text(source.countdownSuffix, "Countdown suffix", d.countdownSuffix),
    freeShipping: {
      enabled: freeEnabled,
      thresholds,
      textUnder: text(free.textUnder, "Message under the threshold", d.freeShipping.textUnder, limits.text, freeEnabled),
      textAdd: text(free.textAdd, "Add this item message", d.freeShipping.textAdd),
      textOver: text(free.textOver, "Message over the threshold", d.freeShipping.textOver)
    },
    availability: { preorderMode, preorderMessage: text(availability.preorderMessage, "Pre-order message", d.availability.preorderMessage, limits.message, preorderMode === "message") },
    warning: {
      enabled: warningEnabled,
      startDate,
      endDate,
      message: warningMessage,
      textColor: colour(warning.textColor, "Warning text colour", d.warning.textColor),
      backgroundColor: colour(warning.backgroundColor, "Warning background colour", d.warning.backgroundColor),
      borderColor: colour(warning.borderColor, "Warning border colour", d.warning.borderColor)
    }
  };
  return errors.length ? { ok: false, errors } : { ok: true, config };
}

// app/modules/shipping/bankHolidays.server.ts
function upcomingBankHolidays(payload, today) {
  const events = payload?.["england-and-wales"]?.events;
  if (!Array.isArray(events)) throw new Error("gov.uk sent a bank holiday list in a format the app does not recognise.");
  return events.map((event) => typeof event?.date === "string" ? event.date : "").filter((date) => isIsoDate(date) && date >= today).sort();
}
function mergeBankHolidays(existing, imported) {
  return [.../* @__PURE__ */ new Set([...existing, ...imported])].sort();
}

// tests/shipping-config.test.ts
var valid = (changes = {}) => ({ ...defaultShippingConfig, ...changes });
var errorsOf = (input) => {
  const check = validateShippingConfig(input);
  import_strict.default.equal(check.ok, false);
  return check.ok ? [] : check.errors;
};
(0, import_node_test.default)("the defaults are valid and stay as they are", () => {
  const check = validateShippingConfig(defaultShippingConfig);
  import_strict.default.equal(check.ok, true);
  import_strict.default.deepEqual(check.ok && check.config, defaultShippingConfig);
});
(0, import_node_test.default)("the cut-off must be a 24-hour HH:MM time", () => {
  for (const good of ["00:00", "09:05", "15:00", "23:59"]) import_strict.default.equal(validateShippingConfig(valid({ cutoffTime: good })).ok, true, good);
  for (const bad of ["", "24:00", "9:05", "15:60", "3pm", "15:00:00"]) import_strict.default.match(errorsOf(valid({ cutoffTime: bad })).join(" "), /Cut-off time/, bad);
});
(0, import_node_test.default)("bank holidays must be real ISO dates, and are cleaned, de-duplicated and sorted", () => {
  const check = validateShippingConfig(valid({ bankHolidays: ["2026-12-28", "2026-12-25", "2026-12-25"] }));
  import_strict.default.deepEqual(check.ok && check.config.bankHolidays, ["2026-12-25", "2026-12-28"]);
  import_strict.default.match(errorsOf(valid({ bankHolidays: ["25/12/2026"] })).join(" "), /YYYY-MM-DD/);
  import_strict.default.match(errorsOf(valid({ bankHolidays: ["2026-02-30"] })).join(" "), /Not valid: 2026-02-30/);
  import_strict.default.equal(isIsoDate("2028-02-29"), true);
  import_strict.default.equal(isIsoDate("2027-02-29"), false);
  import_strict.default.deepEqual(parseBankHolidays("2026-12-28\n2026-12-25, 2026-12-25\r\n bad \n"), { dates: ["2026-12-25", "2026-12-28"], invalid: ["bad"] });
});
(0, import_node_test.default)("at least one shipping day, and delay days between 0 and 60", () => {
  import_strict.default.match(errorsOf(valid({ shippingDays: [false, false, false, false, false, false, false] })).join(" "), /at least one shipping day/);
  import_strict.default.equal(validateShippingConfig(valid({ delayDays: 0 })).ok, true);
  import_strict.default.equal(validateShippingConfig(valid({ delayDays: 60 })).ok, true);
  for (const bad of [-1, 61, 1.5, "x"]) import_strict.default.match(errorsOf(valid({ delayDays: bad })).join(" "), /Delay days/, String(bad));
  import_strict.default.match(errorsOf(valid({ delayDays: 2, delayMessage: " " })).join(" "), /Delay message cannot be empty/);
});
(0, import_node_test.default)("free shipping needs a threshold per currency of zero or more, in whole pence", () => {
  const free = (thresholds, enabled = true) => valid({ freeShipping: { ...defaultShippingConfig.freeShipping, enabled, thresholds } });
  import_strict.default.equal(validateShippingConfig(free({ GBP: 5e3 })).ok, true);
  import_strict.default.equal(validateShippingConfig(free({ gbp: 4950, eur: 6e3 })).ok && true, true);
  const lower = validateShippingConfig(free({ gbp: 4950 }));
  import_strict.default.deepEqual(lower.ok && lower.config.freeShipping.thresholds, { GBP: 4950 }, "codes are upper-cased");
  import_strict.default.match(errorsOf(free({ GBP: -1 })).join(" "), /GBP threshold/);
  import_strict.default.match(errorsOf(free({ GBP: 49.5 })).join(" "), /GBP threshold/);
  import_strict.default.match(errorsOf(free({ POUNDS: 5e3 })).join(" "), /three-letter/);
  import_strict.default.match(errorsOf(free({})).join(" "), /threshold for at least one currency/);
  import_strict.default.equal(validateShippingConfig(free({}, false)).ok, true, "no threshold is fine when it is off");
});
(0, import_node_test.default)("pounds typed in the app become whole pence, and back", () => {
  import_strict.default.equal(toMinorUnits("50"), 5e3);
  import_strict.default.equal(toMinorUnits("49.5"), 4950);
  import_strict.default.equal(toMinorUnits("49.50"), 4950);
  import_strict.default.equal(toMinorUnits("0.05"), 5);
  import_strict.default.equal(toMinorUnits("49.999"), null);
  import_strict.default.equal(toMinorUnits("-1"), null);
  import_strict.default.equal(toMinorUnits(""), null);
  import_strict.default.equal(toMinorUnits("abc"), null);
  import_strict.default.equal(fromMinorUnits(5e3), "50");
  import_strict.default.equal(fromMinorUnits(4950), "49.50");
  import_strict.default.equal(fromMinorUnits(5), "0.05");
});
(0, import_node_test.default)("the warning notice needs valid dates with the end on or after the start, and its colours must be hex", () => {
  const warning = (changes) => valid({ warning: { ...defaultShippingConfig.warning, enabled: true, startDate: "2026-12-01", endDate: "2026-12-24", message: "Last orders", ...changes } });
  import_strict.default.equal(validateShippingConfig(warning({})).ok, true);
  import_strict.default.equal(validateShippingConfig(warning({ startDate: "2026-12-24" })).ok, true, "one day is allowed");
  import_strict.default.match(errorsOf(warning({ endDate: "2026-11-30" })).join(" "), /end date cannot be before/);
  import_strict.default.match(errorsOf(warning({ startDate: "" })).join(" "), /start date must be a valid date/);
  import_strict.default.match(errorsOf(warning({ endDate: "24/12/2026" })).join(" "), /end date must be a valid date/);
  import_strict.default.match(errorsOf(warning({ message: "" })).join(" "), /Warning message cannot be empty/);
  import_strict.default.match(errorsOf(warning({ borderColor: "orange" })).join(" "), /border colour/);
  import_strict.default.equal(validateShippingConfig(valid({ warning: { ...defaultShippingConfig.warning, enabled: false, startDate: "", endDate: "", message: "" } })).ok, true, "empty is fine while it is off");
});
(0, import_node_test.default)("text is trimmed and limited, and nothing unexpected is carried through", () => {
  const check = validateShippingConfig({ ...defaultShippingConfig, countdownPrefix: "  Order in the next  ", evil: "<script>", freeShipping: { ...defaultShippingConfig.freeShipping, extra: 1 } });
  import_strict.default.equal(check.ok && check.config.countdownPrefix, "Order in the next");
  import_strict.default.equal(check.ok && "evil" in check.config, false);
  import_strict.default.equal(check.ok && "extra" in check.config.freeShipping, false);
  import_strict.default.match(errorsOf(valid({ errorText: "x".repeat(301) })).join(" "), /300 characters/);
  import_strict.default.equal(validateShippingConfig(null).ok, true, "nothing saved gives the defaults");
});
(0, import_node_test.default)("the gov.uk list keeps England and Wales dates from today on, and merges without repeats", () => {
  const payload = { "england-and-wales": { events: [{ date: "2026-08-31" }, { date: "2026-12-25" }, { date: "2026-12-28" }, { date: "nonsense" }, {}] }, scotland: { events: [{ date: "2026-12-26" }] } };
  import_strict.default.deepEqual(upcomingBankHolidays(payload, "2026-10-26"), ["2026-12-25", "2026-12-28"]);
  import_strict.default.deepEqual(upcomingBankHolidays(payload, "2026-12-25"), ["2026-12-25", "2026-12-28"], "today counts");
  import_strict.default.throws(() => upcomingBankHolidays({}, "2026-10-26"), /format/);
  import_strict.default.deepEqual(mergeBankHolidays(["2026-12-28", "2027-01-01"], ["2026-12-25", "2026-12-28"]), ["2026-12-25", "2026-12-28", "2027-01-01"]);
});
