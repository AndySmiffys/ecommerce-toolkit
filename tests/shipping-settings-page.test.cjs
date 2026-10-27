/* eslint-env node */
// Mounts the real Shipping countdown settings page in a simulated browser, using the same stand-ins for Shopify's elements as the promotion editor tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');
const { React, find, findAll, byText, type, change, click, wait, toasts, window } = require('./helpers/editor-harness.cjs');
const { createRoot } = require('react-dom/client');
const { createMemoryRouter, RouterProvider, useFetcher } = require('react-router');

const rawPlugin = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: require('node:fs').readFileSync(args.path, 'utf8'), loader: 'text' }));
  },
};
async function loadPage() {
  const result = await build({
    stdin: { contents: "export { ShippingCountdownPage } from './app/modules/shipping/ShippingCountdownPage'; export { defaultShippingConfig } from './app/modules/shipping/config';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false, plugins: [rawPlugin],
  });
  const compiled = new Module(__filename); compiled.paths = module.paths;
  compiled._compile(result.outputFiles[0].text, __filename);
  return compiled.exports;
}

const delivery = {
  version: 1, currency: 'GBP',
  countries: { GB: { free: true, thresholdMinor: 5000, rate: 'Free delivery' }, IE: { free: true, thresholdMinor: 7500, rate: 'Free delivery' }, FR: { free: false } },
  restOfWorld: null,
};

let exportsOf;
async function mountPage({ saved = true, table = delivery, respond } = {}) {
  exportsOf ??= await loadPage();
  const { ShippingCountdownPage, defaultShippingConfig } = exportsOf;
  const container = document.createElement('div'); document.body.appendChild(container);
  const posts = [];
  function Page() {
    const fetcher = useFetcher();
    return React.createElement(ShippingCountdownPage, { initial: defaultShippingConfig, saved, today: '2026-10-27', delivery: table, fetcher });
  }
  const router = createMemoryRouter([{
    path: '/app/shipping-countdown', Component: Page,
    action: async ({ request }) => {
      const data = Object.fromEntries((await request.formData()).entries());
      posts.push(data);
      const config = data.config ? JSON.parse(data.config) : undefined;
      return respond ? respond(data) : { ok: true, intent: data.intent, errors: [], config };
    },
  }], { initialEntries: ['/app/shipping-countdown'] });
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(RouterProvider, { router })); await wait(); });
  return { container, posts, unmount: async () => { await React.act(async () => root.unmount()); router.dispose(); container.remove(); } };
}
const field = (container, tag, label) => findAll(container, tag).find(element => element.getAttribute('label') === label);
const main = container => find(container, '.sc__main').textContent.replace(/\s+/g, ' ').trim();
const save = container => byText(container, 'button', 'Save');

test('the page is laid out like the promotion editor: a preview that stays in view, then numbered step cards, Appearance first', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const steps = findAll(container, 'details[data-step]');
    assert.deepEqual(steps.map(item => item.getAttribute('data-step')), ['appearance', 'dispatch', 'holidays', 'delay', 'free', 'stock', 'warning']);
    assert.deepEqual(steps.filter(item => item.open).map(item => item.getAttribute('data-step')), ['appearance'], 'one step open at a time, the look first');
    const titles = steps.map(item => item.querySelector('summary').textContent.replace(/\s+/g, ' '));
    assert.match(titles[0], /1\s*Appearance/);
    assert.match(titles[5], /6\s*Out of stock and back-order/);
    assert.ok(find(container, '.create-discount-layout aside.desktop-preview-panel'), 'the same two-column layout as the promotion editor');
    assert.match(find(container, 'aside.desktop-preview-panel').textContent, /Storefront preview/);
    assert.ok(find(container, 's-button[data-preview-toggle]'), 'a Preview button for narrow screens');
    assert.ok(find(container, 'details[data-step=appearance] s-select[label="Text alignment"]'), 'the look is in the first card');
    assert.match(find(container, 'details[data-step=dispatch] summary').textContent, /Cut-off 15:00/, 'closed cards summarise their settings');
  } finally { await page.unmount(); }
});

test('the preview shows the real block, and a day and time can be chosen to see it then', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    assert.ok(find(container, 'aside shipping-countdown.sc'), "the block's own markup, with the class the product page gives it");
    assert.equal(find(container, 'aside shipping-countdown').getAttribute('classname'), null, 'no stray attribute');
    // Thursday 24 December, 16:30 London: after the 15:00 cut-off, so the order goes out on Friday.
    await type(field(container, 's-date-field', 'Preview day and time (London): date'), '2026-12-24', 'change');
    await change(field(container, 's-select', 'Hour'), '16');
    await change(field(container, 's-select', 'Minute'), '30');
    assert.equal(main(container), 'Order in the next 22 hours 30 minutes for dispatch on Friday 25 Dec');
    assert.match(find(container, 'aside').textContent, /Showing Thursday 24 Dec, 16:30/);
    // Before the cut-off the same day goes out the same day.
    await change(field(container, 's-select', 'Hour'), '10');
    assert.equal(main(container), 'Order in the next 4 hours 30 minutes for dispatch on Thursday 24 Dec');
    // Back to the real clock.
    await click(byText(container, 's-button', 'Use the current time'));
    assert.match(find(container, 'aside').textContent, /Showing now/);
    assert.equal(byText(container, 's-button', 'Use the current time'), undefined);
  } finally { await page.unmount(); }
});

