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

  /** Splits "text [highlight]this[/highlight] text" into plain and highlighted pieces, without any markup. */
  function parseHighlight(text) {
    var out = [];
    var pattern = /\[highlight\]([\s\S]*?)\[\/highlight\]/g;
    var last = 0, m;
    while ((m = pattern.exec(String(text || '')))) {
      if (m.index > last) out.push({ text: text.slice(last, m.index), highlight: false });
      out.push({ text: m[1], highlight: true });
      last = pattern.lastIndex;
    }
    if (last < String(text || '').length) out.push({ text: text.slice(last), highlight: false });
    return out;
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

  /** Fills {threshold} (every occurrence) and {country} in a message. */
  function fillThreshold(text, thresholdMinor, currency, country) {
    return String(text || '').split('{threshold}').join(formatMoney(thresholdMinor, currency)).split('{country}').join(country || '');
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
    var fill = function (text) { return fillThreshold(text, threshold, input.thresholdCurrency, input.country); };
    if (cart >= threshold) return { state: 'over', text: fill(free.textOver) };
    if (item > 0 && cart + item >= threshold) return { state: 'add', text: fill(free.textAdd) };
    return { state: 'under', text: fill(free.textUnder) };
  }

  /** A variant that can only be bought now as a pre-order or back-order. */
  function isPreorder(variant) {
    if (!variant) return false;
    if (variant.available === false) return true;
    return variant.policy === 'continue' && Boolean(variant.managed) && typeof variant.qty === 'number' && variant.qty <= 0;
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
    if (isPreorder(variant)) {
      return config.availability && config.availability.preorderMode === 'hide' ? { kind: 'hidden' } : { kind: 'preorder' };
    }
    if (delay) {
      var from = delayedDispatch(nowMs, config);
      return from ? { kind: 'delay', date: formatDispatchDate(from) } : unavailable(config);
    }
    var next = nextDispatch(nowMs, config);
    if (!next) return unavailable(config);
    return { kind: 'countdown', countdown: countdownText(next.msUntilCutoff), date: formatDispatchDate(next.date) };
  }
  function unavailable(config) { return config.hideIfUnavailable ? { kind: 'hidden' } : { kind: 'none' }; }

  var logic = {
    londonParts: londonParts, addDays: addDays, weekday: weekday, londonTimeToUtc: londonTimeToUtc, parseCutoff: parseCutoff,
    isDispatchDay: isDispatchDay, nextDispatch: nextDispatch, delayedDispatch: delayedDispatch, countdownText: countdownText,
    formatDispatchDate: formatDispatchDate, parseHighlight: parseHighlight, formatMoney: formatMoney, fillThreshold: fillThreshold,
    freeShippingMessage: freeShippingMessage, isPreorder: isPreorder, warningVisible: warningVisible, dispatchView: dispatchView
  };
  root.ShippingCountdownLogic = logic;
  if (typeof module !== 'undefined' && module.exports) module.exports = logic;

  /* ---------------------------------------------------------------- the element */

  if (typeof HTMLElement === 'undefined' || typeof customElements === 'undefined' || customElements.get('shipping-countdown')) return;

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
        line.append(c.countdownPrefix + ' ', el('span', 'sc__countdown', view.countdown), ' ' + c.countdownSuffix + ' ', el('span', 'sc__dispatch', view.date));
      } else if (view.kind === 'delay') {
        parseHighlight(c.delayMessage).forEach(function (piece) { line.append(piece.highlight ? el('span', 'sc__countdown', piece.text) : document.createTextNode(piece.text)); });
        line.append(' ', el('span', 'sc__dispatch', view.date));
      } else if (view.kind === 'preorder') {
        line.append(c.availability.preorderMessage);
      } else if (view.kind === 'none') {
        line.append(el('span', 'sc__expired', c.noShippingText));
      } else if (view.kind === 'error') {
        line.append(c.errorText);
      }
    }

    renderFree() {
      if (!this.freeLine) return;
      var variant = this.selectedVariant();
      var result = freeShippingMessage(this.config.freeShipping, {
        threshold: this.freeThreshold, thresholdCurrency: this.freeCurrency, country: this.country,
        cartCurrency: this.cart.currency, cartTotal: this.cart.total, itemPrice: variant ? variant.price : 0, quantity: this.selectedQuantity()
      });
      this.freeLine.hidden = result.state === 'hidden';
      if (this.freeLine.textContent !== result.text) this.freeLine.textContent = result.text;
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

  customElements.define('shipping-countdown', ShippingCountdown);
})(typeof window !== 'undefined' ? window : {});
