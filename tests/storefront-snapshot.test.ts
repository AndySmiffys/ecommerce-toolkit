import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Liquid } from "liquidjs";
import { JSDOM } from "jsdom";
import { promotionInlineCss, promotionCss } from "../app/modules/promotions/components/PromotionPreview";
import { companionMetafields, publicSnapshotEntry, splitSnapshot, syncStorefrontSnapshot } from "../app/modules/promotions/services/storefrontSnapshot.server";
import { mapDiscountToPromotion } from "../app/modules/promotions/mappers/promotionMapper";
import { defaultDesign } from "../app/modules/promotions/design/design";
import { encodeIds, decodeIds } from "../app/modules/promotions/design/compactIds";
import { completeDiscountScope } from "../app/modules/promotions/services/discountScope.server";
import { collectionCacheState, collectionProductIds, collectionProductLimit, forgetCollectionProducts } from "../app/modules/promotions/services/collectionProducts.server";
import type { ShopifyDiscountNode } from "../app/modules/promotions/types/discount";
import type { getLatestPromotionSettings } from "../app/modules/promotions/services/promotionSettings.server";
const now = Date.parse("2026-10-09T12:00:00Z");
function promotion(id = 1) {
  const node: ShopifyDiscountNode = { id: `gid://shopify/DiscountNode/${id}`, events: { nodes: [] }, discount: { __typename: "DiscountCodeBasic", title: `Offer ${id}`, status: "ACTIVE", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-20T00:00:00Z", discountClasses: ["ORDER"], codes: { nodes: [{ code: `CODE${id}` }] }, context: { __typename: "DiscountBuyerSelectionAll", all: "ALL" }, customerGets: { value: { __typename: "DiscountPercentage", percentage: .1 }, items: { __typename: "AllDiscountItems", allItems: true } } } };
  const result = mapDiscountToPromotion(node);
  Object.assign(result.settings, { websiteEnabled: true, headline: `Offer ${id}`, showHeaderBanner: true, showCollectionPage: true, showProductPage: true, showProductBadge: true, showCountdown: true, designJson: JSON.stringify({ ...defaultDesign(), desktopImage: 'https://cdn.shopify.com/s/files/1/123/banner.webp?v=1', mobileImage: 'https://cdn.shopify.com/s/files/1/123/mobile.webp?v=2', imageLayout: 'full' }) });
  return { result, node };
}
// The per-promotion lists as the theme sees them: app.metafields.promotion_engine.scope_<id>.value
const scopeMetafields = (scopes: Record<string, unknown>) => Object.fromEntries(Object.entries(scopes).map(([id, value]) => [`scope_${id}`, { value }]));
const liquid = new Liquid({ root: 'extensions/promotion-engine/snippets', extname: '.liquid' });
liquid.registerFilter('asset_url', (value: string) => '/assets/' + value);
const snippet = readFileSync('extensions/promotion-engine/snippets/server-promotion.liquid', 'utf8');
// Shopify's now filter and server time are fixed for eligibility boundary tests.
liquid.registerFilter('date', (value: string, format: string) => format === '%s' ? (value === 'now' ? now / 1000 : Date.parse(value) / 1000) : value);
async function render(promotions: ReturnType<typeof publicSnapshotEntry>[], placement = 'collection', extra = {}) {
  // Published as Shopify gets it: the small snapshot plus the product lists in their own metafield.
  const split = splitSnapshot(promotions as NonNullable<ReturnType<typeof publicSnapshotEntry>>[], 'revision');
  return liquid.parseAndRender(snippet, { snapshot: { version: 3, revision: 'revision', css: promotionCss, inlineCss: promotionInlineCss, promotions: split.promotions }, metafields: scopeMetafields(split.scopes), placement, block: { settings: { spacing: 0 } }, current_collection: { id: 42 }, ...extra });
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
  const split = splitSnapshot([entry], 'saved');
  const snapshot = { version: 3, revision: 'saved', inlineCss: promotionInlineCss, css: promotionCss, promotions: split.promotions };
  for (const name of ['collection-promotion', 'product-promotion', 'header-promotion', 'promotion']) {
    const block = readFileSync(`extensions/promotion-engine/blocks/${name}.liquid`, 'utf8').split('{% schema %}')[0];
    const html = await liquid.parseAndRender(block, { app: { metafields: { promotion_engine: { storefront: { value: snapshot }, ...scopeMetafields(split.scopes) } } }, collection: { id: 42 }, product: { id: 7, selected_or_first_available_variant: { id: 8 } }, block: { settings: { placement: 'collection' } } });
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

// A discount on specific products: the node as Shopify returns it, with `count` of them in the first page.
function productScoped(count: number, hasNextPage = false) {
  const { node } = promotion(1);
  node.discount.discountClasses = ["PRODUCT"];
  const nodes = Array.from({ length: count }, (_, i) => ({ id: `gid://shopify/Product/${1000000000000 + i * 7}`, title: `Product ${i}` }));
  node.discount.customerGets!.items = { __typename: "DiscountProducts", products: { pageInfo: { hasNextPage, endCursor: hasNextPage ? "cursor-1" : null }, nodes }, productVariants: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } as never;
  return { node, result: mapDiscountToPromotion(node) };
}
const noNextPage = { hasNextPage: false, endCursor: null };
test('product ID lists are packed small and unpacked exactly, including ids beyond 32 bits and duplicates', () => {
  const ids = [8123456789012, 8123456789013, 42, 8123456789012, 15000000000000];
  assert.deepEqual(decodeIds(encodeIds(ids)), [42, 8123456789012, 8123456789013, 15000000000000]);
  assert.equal(encodeIds([]), '');
  assert.deepEqual(decodeIds(''), []);
  const many = Array.from({ length: 7000 }, (_, i) => 7000000000000 + i * 1234567);
  assert.equal(decodeIds(encodeIds(many)).length, 7000);
  assert.ok(encodeIds(many).length < JSON.stringify(many.map(String)).length / 2, 'well under half the plain size');
});
test('a discount on thousands of products reaches the storefront in full instead of falling back to the live server', async () => {
  const { node } = productScoped(250, true);
  const pages = [[250, true], [250, true], [130, false]] as const;
  let requested = 0;
  const api = { graphql: async (_query: string, options?: { variables?: Record<string, unknown> }) => {
    const [size, more] = pages[requested++];
    assert.equal(options!.variables!.productsAfter, `cursor-${requested}`);
    const nodes = Array.from({ length: size }, (_, i) => ({ id: `gid://shopify/Product/${2000000000000 + requested * 1000 + i}`, title: 'More' }));
    return Response.json({ data: { discountNode: { discount: { customerGets: { items: { products: { pageInfo: { hasNextPage: more, endCursor: `cursor-${requested + 1}` }, nodes }, productVariants: { pageInfo: noNextPage, nodes: [] } } } } } } });
  } };
  assert.deepEqual(await completeDiscountScope(api, node), { complete: true });
  assert.equal(requested, 3);
  assert.equal(mapDiscountToPromotion(node).shopify.products.products.length, 250 + 250 + 250 + 130);
});
test('a scope page Shopify cannot return leaves the offer on the live path rather than showing it to the wrong products', async () => {
  const { node } = productScoped(250, true);
  const failing = { graphql: async () => Response.json({ errors: [{ message: 'Throttled' }] }) };
  assert.deepEqual(await completeDiscountScope(failing, node), { complete: false });
  const { result } = productScoped(250, true);
  Object.assign(result.settings, { websiteEnabled: true, showProductPage: true, showCollectionPage: true, showHeaderBanner: true, showProductBadge: true });
  const entry = publicSnapshotEntry(result, now, false)!;
  assert.ok(entry.html.header, 'the header does not depend on product scope');
  assert.ok(!entry.html.product && !entry.html.badge && !entry.html.collection, 'scoped placements wait for a complete list');
});
test('the published pieces: a small snapshot, the long lists on their own, and compact badge data', () => {
  const { result } = productScoped(1200);
  Object.assign(result.settings, { websiteEnabled: true, showProductPage: true, showProductBadge: true, showCollectionPage: true, showHeaderBanner: true });
  const entry = publicSnapshotEntry(result, now)!;
  assert.ok(entry.html.product && entry.html.badge, 'a long list is not a reason to skip a placement');
  const everything = promotion(2).result;
  Object.assign(everything.settings, { websiteEnabled: true, showProductBadge: true });
  const collections = promotion(3);
  collections.node.discount.discountClasses = ["PRODUCT"];
  collections.node.discount.customerGets!.items = { __typename: "DiscountCollections", collections: { pageInfo: noNextPage, nodes: [{ id: 'gid://shopify/Collection/5', title: 'Hats', productsCount: { count: 3 } }] } } as never;
  const byCollection = mapDiscountToPromotion(collections.node);
  Object.assign(byCollection.settings, { websiteEnabled: true, showProductBadge: true });
  const split = splitSnapshot([entry, publicSnapshotEntry(everything, now)!, publicSnapshotEntry(byCollection, now)!], 'rev');
  assert.ok(split.promotions.every(promo => !('products' in promo) && !('collections' in promo) && !('variants' in promo)), 'the snapshot every page reads carries no long lists');
  assert.equal(split.scopes['1'].products!.length, 1200);
  assert.ok(!('2' in split.scopes), 'an offer on every product needs no list');
  assert.deepEqual(split.badgeIndex.keys, ['1', '2'], 'badges follow specific products or all products, not collections');
  assert.deepEqual(Object.keys(split.badgeShards), ['1', '2']);
  const shards = Object.values(split.badgeShards).map(shard => JSON.parse(shard));
  assert.equal(decodeIds(shards[0].i).length, 1200);
  assert.equal(shards[1].a, 1);
  assert.match(split.badgeIndex.css, /\.pe-badge/);
});
test('Liquid finds a product in a long list and marks product offers that depend on the chosen variant', async () => {
  const { result } = productScoped(1200);
  Object.assign(result.settings, { websiteEnabled: true, showProductPage: true });
  const entry = publicSnapshotEntry(result, now)!;
  const listed = entry.products[900];
  const markup = await render([entry], 'product', { current_product: { id: Number(listed), collections: [], selected_or_first_available_variant: { id: 8 } } });
  assert.match(markup, /data-pe-initial/);
  assert.ok(!markup.includes('data-variant-scoped'));
  assert.match(await render([entry], 'product', { current_product: { id: 5, collections: [], selected_or_first_available_variant: { id: 8 } } }), /<promotion-engine\s+hidden/);
  const byVariant = { ...entry, products: [], variants: [{ id: '8', product: '7' }] };
  const hidden = await render([byVariant], 'product', { current_product: { id: 7, collections: [], selected_or_first_available_variant: { id: 9 } } });
  assert.match(hidden, /<promotion-engine\s+hidden/);
  assert.match(hidden, /data-variant-scoped="true"/, 'a hidden offer can still appear when the variant changes');
});
test('publishing writes the snapshot, the product lists and the badge data together, and skips the write when nothing changed', async () => {
  const { result, node } = promotion();
  result.endsAt = null; node.discount.endsAt = null; node.discount.discountClasses = ["PRODUCT"];
  const setProducts = (...ids: string[]) => { node.discount.customerGets!.items = { __typename: "DiscountProducts", products: { pageInfo: noNextPage, nodes: ids.map(id => ({ id: `gid://shopify/Product/${id}`, title: id })) }, productVariants: { pageInfo: noNextPage, nodes: [] } } as never; };
  setProducts('77');
  const rows = [{ ...result.settings, id: 1, shop: 'test.myshopify.com', shopifyDiscountId: result.id, createdAt: new Date(0), updatedAt: new Date(0), lastSyncedAt: null }] as Awaited<ReturnType<typeof getLatestPromotionSettings>>;
  const current: Record<string, string> = {};
  const writes: Array<Array<{ key: string; type: string; value: string; compareDigest?: string | null }>> = [];
  const api = { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
    if (query.includes('PromotionInstallation')) return Response.json({ data: { currentAppInstallation: { id: 'gid://shopify/AppInstallation/1', metafield: { value: current.storefront ?? '', compareDigest: 'd' }, companions: { nodes: Object.entries(current).filter(([name]) => name !== 'storefront').map(([name, value]) => ({ key: name, value })) } } } });
    if (query.includes('GetDiscount')) return Response.json({ data: { discountNode: node } });
    const metafields = options!.variables!.metafields as typeof writes[number];
    writes.push(metafields);
    for (const field of metafields) current[field.key] = field.value;
    return Response.json({ data: { metafieldsSet: { userErrors: [] } } });
  } };
  await syncStorefrontSnapshot(api, 'test.myshopify.com', async () => rows);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].map(field => `${field.key}:${field.type}`), ['storefront:json', 'scope_1:json', 'badge_1:multi_line_text_field', 'badge_index:json']);
  assert.equal(writes[0][0].compareDigest, 'd');
  assert.equal(JSON.parse(writes[0][0].value).version, 3);
  assert.deepEqual(JSON.parse(writes[0][1].value), { products: ['77'] });
  assert.equal(JSON.parse(writes[0][2].value).i, encodeIds(['77']));
  assert.deepEqual(JSON.parse(writes[0][3].value).keys, ['1']);
  assert.ok(!writes[0][2].value.includes('<'), 'safe to place in a script tag');
  await syncStorefrontSnapshot(api, 'test.myshopify.com', async () => rows);
  assert.equal(writes.length, 1, 'nothing changed, so nothing is written');
  setProducts('77', '78');
  await syncStorefrontSnapshot(api, 'test.myshopify.com', async () => rows);
  assert.equal(writes.length, 2, 'a change to the product list alone is published');
  assert.deepEqual(writes[1].map(field => field.key), ['scope_1', 'badge_1'], 'only what changed is written, and the unchanged snapshot is left alone');
});
test('lists of promotions that are gone are removed, and many promotions are written in batches with the snapshot last', async () => {
  const ids = Array.from({ length: 13 }, (_, i) => i + 1);
  const nodes = new Map(ids.map(id => {
    const { node } = promotion(id);
    node.discount.endsAt = null;
    node.discount.discountClasses = ["PRODUCT"];
    node.discount.customerGets!.items = { __typename: "DiscountProducts", products: { pageInfo: noNextPage, nodes: [{ id: `gid://shopify/Product/${id}00`, title: 'Hat' }] }, productVariants: { pageInfo: noNextPage, nodes: [] } } as never;
    return [`gid://shopify/DiscountNode/${id}`, node];
  }));
  const rows = ids.map(id => ({ ...promotion(id).result.settings, id, shop: 'test.myshopify.com', shopifyDiscountId: `gid://shopify/DiscountNode/${id}`, createdAt: new Date(0), updatedAt: new Date(0), lastSyncedAt: null })) as Awaited<ReturnType<typeof getLatestPromotionSettings>>;
  const calls: Array<{ kind: string; keys: string[] }> = [];
  const api = { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
    if (query.includes('PromotionInstallation')) return Response.json({ data: { currentAppInstallation: { id: 'gid://shopify/AppInstallation/1', metafield: { value: '', compareDigest: 'd' }, companions: { nodes: [{ key: 'scope_99', value: 'old' }, { key: 'badge_99', value: 'old' }, { key: 'unrelated', value: 'keep' }] } } } });
    if (query.includes('GetDiscount')) return Response.json({ data: { discountNode: nodes.get(String(options!.variables!.id)) } });
    if (query.includes('PromotionStale')) { calls.push({ kind: 'delete', keys: (options!.variables!.metafields as Array<{ key: string }>).map(field => field.key) }); return Response.json({ data: { metafieldsDelete: { userErrors: [] } } }); }
    calls.push({ kind: 'set', keys: (options!.variables!.metafields as Array<{ key: string }>).map(field => field.key) });
    return Response.json({ data: { metafieldsSet: { userErrors: [] } } });
  } };
  await syncStorefrontSnapshot(api, 'test.myshopify.com', async () => rows);
  const sets = calls.filter(call => call.kind === 'set');
  assert.deepEqual(sets.map(call => call.keys.length), [25, 2, 1], '27 per-promotion metafields in batches of 25, then the snapshot');
  assert.deepEqual(sets[2].keys, ['storefront'], 'the snapshot goes last, so it only points at lists that exist');
  assert.deepEqual(calls.at(-1), { kind: 'delete', keys: ['scope_99', 'badge_99'] }, 'stale lists go; unrelated metafields stay');
});
test('a promotion with too many products to publish is named in the error instead of failing silently', () => {
  const { result } = productScoped(8000);
  Object.assign(result.settings, { websiteEnabled: true, showProductPage: true });
  const entry = publicSnapshotEntry(result, now)!;
  assert.throws(() => companionMetafields(splitSnapshot([entry], 'rev'), new Map([['1', 'Mega sale']])), /“Mega sale” lists too many products/);
});

