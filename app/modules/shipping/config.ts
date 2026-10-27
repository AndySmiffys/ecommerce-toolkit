/**
 * The shipping countdown's business settings: one JSON document the merchant edits in the app and the theme block reads
 * from an app metafield. Free-delivery thresholds are not here: they come from Shopify's shipping settings (see delivery/).
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
  /** Space between each line inside the block (the warning, the icon, the free delivery line, the dispatch line, the days), px. */
  lineGap: number;
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

/**
 * What the app adds to a delivery service. The service itself is a Shopify shipping option, matched by its name; its price and delivery time
 * come from Shopify. Only what differs from the defaults is saved.
 */
export type DeliveryServiceSetting = {
  /** The option's name in Shopify. */
  name: string;
  /** What to call it on the product page, when the Shopify name is long or says things (guarantee, cut-off) that are set here instead. */
  label: string;
  show: boolean;
  /** Promised by the carrier. Never assumed: the message says Non-Guaranteed unless this is on. */
  guaranteed: boolean;
  /** "HH:MM" London time, or empty to use the shop's cut-off. */
  cutoffTime: string;
  /** Sunday first. The days this carrier delivers, which delivery times count. */
  days: boolean[];
  onBankHolidays: boolean;
  /** Business days from dispatch, typed in when Shopify has none or its figure is wrong. Both set, or both null to use Shopify's. */
  transitMin: number | null;
  transitMax: number | null;
};

export type DeliverySettings = {
  enabled: boolean;
  /** The words on the dropdown. */
  heading: string;
  guaranteedText: string;
  estimatedText: string;
  showMonth: boolean;
  services: DeliveryServiceSetting[];
};

/** Show a message, or hide the dispatch line altogether. */
export type StockHandling = { mode: "message" | "hide"; message: string };

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
  /** Whether to show the free-delivery message. Where it applies and from what order total is read from Shopify's shipping settings, never typed in. */
  freeShipping: { enabled: boolean; textUnder: string; textAdd: string; textOver: string };
  /** What to say instead of a dispatch date when the chosen variant cannot be dispatched now. */
  availability: { outOfStock: StockHandling; backorder: StockHandling };
  warning: { enabled: boolean; startDate: string; endDate: string; message: string; textColor: string; backgroundColor: string; borderColor: string };
  style: ShippingStyle;
  delivery: DeliverySettings;
};

export const defaultServiceSetting = (name: string): DeliveryServiceSetting => ({ name, label: "", show: true, guaranteed: false, cutoffTime: "", days: [false, true, true, true, true, true, false], onBankHolidays: false, transitMin: null, transitMax: null });

export const defaultDeliverySettings: DeliverySettings = {
  enabled: false,
  heading: "Delivery options",
  guaranteedText: "Delivery by {date}",
  estimatedText: "Delivery by {date} (Non-Guaranteed)",
  showMonth: true,
  services: [],
};

export const defaultShippingStyle: ShippingStyle = {
  align: "center", showIcon: true, textSize: 16, fontWeight: "500", padding: "standard", margin: 16, lineGap: 8, radius: 8, border: "double", borderWidth: 6,
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
    textUnder: "Free delivery to {country} on orders over {threshold}",
    textAdd: "Add this item to get free delivery!",
    textOver: "You've got free delivery!",
  },
  availability: {
    outOfStock: { mode: "message", message: "This item is currently out of stock." },
    backorder: { mode: "message", message: "Available to order now. It will be dispatched as soon as it is back in stock." },
  },
  warning: { enabled: false, startDate: "", endDate: "", message: "", textColor: "#8a4b00", backgroundColor: "#fff4e5", borderColor: "#f59e0b" },
  style: defaultShippingStyle,
  delivery: defaultDeliverySettings,
};

