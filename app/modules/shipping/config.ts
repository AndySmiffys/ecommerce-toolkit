/**
 * The shipping countdown's business settings: one JSON document the merchant edits in the app and the theme block reads
 * from an app metafield. Amounts are in minor units (pence) of each currency, entered per currency, never converted.
 */

/** How the block looks. Everything about it is set in the app; the theme editor only places the block. */
export type ShippingStyle = {
  align: "left" | "center" | "right";
  showIcon: boolean;
  /** Main text size in px. The days line is 87.5% of it and the icon 1.5 times it. */
  textSize: number;
  fontWeight: "400" | "500" | "600" | "700";
  /** Space inside the box: compact 12/16px, standard 16/24px, roomy 24/32px (top and bottom / sides). */
  padding: "compact" | "standard" | "roomy";
  /** Space above and below the block, px. */
  margin: number;
  radius: number;
  border: "double" | "solid" | "none";
  borderWidth: number;
  background: string;
  text: string;
  /** The time left. */
  accent: string;
  /** The dispatch day, and the border. */
  dispatch: string;
  /** The days line and "no dispatch" text. */
  muted: string;
  icon: string;
};

export type ShippingCountdownConfig = {
  version: 1;
  /** 24-hour "HH:MM", London time. */
  cutoffTime: string;
  /** Sunday first, as JavaScript counts days. */
  shippingDays: boolean[];
  /** "YYYY-MM-DD", sorted. */
  bankHolidays: string[];
  /** 0 is off. Otherwise the Nth shipping day from today, ignoring the cut-off. */
  delayDays: number;
  delayMessage: string;
  hideIfUnavailable: boolean;
  showShippingDays: boolean;
  shippingDaysPrefix: string;
  noShippingText: string;
  errorText: string;
  countdownPrefix: string;
  countdownSuffix: string;
  freeShipping: { enabled: boolean; thresholds: Record<string, number>; textUnder: string; textAdd: string; textOver: string };
  availability: { preorderMode: "message" | "hide"; preorderMessage: string };
  warning: { enabled: boolean; startDate: string; endDate: string; message: string; textColor: string; backgroundColor: string; borderColor: string };
  style: ShippingStyle;
};

export const defaultShippingStyle: ShippingStyle = {
  align: "center", showIcon: true, textSize: 16, fontWeight: "500", padding: "standard", margin: 16, radius: 8, border: "double", borderWidth: 6,
  background: "#f8f9fa", text: "#333333", accent: "#d63384", dispatch: "#28a745", muted: "#666666", icon: "#007bff",
};

export const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const defaultShippingConfig: ShippingCountdownConfig = {
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
    thresholds: { GBP: 5000 },
    textUnder: "Free delivery on orders over {threshold}",
    textAdd: "Add this item to get free delivery!",
    textOver: "You've got free delivery!",
  },
  availability: { preorderMode: "message", preorderMessage: "Available to pre-order: your dispatch date is shown at checkout." },
  warning: { enabled: false, startDate: "", endDate: "", message: "", textColor: "#8a4b00", backgroundColor: "#fff4e5", borderColor: "#f59e0b" },
  style: defaultShippingStyle,
};

export const limits = { text: 300, message: 600, holidays: 400, currencies: 20 };

export function isIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

/** One date per line or comma, in any order; returns the clean list and anything that is not a valid date. */
export function parseBankHolidays(text: string): { dates: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const invalid: string[] = [];
  for (const raw of text.split(/[\r\n,;]+/)) {
    const item = raw.trim();
    if (!item) continue;
    if (isIsoDate(item)) seen.add(item); else invalid.push(item);
  }
  return { dates: [...seen].sort(), invalid };
}

const hexColour = /^#[0-9a-fA-F]{6}$/;
const currencyCode = /^[A-Z]{3}$/;

