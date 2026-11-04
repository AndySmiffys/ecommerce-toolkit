import test from "node:test";
import assert from "node:assert/strict";
import { bannerPlaceholders, defaultBannerSettings, defaultDeliverySettings, defaultServiceSetting, defaultShippingConfig, defaultShippingStyle, deliveryPlaceholders, freePlaceholders, isIsoDate, parseBankHolidays, richProblem, stripRich, unknownPlaceholders, validateShippingConfig } from "../app/modules/shipping/config";
import { contrastRatio } from "../app/modules/promotions/design/design";
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
  assert.deepEqual(defaultShippingStyle, { align: "center", showIcon: true, textSize: 16, fontWeight: "500", padding: "standard", margin: 16, lineGap: 8, radius: 8, border: "double", borderWidth: 6, background: "#f8f9fa", text: "#333333", accent: "#c2185b", dispatch: "#1e7e34", muted: "#666666", icon: "#007bff" });
  const look = (changes: Record<string, unknown>) => valid({ style: { ...defaultShippingStyle, ...changes } });
  const good = validateShippingConfig(look({ align: "right", textSize: "20", border: "solid", padding: "compact", background: "#FFFFFF" }));
  assert.equal(good.ok && good.config.style.textSize, 20, "numbers typed as text are accepted");
  assert.equal(good.ok && good.config.style.background, "#ffffff", "colours are lower-cased");
  assert.equal(validateShippingConfig(look({})).ok, true);
  for (const [field, bad, label] of [["align", "middle", /Alignment/], ["fontWeight", "800", /Font weight/], ["padding", "huge", /Padding/], ["border", "dotted", /Border is/], ["textSize", 11, /Text size/], ["textSize", 25, /Text size/], ["textSize", "", /Text size/], ["margin", -1, /Space above/], ["lineGap", -1, /Space between lines/], ["lineGap", 25, /Space between lines/], ["radius", 21, /Corner radius/], ["borderWidth", 0, /Border width/], ["borderWidth", 11, /Border width/], ["accent", "red", /Countdown colour/], ["icon", "#12345", /Icon colour/]] as const) {
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

test("the free-delivery messages can use three placeholders, and anything else in braces is caught as a typo", () => {
  assert.deepEqual(freePlaceholders.map(item => item.name), ["threshold", "country", "rate"]);
  assert.ok(freePlaceholders.every(item => item.meaning.length > 10 && item.example.length > 0), "each is explained, with an example");
  assert.deepEqual(unknownPlaceholders("Free to {country} over {threshold} with {rate}, {rate} again"), []);
  assert.deepEqual(unknownPlaceholders("Spend {thresold} for {rate} and {Country}"), ["{thresold}", "{Country}"], "a typo or the wrong capital letter");
  assert.deepEqual(unknownPlaceholders("{} and {a b}"), ["{}", "{a b}"]);
  assert.deepEqual(unknownPlaceholders("No braces, and an unmatched { is left alone"), []);
  const free = (changes: Record<string, unknown>) => valid({ freeShipping: { ...defaultShippingConfig.freeShipping, ...changes } });
  assert.equal(validateShippingConfig(free({ textUnder: "Get {rate} over {threshold} to {country}" })).ok, true);
  const bad = errorsOf(free({ textUnder: "Spend {thresold}", textAdd: "Add for {Rate}", textOver: "Fine {rate}" })).join(" | ");
  assert.match(bad, /Message under the threshold uses \{thresold\}, which is not a placeholder\. You can use \{threshold\}, \{country\}, \{rate\}/);
  assert.match(bad, /Add this item message uses \{Rate\}/);
  assert.doesNotMatch(bad, /Message over the threshold/, "a correct message is not flagged");
  assert.equal(validateShippingConfig(free({ enabled: false, textUnder: "Spend {thresold}" })).ok, false, "still checked when switched off, so it is not a surprise later");
  assert.match(defaultShippingConfig.freeShipping.textUnder, /\{country\}.*\{threshold\}/);
  assert.deepEqual(unknownPlaceholders(defaultShippingConfig.freeShipping.textUnder + defaultShippingConfig.freeShipping.textAdd + defaultShippingConfig.freeShipping.textOver), [], "the defaults use only real ones");
});

test("formatting in a message must be closed properly, and the words under it count for the rules about wording", () => {
  assert.equal(stripRich("[bold]Last[/bold] [highlight]orders[/highlight]"), "Last orders");
  assert.equal(stripRich("[bold][highlight]a[/highlight][/bold] <b>x</b> [b]y[/b]"), "a <b>x</b> [b]y[/b]", "only the two real tags are removed");
  for (const fine of ["", "plain", "[bold]a[/bold]", "[highlight]a[/highlight] b [bold]c[/bold]", "[bold]a [highlight]b[/highlight][/bold]", "[highlight][bold]a[/bold][/highlight]", "a [ b ] c", "{rate}"]) assert.equal(richProblem(fine), null, fine);
  assert.match(richProblem("[bold]never closed") ?? "", /^\[bold\] that is never closed$/);
  assert.match(richProblem("closing[/highlight] only") ?? "", /a closing \[\/highlight\] with no matching start/);
  assert.match(richProblem("[bold]a [highlight]b[/bold][/highlight]") ?? "", /closing \[\/bold\]/, "closed in the wrong order");
  assert.match(richProblem("[bold][bold]a[/bold]") ?? "", /never closed/);
  const text = (field: string, value: string) => (field === "delay" ? valid({ delayDays: 2, delayMessage: value }) : valid({ [field]: value }));
  for (const field of ["countdownPrefix", "countdownSuffix", "noShippingText", "errorText", "shippingDaysPrefix", "delay"]) {
    assert.equal(validateShippingConfig(text(field, "[bold]ok[/bold] [highlight]fine[/highlight]")).ok, true, field);
    assert.match(errorsOf(text(field, "[bold]open")).join(" "), /has formatting with \[bold\] that is never closed\. Select the words and use the Bold and Highlight buttons\./, field);
  }
  const free = (changes: Record<string, unknown>) => valid({ freeShipping: { ...defaultShippingConfig.freeShipping, ...changes } });
  assert.match(errorsOf(free({ textUnder: "[highlight]open" })).join(" "), /Message under the threshold has formatting/);
  assert.match(errorsOf(free({ textAdd: "x[/bold]" })).join(" "), /Add this item message has formatting/);
  assert.match(errorsOf(valid({ availability: { outOfStock: { mode: "message", message: "[bold]x" }, backorder: defaultShippingConfig.availability.backorder } })).join(" "), /Out of stock message has formatting/);
  assert.match(errorsOf(valid({ warning: { ...defaultShippingConfig.warning, enabled: true, startDate: "2026-12-01", endDate: "2026-12-02", message: "[highlight]x" } })).join(" "), /Warning message has formatting/);
  // A message that is only formatting has no words, so it counts as empty.
  assert.match(errorsOf(free({ textUnder: "[bold][/bold]" })).join(" "), /cannot be empty/);
  assert.match(errorsOf(valid({ availability: { outOfStock: { mode: "message", message: "[bold] [/bold]" }, backorder: defaultShippingConfig.availability.backorder } })).join(" "), /Out of stock message cannot be empty/);
  assert.equal(validateShippingConfig(valid({ delayMessage: defaultShippingConfig.delayMessage })).ok, true, "the default delay message, written before the editor, is still fine");
});

test("delivery options start switched off, with wording that says Non-Guaranteed unless a service is set as guaranteed", () => {
  assert.equal(defaultDeliverySettings.enabled, false, "nothing changes on the product page until it is turned on");
  assert.equal(defaultDeliverySettings.heading, "View Delivery Options", "the words on the button that opens the list");
  assert.equal(defaultDeliverySettings.buttonSize, 16);
  assert.equal(defaultDeliverySettings.buttonAlign, "left");
  assert.equal(defaultDeliverySettings.guaranteedText, "Delivery by {date}");
  assert.equal(defaultDeliverySettings.estimatedText, "Delivery by {date} (Non-Guaranteed)");
  assert.equal("showMonth" in defaultDeliverySettings, false, "the month is always shown, so there is nothing to set");
  assert.deepEqual(defaultDeliverySettings.services, []);
  assert.deepEqual(defaultServiceSetting("Standard"), { name: "Standard", label: "", show: true, guaranteed: false, cutoffTime: "", days: [false, true, true, true, true, true, false], onBankHolidays: false, transitMin: null, transitMax: null }, "a service is a non-guaranteed weekday one until set otherwise");
  assert.deepEqual(deliveryPlaceholders.map(item => item.name), ["date", "from", "service", "cutoff"]);
  const old = validateShippingConfig({ ...defaultShippingConfig, delivery: undefined });
  assert.deepEqual(old.ok && old.config.delivery, defaultDeliverySettings, "settings saved before delivery options existed get the defaults");
  assert.deepEqual(unknownPlaceholders("{date} {from} {service} {cutoff}", deliveryPlaceholders), []);
  assert.deepEqual(unknownPlaceholders("{threshold}", deliveryPlaceholders), ["{threshold}"], "each message has its own placeholders");
  assert.deepEqual(unknownPlaceholders("{date}"), ["{date}"], "and the free-delivery ones do not take the delivery ones");
});

test("the delivery wording must say when it arrives and use only its own placeholders", () => {
  const delivery = (changes: Record<string, unknown>) => valid({ delivery: { ...defaultDeliverySettings, enabled: true, ...changes } });
  assert.equal(validateShippingConfig(delivery({})).ok, true);
  assert.equal(validateShippingConfig(delivery({ estimatedText: "{service}: {from} to {date}" })).ok, true);
  assert.equal(validateShippingConfig(delivery({ guaranteedText: "Arrives [bold]{from}[/bold]" })).ok, true, "formatting works here too, and {from} alone is enough");
  assert.match(errorsOf(delivery({ guaranteedText: "Delivery soon" })).join(" "), /Guaranteed delivery message must include \{date\} \(or \{from\}\)/);
  assert.match(errorsOf(delivery({ estimatedText: "Delivery by {dat}" })).join(" "), /Estimated delivery message uses \{dat\}, which is not a placeholder\. You can use \{date\}, \{from\}, \{service\}, \{cutoff\}\./);
  assert.match(errorsOf(delivery({ estimatedText: "Over {threshold}" })).join(" "), /uses \{threshold\}/);
  assert.match(errorsOf(delivery({ guaranteedText: "[bold]Delivery by {date}" })).join(" "), /Guaranteed delivery message has formatting/);
  assert.match(errorsOf(delivery({ heading: "[bold][/bold]" })).join(" "), /Delivery options button text cannot be empty/);
  assert.match(errorsOf(delivery({ guaranteedText: "" })).join(" "), /Guaranteed delivery message cannot be empty/);
  // Switched off, the wording is not required, but a typo is still caught so it is not a surprise later.
  assert.equal(validateShippingConfig(delivery({ enabled: false, heading: "", guaranteedText: "", estimatedText: "" })).ok, true);
  assert.equal(validateShippingConfig(delivery({ enabled: false, estimatedText: "Delivery by {dat}" })).ok, false);
});

test("each delivery service is checked: name, delivery days, cut-off and delivery time", () => {
  const services = (list: unknown[]) => valid({ delivery: { ...defaultDeliverySettings, enabled: true, services: list } });
  const one = (changes: Record<string, unknown> = {}) => ({ ...defaultServiceSetting("DPD Next Day"), ...changes });
  const good = validateShippingConfig(services([one({ label: "DPD Next Day", guaranteed: true, cutoffTime: "14:00", days: [false, true, true, true, true, true, true], onBankHolidays: true, transitMin: 1, transitMax: 2 })]));
  assert.equal(good.ok, true);
  assert.deepEqual(good.ok && good.config.delivery.services[0], { name: "DPD Next Day", label: "DPD Next Day", show: true, guaranteed: true, cutoffTime: "14:00", days: [false, true, true, true, true, true, true], onBankHolidays: true, transitMin: 1, transitMax: 2 });
  const bare = validateShippingConfig(services([{ name: "  Standard  " }]));
  assert.deepEqual(bare.ok && bare.config.delivery.services[0], defaultServiceSetting("Standard"), "anything left out is the safe default, and the name is trimmed");
  assert.match(errorsOf(services([one({ name: "" })])).join(" "), /A delivery service has no name/);
  assert.match(errorsOf(services([one(), one()])).join(" "), /"DPD Next Day" is listed more than once/);
  assert.match(errorsOf(services([one({ name: "x".repeat(201) })])).join(" "), /is too long/);
  assert.match(errorsOf(services([one({ label: "x".repeat(121) })])).join(" "), /The name shown for "DPD Next Day" must be 120 characters or fewer/);
  assert.match(errorsOf(services([one({ cutoffTime: "25:00" })])).join(" "), /cut-off time for "DPD Next Day" must be a 24-hour time/);
  assert.equal(validateShippingConfig(services([one({ cutoffTime: "" })])).ok, true, "empty means the shop's");
  assert.match(errorsOf(services([one({ days: [false, false, false, false, false, false, false] })])).join(" "), /Choose at least one delivery day for "DPD Next Day"/);
  assert.match(errorsOf(services([one({ transitMin: 2, transitMax: null })])).join(" "), /Enter both the shortest and the longest delivery time for "DPD Next Day", or neither/);
  assert.match(errorsOf(services([one({ transitMin: 3, transitMax: 2 })])).join(" "), /shortest delivery time for "DPD Next Day" cannot be longer/);
  for (const bad of [[-1, 2], [1, 61], [1.5, 2], ["x", 2]]) assert.match(errorsOf(services([one({ transitMin: bad[0], transitMax: bad[1] })])).join(" "), /whole business days from 0 to 60/, String(bad));
  assert.equal(validateShippingConfig(services([one({ transitMin: 0, transitMax: 0 })])).ok, true, "same day is fine");
  assert.equal(validateShippingConfig(services([one({ transitMin: "2", transitMax: "3" })])).ok, true, "numbers typed as text are accepted");
  const many = Array.from({ length: 101 }, (_, i) => one({ name: `Service ${i}` }));
  assert.match(errorsOf(services(many)).join(" "), /Keep delivery services to 100 or fewer/);
  const stripped = validateShippingConfig(services([{ ...one(), nonsense: "x" }]));
  assert.equal(stripped.ok && "nonsense" in stripped.config.delivery.services[0], false);
});

test("a month setting saved by an earlier version is ignored", () => {
  const old = validateShippingConfig({ ...defaultShippingConfig, delivery: { ...defaultDeliverySettings, showMonth: false } });
  assert.equal(old.ok && "showMonth" in old.config.delivery, false);
});

test("the button that opens the delivery options has a size from 10 to 32 and sits left, centre or right", () => {
  const delivery = (changes: Record<string, unknown>) => valid({ delivery: { ...defaultDeliverySettings, ...changes } });
  for (const size of [10, 16, 32, "20"]) assert.equal(validateShippingConfig(delivery({ buttonSize: size })).ok, true, String(size));
  for (const size of [9, 33, 1.5, "big", ""]) assert.match(errorsOf(delivery({ buttonSize: size })).join(" "), /Delivery options button text size must be a whole number from 10 to 32/, String(size));
  for (const align of ["left", "center", "right"]) assert.equal(validateShippingConfig(delivery({ buttonAlign: align })).ok, true, align);
  assert.match(errorsOf(delivery({ buttonAlign: "middle" })).join(" "), /Delivery options button position is not one of the choices/);
  const old = validateShippingConfig(valid({ delivery: { enabled: true, heading: "Delivery options", guaranteedText: "{date}", estimatedText: "{date}", services: [] } }));
  assert.deepEqual(old.ok && [old.config.delivery.buttonSize, old.config.delivery.buttonAlign], [16, "left"], "settings saved before the button had a size and position get the defaults");
  assert.equal(old.ok && old.config.delivery.heading, "Delivery options", "words that were saved are kept, not replaced by the new default");
});

test("the delivery options are ordered soonest first unless an order is set, and a bad choice is refused", () => {
  assert.equal(defaultDeliverySettings.sort, "soonest");
  const delivery = (changes: Record<string, unknown>) => valid({ delivery: { ...defaultDeliverySettings, ...changes } });
  for (const sort of ["soonest", "manual"]) assert.equal(validateShippingConfig(delivery({ sort })).ok, true, sort);
  assert.match(errorsOf(delivery({ sort: "alphabetical" })).join(" "), /Delivery options order is not one of the choices/);
  const old = validateShippingConfig(valid({ delivery: { enabled: true, heading: "x", guaranteedText: "{date}", estimatedText: "{date}", services: [] } }));
  assert.equal(old.ok && old.config.delivery.sort, "soonest", "settings saved before an order could be set keep today's behaviour");
});

test("the header banner starts switched off, with the message the shop already uses, and is checked when it is switched on", () => {
  assert.equal(defaultBannerSettings.enabled, false, "nothing appears in the header until it is turned on");
  assert.equal(defaultBannerSettings.message, "Order in the next {time} for dispatch on {date}");
  assert.deepEqual(bannerPlaceholders.map(item => item.name), ["time", "date"]);
  const old = validateShippingConfig({ ...defaultShippingConfig, banner: undefined });
  assert.deepEqual(old.ok && old.config.banner, defaultBannerSettings, "settings saved before the banner existed get the defaults");
  const banner = (changes: Record<string, unknown>) => valid({ banner: { ...defaultBannerSettings, enabled: true, ...changes } });
  assert.equal(validateShippingConfig(banner({})).ok, true);
  assert.equal(validateShippingConfig(banner({ message: "Ships [bold]{date}[/bold]" })).ok, true, "{date} alone is enough, and it can be formatted");
  assert.equal(validateShippingConfig(banner({ message: "{time} left" })).ok, true);
  assert.match(errorsOf(banner({ message: "Fast dispatch" })).join(" "), /Header banner message must include \{time\} or \{date\}/);
  assert.match(errorsOf(banner({ message: "Ships {dat}" })).join(" "), /Header banner message uses \{dat\}, which is not a placeholder\. You can use \{time\}, \{date\}\./);
  assert.match(errorsOf(banner({ message: "Over {threshold} {date}" })).join(" "), /uses \{threshold\}/);
  assert.match(errorsOf(banner({ message: "" })).join(" "), /Header banner message cannot be empty/);
  assert.match(errorsOf(banner({ message: "[bold]Ships {date}" })).join(" "), /Header banner message has formatting/);
  assert.match(errorsOf(banner({ textSize: 40 })).join(" "), /Header banner text size must be a whole number from 10 to 24/);
  assert.match(errorsOf(banner({ align: "top" })).join(" "), /Header banner alignment is not one of the choices/);
  assert.match(errorsOf(banner({ background: "blue" })).join(" "), /Header banner background colour must be a colour/);
  for (const field of ["text", "highlight", "dispatch"]) assert.match(errorsOf(banner({ [field]: "red" })).join(" "), /must be a colour such as #f59e0b/, field);
  // Switched off, the message is not needed, but a typo is still caught.
  assert.equal(validateShippingConfig(banner({ enabled: false, message: "" })).ok, true);
  assert.equal(validateShippingConfig(banner({ enabled: false, message: "{dat}" })).ok, false);
  const kept = validateShippingConfig(banner({ background: "#ABCDEF", textSize: "18" }));
  assert.deepEqual(kept.ok && [kept.config.banner.background, kept.config.banner.textSize], ["#abcdef", 18], "colours are lower-cased and sizes read as numbers");
});

test("every colour the app starts with can be read: text 4.5 to 1 on its background, the icon 3 to 1", () => {
  const style = defaultShippingStyle;
  for (const [name, colour] of [["text", style.text], ["time left", style.accent], ["dispatch day", style.dispatch], ["secondary text", style.muted]]) assert.ok(contrastRatio(colour, style.background) >= 4.5, `block ${name}`);
  assert.ok(contrastRatio(style.icon, style.background) >= 3, "block icon");
  const banner = defaultBannerSettings;
  for (const [name, colour] of [["text", banner.text], ["highlight and time left", banner.highlight], ["dispatch day", banner.dispatch]]) assert.ok(contrastRatio(colour, banner.background) >= 4.5, `banner ${name}`);
  const warning = defaultShippingConfig.warning;
  assert.ok(contrastRatio(warning.textColor, warning.backgroundColor) >= 4.5, "warning notice");
});

test("the delivery options can be always open, with no button, and then the button's words are not needed", () => {
  assert.equal(defaultDeliverySettings.alwaysOpen, false, "a button, as before, unless it is turned on");
  const delivery = (changes: Record<string, unknown>) => valid({ delivery: { ...defaultDeliverySettings, enabled: true, ...changes } });
  const open = validateShippingConfig(delivery({ alwaysOpen: true, heading: "" }));
  assert.equal(open.ok, true, "no button, so no button text to ask for");
  assert.equal(open.ok && open.config.delivery.alwaysOpen, true);
  assert.match(errorsOf(delivery({ alwaysOpen: false, heading: "" })).join(" "), /Delivery options button text cannot be empty/, "with a button the words are still needed");
  const old = validateShippingConfig(valid({ delivery: { enabled: true, heading: "Options", guaranteedText: "{date}", estimatedText: "{date}", services: [] } }));
  assert.equal(old.ok && old.config.delivery.alwaysOpen, false, "settings saved before this get the button");
});
