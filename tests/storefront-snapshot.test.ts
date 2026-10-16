import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Liquid } from "liquidjs";
import { JSDOM } from "jsdom";
import { promotionInlineCss, promotionCss } from "../app/modules/promotions/components/PromotionPreview";
import { publicSnapshotEntry, syncStorefrontSnapshot } from "../app/modules/promotions/services/storefrontSnapshot.server";
import { mapDiscountToPromotion } from "../app/modules/promotions/mappers/promotionMapper";
import { defaultDesign } from "../app/modules/promotions/design/design";
import type { ShopifyDiscountNode } from "../app/modules/promotions/types/discount";
import type { getLatestPromotionSettings } from "../app/modules/promotions/services/promotionSettings.server";
const now = Date.parse("2026-10-09T12:00:00Z");
function promotion(id = 1) {
  const node: ShopifyDiscountNode = { id: `gid://shopify/DiscountNode/${id}`, events: { nodes: [] }, discount: { __typename: "DiscountCodeBasic", title: `Offer ${id}`, status: "ACTIVE", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-20T00:00:00Z", discountClasses: ["ORDER"], codes: { nodes: [{ code: `CODE${id}` }] }, context: { __typename: "DiscountBuyerSelectionAll", all: "ALL" }, customerGets: { value: { __typename: "DiscountPercentage", percentage: .1 }, items: { __typename: "AllDiscountItems", allItems: true } } } };
  const result = mapDiscountToPromotion(node);
  Object.assign(result.settings, { websiteEnabled: true, headline: `Offer ${id}`, showHeaderBanner: true, showCollectionPage: true, showProductPage: true, showProductBadge: true, showCountdown: true, designJson: JSON.stringify({ ...defaultDesign(), desktopImage: 'https://cdn.shopify.com/s/files/1/123/banner.webp?v=1', mobileImage: 'https://cdn.shopify.com/s/files/1/123/mobile.webp?v=2', imageLayout: 'full' }) });
  return { result, node };
}
const liquid = new Liquid({ root: 'extensions/promotion-engine/snippets', extname: '.liquid' });
liquid.registerFilter('asset_url', (value: string) => '/assets/' + value);
const snippet = readFileSync('extensions/promotion-engine/snippets/server-promotion.liquid', 'utf8');
// Shopify's now filter and server time are fixed for eligibility boundary tests.
liquid.registerFilter('date', (value: string, format: string) => format === '%s' ? (value === 'now' ? now / 1000 : Date.parse(value) / 1000) : value);
async function render(promotions: ReturnType<typeof publicSnapshotEntry>[], placement = 'collection', extra = {}) {
  return liquid.parseAndRender(snippet, { snapshot: { version: 2, revision: 'revision', css: promotionCss, inlineCss: promotionInlineCss, promotions }, placement, block: { settings: { spacing: 0 } }, current_collection: { id: 42 }, ...extra });
}
test('Liquid renders the priority winner initially and hides empty, expired, future and nonqualifying placements without a reserved gap', async () => {
  const high = publicSnapshotEntry(promotion(1).result, now)!;
  const low = publicSnapshotEntry(promotion(2).result, now)!;
  let markup = await render([high, low]);
  assert.match(markup, /data-promotion-id="gid:\/\/shopify\/DiscountNode\/1"/);
  assert.match(markup, /<div data-pe-initial>/);
  assert.match(markup, /srcSet=.*width=390/);
  assert.match(markup, /fetchpriority="high"/);
  assert.match(markup, /media="\(max-width: 600px\)"/);
  assert.ok(!/<promotion-engine\s+hidden/.test(markup));
  for (const entries of [[], [{ ...high, ends: now / 1000 }], [{ ...high, starts: now / 1000 + 1 }], [{ ...high, all: false, collections: ['99'] }]]) {
    markup = await render(entries);
    assert.match(markup, /<promotion-engine\s+hidden/);
    assert.ok(!markup.includes('data-pe-initial'));
    assert.ok(!markup.includes('min-height'));
  }
  markup = await render([{ ...high, starts: now / 1000 + 1 }, low]);
  assert.match(markup, /DiscountNode\/2/);
  assert.match(await render([{ ...high, all: false, collections: ['42'] }]), /data-pe-initial/);
});
test('Liquid follows collection, whole product and selected variant scope with correct fallback priority', async () => {
  const high = { ...publicSnapshotEntry(promotion(1).result, now)!, all: false, products: [], collections: [], variants: [{ id: '8', product: '7' }] };
  const low = publicSnapshotEntry(promotion(2).result, now)!;
  const product = { id: 7, collections: [{ id: 42 }], selected_or_first_available_variant: { id: 8 } };
  assert.match(await render([high, low], 'product', { current_product: product }), /DiscountNode\/1/);
  assert.match(await render([high, low], 'product', { current_product: { ...product, selected_or_first_available_variant: { id: 9 } } }), /DiscountNode\/2/);
  assert.match(await render([{ ...high, variants: [], collections: ['42'] }], 'product', { current_product: product }), /data-pe-initial/);
  assert.match(await render([{ ...high, variants: [], products: ['7'] }], 'product', { current_product: product }), /data-pe-initial/);
  assert.match(await render([high], 'collection'), /<promotion-engine\s+hidden/);
});
test('public snapshot excludes restricted, draft, expired and codeless offers, and includes future schedules for Liquid date checks', () => {
  const { result } = promotion();
  const restricted = structuredClone(result);
  restricted.shopify.customers.appliesToAllCustomers = false;
  restricted.shopify.customers.customers = [{ id: 'gid://shopify/Customer/99', name: 'Private buyer' }];
  assert.equal(publicSnapshotEntry(restricted, now), null);
  assert.equal(publicSnapshotEntry({ ...result, settings: { ...result.settings, websiteEnabled: false } }, now), null);
  assert.equal(publicSnapshotEntry({ ...result, endsAt: new Date(now).toISOString() }, now), null);
  assert.equal(publicSnapshotEntry({ ...result, code: null }, now), null);
  assert.ok(publicSnapshotEntry({ ...result, status: 'SCHEDULED', startsAt: new Date(now + 60000).toISOString() }, now));
  assert.ok(!JSON.stringify(publicSnapshotEntry(result, now)).includes('customers'));
});
test('snapshot publication uses compare-and-set, retries concurrent saves and surfaces real Shopify failures', async () => {
  const { result, node } = promotion();
  result.endsAt = null; node.discount.endsAt = null;
  const rows = [{ ...result.settings, id: 1, shop: 'test.myshopify.com', shopifyDiscountId: result.id, createdAt: new Date(0), updatedAt: new Date(0), lastSyncedAt: null }] as Awaited<ReturnType<typeof getLatestPromotionSettings>>;
  let writes = 0, digest = 'before', failure = false;
  const api = { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
    if (query.includes('PromotionInstallation')) return Response.json({ data: { currentAppInstallation: { id: 'gid://shopify/AppInstallation/1', metafield: { value: '', compareDigest: digest } } } });
    if (query.includes('GetDiscount')) return Response.json({ data: { discountNode: node } });
    const input = (options!.variables!.metafields as Array<{ compareDigest: string; value: string }>)[0];
    assert.equal(input.compareDigest, digest);
    assert.equal(JSON.parse(input.value).promotions.length, 1);
    writes++;
    if (writes === 1) { digest = 'after'; return Response.json({ data: { metafieldsSet: { userErrors: [{ code: 'STALE_OBJECT', message: 'Concurrent save' }] } } }); }
    return Response.json({ data: { metafieldsSet: { userErrors: failure ? [{ code: 'INVALID_VALUE', message: 'Cannot publish' }] : [] } } });
  } };
  await syncStorefrontSnapshot(api, 'test.myshopify.com', async () => rows);
  assert.equal(writes, 2);
  failure = true;
  await assert.rejects(syncStorefrontSnapshot(api, 'test.myshopify.com', async () => rows), /Cannot publish/);
});
test('initial promotion stays visible while a delayed proxy validates it and is not rebuilt when both renderers agree', async () => {
  const dom = new JSDOM('<promotion-engine data-server-rendered="true" data-placement="collection" data-promotion-id="offer" data-revision="revision" data-render-key="render"><div data-pe-initial>Initial offer</div><template data-pe-style><style></style></template><span hidden data-pe-ready></span></promotion-engine>', { url: 'https://shop.example/', runScripts: 'outside-only' });
  const { window } = dom;
  window.matchMedia = query => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return true; } });
  let resolve: (result: Response) => void = () => {};
  window.fetch = () => new Promise<Response>(done => { resolve = done; });
  window.eval(readFileSync('extensions/promotion-engine/assets/promotion-engine.js', 'utf8'));
  const element = window.document.querySelector('promotion-engine') as HTMLElement & { shadowRoot: ShadowRoot };
  try {
    assert.equal(element.hidden, false);
    const content = element.shadowRoot.querySelector('[data-pe-initial]');
    assert.equal(content?.textContent, 'Initial offer');
    resolve(Response.json({ promotionId: 'offer', revision: 'revision', renderKey: 'render', html: '<div>Live offer</div>', endsAt: null }));
    await new Promise(done => setTimeout(done, 20));
    assert.equal(element.hidden, false);
    assert.equal(element.shadowRoot.querySelector('[data-pe-initial]'), content);
    element.remove();
  } finally { window.close(); }
});
test('an empty initial block stays hidden during loading, while a failed check preserves a public initial offer until expiry', async () => {
  for (const native of [false, true]) {
    const dom = new JSDOM(native ? '<promotion-engine data-server-rendered="true" data-placement="collection"><template shadowrootmode="open"><div>Public offer</div></template></promotion-engine>' : '<promotion-engine hidden data-placement="collection"></promotion-engine>', { url: 'https://shop.example/', runScripts: 'outside-only' });
    const { window } = dom;
    window.matchMedia = query => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return true; } });
    let fail: (error: Error) => void = () => {};
    window.fetch = () => new Promise<Response>((_resolve, reject) => { fail = reject; });
    window.eval(readFileSync('extensions/promotion-engine/assets/promotion-engine.js', 'utf8'));
    const element = window.document.querySelector('promotion-engine') as HTMLElement;
    try {
      assert.equal(element.hidden, !native);
      fail(new Error('Network unavailable'));
      await new Promise(done => setTimeout(done, 20));
      assert.equal(element.hidden, !native);
      assert.equal(element.style.minHeight, '');
      if (native) assert.match(element.shadowRoot!.textContent!, /Public offer/);
    } finally { window.close(); }
  }
});
test('a live empty response removes an initial offer, while an updated code replaces same-ID initial content', async () => {
  for (const empty of [false, true]) {
    const dom = new JSDOM('<promotion-engine data-server-rendered="true" data-placement="collection" data-promotion-id="offer" data-revision="revision" data-render-key="old"><template shadowrootmode="open"><div>Old code</div></template></promotion-engine>', { url: 'https://shop.example/', runScripts: 'outside-only' });
    const { window } = dom;
    window.matchMedia = query => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return true; } });
    window.fetch = async () => Response.json({ promotionId: empty ? null : 'offer', revision: 'revision', renderKey: 'new', html: empty ? '' : '<div>New code</div>', css: '', endsAt: null });
    window.eval(readFileSync('extensions/promotion-engine/assets/promotion-engine.js', 'utf8'));
    try {
      await new Promise(done => setTimeout(done, 20));
      const element = window.document.querySelector('promotion-engine') as HTMLElement;
      assert.equal(element.hidden, empty);
      assert.ok(!element.shadowRoot!.textContent!.includes('Old code'));
      if (!empty) assert.match(element.shadowRoot!.textContent!, /New code/);
    } finally { window.close(); }
  }
});
test('actual app blocks pass snapshot into their isolated snippet and render banner HTML before any script runs', async () => {
  const entry = publicSnapshotEntry(promotion().result, now)!;
  const snapshot = { version: 2, revision: 'saved', inlineCss: promotionInlineCss, css: promotionCss, promotions: [entry] };
  for (const name of ['collection-promotion', 'product-promotion', 'header-promotion', 'promotion']) {
    const block = readFileSync(`extensions/promotion-engine/blocks/${name}.liquid`, 'utf8').split('{% schema %}')[0];
    const html = await liquid.parseAndRender(block, { app: { metafields: { promotion_engine: { storefront: { value: snapshot } } } }, collection: { id: 42 }, product: { id: 7, selected_or_first_available_variant: { id: 8 } }, block: { settings: { placement: 'collection' } } });
    const dom = new JSDOM(html);
    try {
      const host = dom.window.document.querySelector('promotion-engine') as HTMLElement;
      assert.equal(host.hidden, false, name);
      assert.equal(host.dataset.snapshotState, 'ready', name);
      assert.ok(host.querySelector('[data-pe-initial] .pe-promo'), name);
      assert.ok(!host.shadowRoot, name);
      assert.equal(host.style.display, 'block', name);
    } finally { dom.window.close(); }
  }
});
test('initial HTML styles are scoped inside promotions, including media queries, and header wrapper spans its row', () => {
  const dom = new JSDOM(`<style>${promotionInlineCss}</style><style>${readFileSync('extensions/promotion-engine/assets/promotion-layout.css', 'utf8')}</style><div class="pe-header-app-block"><promotion-engine data-placement="header"></promotion-engine></div>`);
  try {
    const inspect = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if ('cssRules' in rule) inspect((rule as CSSMediaRule).cssRules);
        else for (const selector of (rule as CSSStyleRule).selectorText.split(',')) assert.ok(selector.trim().startsWith('promotion-engine[data-server-rendered="true"]'), selector);
      }
    };
    inspect(dom.window.document.styleSheets[0].cssRules);
    const computed = dom.window.getComputedStyle(dom.window.document.querySelector('.pe-header-app-block')!);
    assert.equal(computed.width, '100%');
    assert.equal(computed.maxWidth, 'none');
    assert.equal(computed.flex, '1 1 100%');
  } finally { dom.window.close(); }
});
test('an early custom element upgrade leaves the initial light DOM visible until the parser finishes all banner children', async () => {
  const dom = new JSDOM('', { url: 'https://shop.example/', runScripts: 'outside-only' });
  const { window } = dom;
  window.matchMedia = query => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return true; } });
  let calls = 0;
  window.fetch = () => { calls++; return new Promise<Response>(() => {}); };
  window.eval(readFileSync('extensions/promotion-engine/assets/promotion-engine.js', 'utf8'));
  const host = window.document.createElement('promotion-engine');
  host.dataset.serverRendered = 'true';
  host.dataset.placement = 'header';
  try {
    window.document.body.append(host);
    host.innerHTML = '<div data-pe-initial>Initial announcement</div><template data-pe-style><style></style></template>';
    await new Promise(done => setTimeout(done, 15));
    assert.equal(host.shadowRoot, null);
    assert.equal(host.hidden, false);
    assert.match(host.textContent!, /Initial announcement/);
    assert.equal(calls, 0);
    host.insertAdjacentHTML('beforeend', '<span hidden data-pe-ready></span>');
    await new Promise(done => setTimeout(done, 15));
    assert.equal(host.hidden, false);
    assert.match(host.shadowRoot!.textContent!, /Initial announcement/);
    assert.equal(calls, 1);
    host.remove();
  } finally { window.close(); }
});