test('end to end: the loader embed joins each promotion\'s badge data into the page and the card script shows badges from it without asking the app', async () => {
  const { result: listed } = productScoped(3);
  Object.assign(listed.settings, { websiteEnabled: true, showProductBadge: true, priority: 9 });
  const everything = promotion(2).result;
  Object.assign(everything.settings, { websiteEnabled: true, showProductBadge: true, priority: 1 });
  const split = splitSnapshot([publicSnapshotEntry(listed, now)!, publicSnapshotEntry(everything, now)!], 'rev');
  const shards = Object.fromEntries(Object.entries(split.badgeShards).map(([id, value]) => [`badge_${id}`, { value }]));
  const loader = readFileSync('extensions/promotion-engine/blocks/promotion-loader.liquid', 'utf8').split('{% schema %}')[0];
  const context = (pageType: string) => ({ app: { metafields: { promotion_engine: { badge_index: { value: split.badgeIndex }, ...shards } } }, block: { settings: { badges_enabled: true } }, request: { page_type: pageType }, routes: { root_url: '/' }, collection: { id: 1 } });
  const html = await liquid.parseAndRender(loader, context('collection'));
  const page = new JSDOM(`<body>${html}<div class="card-wrapper" data-product-id="1000000000007"><div class="card__inner"><a href="/products/listed">Listed</a></div></div><div class="card-wrapper" data-product-id="5"><div class="card__inner"><a href="/products/other">Other</a></div></div></body>`, { url: 'https://shop.example/collections/all', runScripts: 'outside-only' });
  try {
    const data = JSON.parse(page.window.document.getElementById('promotion-engine-badges')!.textContent!);
    assert.equal(data.promos.length, 2, 'both promotions are in the one script');
    assert.match(data.css, /\.pe-badge/);
    const requests: string[] = [];
    Object.assign(page.window, { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), fetch: async (url: string) => { requests.push(String(url)); return { ok: true, json: async () => ({}) }; } });
    page.window.eval(readFileSync('extensions/promotion-engine/assets/promotion-engine.js', 'utf8'));
    page.window.eval(readFileSync('extensions/promotion-engine/assets/promotion-placements.js', 'utf8'));
    const embed = page.window.document.createElement('promotion-engine-embed');
    Object.assign(embed.dataset, { badgesEnabled: 'true', root: '/' });
    page.window.document.body.append(embed);
    await new Promise(done => setTimeout(done, 60));
    const badge = (id: string) => page.window.document.querySelector(`[data-pe-auto="badge"][data-product-id="${id}"]`) as HTMLElement;
    assert.equal(badge('1000000000007').hidden, false);
    assert.equal(badge('1000000000007').dataset.promotionId, '1', 'the specific-products offer ranks first for a product it lists');
    assert.equal(badge('5').dataset.promotionId, '2', 'every other product gets the offer on all products');
    assert.deepEqual(requests.filter(url => url.includes('/apps/')), [], 'no request reached the app');
  } finally { page.window.close(); }
  assert.ok(!(await liquid.parseAndRender(loader, context('cart'))).includes('promotion-engine-badges'), 'the cart has no product cards');
  assert.ok(!(await liquid.parseAndRender(loader, context('customers/account'))).includes('promotion-engine-badges'));
});