/** What can be written in braces in a free-delivery message. The product page fills each one in for the shopper. */
export const freePlaceholders = [
  { name: "threshold", meaning: "The order total that unlocks free delivery, in the shopper's currency", example: "£50" },
  { name: "country", meaning: "The shopper's country", example: "United Kingdom" },
  { name: "rate", meaning: "The name of the free delivery option in your Shopify shipping settings", example: "Free delivery" },
] as const;

/** What can be written in braces in a delivery message. */
export const deliveryPlaceholders = [
  { name: "date", meaning: "The latest date it can arrive", example: "Wed 28th Oct" },
  { name: "from", meaning: "The earliest date it can arrive", example: "Tue 27th Oct" },
  { name: "service", meaning: "The service's name, or the name you gave it here", example: "DPD Next Day" },
] as const;

/** Anything in braces that is not a placeholder the product page fills in, so a typo is caught instead of shown to shoppers. */
export function unknownPlaceholders(text: string, placeholders: ReadonlyArray<{ name: string }> = freePlaceholders): string[] {
  const known = new Set<string>(placeholders.map(item => item.name));
  return [...new Set([...text.matchAll(/\{([^{}]*)\}/g)].map(match => match[1]).filter(name => !known.has(name)))].map(name => `{${name}}`);
}

/** The message with its [bold] and [highlight] tags removed: the words a shopper reads. */
export const stripRich = (text: string) => text.replace(/\[\/?(?:bold|highlight)\]/g, "");

/**
 * Whether the formatting in a message is closed properly and nested (bold outside, highlight inside is fine either way round as long as
 * each is closed in the order it was opened). The editor only writes well-formed text, so this catches text that was written by hand.
 */
export function richProblem(text: string): string | null {
  const stack: string[] = [];
  for (const match of text.matchAll(/\[(\/?)(bold|highlight)\]/g)) {
    if (!match[1]) { stack.push(match[2]); continue; }
    if (stack.pop() !== match[2]) return `a closing [/${match[2]}] with no matching start`;
  }
  return stack.length ? `[${stack[stack.length - 1]}] that is never closed` : null;
}

