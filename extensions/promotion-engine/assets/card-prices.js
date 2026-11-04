/*
 * Discounted prices on product cards (collection pages, search, scrollers).
 *
 * Shopify puts the automatic discounts and the products they cover in the page (see blocks/promotion-loader.liquid), so no request is made
 * to the app. A card shows the first variant's price, which the theme has already written; this reads it, works out the price with the best
 * automatic discount that covers the card's product, with the same sums as the product page (discounted-price.js), and shows that price in
 * its place with the old price struck through and what is saved. Anything it cannot read with certainty (a range, a price it cannot parse) is
 * left exactly as the theme wrote it. Codes are never shown on a card.
 */
(function (root) {
  'use strict';

  var SEPARATORS = {
    amount: [',', '.'], amount_no_decimals: [',', ''], amount_with_comma_separator: ['.', ','], amount_no_decimals_with_comma_separator: ['.', ''],
    amount_with_apostrophe_separator: ["'", '.'], amount_no_decimals_with_space_separator: [' ', ''], amount_with_space_separator: [' ', ','],
    amount_with_period_and_space_separator: [' ', '.']
  };

  /** The price in minor units that a theme wrote as text in the shop's money format, or null when the text is not one plain price (a range, "from", nothing). */
  function parseMoney(text, format) {
    var match = /\{\{\s*(\w+)\s*\}\}/.exec(format || '');
    var separators = SEPARATORS[match ? match[1] : 'amount'] || SEPARATORS.amount;
    var value = String(text || '');
    if (/[-\u2013\u2014]|\bto\b|\bfrom\b/i.test(value)) return null;
    var tokens = value.match(/\d[\d.,'\s\u00a0\u202f]*/g);
    if (!tokens || tokens.length !== 1) return null;
    var number = tokens[0].replace(/[\s\u00a0\u202f]+$/, '');
    var thousands = separators[0];
    number = thousands === ' ' ? number.replace(/[\s\u00a0\u202f]/g, '') : number.split(thousands).join('');
    if (separators[1] && separators[1] !== '.') number = number.replace(separators[1], '.');
    if (!/^\d+(\.\d+)?$/.test(number)) return null;
    return Math.round(parseFloat(number) * 100);
  }

  /** What part of `whole` an amount is, as a whole percentage, rounding half up (as the product page does). */
  function wholePercent(amount, whole) { return whole > 0 ? Math.floor((amount * 200 + whole) / (whole * 2)) : 0; }

  /** Product IDs are sorted, stored as differences in base 36 and joined with commas (see compactIds.ts). */
  function decodeIds(encoded) {
    var ids = {};
    var total = 0;
    if (encoded) encoded.split(',').forEach(function (part) { total += parseInt(part, 36); ids[total] = true; });
    return ids;
  }

  /** The best automatic discount for a product at a price: the lowest price any running rule gives, or null when none lowers it. */
  function bestPrice(rules, productId, price, currency, logic, now) {
    var best = null;
    rules.forEach(function (rule) {
      if (rule.s > now || (rule.e && rule.e <= now)) return;
      if (!rule.a) { rule.set = rule.set || decodeIds(rule.i); if (!rule.set[Number(productId)]) return; }
      var result = logic.discounted(price, { t: rule.t, v: rule.v, u: rule.u }, currency);
      if (result !== null && result < price && (best === null || result < best)) best = result;
    });
    return best;
  }

  /** Where the theme wrote the price and the old price on a card (Horizon, and Dawn as far as its markup allows), or null. */
  function priceParts(card) {
    var box = card.querySelector('[ref="priceContainer"]') || card.querySelector('.price');
    if (!box) return null;
    var priceEl = box.querySelector('.price:not(.compare-at-price) bdi, .price-item--sale, .price__regular .price-item--regular');
    if (!priceEl) return null;
    var compareEl = box.querySelector('.compare-at-price bdi, .price__sale s.price-item--regular');
    return { box: box, priceEl: priceEl, compareEl: compareEl };
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function run(data, logic) {
    var cfg = data.cfg || {};
    var format = cfg.format || '£{{amount}}';
    var currency = cfg.currency || '';
    var rules = data.promos || [];
    var embed = document.querySelector('promotion-engine-embed');
    var selector = (embed && embed.dataset.cardSelector) || 'product-card, .product-card-wrapper, .card-wrapper';
    var vars = {
      '--dp-weight': cfg.weight || '600', '--dp-sale': cfg.sale, '--dp-was': cfg.was, '--dp-save-bg': cfg.saveBg, '--dp-save-text': cfg.saveText
    };

    function clear(card) {
      var old = card.querySelector('[data-pe-card-price]');
      if (old) old.remove();
      card.querySelectorAll('[data-pe-card-hidden]').forEach(function (node) { node.removeAttribute('data-pe-card-hidden'); });
      delete card.dataset.peCardSig;
    }

    function handle(card) {
      var productId = card.dataset.productId || (card.querySelector('[data-product-id]') || { dataset: {} }).dataset.productId;
      if (!/^\d+$/.test(productId || '')) return;
      var parts = priceParts(card);
      var ours = card.querySelector('[data-pe-card-price]');
      if (!parts) { if (ours) clear(card); return; }
      var priceText = parts.priceEl.textContent;
      var compareText = parts.compareEl ? parts.compareEl.textContent : '';
      var signature = priceText + '|' + compareText;
      if (ours && card.dataset.peCardSig === signature) return;
      var price = parseMoney(priceText, format);
      var compare = compareText ? parseMoney(compareText, format) : null;
      if (price === null || (compareText && compare === null)) { clear(card); return; }
      var now = bestPrice(rules, productId, price, currency, logic, Date.now() / 1000);
      if (now === null) { clear(card); card.dataset.peCardSig = signature; return; }
      var was = compare && compare > price ? compare : price;
      var saving = was - now;
      var withCode = currency && priceText.indexOf(currency) !== -1 ? ' ' + currency : '';
      var write = function (minor) { return logic.formatMoney(minor, format) + withCode; };
      if (ours) ours.remove();
      ours = el('span', 'pe-cp');
      ours.setAttribute('data-pe-card-price', '');
      Object.keys(vars).forEach(function (name) { if (vars[name]) ours.style.setProperty(name, vars[name]); });
      ours.appendChild(el('span', 'pe-cp__sr', cfg.saleLabel || 'Sale price '));
      ours.appendChild(el('span', 'pe-cp__now', write(now)));
      ours.appendChild(el('span', 'pe-cp__sr', cfg.regularLabel || 'Regular price '));
      ours.appendChild(el('s', 'pe-cp__was', write(was)));
      ours.appendChild(el('span', 'pe-cp__save', logic.fillText(cfg.text || 'Save {amount} ({percent}%)', { amount: write(saving), percent: String(wholePercent(saving, was)) })));
      parts.box.setAttribute('data-pe-card-hidden', '');
      parts.box.insertAdjacentElement('afterend', ours);
      card.dataset.peCardSig = signature;
    }

    function scan() {
      var cards;
      try { cards = document.querySelectorAll(selector); } catch (error) { return; }
      cards.forEach(function (card) {
        // The innermost card only, so a nested wrapper is not handled twice.
        try { if (card.querySelector(selector)) return; } catch (error) { return; }
        try { handle(card); } catch (error) { /* A card that cannot be read keeps the theme's own price. */ }
      });
    }

    var timer = null;
    var observer = new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(scan, 50); });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    scan();
    return { scan: scan, stop: function () { observer.disconnect(); clearTimeout(timer); } };
  }

  function start() {
    var script = document.getElementById('promotion-engine-card-prices');
    var logic = root.DiscountedPriceLogic;
    if (!script || !logic || !document.body) return null;
    var data;
    try { data = JSON.parse(script.textContent); } catch (error) { return null; }
    if (!data || data.v !== 1 || !Array.isArray(data.promos) || !data.promos.length) return null;
    return run(data, logic);
  }

  var api = { parseMoney: parseMoney, bestPrice: bestPrice, wholePercent: wholePercent, start: start };
  root.PromotionCardPrices = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root.document) start();
})(typeof window !== 'undefined' ? window : {});