// A fake Admin API holding collections of products, handing them out a page at a time.
function collectionApi(collections: Record<string, string[]>, throttleFirst = 0) {
  const calls: Array<{ id: string; after: string | null }> = [];
  let throttled = 0;
  const api = { graphql: async (_query: string, options?: { variables?: Record<string, unknown> }) => {
    const id = String(options!.variables!.id);
    const after = (options!.variables!.after as string | null) ?? null;
    calls.push({ id, after });
    if (throttled < throttleFirst) { throttled++; return Response.json({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }); }
    const members = collections[id.split('/').pop()!] ?? [];
    const start = after ? Number(after) : 0;
    const page = members.slice(start, start + 250);
    return Response.json({ data: { collection: { products: { pageInfo: { hasNextPage: start + 250 < members.length, endCursor: String(start + 250) }, nodes: page.map(product => ({ id: `gid://shopify/Product/${product}` })) } } } });
  } };
  return { api, calls };
}
const ids = (count: number, from = 1000) => Array.from({ length: count }, (_, i) => String(from + i));
test('the products in a collection are read in pages, kept for a few minutes, and read again when stale or forgotten', async () => {
  forgetCollectionProducts();
  const { api, calls } = collectionApi({ '5': ids(600), '6': ids(3, 50) });
  const first = await collectionProductIds(api, ['gid://shopify/Collection/5', 'gid://shopify/Collection/6'], 1_000_000);
  assert.equal(first.ids.length, 603);
  assert.deepEqual(first.tooLarge, []);
  assert.equal(calls.length, 4, '600 products are three pages, and the small collection is one');
  await collectionProductIds(api, ['gid://shopify/Collection/5'], 1_000_000 + 5 * 60000);
  assert.equal(calls.length, 4, 'a second publish within minutes reads nothing');
  assert.deepEqual(collectionCacheState(1_000_000 + 5 * 60000), { inUse: true, due: false });
  assert.equal(collectionCacheState(1_000_000 + 11 * 60000).due, true, 'old lists are due to be read again');
  await collectionProductIds(api, ['gid://shopify/Collection/6'], 1_000_000 + 11 * 60000);
  assert.equal(calls.length, 5, 'a stale list is read again');
  assert.equal(forgetCollectionProducts('5'), true, 'a collection that changed is forgotten');
  assert.equal(forgetCollectionProducts('999'), false, 'a collection no promotion uses is ignored');
  await collectionProductIds(api, ['gid://shopify/Collection/5'], 1_000_000 + 12 * 60000);
  assert.equal(calls.length, 8);
  forgetCollectionProducts();
});
test('reading collections waits out Shopify throttling and reports a collection that is too large instead of cutting it short', async () => {
  forgetCollectionProducts();
  const waits: number[] = [];
  const throttled = collectionApi({ '5': ids(3) }, 2);
  const found = await collectionProductIds(throttled.api, ['gid://shopify/Collection/5'], 1, async ms => { waits.push(ms); });
  assert.deepEqual(found.ids, ['1000', '1001', '1002']);
  assert.deepEqual(waits, [1500, 3000], 'it waits a little longer each time');
  forgetCollectionProducts();
  const stuck = collectionApi({ '5': ids(3) }, 100);
  await assert.rejects(collectionProductIds(stuck.api, ['gid://shopify/Collection/5'], 1, async () => {}), /limiting requests/);
  forgetCollectionProducts();
  const huge = collectionApi({ '7': ids(collectionProductLimit + 1) });
  const tooBig = await collectionProductIds(huge.api, ['gid://shopify/Collection/7'], 1, async () => {});
  assert.deepEqual(tooBig, { ids: [], tooLarge: ['gid://shopify/Collection/7'] });
  forgetCollectionProducts();
});
test('end to end: a badge promotion on a collection outranks one on all products for the products it covers, and the rest keep the lower one', async () => {
  const collection = promotion(1);
  collection.node.discount.discountClasses = ["PRODUCT"];
  collection.node.discount.customerGets!.items = { __typename: "DiscountCollections", collections: { pageInfo: noNextPage, nodes: [{ id: 'gid://shopify/Collection/5', title: 'Test Collection 1', productsCount: { count: 2 } }] } } as never;
  const byCollection = mapDiscountToPromotion(collection.node);
  Object.assign(byCollection.settings, { websiteEnabled: true, showProductBadge: true, priority: 9 });
  const everything = promotion(2).result;
  Object.assign(everything.settings, { websiteEnabled: true, showProductBadge: true, priority: 1 });
  // Without the collection's products the collection promotion cannot be matched to a card, as it was before.
  assert.deepEqual(splitSnapshot([publicSnapshotEntry(byCollection, now)!, publicSnapshotEntry(everything, now)!], 'rev').badgeIndex.keys, ['2']);
  forgetCollectionProducts();
  const { api } = collectionApi({ '5': ['100', '101'] });
  const found = await collectionProductIds(api, ['gid://shopify/Collection/5'], now);
  const split = splitSnapshot([publicSnapshotEntry(byCollection, now, true, found.ids)!, publicSnapshotEntry(everything, now)!], 'rev');
  assert.deepEqual(split.badgeIndex.keys, ['1', '2'], 'the higher-ranked collection promotion comes first');
  assert.deepEqual(decodeIds(JSON.parse(split.badgeShards['1']).i), [100, 101], 'its badge lists the products found in the collection');
  assert.ok(!('badgeProducts' in split.promotions[0]), 'the lists are not added to the snapshot every page reads');
  assert.ok(split.scopes['1'].collections, 'Liquid still sees its collection for the product page offer');
  forgetCollectionProducts();
});

