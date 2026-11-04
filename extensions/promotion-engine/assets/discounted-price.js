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

  /** Whether a discount allows being combined with discounts of a kind ("P" product, "O" order). */
  function allows(rule, kind) { return kind === 'P' ? Boolean(rule.cp) : Boolean(rule.co); }
  /** Two discounts combine only when each allows the other's kind. */
  function canCombine(a, b) { return allows(a, b.k) && allows(b, a.k); }

  /**
   * What to show for a variant, in three separate parts. The main price: `now` is the price (Shopify's own), `was` the compare-at price when
   * it is higher. `auto` is the best automatic discount that applies, on its own line and never folded into the main price, with what it
   * saves against the price before any discount. `code` is the code discount, likewise. The code spoken of is the first one, in the order given
   * (the banners' order), that covers the variant: a lower one is never shown in its place, and one without a price ("n") is spoken of as
   * nothing. It is left out when it cannot be combined with the automatic discount that applies, and when it would not make the price
   * lower than the lowest already shown. Codes are not added to automatic discounts here: the shopper has not entered one, and checkout
   * decides what combines.
   */
  function priceState(variant, rules, currency) {
    var base = variant.price;
    var compare = variant.compare_at_price || 0;
    var list = compare > base ? compare : base;
    var auto = -1, autoRule = null, code = -1, codeRule = null;
    (rules || []).forEach(function (rule) {
      if (!covers(rule, variant.id)) return;
      if (rule.c) {
        if (codeRule) return;
        codeRule = rule;
        var codePrice = discounted(base, rule, currency);
        if (codePrice !== null) code = codePrice;
        return;
      }
      var price = discounted(base, rule, currency);
      if (price === null) return;
      if (auto < 0 || price < auto) { auto = price; autoRule = rule; }
    });
    var applied = auto >= 0 && auto < base;
    var was = base < list ? list : 0;
    var saving = was ? was - base : 0;
    var lowest = applied ? auto : base;
    var codeSaving = code >= 0 ? base - code : 0;
    var codeShown = code >= 0 && code < lowest && !(applied && !canCombine(autoRule, codeRule));
    return {
      now: base, was: was, saving: saving,
      percent: was ? wholePercent(saving, was) : 0,
      auto: applied ? { price: auto, saving: base - auto, percent: wholePercent(base - auto, base) } : null,
      code: codeShown ? { price: code, name: codeRule.c, saving: codeSaving, percent: wholePercent(codeSaving, base) } : null
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

  /** Copies the code on a button to the clipboard and says so on the button for a moment. */
  function copyCode(button) {
    var code = button.dataset.code || button.textContent;
    var done = function () {
      if (button.dataset.copied) return;
      var label = button.textContent;
      button.dataset.copied = 'true';
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = label; delete button.dataset.copied; }, 1500);
    };
    var fallback = function () {
      var field = document.createElement('textarea');
      field.value = code;
      field.setAttribute('readonly', '');
      field.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(field);
      field.select();
      try { if (document.execCommand('copy')) done(); } catch (error) { /* nothing more to try */ }
      document.body.removeChild(field);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, fallback);
    else fallback();
  }

  class DiscountedPrice extends HTMLElement {
    connectedCallback() {
      var self = this;
      try {
        this.rules = JSON.parse(this.querySelector('script[data-rules]').textContent);
        this.variants = JSON.parse(this.querySelector('script[data-variants]').textContent);
      } catch (error) { return; }
      if (!this.querySelector('[data-role="line"]')) return;
      this.format = this.dataset.moneyFormat || '£{{amount}}';
      this.currency = this.dataset.currency || '';
      this.variantId = Number(this.dataset.variantId) || null;
      this.listeners = [];
      this.last = this.dataset.variantId;
      this.seen = this.dataset.variantId;
      var refresh = function () { self.update(); };
      VARIANT_EVENTS.forEach(function (name) {
        self.listen(document, name, function (event) {
          var d = event.detail || {};
          var id = Number((d.resource && d.resource.id) || (d.variant && d.variant.id) || d.id) || null;
          // The theme says which variant it is now, and often updates the form and the address a moment later: until they change, believe it.
          if (id) self.hint = { id: id, form: formVariantId(), url: urlVariantId() };
          refresh();
          self.recheck();
        });
      });
      // Any choice made in the page's own pickers (colour, size) may change the variant; the form and the address follow a moment later.
      this.listen(document, 'change', function (event) {
        var t = event.target;
        if (t && t.matches && t.matches('input[name="id"], select[name="id"]')) { self.hint = null; refresh(); return; }
        if (t && t.closest && t.closest('form, fieldset, variant-picker, variant-selects, variant-radios')) self.recheck();
      });
      this.listen(this, 'click', function (event) {
        var button = event.target && event.target.closest && event.target.closest('.dp__copy');
        if (button && self.contains(button)) copyCode(button);
      });
      this.listen(window, 'popstate', refresh);
      this.listen(window, 'pageshow', function (event) { if (event.persisted) refresh(); });
    }

    disconnectedCallback() {
      (this.timers || []).forEach(clearTimeout);
      this.timers = [];
      (this.listeners || []).forEach(function (l) { l[0].removeEventListener(l[1], l[2]); });
      this.listeners = [];
    }

    listen(target, name, handler) {
      target.addEventListener(name, handler);
      this.listeners.push([target, name, handler]);
    }

    /**
     * The variant being looked at: what the theme last announced until the form or the address says something different, else the product
     * form's, else the address's, else the one the server wrote.
     */
    selectedVariant() {
      var form = formVariantId();
      var url = urlVariantId();
      var hint = this.hint;
      var id;
      if (hint && form === hint.form && url === hint.url) id = hint.id;
      else id = form || url || this.variantId;
      for (var i = 0; i < this.variants.length; i++) if (this.variants[i].id === id) return this.variants[i];
      return null;
    }

    update() {
      // A theme that fetches the page section again writes the server's price for the new variant into this element and changes its variant: that is what is shown now.
      if (this.dataset.variantId !== this.seen) { this.seen = this.dataset.variantId; this.last = this.seen; }
      var variant = this.selectedVariant();
      if (!variant || String(variant.id) === this.last) return;
      this.last = String(variant.id);
      render(this, priceState(variant, this.rules, this.currency));
    }

    /** Looks now, and again shortly after, because themes update the form, the address and their own markup a moment after they announce a change. */
    recheck() {
      var self = this;
      (this.timers || []).forEach(clearTimeout);
      this.timers = [0, 120, 350, 800].map(function (wait) { return setTimeout(function () { self.update(); }, wait); });
    }
  }

  function formVariantId() {
    var form = document.querySelector(CART_FORMS);
    var field = form && form.querySelector('[name="id"]');
    return Number(field && field.value) || null;
  }
  function urlVariantId() { return Number(new URLSearchParams(location.search).get('variant')) || null; }

  /** Writes the price lines. Built from text nodes, so nothing in a message can become markup. */
  function render(host, state) {
    var format = host.format;
    // The theme may have replaced this block's markup since the last time, so the lines are found again each time.
    var line = host.querySelector('[data-role="line"]');
    if (!line) return;
    host.autoLine = host.querySelector('[data-role="auto"]');
    host.codeLine = host.querySelector('[data-role="code"]');
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
    if (host.autoLine) {
      host.autoLine.hidden = !state.auto;
      host.autoLine.textContent = state.auto ? fillText(host.dataset.autoText || '{price} with the automatic discount', { price: formatMoney(state.auto.price, format), amount: formatMoney(state.auto.saving, format), percent: String(state.auto.percent) }) : '';
    }
    if (host.codeLine) {
      host.codeLine.hidden = !state.code;
      host.codeLine.textContent = '';
      if (state.code) {
        var values = { price: formatMoney(state.code.price, format), amount: formatMoney(state.code.saving, format), percent: String(state.code.percent) };
        var parts = String(host.dataset.codeText || '{price} with code {code}').split('{code}');
        parts.forEach(function (part, index) {
          if (index) {
            var button = el('button', 'dp__copy', state.code.name);
            button.type = 'button';
            button.dataset.code = state.code.name;
            button.title = 'Click to copy the code';
            button.setAttribute('aria-label', 'Copy code ' + state.code.name);
            host.codeLine.appendChild(button);
          }
          if (part) host.codeLine.appendChild(document.createTextNode(fillText(part, values)));
        });
      }
    }
  }

  if (!customElements.get('discounted-price')) customElements.define('discounted-price', DiscountedPrice);
})(typeof window !== 'undefined' ? window : {});