test('the preview can show each stock case, with its own message', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const stock = field(container, 's-select', 'Stock of the chosen variant');
    assert.deepEqual(findAll(stock, 's-option').map(option => option.textContent), ['In stock', 'Out of stock', 'Zero stock, continue selling']);
    await change(stock, 'out');
    assert.equal(main(container), 'This item is currently out of stock.');
    await change(stock, 'backorder');
    assert.match(main(container), /^Available to order now/);
    await change(stock, 'in');
    assert.match(main(container), /^Order in the next/);
  } finally { await page.unmount(); }
});

test('the two stock cases are set separately: their own wording, and hiding the line', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=stock]');
    assert.match(card.querySelector('summary').textContent, /Out of stock: message/);
    assert.match(card.textContent, /Zero stock, continue selling/);
    assert.match(card.textContent, /Continue selling when out of stock/);
    const message = label => findAll(card, 's-text-area').filter(element => element.getAttribute('label') === 'Message');
    assert.equal(message().length, 2);
    await type(message()[0], 'Sold out, back in January');
    await type(message()[1], 'Order now, ships in two weeks');
    const stock = field(container, 's-select', 'Stock of the chosen variant');
    await change(stock, 'out');
    assert.equal(main(container), 'Sold out, back in January');
    await change(stock, 'backorder');
    assert.equal(main(container), 'Order now, ships in two weeks');
    // Hide the line for zero stock with continue selling only.
    await change(findAll(card, 's-choice-list')[1], ['hide']);
    assert.match(card.querySelector('summary').textContent, /Zero stock, continue selling: hidden/);
    assert.match(find(container, 'aside').textContent, /The block is hidden/);
    await change(stock, 'out');
    assert.equal(main(container), 'Sold out, back in January', 'hiding one case leaves the other');
  } finally { await page.unmount(); }
});

test('changing the look changes the preview at once, and saving sends the settings', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    assert.equal(save(container).disabled, true, 'nothing to save yet');
    await change(field(container, 's-select', 'Text alignment'), 'left');
    assert.ok(find(container, 'aside shipping-countdown[data-align="left"]'));
    await change(field(container, 's-select', 'Border'), 'solid');
    assert.ok(find(container, 'aside shipping-countdown[data-border="solid"]'));
    assert.equal(save(container).disabled, false);
    await click(save(container));
    await wait(60);
    assert.equal(page.posts.length, 1);
    const sent = JSON.parse(page.posts[0].config);
    assert.equal(page.posts[0].intent, 'save');
    assert.deepEqual([sent.style.align, sent.style.border], ['left', 'solid']);
    assert.deepEqual(Object.keys(sent.availability).sort(), ['backorder', 'outOfStock']);
    assert.ok(toasts.includes('Shipping countdown saved'));
  } finally { await page.unmount(); }
});

test('a setting that cannot be saved is explained, and Save waits', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    await type(field(container, 's-text-field', 'Daily cut-off time'), '25:99');
    assert.match(container.textContent, /Cut-off time must be a 24-hour time/);
    assert.equal(save(container).disabled, true);
    assert.match(container.textContent, /Fix the problem shown above the settings to see a preview/);
  } finally { await page.unmount(); }
});

test('free shipping shows what was read from Shopify, and its preview follows the chosen country', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=free]');
    assert.match(card.textContent, /From your Shopify shipping settings/);
    assert.match(card.textContent, /United Kingdom: Free over £50/);
    assert.match(card.textContent, /Ireland: Free over £75/);
    assert.doesNotMatch(card.textContent, /France:/, 'a country with no free delivery is not listed as free');
    assert.match(find(container, 'aside .sc__free').textContent, /Free delivery to United Kingdom on orders over £50/);
    await change(field(container, 's-select', 'Country of the shopper'), 'IE');
    assert.match(find(container, 'aside .sc__free').textContent, /Free delivery to Ireland on orders over £75/);
    await change(field(container, 's-select', 'Country of the shopper'), 'FR');
    assert.equal(find(container, 'aside .sc__free'), null, 'nothing to say where there is no free delivery');
    await change(field(container, 's-select', 'Stock of the chosen variant'), 'out');
    await change(field(container, 's-select', 'Country of the shopper'), 'GB');
    assert.equal(find(container, 'aside .sc__free'), null, 'an item that cannot be bought is not an offer');
  } finally { await page.unmount(); }
});

test('before shipping has been read from Shopify the page says so', async () => {
  const page = await mountPage({ table: null, saved: false });
  try {
    const { container } = page;
    assert.ok(find(container, 's-banner[heading="Free delivery has not been read from Shopify yet"]'));
    assert.ok(find(container, 's-banner[heading="Nothing is saved yet"]'));
    assert.equal(find(container, 'aside .sc__free'), null);
    assert.equal(field(container, 's-select', 'Country of the shopper'), undefined, 'no countries to choose from');
    assert.equal(save(container).disabled, false, 'a first save is allowed with the starting values');
  } finally { await page.unmount(); }
});

test('the Preview button opens the same preview in a modal on narrow screens', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    assert.equal(findAll(document, 's-modal shipping-countdown').length, 0, 'closed until asked for');
    await click(find(container, 's-button[data-preview-toggle]'));
    await wait(60);
    assert.equal(findAll(document, 's-modal shipping-countdown').length, 1);
    assert.match(find(document, 's-modal').textContent, /Storefront preview/);
  } finally { await page.unmount(); }
});

void window;
