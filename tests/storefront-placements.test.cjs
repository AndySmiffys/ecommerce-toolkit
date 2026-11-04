const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
const base = 'extensions/promotion-engine/';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(html, config = {}, respond = () => ({ html: '<span>Save 10%</span>', css: '' })) {
  const dom = new JSDOM(html, { url: 'https://shop.example/fr/collections/offers', runScripts: 'outside-only' });
  const { window } = dom;
  const calls = [];
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch = async url => { calls.push(new URL(url)); return { ok: true, json: async () => String(url).endsWith('.js') ? { id: 42 } : respond(url) }; };
  window.eval(readFileSync(base + 'assets/promotion-engine.js', 'utf8'));
  window.eval(readFileSync(base + 'assets/promotion-placements.js', 'utf8'));
  const embed = window.document.createElement('promotion-engine-embed');
  Object.assign(embed.dataset, { badgesEnabled: 'true', root: '/fr/', ...config });
  window.document.body.append(embed);
  return { dom, window, embed, calls };
}
test('Dawn resolves card products through localized Ajax URLs without inserting a header', async () => {
  const f = fixture('<div class="section-header"><header></header></div><div class="card-wrapper"><div class="card__inner"><a href="/fr/products/hat">Hat</a></div></div>');
  try {
    await wait(30);
    assert.equal(f.window.document.querySelectorAll('[data-pe-auto="header"]').length, 0);
    const badge = f.window.document.querySelector('[data-pe-auto="badge"]');
    assert.equal(badge.dataset.productId, '42');
    assert.equal(badge.parentElement.className, 'card__inner');
    assert.ok(f.calls.some(url => url.pathname === '/fr/products/hat.js'));
    assert.equal(badge.hidden, false);
    assert.match(badge.shadowRoot.textContent, /Save 10%/);
  } finally { f.dom.window.close(); }
});
test('Horizon handles nested cards and newly inserted collection results without duplicate badges', async () => {
  const f = fixture('<div id="header-group"></div><div class="product-card-wrapper"><product-card data-product-id="8"><div class="card-gallery"><a href="/products/hat"></a></div></product-card></div>');
  try {
    await wait(20);
    assert.equal(f.window.document.querySelectorAll('[data-pe-auto="badge"]').length, 1);
    assert.ok(!f.calls.some(url => url.pathname.endsWith('.js')));
    f.window.document.body.insertAdjacentHTML('beforeend', '<product-card data-product-id="9"><div class="card-gallery"><a href="/products/shirt"></a></div></product-card>');
    await wait(160);
    assert.equal(f.window.document.querySelectorAll('[data-pe-auto="badge"]').length, 2);
    const card = f.window.document.querySelector('product-card');
    card.dataset.productId = '10';
    card.querySelector('a').href = '/products/new';
    await wait(160);
    assert.equal(card.querySelector('[data-pe-auto="badge"]').dataset.productId, '10');
    f.embed.remove();
    assert.equal(f.window.document.querySelectorAll('[data-pe-auto]').length, 0);
    assert.equal(card.querySelector('.card-gallery').style.position, '');
  } finally { f.dom.window.close(); }
});
test('Explicit placements take precedence and invalid custom selectors are harmless', async () => {
  const f = fixture('<header role="banner"></header><promotion-engine data-placement="header"></promotion-engine><product-card data-product-id="8"><a href="/products/a"></a><promotion-engine data-placement="badge" data-product-id="8"></promotion-engine></product-card>');
  try { await wait(20); assert.equal(f.window.document.querySelectorAll('[data-pe-auto]').length, 0); }
  finally { f.dom.window.close(); }
  const invalid = fixture('<header role="banner"></header>', { headerSelector: '[', cardSelector: '[' });
  try { await wait(20); assert.equal(invalid.window.document.querySelectorAll('[data-pe-auto]').length, 0); }
  finally { invalid.dom.window.close(); }
});
test('Empty promotions stay hidden, including inside the shadow stylesheet', async () => {
  const f = fixture('<promotion-engine data-placement="header"></promotion-engine>', {}, () => ({ html: '', css: '' }));
  try {
    await wait(20);
    const header = f.window.document.querySelector('promotion-engine[data-placement="header"]');
    assert.equal(header.hidden, true);
    assert.match(header.shadowRoot.querySelector('style').textContent, /:host\(\[hidden\]\)/);
  } finally { f.dom.window.close(); }
});
test('Changing a product form does not change badges or offers in other sections', async () => {
  const f = fixture('<section class="shopify-section" id="one"><form><input name="id" value="11"></form><promotion-engine data-placement="product" data-product-id="1" data-variant-id="10"></promotion-engine></section><section class="shopify-section" id="two"><promotion-engine data-placement="product" data-product-id="2" data-variant-id="20"></promotion-engine></section><promotion-engine data-placement="badge" data-product-id="1"></promotion-engine>', { headerEnabled: 'false', badgesEnabled: 'false' });
  try {
    f.window.document.querySelector('input').dispatchEvent(new f.window.Event('change', { bubbles: true }));
    await wait(180);
    assert.equal(f.window.document.querySelector('#one promotion-engine').dataset.variantId, '11');
    assert.equal(f.window.document.querySelector('#two promotion-engine').dataset.variantId, '20');
    assert.equal(f.window.document.querySelector('[data-placement="badge"]').dataset.variantId, undefined);
  } finally { f.dom.window.close(); }
});
test('Liquid schemas remain valid and expose placement controls', () => {
  for (const name of ['promotion', 'promotion-loader', 'product-promotion', 'collection-promotion', 'header-promotion']) {
    const source = readFileSync(base + `blocks/${name}.liquid`, 'utf8');
    const schema = JSON.parse(source.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
    assert.equal(schema.javascript, 'promotion-engine.js');
    // Shopify rejects a theme block whose name is longer than 25 characters, and only says so when the app is deployed.
    assert.ok(schema.name.length <= 25, `${name}: the block name "${schema.name}" is ${schema.name.length} characters (the limit is 25)`);
    const ids = schema.settings.filter(setting => setting.id).map(setting => setting.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(!ids.includes('proxy_path'));
    assert.match(name === 'promotion-loader' ? source : readFileSync(base + 'snippets/server-promotion.liquid', 'utf8'), /data-proxy-path="\/apps\/promotion-engine"/);
    if (name === 'promotion-loader') assert.ok(ids.includes('card_selector'));
    else if (name === 'collection-promotion') {
      assert.deepEqual(schema.enabled_on.templates, ['collection']);
      assert.deepEqual(schema.settings.find(setting => setting.id === 'width_mode').options.map(option => option.value), ['content', 'full']);
      assert.ok(!ids.includes('placement'));
      assert.equal(schema.class, 'pe-collection-app-block');
    } else if (name === 'product-promotion') {
      assert.deepEqual(schema.enabled_on.templates, ['product']);
      assert.ok(!ids.includes('placement'));
      assert.match(readFileSync(base + 'snippets/server-promotion.liquid', 'utf8'), /selected_or_first_available_variant/);
    }
    else if (name === 'header-promotion') assert.equal(schema.class, 'pe-header-app-block');
    else { assert.ok(ids.includes('spacing')); assert.equal(schema.settings.find(setting => setting.id === 'collection_full_width').default, true); assert.match(source, /closest.product/); }
  }
});
test('Cards wait until near the viewport and a removed embed cannot mount a delayed badge', async () => {
  const dom = new JSDOM('<product-card><a href="/products/hat"></a></product-card>', { url: 'https://shop.example/', runScripts: 'outside-only' });
  const { window } = dom;
  let notify, finish;
  let requests = 0;
  window.IntersectionObserver = class { constructor(callback) { notify = callback; } observe() {} unobserve() {} disconnect() {} };
  window.fetch = () => { requests++; return new Promise(resolve => { finish = () => resolve({ ok: true, json: async () => ({ id: 42 }) }); }); };
  window.eval(readFileSync(base + 'assets/promotion-placements.js', 'utf8'));
  const embed = window.document.createElement('promotion-engine-embed');
  Object.assign(embed.dataset, { headerEnabled: 'false', badgesEnabled: 'true' });
  try {
    window.document.body.append(embed);
    assert.equal(requests, 0);
    notify([{ target: window.document.querySelector('product-card'), isIntersecting: true }]);
    assert.equal(requests, 1);
    embed.remove();
    finish();
    await wait(20);
    assert.equal(window.document.querySelectorAll('[data-pe-auto]').length, 0);
  } finally { window.close(); }
});
test('A failed promotion request clears stale content rather than breaking the page', async () => {
  const f = fixture('<promotion-engine data-placement="header"></promotion-engine>');
  try {
    await wait(20);
    const header = f.window.document.querySelector('promotion-engine[data-placement="header"]');
    f.window.fetch = async () => ({ ok: false });
    await header.load();
    assert.equal(header.hidden, true);
    assert.equal(header.shadowRoot.childNodes.length, 0);
  } finally { f.dom.window.close(); }
});
test('Returning to the storefront refreshes the selected header and records its saved priority', async () => {
  let priority = 0;
  const f = fixture('<promotion-engine data-placement="header"></promotion-engine>', {}, () => ({ html: `<span>Priority ${priority}</span>`, css: '', promotionId: `discount-${priority}`, priority, revision: `revision-${priority}` }));
  try {
    await wait(20);
    const header = f.window.document.querySelector('promotion-engine[data-placement="header"]');
    assert.match(header.shadowRoot.textContent, /Priority 0/);
    priority = 100;
    f.window.Date.now = () => Date.now() + 5000;
    f.window.dispatchEvent(new f.window.Event('focus'));
    await wait(20);
    assert.match(header.shadowRoot.textContent, /Priority 100/);
    assert.equal(header.dataset.priority, '100');
    assert.equal(header.dataset.promotionId, 'discount-100');
    assert.notEqual(f.calls[0].searchParams.get('_refresh'), f.calls[1].searchParams.get('_refresh'));
  } finally { f.dom.window.close(); }
});

test('Collection width modes measure both page edges and retain theme gutters in content mode', async () => {
  const f = fixture('<div class="pe-collection-app-block"><promotion-engine class="pe-collection-banner" data-placement="collection" data-width-mode="full"></promotion-engine></div>', { headerEnabled: 'false', badgesEnabled: 'false' });
  const banner = f.window.document.querySelector('promotion-engine');
  let pageWidth = 1907, parentLeft = 235, parentWidth = 1437;
  Object.defineProperty(f.window.document.documentElement, 'clientWidth', { get: () => pageWidth });
  // Simulate a theme centring the app inside its available section width.
  banner.getBoundingClientRect = () => {
    const width = parseFloat(banner.style.width) || parentWidth;
    const left = parentLeft + (parentWidth - width) / 2 + parseFloat(banner.style.left || '0');
    return { left, right: left + width, width };
  };
  try {
    await wait(30);
    assert.equal(banner.hidden, false);
    assert.equal(banner.getBoundingClientRect().left, 0);
    assert.equal(banner.getBoundingClientRect().right, pageWidth);
    assert.equal(banner.style.getPropertyPriority('width'), 'important');
    pageWidth = 390; parentLeft = 20; parentWidth = 350;
    f.window.dispatchEvent(new f.window.Event('resize'));
    assert.equal(banner.getBoundingClientRect().left, 0);
    assert.equal(banner.getBoundingClientRect().right, 390);
    banner.dataset.widthMode = 'content';
    f.window.dispatchEvent(new f.window.Event('resize'));
    assert.equal(banner.style.width, '');
    assert.equal(banner.getBoundingClientRect().left, 20);
    assert.equal(banner.getBoundingClientRect().right, 370);
    banner.remove();
    banner.dataset.widthMode = 'full';
    f.window.dispatchEvent(new f.window.Event('resize'));
    assert.equal(banner.style.width, '');
  } finally { f.dom.window.close(); }
});
test('loader never creates a header, even with historical header settings or after an explicit block is removed', async () => {
  const f = fixture('<header role="banner"></header>', { headerEnabled: 'true' });
  try {
    await wait(30);
    assert.equal(f.window.document.querySelector('promotion-engine[data-placement="header"]'), null);
    assert.ok(!f.calls.some(url => url.searchParams.get('placement') === 'header'));
    const header = f.window.document.createElement('promotion-engine');
    header.dataset.placement = 'header';
    f.window.document.body.append(header);
    await wait(20);
    header.remove();
    await wait(160);
    assert.equal(f.window.document.querySelector('promotion-engine[data-placement="header"]'), null);
  } finally { f.dom.window.close(); }
});

const proxyCalls = f => f.calls.filter(url => url.pathname === '/apps/promotion-engine');
// Product ids 42 and 100 packed as base-36 differences ("16" is 42, "1m" is 58 more).
const badgeJson = promos => `<script type="application/json" id="promotion-engine-badges">${JSON.stringify({ v: 1, css: '.pe-badge{display:inline-block}', promos })}</script>`;
const sale = { k: '7', p: 5, s: 0, e: 0, a: 0, i: '16,1m', h: '<span class="pe-badge">Sale</span>', r: 'render' };
test('Badges are decided from the data in the page, so product cards make no request to the app', async () => {
  const f = fixture(`${badgeJson([sale])}<div class="card-wrapper" data-product-id="42"><div class="card__inner"><a href="/products/hat">Hat</a></div></div><div class="card-wrapper" data-product-id="43"><div class="card__inner"><a href="/products/cap">Cap</a></div></div><div class="card-wrapper" data-product-id="100"><div class="card__inner"><a href="/products/bag">Bag</a></div></div>`);
  try {
    await wait(40);
    const badges = [...f.window.document.querySelectorAll('[data-pe-auto="badge"]')];
    assert.equal(badges.length, 3);
    const shown = badges.filter(badge => !badge.hidden);
    assert.deepEqual(shown.map(badge => badge.dataset.productId).sort(), ['100', '42'], 'only the listed products get the badge');
    assert.match(shown[0].shadowRoot.textContent, /Sale/);
    assert.equal(shown[0].dataset.promotionId, '7');
    assert.equal(proxyCalls(f).length, 0, 'no request reached the app');
  } finally { f.dom.window.close(); }
});
test('Badge data picks the highest-ranked offer that is running and applies to every product when asked', async () => {
  const now = Math.floor(Date.now() / 1000);
  const f = fixture(`${badgeJson([
    { ...sale, k: 'ended', p: 9, e: now - 60, h: '<span class="pe-badge">Ended</span>' },
    { ...sale, k: 'future', p: 8, s: now + 3600, h: '<span class="pe-badge">Future</span>' },
    { ...sale, k: 'few', p: 7, i: '16', h: '<span class="pe-badge">Few</span>' },
    { ...sale, k: 'every', p: 1, a: 1, i: '', h: '<span class="pe-badge">Everything</span>' },
  ])}<div class="card-wrapper" data-product-id="42"><div class="card__inner"><a href="/products/hat">Hat</a></div></div><div class="card-wrapper" data-product-id="43"><div class="card__inner"><a href="/products/cap">Cap</a></div></div>`);
  try {
    await wait(40);
    const text = id => f.window.document.querySelector(`[data-pe-auto="badge"][data-product-id="${id}"]`).shadowRoot.textContent;
    assert.match(text('42'), /Few/, 'skips the ended and future offers, then the first that lists the product wins');
    assert.match(text('43'), /Everything/, 'an offer on every product covers the rest');
    assert.equal(proxyCalls(f).length, 0);
  } finally { f.dom.window.close(); }
});
test('Without badge data in the page, badges still ask the app as before', async () => {
  const f = fixture('<div class="card-wrapper"><div class="card__inner"><a href="/products/hat">Hat</a></div></div>');
  try {
    await wait(40);
    assert.ok(proxyCalls(f).length >= 1);
  } finally { f.dom.window.close(); }
});
test('A block Shopify rendered from published data asks the app for nothing: not on load, focus, a returning tab or a timer', async () => {
  const f = fixture('<promotion-engine data-placement="header" data-snapshot-state="ready" data-server-rendered="true" data-promotion-id="7" data-render-key="k" data-revision="r"><div data-pe-initial><span>Header offer</span></div><template data-pe-style><style></style></template><span hidden data-pe-ready></span></promotion-engine><promotion-engine data-placement="collection" data-snapshot-state="ready" hidden></promotion-engine>');
  try {
    await wait(30);
    const header = f.window.document.querySelector('promotion-engine[data-placement="header"]');
    assert.match(header.shadowRoot.textContent, /Header offer/);
    f.window.dispatchEvent(new f.window.Event('focus'));
    f.window.document.dispatchEvent(new f.window.Event('visibilitychange'));
    await wait(30);
    assert.equal(proxyCalls(f).length, 0, 'no request');
    assert.equal(header.timer, undefined, 'no timer');
    assert.equal(f.window.document.querySelector('promotion-engine[data-placement="collection"]').hidden, true, 'nothing to show stays hidden without asking');
  } finally { f.dom.window.close(); }
});
test('A product offer that depends on the chosen variant still asks when the variant changes, and others do not', async () => {
  const markup = scoped => `<promotion-engine data-placement="product" data-product-id="7" data-variant-id="8" data-snapshot-state="ready" ${scoped ? 'data-variant-scoped="true"' : ''} hidden></promotion-engine>`;
  for (const scoped of [true, false]) {
    const f = fixture(markup(scoped));
    try {
      await wait(30);
      assert.equal(proxyCalls(f).length, 0, 'nothing is requested on load');
      f.window.document.dispatchEvent(new f.window.CustomEvent('variant:change', { detail: { productId: '7', variant: { id: 9 } } }));
      await wait(30);
      assert.equal(proxyCalls(f).length, scoped ? 1 : 0, scoped ? 'a variant-scoped offer asks for the new variant' : 'an offer on the whole product does not');
    } finally { f.dom.window.close(); }
  }
});
