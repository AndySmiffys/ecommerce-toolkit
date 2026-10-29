/*
 * Discounted price: the product page's price, with the price after any discount that covers the product.
 *
 * The first half is pure functions of (variant, rules, currency) so the admin preview and the tests can run this same file; the second half
 * is the <discounted-price> element, which keeps the price right when the shopper picks another variant. The server writes the price for the
 * first variant itself (see blocks/discounted-price.liquid), with the same sums in whole minor units (pence), so nothing jumps.
 */
(function (root) {
  'use strict';

  /** A discount's price for an item costing `price` (minor units), or null when the rule does not apply to it. */
  function discounted(price, rule, currency) {
    if (rule.t === 'p') return price - Math.floor((price * rule.v + 5000) / 10000);
    if (rule.t === 'a' && rule.u === currency) return Math.max(price - rule.v, 0);
    return null;
  }

  /** Whether a rule covers this variant: every variant of the product, or only the variants it names. */
  function covers(rule, variantId) {
    if (!rule.vs) return true;
    for (var i = 0; i < rule.vs.length; i++) if (String(rule.vs[i]) === String(variantId)) return true;
    return false;
  }

  /**
   * What to show for a variant. `now` is the price to pay (the best automatic discount, or the price itself), `was` the price it is compared
   * with (the compare-at price or the price) when `now` is lower, and `code` the best code discount when it beats `now`, with what it saves
   * against the price before any discount. Codes are not added to automatic discounts here: the shopper has not entered one, and checkout
   * decides what combines.
   */
  function priceState(variant, rules, currency) {
    var base = variant.price;
    var compare = variant.compare_at_price || 0;
    var list = compare > base ? compare : base;
    var auto = -1, code = -1, codeName = '';
    (rules || []).forEach(function (rule) {
      if (!covers(rule, variant.id)) return;
      var price = discounted(base, rule, currency);
      if (price === null) return;
      if (!rule.c) { if (auto < 0 || price < auto) auto = price; }
      else if (code < 0 || price < code) { code = price; codeName = rule.c; }
    });
    var now = auto >= 0 && auto < base ? auto : base;
    var was = now < list ? list : 0;
    var saving = was ? was - now : 0;
    var codeSaving = code >= 0 ? base - code : 0;
    return {
      now: now, was: was, saving: saving,
      percent: was ? wholePercent(saving, was) : 0,
      code: code >= 0 && code < now ? { price: code, name: codeName, saving: codeSaving, percent: wholePercent(codeSaving, base) } : null
    };
  }

  /** What part of `whole` an amount is, as a whole percentage, rounding half up. */
  function wholePercent(amount, whole) {
    return whole > 0 ? Math.floor((amount * 200 + whole) / (whole * 2)) : 0;
  }

  /** An amount in minor units written the way the shop's money format says ("£{{amount}}"), as Shopify's own storefront code does. */
  function formatMoney(minor, format) {
    function digits(number, precision, thousands, decimal) {
      thousands = thousands || ',';
      decimal = decimal || '.';
      var parts = (number / 100).toFixed(precision).split('.');
      return parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + thousands) + (parts[1] ? decimal + parts[1] : '');
    }
    var pattern = /\{\{\s*(\w+)\s*\}\}/;
    var text = String(format || '£{{amount}}');
    var match = pattern.exec(text);
    if (!match) return text;
    var value;
    switch (match[1]) {
      case 'amount_no_decimals': value = digits(minor, 0); break;
      case 'amount_with_comma_separator': value = digits(minor, 2, '.', ','); break;
      case 'amount_no_decimals_with_comma_separator': value = digits(minor, 0, '.', ','); break;
      case 'amount_with_apostrophe_separator': value = digits(minor, 2, "'", '.'); break;
      case 'amount_no_decimals_with_space_separator': value = digits(minor, 0, ' '); break;
      case 'amount_with_space_separator': value = digits(minor, 2, ' ', ','); break;
      case 'amount_with_period_and_space_separator': value = digits(minor, 2, ' ', '.'); break;
      default: value = digits(minor, 2);
    }
    return text.replace(pattern, value);
  }

  /** Fills the words a message may use. Anything not listed is left as typed. */
  function fillText(template, values) {
    var text = String(template || '');
    Object.keys(values).forEach(function (name) { text = text.split('{' + name + '}').join(values[name]); });
    return text;
  }

  var logic = { discounted: discounted, covers: covers, priceState: priceState, formatMoney: formatMoney, fillText: fillText };
  root.DiscountedPriceLogic = logic;
  if (typeof module !== 'undefined' && module.exports) module.exports = logic;

  /* ---------------------------------------------------------------- the element */

  if (typeof HTMLElement === 'undefined' || typeof customElements === 'undefined') return;

  var VARIANT_EVENTS = ['variant:update', 'variant:change', 'variantChange'];
  var CART_FORMS = 'form[action^="/cart/add"]';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  class DiscountedPrice extends HTMLElement {
    connectedCallback() {
      var self = this;
      try {
        this.rules = JSON.parse(this.querySelector('script[data-rules]').textContent);
        this.variants = JSON.parse(this.querySelector('script[data-variants]').textContent);
      } catch (error) { return; }
      this.line = this.querySelector('[data-role="line"]');
      this.codeLine = this.querySelector('[data-role="code"]');
      if (!this.line) return;
      this.format = this.dataset.moneyFormat || '£{{amount}}';
      this.currency = this.dataset.currency || '';
      this.variantId = Number(this.dataset.variantId) || null;
      this.listeners = [];
      this.last = this.dataset.variantId;
      var refresh = function () { self.update(); };
      VARIANT_EVENTS.forEach(function (name) {
        self.listen(document, name, function (event) {
          var d = event.detail || {};
          var id = Number((d.resource && d.resource.id) || (d.variant && d.variant.id) || d.id) || null;
          if (id) self.variantId = id;
          refresh();
        });
      });
      this.listen(document, 'change', function (event) {
        var t = event.target;
        if (t && t.matches && t.matches('input[name="id"], select[name="id"]')) refresh();
      });
      this.listen(window, 'popstate', refresh);
      this.listen(window, 'pageshow', function (event) { if (event.persisted) refresh(); });
    }

    disconnectedCallback() {
      (this.listeners || []).forEach(function (l) { l[0].removeEventListener(l[1], l[2]); });
      this.listeners = [];
    }

    listen(target, name, handler) {
      target.addEventListener(name, handler);
      this.listeners.push([target, name, handler]);
    }

    /** The variant being looked at: the product form's, else the address's, else the one the server wrote. */
    selectedVariant() {
      var form = document.querySelector(CART_FORMS);
      var field = form && form.querySelector('[name="id"]');
      var id = Number(field && field.value) || Number(new URLSearchParams(location.search).get('variant')) || this.variantId;
      for (var i = 0; i < this.variants.length; i++) if (this.variants[i].id === id) return this.variants[i];
      return null;
    }

    update() {
      var variant = this.selectedVariant();
      if (!variant || String(variant.id) === this.last) return;
      this.last = String(variant.id);
      render(this, priceState(variant, this.rules, this.currency));
    }
  }

  /** Writes the price lines. Built from text nodes, so nothing in a message can become markup. */
  function render(host, state) {
    var format = host.format;
    var line = host.line;
    line.textContent = '';
    if (state.was) line.appendChild(el('span', 'dp__sr', host.dataset.saleLabel || 'Sale price '));
    line.appendChild(el('span', state.was ? 'dp__now dp__now--sale' : 'dp__now', formatMoney(state.now, format)));
    if (state.was) {
      line.appendChild(el('span', 'dp__sr', host.dataset.regularLabel || 'Regular price '));
      line.appendChild(el('s', 'dp__was', formatMoney(state.was, format)));
      if (host.dataset.showSavings === 'true') {
        line.appendChild(el('span', 'dp__save', fillText(host.dataset.savingsText || 'Save {amount}', { amount: formatMoney(state.saving, format), percent: String(state.percent) })));
      }
    }
    if (host.codeLine) {
      host.codeLine.hidden = !state.code;
      host.codeLine.textContent = state.code ? fillText(host.dataset.codeText || '{price} with code {code}', { price: formatMoney(state.code.price, format), code: state.code.name, amount: formatMoney(state.code.saving, format), percent: String(state.code.percent) }) : '';
    }
  }

  if (!customElements.get('discounted-price')) customElements.define('discounted-price', DiscountedPrice);
})(typeof window !== 'undefined' ? window : {});