export const limits = { text: 300, message: 600, holidays: 400, services: 100 };

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
    if (required && !stripRich(clean).trim()) errors.push(`${label} cannot be empty.`);
    if (clean.length > max) errors.push(`${label} must be ${max} characters or fewer.`);
    const broken = richProblem(clean);
    if (broken) errors.push(`${label} has formatting with ${broken}. Select the words and use the Bold and Highlight buttons.`);
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

  const freeEnabled = flag(free.enabled, d.freeShipping.enabled);
  const freeText = (value: unknown, label: string, fallback: string, required: boolean) => {
    const clean = text(value, label, fallback, limits.text, required);
    const unknown = unknownPlaceholders(clean);
    if (unknown.length) errors.push(`${label} uses ${unknown.join(", ")}, which is not a placeholder. You can use ${freePlaceholders.map(item => `{${item.name}}`).join(", ")}.`);
    return clean;
  };

  // Settings saved before out of stock and back-order were told apart had one pair of fields: keep their wording for back-order.
  const legacy = typeof availability.preorderMessage === "string" || availability.preorderMode !== undefined ? { mode: availability.preorderMode, message: availability.preorderMessage } : undefined;
  const stock = (raw: unknown, label: string, fallback: StockHandling): StockHandling => {
    const rule = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const mode = rule.mode === "hide" ? "hide" : "message";
    return { mode, message: text(rule.message, `${label} message`, fallback.message, limits.message, mode === "message") };
  };
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
    lineGap: whole(look.lineGap, "Space between lines", 0, 24, ds.lineGap),
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

  const dl = (source.delivery && typeof source.delivery === "object" ? source.delivery : {}) as Record<string, unknown>;
  const dd = defaultDeliverySettings;
  const deliveryEnabled = flag(dl.enabled, dd.enabled);
  const deliveryText = (value: unknown, label: string, fallback: string) => {
    const clean = text(value, label, fallback, limits.text, deliveryEnabled);
    const unknown = unknownPlaceholders(clean, deliveryPlaceholders);
    if (unknown.length) errors.push(`${label} uses ${unknown.join(", ")}, which is not a placeholder. You can use ${deliveryPlaceholders.map(item => `{${item.name}}`).join(", ")}.`);
    else if (deliveryEnabled && clean && !/\{(date|from)\}/.test(clean)) errors.push(`${label} must include {date} (or {from}), so it says when it arrives.`);
    return clean;
  };
  const services: DeliveryServiceSetting[] = [];
  const serviceInput = Array.isArray(dl.services) ? dl.services : [];
  if (serviceInput.length > limits.services) errors.push(`Keep delivery services to ${limits.services} or fewer.`);
  const seenServices = new Set<string>();
  for (const raw of serviceInput.slice(0, limits.services)) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) { errors.push("A delivery service has no name."); continue; }
    if (name.length > 200) { errors.push(`The name of "${name.slice(0, 40)}…" is too long.`); continue; }
    if (seenServices.has(name)) { errors.push(`"${name}" is listed more than once.`); continue; }
    seenServices.add(name);
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (label.length > 120) errors.push(`The name shown for "${name}" must be 120 characters or fewer.`);
    const cutoff = typeof item.cutoffTime === "string" ? item.cutoffTime.trim() : "";
    if (cutoff && !/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) errors.push(`The cut-off time for "${name}" must be a 24-hour time such as 14:00, or empty to use the shop's.`);
    const days = Array.isArray(item.days) && item.days.length === 7 ? item.days.map(Boolean) : defaultServiceSetting(name).days;
    if (!days.some(Boolean)) errors.push(`Choose at least one delivery day for "${name}".`);
    const hasMin = item.transitMin !== null && item.transitMin !== undefined && item.transitMin !== "";
    const hasMax = item.transitMax !== null && item.transitMax !== undefined && item.transitMax !== "";
    let transitMin: number | null = null;
    let transitMax: number | null = null;
    if (hasMin || hasMax) {
      const min = Number(item.transitMin);
      const max = Number(item.transitMax);
      if (!hasMin || !hasMax) errors.push(`Enter both the shortest and the longest delivery time for "${name}", or neither.`);
      else if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 0 || min > 60 || max > 60) errors.push(`The delivery time for "${name}" must be whole business days from 0 to 60.`);
      else if (min > max) errors.push(`The shortest delivery time for "${name}" cannot be longer than the longest.`);
      else { transitMin = min; transitMax = max; }
    }
    services.push({ name, label, show: flag(item.show, true), guaranteed: flag(item.guaranteed, false), cutoffTime: cutoff, days, onBankHolidays: flag(item.onBankHolidays, false), transitMin, transitMax });
  }
  const delivery: DeliverySettings = {
    enabled: deliveryEnabled,
    heading: text(dl.heading, "Delivery options heading", dd.heading, limits.text, deliveryEnabled),
    guaranteedText: deliveryText(dl.guaranteedText, "Guaranteed delivery message", dd.guaranteedText),
    estimatedText: deliveryText(dl.estimatedText, "Estimated delivery message", dd.estimatedText),
    showMonth: flag(dl.showMonth, dd.showMonth),
    services,
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
      textUnder: freeText(free.textUnder, "Message under the threshold", d.freeShipping.textUnder, freeEnabled),
      textAdd: freeText(free.textAdd, "Add this item message", d.freeShipping.textAdd, false),
      textOver: freeText(free.textOver, "Message over the threshold", d.freeShipping.textOver, false),
    },
    availability: {
      outOfStock: stock(availability.outOfStock, "Out of stock", d.availability.outOfStock),
      backorder: stock(availability.backorder ?? legacy, "Back-order", d.availability.backorder),
    },
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
    delivery,
  };
  return errors.length ? { ok: false, errors } : { ok: true, config };
}