/** Pounds as typed ("50", "49.50") to pence, or null when it is not a non-negative amount with at most two decimals. */
export function toMinorUnits(text: string): number | null {
  const match = /^\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(text);
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || 0) : null;
}
export function fromMinorUnits(minor: number) {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

export type ConfigCheck = { ok: true; config: ShippingCountdownConfig } | { ok: false; errors: string[] };

/**
 * Checks what the merchant entered and returns the clean settings, or every problem found. Takes unknown input so the same
 * check protects the save and anything read back from the metafield.
 */
export function validateShippingConfig(input: unknown): ConfigCheck {
  const errors: string[] = [];
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (value: unknown, label: string, fallback: string, max = limits.text, required = false) => {
    const clean = typeof value === "string" ? value.trim() : fallback;
    if (required && !clean) errors.push(`${label} cannot be empty.`);
    if (clean.length > max) errors.push(`${label} must be ${max} characters or fewer.`);
    return clean;
  };
  const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  const d = defaultShippingConfig;
  const free = (source.freeShipping && typeof source.freeShipping === "object" ? source.freeShipping : {}) as Record<string, unknown>;
  const availability = (source.availability && typeof source.availability === "object" ? source.availability : {}) as Record<string, unknown>;
  const warning = (source.warning && typeof source.warning === "object" ? source.warning : {}) as Record<string, unknown>;
  const look = (source.style && typeof source.style === "object" ? source.style : {}) as Record<string, unknown>;

  const cutoffTime = typeof source.cutoffTime === "string" ? source.cutoffTime.trim() : d.cutoffTime;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoffTime)) errors.push("Cut-off time must be a 24-hour time such as 15:00.");

  const shippingDays = Array.isArray(source.shippingDays) && source.shippingDays.length === 7 ? source.shippingDays.map(Boolean) : d.shippingDays;
  if (!shippingDays.some(Boolean)) errors.push("Choose at least one shipping day.");

  let bankHolidays: string[] = [];
  if (Array.isArray(source.bankHolidays)) {
    const bad = source.bankHolidays.filter(item => typeof item !== "string" || !isIsoDate(item));
    if (bad.length) errors.push(`Bank holidays must be dates written YYYY-MM-DD. Not valid: ${bad.slice(0, 3).join(", ")}.`);
    bankHolidays = [...new Set(source.bankHolidays.filter((item): item is string => typeof item === "string" && isIsoDate(item)))].sort();
  }
  if (bankHolidays.length > limits.holidays) errors.push(`Keep bank holidays to ${limits.holidays} dates or fewer.`);

  const delayRaw = source.delayDays === undefined ? d.delayDays : Number(source.delayDays);
  if (!Number.isInteger(delayRaw) || delayRaw < 0 || delayRaw > 60) errors.push("Delay days must be a whole number from 0 to 60.");
  const delayDays = Number.isInteger(delayRaw) && delayRaw >= 0 && delayRaw <= 60 ? delayRaw : 0;

  const thresholds: Record<string, number> = {};
  const thresholdInput = free.thresholds && typeof free.thresholds === "object" ? Object.entries(free.thresholds as Record<string, unknown>) : Object.entries(d.freeShipping.thresholds);
  if (thresholdInput.length > limits.currencies) errors.push(`Keep thresholds to ${limits.currencies} currencies or fewer.`);
  for (const [code, amount] of thresholdInput) {
    const upper = code.trim().toUpperCase();
    if (!currencyCode.test(upper)) { errors.push(`"${code}" is not a three-letter currency code such as GBP.`); continue; }
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) { errors.push(`The ${upper} threshold must be zero or more.`); continue; }
    thresholds[upper] = amount;
  }
  const freeEnabled = flag(free.enabled, d.freeShipping.enabled);
  if (freeEnabled && !Object.values(thresholds).some(amount => amount > 0)) errors.push("Enter a free shipping threshold for at least one currency, or turn free shipping off.");

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
  const colour = (value: unknown, label: string, fallback: string) => {
    if (value === undefined || value === "") return fallback;
    if (typeof value !== "string" || !hexColour.test(value)) { errors.push(`${label} must be a colour such as #f59e0b.`); return fallback; }
    return value.toLowerCase();
  };

  const ds = defaultShippingStyle;
  const choice = <T extends string>(value: unknown, allowed: readonly T[], fallback: T, label: string): T => {
    if (value === undefined) return fallback;
    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
    errors.push(`${label} is not one of the choices.`);
    return fallback;
  };
  const whole = (value: unknown, label: string, min: number, max: number, fallback: number) => {
    if (value === undefined) return fallback;
    const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
    if (!Number.isInteger(n) || n < min || n > max) { errors.push(`${label} must be a whole number from ${min} to ${max}.`); return fallback; }
    return n;
  };
  const style: ShippingStyle = {
    align: choice(look.align, ["left", "center", "right"], ds.align, "Alignment"),
    showIcon: flag(look.showIcon, ds.showIcon),
    textSize: whole(look.textSize, "Text size", 12, 24, ds.textSize),
    fontWeight: choice(look.fontWeight, ["400", "500", "600", "700"], ds.fontWeight, "Font weight"),
    padding: choice(look.padding, ["compact", "standard", "roomy"], ds.padding, "Padding"),
    margin: whole(look.margin, "Space above and below", 0, 40, ds.margin),
    radius: whole(look.radius, "Corner radius", 0, 20, ds.radius),
    border: choice(look.border, ["double", "solid", "none"], ds.border, "Border"),
    borderWidth: whole(look.borderWidth, "Border width", 1, 10, ds.borderWidth),
    background: colour(look.background, "Background colour", ds.background),
    text: colour(look.text, "Text colour", ds.text),
    accent: colour(look.accent, "Countdown colour", ds.accent),
    dispatch: colour(look.dispatch, "Dispatch day colour", ds.dispatch),
    muted: colour(look.muted, "Secondary text colour", ds.muted),
    icon: colour(look.icon, "Icon colour", ds.icon),
  };

  const config: ShippingCountdownConfig = {
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
      textOver: text(free.textOver, "Message over the threshold", d.freeShipping.textOver),
    },
    availability: { preorderMode, preorderMessage: text(availability.preorderMessage, "Pre-order message", d.availability.preorderMessage, limits.message, preorderMode === "message") },
    warning: {
      enabled: warningEnabled,
      startDate,
      endDate,
      message: warningMessage,
      textColor: colour(warning.textColor, "Warning text colour", d.warning.textColor),
      backgroundColor: colour(warning.backgroundColor, "Warning background colour", d.warning.backgroundColor),
      borderColor: colour(warning.borderColor, "Warning border colour", d.warning.borderColor),
    },
    style,
  };
  return errors.length ? { ok: false, errors } : { ok: true, config };
}