test('publishing gives a discount on a collection a badge listing the products in it, reads the collection once, and names a collection that is too large', async () => {
  forgetCollectionProducts();
  const { result, node } = promotion(1);
  result.endsAt = null; node.discount.endsAt = null; node.discount.discountClasses = ["PRODUCT"];
  node.discount.customerGets!.items = { __typename: "DiscountCollections", collections: { pageInfo: noNextPage, nodes: [{ id: 'gid://shopify/Collection/5', title: 'Test Collection 1', productsCount: { count: 2 } }] } } as never;
  const rows = [{ ...result.settings, showProductBadge: true, id: 1, shop: 'test.myshopify.com', shopifyDiscountId: result.id, createdAt: new Date(0), updatedAt: new Date(0), lastSyncedAt: null }] as Awaited<ReturnType<typeof getLatestPromotionSettings>>;
  const members = { current: ids(2, 100) };
  let collectionReads = 0;
  const written: Record<string, string> = {};
  const api = { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
    if (query.includes('PromotionInstallation')) return Response.json({ data: { currentAppInstallation: { id: 'gid://shopify/AppInstallation/1', metafield: { value: '', compareDigest: 'd' }, companions: { nodes: [] } } } });
    if (query.includes('GetDiscount')) return Response.json({ data: { discountNode: node } });
    if (query.includes('CollectionProductIds')) {
      collectionReads++;
      return Response.json({ data: { collection: { products: { pageInfo: noNextPage, nodes: members.current.map(product => ({ id: `gid://shopify/Product/${product}` })) } } } });
    }
    for (const field of options!.variables!.metafields as Array<{ key: string; value: string }>) written[field.key] = field.value;
    return Response.json({ data: { metafieldsSet: { userErrors: [] } } });
  } };
  await syncStorefrontSnapshot(api, 'test.myshopify.com', async () => rows);
  assert.deepEqual(decodeIds(JSON.parse(written.badge_1).i), [100, 101], 'the badge lists the products found in the collection');
  assert.deepEqual(JSON.parse(written.badge_index).keys, ['1']);
  assert.deepEqual(JSON.parse(written.scope_1).collections, ['5'], 'the product page offer still follows the collection');
  assert.ok(!('badgeProducts' in JSON.parse(written.storefront).promotions[0]));
  await syncStorefrontSnapshot(api, 'test.myshopify.com', async () => rows);
  assert.equal(collectionReads, 1, 'a second publish within minutes does not read the collection again');
  forgetCollectionProducts();
  members.current = ids(collectionProductLimit + 1);
  await assert.rejects(syncStorefrontSnapshot(api, 'test.myshopify.com', async () => rows), /targets a collection with more than 9,000 products/);
  forgetCollectionProducts();
});
