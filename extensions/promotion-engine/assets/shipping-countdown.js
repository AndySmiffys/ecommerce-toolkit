/*
 * Shipping countdown: dispatch countdown, free-shipping message and warning notice.
 *
 * The first half is pure functions of (now, config, variant, cart) so they can be tested with a mocked clock
 * (tests/shipping-countdown.test.cjs loads this same file). The second half is the <shipping-countdown> element.
 * All calendar days are "YYYY-MM-DD" strings in Europe/London; the visitor's time zone is never used.
 */
(function (root) {
  'use strict';

  var TIME_ZONE = 'Europe/London';
  var DAY_MS = 86400000;
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DISPATCH_SEARCH_DAYS = 30;

  var partsFormat = null;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  /** The calendar date and clock time in London for an instant (milliseconds since 1970). */
  function londonParts(ms) {
    if (!partsFormat) {
      partsFormat = new Intl.DateTimeFormat('en-GB', {
        timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    var p = {};
    partsFormat.formatToParts(new Date(ms)).forEach(function (part) {
      if (part.type !== 'literal') p[part.type] = parseInt(part.value, 10);
    });
    if (p.hour === 24) p.hour = 0;
    return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second, date: ymd(p.year, p.month, p.day) };
  }

  function parseDate(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
    return { y: y, m: mo, d: d };
  }

  /** Calendar arithmetic on date strings, done in UTC so clock changes cannot move a day. */
  function addDays(date, n) {
    var p = parseDate(date);
    var t = new Date(Date.UTC(p.y, p.m - 1, p.d) + n * DAY_MS);
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  function weekday(date) {
    var p = parseDate(date);
    return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  }

  /** The instant at which London's clocks show this date and time. */
  function londonTimeToUtc(date, hour, minute) {
    var p = parseDate(date);
    var wall = Date.UTC(p.y, p.m - 1, p.d, hour, minute, 0);
    var guess = wall;
    for (var i = 0; i < 3; i++) {
      var q = londonParts(guess);
      guess -= Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) - wall;
    }
    return guess;
  }

  /** "HH:MM" to minutes after midnight, or null. */
  function parseCutoff(text) {
    var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(text || '').trim());
    return m ? +m[1] * 60 + +m[2] : null;
  }

  function isDispatchDay(date, config) {
    return Boolean(config.shippingDays && config.shippingDays[weekday(date)]) && (config.bankHolidays || []).indexOf(date) < 0;
  }

  /** The next day an order can be dispatched, and the moment its cut-off falls, or null. */
  function nextDispatch(nowMs, config) {
    var cutoff = parseCutoff(config.cutoffTime);
    if (cutoff === null) return null;
    var today = londonParts(nowMs).date;
    for (var i = 0; i <= DISPATCH_SEARCH_DAYS; i++) {
      var date = addDays(today, i);
      if (!isDispatchDay(date, config)) continue;
      var cutoffAt = londonTimeToUtc(date, Math.floor(cutoff / 60), cutoff % 60);
      if (i === 0 && nowMs >= cutoffAt) continue;
      return { date: date, cutoffAt: cutoffAt, msUntilCutoff: cutoffAt - nowMs };
    }
    return null;
  }

  /** Warehouse delay: the Nth dispatch day after today, whatever the time of day. */
  function delayedDispatch(nowMs, config) {
    var wanted = Math.floor(config.delayDays || 0);
    if (wanted < 1) return null;
    var today = londonParts(nowMs).date;
    var found = 0;
    for (var i = 1; i <= 400; i++) {
      var date = addDays(today, i);
      if (isDispatchDay(date, config) && ++found >= wanted) return date;
    }
    return null;
  }

  function units(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /** "1 hour 21 minutes" under a day, "2 days 5 hours" from a day, "less than 1 minute" at the end. */
  function countdownText(ms) {
    var minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'less than 1 minute';
    var parts = [];
    if (minutes < 1440) {
      if (minutes >= 60) parts.push(units(Math.floor(minutes / 60), 'hour'));
      if (minutes % 60) parts.push(units(minutes % 60, 'minute'));
    } else {
      parts.push(units(Math.floor(minutes / 1440), 'day'));
      var hours = Math.floor((minutes % 1440) / 60);
      if (hours) parts.push(units(hours, 'hour'));
    }
    return parts.join(' ');
  }

  /** "Monday 26 Oct" */
  function formatDispatchDate(date) {
    var p = parseDate(date);
    return DAY_NAMES[weekday(date)] + ' ' + p.d + ' ' + MONTH_NAMES[p.m - 1];
  }

  var OPEN_BOLD = '[bold]', CLOSE_BOLD = '[/bold]', OPEN_HIGHLIGHT = '[highlight]', CLOSE_HIGHLIGHT = '[/highlight]';
  // Marks put round the dates in a delivery message so they can take the dispatch colour. Private-use characters, so nothing typed can be one.
  var OPEN_DATE = '\uE000', CLOSE_DATE = '\uE001';
  // The same for the time left in the header banner.
  var OPEN_TIME = '\uE002', CLOSE_TIME = '\uE003';

  /**
   * Reads the formatting in a message: "Order [bold]now[/bold] for [highlight]free[/highlight] delivery" (the two can be nested).
   * Returns runs of text with what applies to each. It never produces markup, so it is safe for any text, and it forgives what is not
   * balanced: a closing tag with nothing open is ignored, and a tag left open runs to the end.
   */
  function parseRich(text) {
    var source = String(text || '');
    var runs = [], bold = 0, highlight = 0, date = 0, time = 0, buffer = '', i = 0;
    function flush() {
      if (!buffer) return;
      var last = runs[runs.length - 1];
      if (last && last.bold === (bold > 0) && last.highlight === (highlight > 0) && Boolean(last.date) === (date > 0) && Boolean(last.time) === (time > 0)) last.text += buffer;
      else {
        var run = { text: buffer, bold: bold > 0, highlight: highlight > 0 };
        if (date > 0) run.date = true;
        if (time > 0) run.time = true;
        runs.push(run);
      }
      buffer = '';
    }
    while (i < source.length) {
      if (source.substr(i, OPEN_BOLD.length) === OPEN_BOLD) { flush(); bold++; i += OPEN_BOLD.length; }
      else if (source.substr(i, CLOSE_BOLD.length) === CLOSE_BOLD) { flush(); if (bold > 0) bold--; i += CLOSE_BOLD.length; }
      else if (source.substr(i, OPEN_HIGHLIGHT.length) === OPEN_HIGHLIGHT) { flush(); highlight++; i += OPEN_HIGHLIGHT.length; }
      else if (source.substr(i, CLOSE_HIGHLIGHT.length) === CLOSE_HIGHLIGHT) { flush(); if (highlight > 0) highlight--; i += CLOSE_HIGHLIGHT.length; }
      else if (source.charAt(i) === OPEN_DATE) { flush(); date++; i++; }
      else if (source.charAt(i) === CLOSE_DATE) { flush(); if (date > 0) date--; i++; }
      else if (source.charAt(i) === OPEN_TIME) { flush(); time++; i++; }
      else if (source.charAt(i) === CLOSE_TIME) { flush(); if (time > 0) time--; i++; }
      else { buffer += source.charAt(i); i++; }
    }
    flush();
    return runs;
  }

  /** An amount in minor units (pence), with pence only when there are some: 5000 is "£50", 4950 is "£49.50". */
  function formatMoney(minor, currency) {
    try {
      var whole = minor % 100 === 0;
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(minor / 100);
    } catch (error) {
      return currency + ' ' + (minor / 100);
    }
  }

  /** Fills {threshold}, {country} and {rate} (every occurrence of each) in a free-delivery message. */
  function fillThreshold(text, thresholdMinor, currency, country, rate) {
    return String(text || '').split('{threshold}').join(formatMoney(thresholdMinor, currency)).split('{country}').join(country || '').split('{rate}').join(rate || '');
  }

  /**
   * Which free-shipping message applies. The threshold is the shopper's own, worked out on the server from the shop's shipping settings for
   * their country (in minor units, 0 meaning always free). It only applies to a cart in the same currency, so nothing is converted.
   */
  function freeShippingMessage(free, input) {
    var threshold = input.threshold;
    if (!free || !free.enabled || typeof threshold !== 'number' || !(threshold >= 0) || !input.thresholdCurrency || input.cartCurrency !== input.thresholdCurrency) {
      return { state: 'hidden', text: '' };
    }
    var cart = input.cartTotal || 0;
    var item = (input.itemPrice || 0) * (input.quantity || 1);
    var fill = function (text) { return fillThreshold(text, threshold, input.thresholdCurrency, input.country, input.rate); };
    if (cart >= threshold) return { state: 'over', text: fill(free.textOver) };
    if (item > 0 && cart + item >= threshold) return { state: 'add', text: fill(free.textAdd) };
    return { state: 'under', text: fill(free.textUnder) };
  }

  /* ------------------------------------------------------------ delivery services */

  var WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  /** A service with nothing set: Monday to Friday, not guaranteed, no cut-off of its own, shown. Nothing is promised that was not chosen. */
  var DEFAULT_SERVICE = { show: true, label: '', guaranteed: false, cutoffTime: '', days: [false, true, true, true, true, true, false], onBankHolidays: false, transitMin: null, transitMax: null };

  function ordinal(n) {
    var tens = n % 100;
    if (tens >= 11 && tens <= 13) return n + 'th';
    return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  }

  /** "Wed 28th Oct". The month is always there: near a month's end "Fri 30th" could be this month or the next. */
  function formatDeliveryDate(date) {
    var p = parseDate(date);
    return WEEKDAY_SHORT[weekday(date)] + ' ' + ordinal(p.d) + ' ' + MONTH_NAMES[p.m - 1];
  }

  /** Whether the carrier delivers on this day: one of the service's delivery days, and not a bank holiday unless it delivers on those. */
  function isDeliveryDay(date, service, bankHolidays) {
    return Boolean(service.days && service.days[weekday(date)]) && (Boolean(service.onBankHolidays) || (bankHolidays || []).indexOf(date) < 0);
  }

  /**
   * The Nth delivery day after the dispatch day, counting only days this service delivers (the business days Shopify's delivery times are in).
   * Zero days is the first delivery day on or after dispatch. Null when the service delivers on no day.
   */
  function addDeliveryDays(dispatchDate, days, service, bankHolidays) {
    var wanted = Math.max(0, Math.floor(days || 0));
    var counted = 0;
    for (var i = wanted === 0 ? 0 : 1; i <= 400; i++) {
      var date = addDays(dispatchDate, i);
      if (!isDeliveryDay(date, service, bankHolidays)) continue;
      if (wanted === 0 || ++counted >= wanted) return date;
    }
    return null;
  }

  /**
   * When an order placed now reaches the customer by this service: it is dispatched by the service's own cut-off (the shop's when it has none),
   * or on the warehouse delay date when one is set, then travels the shortest and longest delivery times. Null when no date can be given.
   */
  function deliveryEstimate(nowMs, config, service, transit) {
    var own = Object.assign({}, DEFAULT_SERVICE, service || {});
    var dispatch;
    if (Math.floor(config.delayDays || 0) > 0) {
      var delayed = delayedDispatch(nowMs, config);
      dispatch = delayed ? { date: delayed } : null;
    } else {
      dispatch = nextDispatch(nowMs, Object.assign({}, config, { cutoffTime: own.cutoffTime || config.cutoffTime }));
    }
    if (!dispatch || !transit) return null;
    var from = addDeliveryDays(dispatch.date, transit.minDays, own, config.bankHolidays);
    var to = addDeliveryDays(dispatch.date, transit.maxDays, own, config.bankHolidays);
    if (!from || !to) return null;
    return { dispatchDate: dispatch.date, from: from, to: to, cutoffAt: dispatch.cutoffAt || null, msUntilCutoff: dispatch.msUntilCutoff === undefined ? null : dispatch.msUntilCutoff };
  }

  /** A cut-off as people say it: "14:00" is "2pm", "14:15" is "2:15pm". */
  function formatCutoff(text) {
    var minutes = parseCutoff(text);
    if (minutes === null) return '';
    var hour = Math.floor(minutes / 60), minute = minutes % 60;
    return ((hour % 12) || 12) + (minute ? ':' + pad(minute) : '') + (hour >= 12 ? 'pm' : 'am');
  }

  /**
   * Fills {date} (the latest date), {from} (the earliest), {service} and {cutoff} (the time to order by) in a delivery message. With `mark`, each date is put between marks, so it
   * is written in the dispatch day's colour like the dispatch date is; the words round it are not, so "(Non-Guaranteed)" never looks like good news.
   */
  function fillDelivery(text, values, mark) {
    var date = function (value) { return mark && value ? OPEN_DATE + value + CLOSE_DATE : value || ''; };
    return String(text || '').split('{date}').join(date(values.date)).split('{from}').join(date(values.from)).split('{service}').join(values.service || '').split('{cutoff}').join(values.cutoff || '');
  }

  /**
   * What a service costs, from its price bands: "£4.99, or £2.99 on orders of £30 or more", "£3.99, or free on orders of £30 or more". A service
   * whose price also depends on something other than the order total says "From" its lowest price.
   */
  function servicePrice(service, currency) {
    var tiers = (service.tiers || []).slice().sort(function (a, b) { return a.from - b.from; });
    if (!tiers.length) return '';
    var money = function (minor) { return minor === 0 ? 'free' : formatMoney(minor, currency); };
    if (service.complex) {
      var lowest = Math.min.apply(null, tiers.map(function (tier) { return tier.price; }));
      return lowest === 0 ? 'Free' : 'From ' + formatMoney(lowest, currency);
    }
    var first = tiers[0];
    var text = first.from > 0 ? money(first.price) + ' on orders of ' + formatMoney(first.from, currency) + ' or more' : (first.price === 0 ? 'Free' : formatMoney(first.price, currency));
    for (var i = 1; i < tiers.length; i++) text += ', or ' + money(tiers[i].price) + ' on orders of ' + formatMoney(tiers[i].from, currency) + ' or more';
    return text;
  }

  /**
   * The delivery options for the dropdown, soonest first. Each service is a Shopify shipping option for the shopper's country ({ name, tiers,
   * transit }) with what the app adds in config.delivery.services. A service with no delivery time (typed in the app, else Shopify's) is left out,
   * because no date can be promised for it. Nothing is shown for a variant that cannot be dispatched now.
   */
  /** What makes two names the same service: stray and doubled spaces and capital letters do not count. */
  function nameKey(name) { return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

  function deliveryOptions(nowMs, config, services, currency, variant) {
    var delivery = config.delivery;
    if (!delivery || !delivery.enabled || stockState(variant) !== 'in') return [];
    var options = [];
    (services || []).forEach(function (service) {
      var found = (delivery.services || []).filter(function (item) { return nameKey(item.name) === nameKey(service.name); })[0];
      var setting = Object.assign({}, DEFAULT_SERVICE, found || {});
      if (setting.show === false) return;
      var typed = typeof setting.transitMin === 'number' && typeof setting.transitMax === 'number' ? { minDays: setting.transitMin, maxDays: setting.transitMax } : null;
      var estimate = deliveryEstimate(nowMs, config, setting, typed || service.transit);
      if (!estimate) return;
      var label = setting.label || service.name;
      var template = setting.guaranteed ? delivery.guaranteedText : delivery.estimatedText;
      var cutoff = formatCutoff(setting.cutoffTime || config.cutoffTime);
      var values = { date: formatDeliveryDate(estimate.to), from: formatDeliveryDate(estimate.from), service: label, cutoff: cutoff };
      var lowest = Math.min.apply(null, (service.tiers || [{ price: 0 }]).map(function (tier) { return tier.price; }));
      options.push({ seq: options.length, name: service.name, label: label, cutoff: cutoff, price: servicePrice(service, currency), guaranteed: Boolean(setting.guaranteed), text: fillDelivery(template, values), marked: fillDelivery(template, values, true), to: estimate.to, from: estimate.from, dispatchDate: estimate.dispatchDate, lowest: lowest });
    });
    if (delivery.sort === 'manual') {
      // The order set in the app: services in the order listed there, and any not listed after them in the order Shopify gives them.
      var listed = (delivery.services || []).map(function (item) { return nameKey(item.name); });
      var rank = function (option) { var at = listed.indexOf(nameKey(option.name)); return at < 0 ? listed.length : at; };
      return options.sort(function (a, b) { return rank(a) - rank(b) || a.seq - b.seq; });
    }
    return options.sort(function (a, b) { return a.to < b.to ? -1 : a.to > b.to ? 1 : a.lowest - b.lowest || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0); });
  }

  /**
   * Whether a variant can be dispatched now. "out" is unavailable altogether. "backorder" is sold while stock is zero or below (the
   * variant's "continue selling when out of stock" setting), so there is no dispatch date to promise either.
   */
  function stockState(variant) {
    if (!variant) return 'in';
    if (variant.available === false) return 'out';
    if (variant.policy === 'continue' && Boolean(variant.managed) && typeof variant.qty === 'number' && variant.qty <= 0) return 'backorder';
    return 'in';
  }

  /** Whether the warning notice is showing today (London), both dates included. */
  function warningVisible(nowMs, warning) {
    if (!warning || !warning.enabled || !warning.startDate || !warning.endDate || !warning.message) return false;
    var today = londonParts(nowMs).date;
    return today >= warning.startDate && today <= warning.endDate;
  }

  /** What the dispatch line should say right now. */
  function dispatchView(nowMs, config, variant) {
    var delay = Math.floor(config.delayDays || 0) > 0;
    if (!delay && parseCutoff(config.cutoffTime) === null) return { kind: 'error' };
    var stock = stockState(variant);
    if (stock !== 'in') {
      var rule = config.availability && (stock === 'out' ? config.availability.outOfStock : config.availability.backorder);
      return rule && rule.mode === 'hide' ? { kind: 'hidden' } : { kind: stock === 'out' ? 'outofstock' : 'backorder' };
    }
    if (delay) {
      var from = delayedDispatch(nowMs, config);
      return from ? { kind: 'delay', date: formatDispatchDate(from) } : unavailable(config);
    }
    var next = nextDispatch(nowMs, config);
    if (!next) return unavailable(config);
    return { kind: 'countdown', countdown: countdownText(next.msUntilCutoff), date: formatDispatchDate(next.date) };
  }
  /**
   * The header banner's message right now. It is the dispatch message for a shopper not looking at a product, so stock does not come into it, and
   * it is left out when there is nothing true to say: a header on every page should never show an error or "no dispatch day".
   */
  function bannerView(nowMs, config) {
    var banner = config.banner;
    if (!banner || !banner.enabled) return { kind: 'hidden' };
    var view = dispatchView(nowMs, config, null);
    if (view.kind === 'countdown') {
      var date = OPEN_DATE + view.date + CLOSE_DATE;
      return { kind: 'message', marked: String(banner.message || '').split('{time}').join(OPEN_TIME + view.countdown + CLOSE_TIME).split('{date}').join(date) };
    }
    if (view.kind === 'delay') return { kind: 'message', marked: String(config.delayMessage || '') + ' ' + OPEN_DATE + view.date + CLOSE_DATE };
    return { kind: 'hidden' };
  }
  function unavailable(config) { return config.hideIfUnavailable ? { kind: 'hidden' } : { kind: 'none' }; }

  var logic = {
    londonParts: londonParts, addDays: addDays, weekday: weekday, londonTimeToUtc: londonTimeToUtc, parseCutoff: parseCutoff,
    isDispatchDay: isDispatchDay, nextDispatch: nextDispatch, delayedDispatch: delayedDispatch, countdownText: countdownText,
    formatDispatchDate: formatDispatchDate, parseRich: parseRich, formatMoney: formatMoney, fillThreshold: fillThreshold,
    freeShippingMessage: freeShippingMessage, stockState: stockState, formatDeliveryDate: formatDeliveryDate, isDeliveryDay: isDeliveryDay, addDeliveryDays: addDeliveryDays, deliveryEstimate: deliveryEstimate, fillDelivery: fillDelivery, servicePrice: servicePrice, deliveryOptions: deliveryOptions, warningVisible: warningVisible, dispatchView: dispatchView, bannerView: bannerView, formatCutoff: formatCutoff
  };
  root.ShippingCountdownLogic = logic;
  if (typeof module !== 'undefined' && module.exports) module.exports = logic;

  /* ---------------------------------------------------------------- the element */

  if (typeof HTMLElement === 'undefined' || typeof customElements === 'undefined') return;

  var CART_EVENTS = ['cart:update', 'cart:updated', 'cart:change', 'cart:refresh', 'cart-drawer:updated', 'product:added', 'quantity-selector:update'];
  var VARIANT_EVENTS = ['variant:update', 'variant:change', 'variantChange'];
  var CART_FORMS = 'form[action^="/cart/add"], form[action^="/cart/change"], form[action^="/cart/update"]';

  function cartFrom(value) {
    var candidates = [value, value && value.resource, value && value.cart, value && value.data];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (c && typeof c === 'object' && typeof c.total_price === 'number') return c;
    }
    return null;
  }
  /** Writes a message into a node with its bold and highlighted words, built from text nodes so nothing in it can become markup. */
  function appendRich(node, text) {
    parseRich(text).forEach(function (run) {
      var piece = document.createTextNode(run.text);
      if (run.bold) { var strong = document.createElement('strong'); strong.appendChild(piece); piece = strong; }
      if (run.highlight || run.time) { var mark = el('span', 'sc__countdown'); mark.appendChild(piece); piece = mark; }
      if (run.date) { var when = el('span', 'sc__dispatch'); when.appendChild(piece); piece = when; }
      node.appendChild(piece);
    });
  }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  class ShippingCountdown extends HTMLElement {
    connectedCallback() {
      var self = this;
      try {
        this.config = JSON.parse(this.querySelector('script[data-config]').textContent);
        this.variants = JSON.parse(this.querySelector('script[data-variants]').textContent);
      } catch (error) { this.config = null; }
      this.dispatchLine = this.querySelector('[data-role="dispatch"]');
      this.freeLine = this.querySelector('[data-role="free"]');
      this.warning = this.querySelector('[data-role="warning"]');
      if (!this.config || !this.dispatchLine) return;
      this.cart = { total: Number(this.dataset.cartTotal) || 0, currency: this.dataset.currency || 'GBP' };
      // Free delivery for this shopper's country, worked out by the server from the shop's shipping settings.
      this.freeThreshold = this.dataset.freeThreshold === undefined || this.dataset.freeThreshold === '' ? null : Number(this.dataset.freeThreshold);
      this.freeCurrency = this.dataset.freeCurrency || '';
      this.country = this.dataset.country || '';
      this.freeRate = this.dataset.freeRate || '';
      // The delivery services for this shopper's country, from Shopify's shipping settings, and the box they are listed in.
      this.deliveryCurrency = this.dataset.deliveryCurrency || '';
      this.deliveryBox = this.querySelector('[data-role="delivery"]');
      this.deliveryList = this.querySelector('[data-role="delivery-list"]');
      try { this.services = JSON.parse(this.querySelector('script[data-services]').textContent); } catch (error) { this.services = null; }
      this.variantId = Number(this.dataset.variantId) || null;
      this.listeners = [];

      this.renderAll(true);
      this.scheduleTick();

      var refresh = function () { self.scheduleCartRefresh(); };
      CART_EVENTS.forEach(function (name) {
        self.listen(document, name, function (event) {
          var cart = cartFrom(event.detail);
          if (cart) self.setCart(cart); else self.scheduleCartRefresh();
        });
      });
      // Horizon announces a change before its request finishes; its event carries a promise for the result.
      this.listen(document, 'shopify:cart:lines-update', function (event) {
        var promise = event.promise;
        if (promise && typeof promise.then === 'function') {
          promise.then(function (result) { var cart = cartFrom(result && result.detail); if (cart) self.setCart(cart); else refresh(); }, refresh);
        } else refresh();
      });
      this.listen(document, 'submit', function (event) { if (event.target.matches && event.target.matches(CART_FORMS)) refresh(); });
      this.listen(document, 'change', function (event) {
        var t = event.target;
        if (!t || !t.matches) return;
        if (t.matches('input[name="updates[]"]')) refresh();
        else if (t.matches('input[name="id"], select[name="id"], input[name="quantity"]') && self.inProductForm(t)) self.renderFree();
        if (t.matches('input[name="id"], select[name="id"]') && self.inProductForm(t)) self.renderDispatch();
      });
      this.listen(document, 'input', function (event) {
        var t = event.target;
        if (t && t.matches && t.matches('input[name="quantity"]') && self.inProductForm(t)) self.renderFree();
      });
      VARIANT_EVENTS.forEach(function (name) {
        self.listen(document, name, function (event) {
          var d = event.detail || {};
          var id = Number((d.resource && d.resource.id) || (d.variant && d.variant.id) || d.id) || null;
          if (id) self.variantId = id;
          self.renderDispatch();
          self.renderFree();
        });
      });
      this.listen(window, 'popstate', function () { self.renderDispatch(); self.renderFree(); });
      this.listen(document, 'visibilitychange', function () { if (!document.hidden) self.renderAll(); });
      this.listen(window, 'pageshow', function (event) { if (event.persisted) { self.scheduleCartRefresh(); self.renderAll(); } });
    }

    disconnectedCallback() {
      clearTimeout(this.tickTimer);
      clearTimeout(this.cartTimer);
      if (this.abort) this.abort.abort();
      (this.listeners || []).forEach(function (l) { l[0].removeEventListener(l[1], l[2]); });
      this.listeners = [];
    }

    listen(target, name, handler) {
      target.addEventListener(name, handler);
      this.listeners.push([target, name, handler]);
    }

    /** The product form this block belongs to: the one in its own section, else the first on the page. */
    productForm() {
      var section = this.closest('section, [data-section-id], .shopify-section');
      return (section && section.querySelector(CART_FORMS)) || document.querySelector('form[action^="/cart/add"]');
    }
    inProductForm(node) { var form = this.productForm(); return !form || form.contains(node) || (node.form && node.form === form); }

    selectedVariant() {
      var form = this.productForm();
      var field = form && form.querySelector('[name="id"]');
      var id = Number(field && field.value) || Number(new URLSearchParams(location.search).get('variant')) || this.variantId;
      for (var i = 0; i < this.variants.length; i++) if (this.variants[i].id === id) return this.variants[i];
      for (var j = 0; j < this.variants.length; j++) if (this.variants[j].id === this.variantId) return this.variants[j];
      return null;
    }
    selectedQuantity() {
      var form = this.productForm();
      var field = form && form.querySelector('input[name="quantity"]');
      var n = Math.floor(Number(field && field.value));
      return n > 0 ? n : 1;
    }

    renderAll(first) {
      this.renderWarning();
      this.renderDispatch();
      // The server wrote the free-shipping line for the cart as it loaded; only rewrite it after something changes.
      if (!first) this.renderFree();
    }

    renderWarning() {
      if (this.warning) this.warning.hidden = !warningVisible(Date.now(), this.config.warning);
    }

    renderDispatch() {
      var line = this.dispatchLine;
      var c = this.config;
      var view = dispatchView(Date.now(), c, this.selectedVariant());
      this.hidden = view.kind === 'hidden';
      line.textContent = '';
      if (view.kind === 'countdown') {
        appendRich(line, c.countdownPrefix);
        line.append(' ', el('span', 'sc__countdown', view.countdown), ' ');
        appendRich(line, c.countdownSuffix);
        line.append(' ', el('span', 'sc__dispatch', view.date));
      } else if (view.kind === 'delay') {
        appendRich(line, c.delayMessage);
        line.append(' ', el('span', 'sc__dispatch', view.date));
      } else if (view.kind === 'outofstock') {
        appendRich(line, c.availability.outOfStock.message);
      } else if (view.kind === 'backorder') {
        appendRich(line, c.availability.backorder.message);
      } else if (view.kind === 'none') {
        var expired = el('span', 'sc__expired');
        appendRich(expired, c.noShippingText);
        line.append(expired);
      } else if (view.kind === 'error') {
        appendRich(line, c.errorText);
      }
      this.renderDelivery();
    }

    /** The delivery options for the chosen variant, soonest first. Rebuilt each time; the box itself stays, so it stays open. */
    renderDelivery() {
      if (!this.deliveryBox || !this.deliveryList || !this.services) return;
      var options = this.cart.currency === this.deliveryCurrency ? deliveryOptions(Date.now(), this.config, this.services, this.deliveryCurrency, this.selectedVariant()) : [];
      this.deliveryBox.hidden = options.length === 0;
      this.deliveryList.textContent = '';
      options.forEach(function (option) {
        var item = el('li', 'sc__option');
        var when = el('span', 'sc__option-date');
        appendRich(when, option.marked);
        item.append(el('span', 'sc__option-name', option.label), el('span', 'sc__option-price', option.price), when);
        this.deliveryList.appendChild(item);
      }, this);
    }

    renderFree() {
      if (!this.freeLine) return;
      var variant = this.selectedVariant();
      var result = freeShippingMessage(this.config.freeShipping, {
        threshold: this.freeThreshold, thresholdCurrency: this.freeCurrency, country: this.country, rate: this.freeRate,
        // An item that is out of stock cannot be added, so it never counts towards the threshold.
        cartCurrency: this.cart.currency, cartTotal: this.cart.total, itemPrice: variant && stockState(variant) !== 'out' ? variant.price : 0, quantity: this.selectedQuantity()
      });
      this.freeLine.hidden = result.state === 'hidden';
      // Rewritten only when the message changed, so a screen reader is not told the same thing again.
      if (this.freeLine.getAttribute('data-message') !== result.text) {
        this.freeLine.textContent = '';
        appendRich(this.freeLine, result.text);
        this.freeLine.setAttribute('data-message', result.text);
      }
    }

    /** Re-run the dispatch line on the minute, so the countdown ticks over and rolls to the next day by itself. */
    scheduleTick() {
      var self = this;
      clearTimeout(this.tickTimer);
      var wait = 60000 - (Date.now() % 60000) + 50;
      this.tickTimer = setTimeout(function () { self.renderWarning(); self.renderDispatch(); self.scheduleTick(); }, wait);
    }

    setCart(cart) {
      this.cart = { total: cart.total_price, currency: cart.currency || this.cart.currency };
      this.renderFree();
      // Prices are not converted, so a cart in another currency has no delivery options to show.
      this.renderDelivery();
    }

    scheduleCartRefresh() {
      var self = this;
      if (!this.freeLine) return;
      clearTimeout(this.cartTimer);
      this.cartTimer = setTimeout(function () {
        if (self.abort) self.abort.abort();
        self.abort = new AbortController();
        fetch('/cart.js', { cache: 'no-store', headers: { Accept: 'application/json' }, signal: self.abort.signal })
          .then(function (response) { return response.json(); })
          .then(function (cart) { if (typeof cart.total_price === 'number') self.setCart(cart); })
          .catch(function () { /* keep the message already showing */ });
      }, 300);
    }
  }

  /** The dispatch message as a header banner: one line, on every page, kept right by the clock. */
  class ShippingCountdownBanner extends HTMLElement {
    connectedCallback() {
      var self = this;
      try { this.config = JSON.parse(this.querySelector('script[data-config]').textContent); } catch (error) { this.config = null; }
      this.line = this.querySelector('[data-role="line"]');
      if (!this.config || !this.line) return;
      this.render();
      this.onVisible = function () { if (!document.hidden) self.render(); };
      document.addEventListener('visibilitychange', this.onVisible);
      this.tick();
    }
    disconnectedCallback() {
      clearTimeout(this.timer);
      if (this.onVisible) document.removeEventListener('visibilitychange', this.onVisible);
    }
    render() {
      var view = bannerView(Date.now(), this.config);
      this.hidden = view.kind === 'hidden';
      this.line.textContent = '';
      if (view.kind === 'message') appendRich(this.line, view.marked);
    }
    /** On the minute, so the time left counts down and the day rolls over by itself. */
    tick() {
      var self = this;
      clearTimeout(this.timer);
      this.timer = setTimeout(function () { self.render(); self.tick(); }, 60000 - (Date.now() % 60000) + 50);
    }
  }

  if (!customElements.get('shipping-countdown')) customElements.define('shipping-countdown', ShippingCountdown);
  if (!customElements.get('shipping-countdown-banner')) customElements.define('shipping-countdown-banner', ShippingCountdownBanner);
})(typeof window !== 'undefined' ? window : {});
