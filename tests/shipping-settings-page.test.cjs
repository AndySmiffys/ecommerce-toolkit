/* eslint-env node */
// Mounts the real Shipping countdown settings page in a simulated browser, using the same stand-ins for Shopify's elements as the promotion editor tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');
const { React, find, findAll, byText, type, change, check, click, wait, toasts, window } = require('./helpers/editor-harness.cjs');
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

// The delivery services the app publishes from Shopify's shipping settings, as in the Shipping zones screen: price bands and a delivery time each.
const services = {
  version: 1, currency: 'GBP',
  zones: {
    z0: { name: 'Domestic', services: [
      { name: 'DPD Next Working Day Delivery (Order Before 2pm for Delivery Mon - Fri by 6pm)', tiers: [{ from: 0, price: 699 }, { from: 3000, price: 499 }], transit: { minDays: 1, maxDays: 1 } },
      { name: 'Amazon 2 Day (Order Before 2pm) Non Guaranteed', tiers: [{ from: 0, price: 399 }, { from: 3000, price: 0 }], transit: { minDays: 2, maxDays: 2 } },
      { name: 'Collection', tiers: [{ from: 0, price: 0 }] },
    ] },
    z1: { name: 'Ireland', services: [] },
  },
  countries: { GB: 'z0', IE: 'z1' },
  restOfWorld: null,
};
const DPD = 'DPD Next Working Day Delivery (Order Before 2pm for Delivery Mon - Fri by 6pm)';
const AMAZON = 'Amazon 2 Day (Order Before 2pm) Non Guaranteed';
const serviceCard = (container, name) => findAll(container, 'details[data-service]').find(card => card.getAttribute('data-service') === name);
const controls = (card, tag, label) => findAll(card, tag).find(element => element.getAttribute('label') === label);
// Tuesday 20 October, 10:00 London: before the shop's 15:00 cut-off.
async function previewAt(container, date, hour, minute) {
  await type(field(container, 's-date-field', 'Preview day and time (London): date'), date, 'change');
  await change(field(container, 's-select', 'Hour'), hour);
  await change(field(container, 's-select', 'Minute'), minute);
}
const options = container => findAll(container, 'aside .sc__option').map(row => [...row.children].map(item => item.textContent));

let exportsOf;
async function mountPage({ saved = true, table = delivery, respond, services = null, config: patch = null } = {}) {
  exportsOf ??= await loadPage();
  const { ShippingCountdownPage, defaultShippingConfig } = exportsOf;
  const container = document.createElement('div'); document.body.appendChild(container);
  const posts = [];
  function Page() {
    const fetcher = useFetcher();
    return React.createElement(ShippingCountdownPage, { initial: patch ? { ...defaultShippingConfig, ...patch } : defaultShippingConfig, saved, today: '2026-10-27', delivery: table, services, fetcher });
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
// The wording boxes are formatting editors. These find one by its label and write into it the way a person would.
const editorOf = (scope, label, nth = 0) => findAll(scope, '.rt-field').filter(field => field.getAttribute('data-field') === label)[nth];
const boxOf = (scope, label, nth = 0) => find(editorOf(scope, label, nth), '.rt-editor');
const writeIn = async (box, text) => { await React.act(async () => { box.textContent = text; box.dispatchEvent(new window.Event('input', { bubbles: true })); await wait(); }); };
async function selectChars(box, start, end) {
  const walker = document.createTreeWalker(box, 4);
  const place = offset => { let left = offset; walker.currentNode = box; for (let node = walker.nextNode(); node; node = walker.nextNode()) { if (left <= node.textContent.length) return [node, left]; left -= node.textContent.length; } return [box, 0]; };
  const from = place(start); const to = place(end);
  const range = document.createRange(); range.setStart(...from); range.setEnd(...to);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  await React.act(async () => { document.dispatchEvent(new window.Event('selectionchange')); await wait(); });
}
const main = container => find(container, '.sc__main').textContent.replace(/\s+/g, ' ').trim();
const save = container => byText(container, 'button', 'Save');

test('the page is laid out like the promotion editor: a preview that stays in view, then numbered step cards, Appearance first', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const steps = findAll(container, 'details[data-step]');
    assert.deepEqual(steps.map(item => item.getAttribute('data-step')), ['appearance', 'dispatch', 'holidays', 'delivery', 'free', 'stock', 'delay', 'warning', 'banner']);
    assert.deepEqual(steps.filter(item => item.open).map(item => item.getAttribute('data-step')), ['appearance'], 'one step open at a time, the look first');
    const titles = steps.map(item => item.querySelector('summary').textContent.replace(/\s+/g, ' '));
    assert.match(titles[0], /1\s*Appearance/);
    assert.deepEqual(titles.map(title => title.match(/^\d+\s*([A-Za-z -]+?)(?=Cut-off|On|Off|\d|Out of stock:|$)/)?.[0].replace(/\s+/g, ' ').trim()).slice(3), ['4Delivery services', '5Free shipping', '6Out of stock and back-order', '7Warehouse delay', '8Warning notice', '9Header banner'], 'in the order the settings are used');
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
    assert.equal(findAll(card, '.rt-field').length, 2);
    await writeIn(boxOf(card, 'Message', 0), 'Sold out, back in January');
    await writeIn(boxOf(card, 'Message', 1), 'Order now, ships in two weeks');
    const stock = field(container, 's-select', 'Stock of the chosen variant');
    await change(stock, 'out');
    assert.equal(main(container), 'Sold out, back in January');
    await change(stock, 'backorder');
    assert.equal(main(container), 'Order now, ships in two weeks');
    // Hide the line for zero stock with continue selling only.
    await change(findAll(card, 's-choice-list')[1], ['hide']);
    assert.match(card.querySelector('summary').textContent, /Zero stock, continue selling: hidden/);
    assert.match(find(container, 'aside').textContent, /The block is hidden/);
    assert.equal(findAll(card, '.rt-field').length, 1, 'no message to write when the line is hidden');
    await change(stock, 'out');
    assert.equal(main(container), 'Sold out, back in January', 'hiding one case leaves the other');
  } finally { await page.unmount(); }
});

test('every wording is a formatting editor, and only the times and dates stay plain', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const labels = step => findAll(find(container, `details[data-step=${step}]`), '.rt-field').map(item => item.getAttribute('data-field'));
    assert.deepEqual(labels('dispatch'), ['Shipping days prefix', 'Countdown prefix', 'Countdown suffix', 'No dispatch day text', 'Error text']);
    assert.deepEqual(labels('free'), ['Message when under the threshold', 'Message when this item would reach it', 'Message when the cart has reached it']);
    assert.deepEqual(labels('stock'), ['Message', 'Message']);
    assert.deepEqual(labels('delay'), ['Delay message']);
    assert.deepEqual(labels('warning'), [], 'the warning wording appears once the notice is switched on');
    await check(find(container, 'details[data-step=warning] s-checkbox'), true);
    assert.deepEqual(labels('warning'), ['Message']);
    assert.ok(field(container, 's-text-field', 'Daily cut-off time'), 'a time is not wording');
    assert.equal(findAll(container, 's-text-area').filter(item => item.getAttribute('label') === 'Bank holidays (no dispatch)').length, 1, 'nor is a list of dates');
    assert.equal(findAll(container, 's-text-field, s-text-area').filter(item => /message|prefix|suffix|text/i.test(item.getAttribute('label') ?? '') && !/Bank holidays|cut-off/.test(item.getAttribute('label'))).length, 0, 'no plain box is left for wording');
    assert.doesNotMatch(find(container, 'details[data-step=delay]').textContent, /\[highlight\]|\[\/highlight\]/, 'no instructions about tags');
    assert.match(find(container, 'details[data-step=delay]').textContent, /Select words and use Highlight/);
  } finally { await page.unmount(); }
});

test('words made bold or highlighted show in the preview, and are saved', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const dispatch = find(container, 'details[data-step=dispatch]');
    const prefix = boxOf(dispatch, 'Countdown prefix');
    assert.equal(prefix.textContent, 'Order in the next');
    await selectChars(prefix, 9, 12);
    await click(find(editorOf(dispatch, 'Countdown prefix'), '.rt-toolbar button'));
    assert.deepEqual(findAll(prefix, 'strong').map(item => item.textContent), ['the']);
    assert.match(find(container, 'aside .sc__main').innerHTML, /Order in <strong>the<\/strong> next/, 'the preview shows it at once');
    const suffix = boxOf(dispatch, 'Countdown suffix');
    await selectChars(suffix, 0, 3);
    await click(findAll(editorOf(dispatch, 'Countdown suffix'), '.rt-toolbar button')[1]);
    assert.match(find(container, 'aside .sc__main').innerHTML, /<span class="sc__countdown">for<\/span> dispatch on/);
    const stock = find(container, 'details[data-step=stock]');
    await writeIn(boxOf(stock, 'Message', 0), 'Gone');
    await selectChars(boxOf(stock, 'Message', 0), 0, 4);
    await click(find(editorOf(stock, 'Message', 0), '.rt-toolbar button'));
    await change(field(container, 's-select', 'Stock of the chosen variant'), 'out');
    assert.equal(find(container, 'aside .sc__main').innerHTML, '<strong>Gone</strong>', 'every message, not just the dispatch line');
    assert.equal(save(container).disabled, false);
    await click(save(container));
    await wait(60);
    const sent = JSON.parse(page.posts[0].config);
    assert.equal(sent.countdownPrefix, 'Order in [bold]the[/bold] next');
    assert.equal(sent.countdownSuffix, '[highlight]for[/highlight] dispatch on');
    assert.equal(sent.availability.outOfStock.message, '[bold]Gone[/bold]');
    assert.doesNotMatch(container.textContent, /\[bold\]|\[highlight\]/, 'the tags are never on screen');
  } finally { await page.unmount(); }
});

test('the delay message written before there was an editor shows its highlight in the box, and in the preview', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const box = boxOf(find(container, 'details[data-step=delay]'), 'Delay message');
    assert.equal(findAll(box, '.rt-hl').map(item => item.textContent).join(), 'Orders are being dispatched from');
    assert.match(box.textContent, /^Our warehouse is busier than usual\. Orders are being dispatched from$/);
    await change(find(container, 'details[data-step=delay] s-number-field'), '2');
    await type(find(container, 'details[data-step=delay] s-number-field'), '2');
    assert.match(find(container, 'aside .sc__main').innerHTML, /<span class="sc__countdown">Orders are being dispatched from<\/span> <span class="sc__dispatch">/);
  } finally { await page.unmount(); }
});

test('the delivery option name can be used in a message, and a typo is pointed out', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=free]');
    const under = boxOf(card, 'Message when under the threshold');
    const errorOf = () => find(editorOf(card, 'Message when under the threshold'), '.rt-error');
    await writeIn(under, 'Spend {threshold} to unlock {rate}');
    assert.match(find(container, 'aside .sc__free').textContent, /^Spend £50 to unlock Free delivery$/);
    assert.equal(errorOf(), null);
    assert.equal(save(container).disabled, false);
    await writeIn(under, 'Spend {thresold} to unlock {rate}');
    assert.match(errorOf().textContent, /\{thresold\} is not a placeholder\. Use \{threshold\}, \{country\}, \{rate\}\./);
    assert.equal(under.getAttribute('aria-invalid'), 'true');
    assert.equal(save(container).disabled, true, 'a typo cannot be saved');
    assert.match(container.textContent, /uses \{thresold\}, which is not a placeholder/);
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

test('the free delivery step lists the placeholders, with what each becomes for the country in the preview', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=free]');
    assert.match(card.textContent, /Placeholders you can use in these messages/);
    const rows = findAll(card, 's-table-row').map(row => findAll(row, 's-table-cell').map(cell => cell.textContent.trim()));
    assert.deepEqual(rows.map(row => row[0]), ['{threshold}', '{country}', '{rate}']);
    assert.match(rows[0][1], /order total that unlocks free delivery/);
    assert.match(rows[2][1], /name of the free delivery option: the name you gave that service in Delivery services, or its name in your Shopify shipping settings/);
    assert.deepEqual(rows.map(row => row[2]), ['£50', 'United Kingdom', 'Free delivery'], 'examples for the preview country');
    await change(field(container, 's-select', 'Country of the shopper'), 'IE');
    assert.deepEqual(findAll(card, 's-table-row').map(row => findAll(row, 's-table-cell')[2].textContent.trim()), ['£75', 'Ireland', 'Free delivery']);
  } finally { await page.unmount(); }
});

test('{rate} in the preview is the name given to the service in the app, and its example says so', async () => {
  const named = { enabled: false, heading: 'View Delivery Options', buttonSize: 16, buttonAlign: 'left', guaranteedText: 'Delivery by {date}', estimatedText: 'Delivery by {date} (Non-Guaranteed)', services: [{ name: ' free  DELIVERY', label: 'Free standard delivery', show: true, guaranteed: false, cutoffTime: '', days: [false, true, true, true, true, true, false], onBankHolidays: false, transitMin: null, transitMax: null }] };
  const page = await mountPage({ config: { delivery: named, freeShipping: { enabled: true, textUnder: 'Spend {threshold} to get {rate}', textAdd: 'Add this', textOver: 'Done' } } });
  try {
    const { container } = page;
    assert.match(find(container, 'aside .sc__free').textContent, /^Spend £50 to get Free standard delivery$/, 'the name given to the service, not Shopify\'s "Free delivery"');
    const card = find(container, 'details[data-step=free]');
    const rows = findAll(card, 's-table-row').map(row => findAll(row, 's-table-cell').map(cell => cell.textContent.trim()));
    assert.equal(rows[2][2], 'Free standard delivery');
  } finally { await page.unmount(); }
});

test('clicking a placeholder copies it, and says so', async () => {
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied.push(value); } } });
  toasts.length = 0;
  const page = await mountPage();
  try {
    const card = find(page.container, 'details[data-step=free]');
    assert.match(card.textContent, /Click a placeholder to copy it/);
    const buttons = findAll(card, 's-table-row s-button');
    assert.deepEqual(buttons.map(button => button.textContent), ['{threshold}', '{country}', '{rate}']);
    await click(buttons[2]);
    await click(buttons[0]);
    assert.deepEqual(copied, ['{rate}', '{threshold}']);
    assert.deepEqual(toasts, ['Copied {rate}', 'Copied {threshold}']);
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('blocked'); } } });
    toasts.length = 0;
    await click(buttons[1]);
    assert.deepEqual(toasts, ['Could not copy. Type it in braces instead.'], 'when the browser will not allow it, the merchant is told what to do instead');
  } finally { await page.unmount(); }
});

test('the delivery step has the switch, a link to the Shipping page right under it, the placeholders above the messages, and no month setting', async () => {
  const page = await mountPage({ services });
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=delivery]');
    assert.match(card.querySelector('summary').textContent, /Delivery services/);
    assert.match(card.querySelector('summary').textContent, /Off/);
    assert.equal(find(find(container, 'aside'), '.sc__delivery'), null, 'nothing on the product page until it is turned on');
    const checkbox = find(card, 's-checkbox');
    await check(checkbox, true);
    assert.match(card.querySelector('summary').textContent, /On, 3 of 3 services shown/);
    // The link comes straight after the switch, before anything else.
    const link = find(card, 's-link');
    assert.match(link.textContent, /Set up your delivery services on the Shipping page/);
    assert.match(link.getAttribute('href'), /\/app\/shipping/);
    assert.equal(checkbox.compareDocumentPosition(link) & window.Node.DOCUMENT_POSITION_FOLLOWING, window.Node.DOCUMENT_POSITION_FOLLOWING);
    const firstMessage = find(card, '.rt-field');
    const placeholders = find(card, 's-table');
    assert.ok(placeholders, 'the list of placeholders');
    assert.equal(placeholders.compareDocumentPosition(firstMessage) & window.Node.DOCUMENT_POSITION_FOLLOWING, window.Node.DOCUMENT_POSITION_FOLLOWING, 'the placeholders come before the message boxes');
    assert.deepEqual(findAll(card, '.rt-field').map(item => item.getAttribute('data-field')), ['Button text', 'Message for a guaranteed service', 'Message for a service that is not guaranteed']);
    assert.equal(findAll(card, 's-checkbox').length, 1, 'no month checkbox: it is always shown');
    assert.doesNotMatch(card.textContent, /Show the month/);
    // The services themselves are set up on the Shipping page, not here.
    assert.equal(findAll(container, 'details[data-service]').length, 0);
    assert.match(card.textContent, /3 of 3 delivery services are switched on/);
    assert.match(card.textContent, /set per service on the Shipping page/);
  } finally { await page.unmount(); }
});

test('with delivery options on, the preview lists each service with its price and date, and says Non-Guaranteed', async () => {
  const page = await mountPage({ services });
  try {
    const { container } = page;
    await check(find(container, 'details[data-step=delivery] s-checkbox'), true);
    await previewAt(container, '2026-10-20', '10', '00');
    assert.deepEqual(options(container), [
      [DPD, '£6.99, or £4.99 on orders of £30 or more', 'Delivery by Wed 21st Oct (Non-Guaranteed)'],
      [AMAZON, '£3.99, or free on orders of £30 or more', 'Delivery by Thu 22nd Oct (Non-Guaranteed)'],
    ], 'soonest first; Collection has no delivery time, so no date');
    assert.equal(find(container, 'aside .sc__delivery-heading').textContent, 'View Delivery Options', 'the default words on the button');
    await change(field(container, 's-select', 'Stock of the chosen variant'), 'out');
    assert.equal(find(container, 'aside .sc__delivery'), null, 'none for something that cannot be dispatched');
    await change(field(container, 's-select', 'Stock of the chosen variant'), 'in');
    await change(field(container, 's-select', 'Country of the shopper'), 'IE');
    assert.equal(find(container, 'aside .sc__delivery'), null, 'a country whose zone offers nothing');
  } finally { await page.unmount(); }
});

test('the delivery messages can be formatted, use their own placeholders, and a typo is pointed out', async () => {
  const page = await mountPage({ services });
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=delivery]');
    await check(find(card, 's-checkbox'), true);
    await previewAt(container, '2026-10-20', '10', '00');
    assert.deepEqual(findAll(card, '.rt-field').map(item => item.getAttribute('data-field')), ['Button text', 'Message for a guaranteed service', 'Message for a service that is not guaranteed']);
    const rows = findAll(card, 's-table-row').map(row => findAll(row, 's-table-cell').map(cell => cell.textContent.trim()));
    assert.deepEqual(rows.map(row => row[0]), ['{date}', '{from}', '{service}', '{cutoff}']);
    assert.deepEqual(rows.map(row => row[2]), ['Wed 21st Oct', 'Wed 21st Oct', DPD, '3pm'], 'filled in for the first service in the preview, the cut-off being the shop\'s');
    await writeIn(boxOf(card, 'Message for a service that is not guaranteed'), '{service}: arrives {from} to {date}');
    assert.equal(options(container)[0][2], DPD + ': arrives Wed 21st Oct to Wed 21st Oct');
    await writeIn(boxOf(card, 'Message for a service that is not guaranteed'), 'Arrives {dat}');
    assert.match(find(editorOf(card, 'Message for a service that is not guaranteed'), '.rt-error').textContent, /\{dat\} is not a placeholder\. Use \{date\}, \{from\}, \{service\}, \{cutoff\}\./);
    assert.equal(save(container).disabled, true);
    await writeIn(boxOf(card, 'Message for a service that is not guaranteed'), 'No date at all');
    assert.match(container.textContent, /must include \{date\} \(or \{from\}\)/);
    // Copy a placeholder.
    const copied = [];
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied.push(value); } } });
    await click(findAll(card, 's-table-row s-button')[0]);
    assert.deepEqual(copied, ['{date}']);
  } finally { await page.unmount(); }
});

test('what is saved for the services is used by the preview, and saving here never changes it', async () => {
  const saved = [
    { name: DPD, label: 'DPD Next Day', show: true, guaranteed: true, cutoffTime: '16:00', days: [false, true, true, true, true, true, true], onBankHolidays: false, transitMin: null, transitMax: null },
    { name: AMAZON, label: '', show: true, guaranteed: false, cutoffTime: '', days: [false, true, true, true, true, true, false], onBankHolidays: false, transitMin: 3, transitMax: 4 },
    { name: 'Collection', label: '', show: false, guaranteed: false, cutoffTime: '', days: [false, true, true, true, true, true, false], onBankHolidays: false, transitMin: null, transitMax: null },
  ];
  const page = await mountPage({ services, config: { delivery: { enabled: true, heading: 'Delivery options', buttonSize: 16, buttonAlign: 'left', guaranteedText: 'Delivery by {date}', estimatedText: 'Delivery by {date} (Non-Guaranteed)', services: saved } } });
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=delivery]');
    assert.match(card.querySelector('summary').textContent, /On, 2 of 3 services shown/, 'one is hidden');
    // Friday 15:30: the shop's 15:00 has passed, this service's own 16:00 has not, and a Saturday carrier delivers on Saturday.
    await previewAt(container, '2026-10-23', '15', '30');
    assert.deepEqual(options(container).map(row => [row[0], row[2]]), [['DPD Next Day', 'Delivery by Sat 24th Oct'], [AMAZON, 'Delivery by Fri 30th Oct (Non-Guaranteed)']], 'guaranteed has no suffix; the typed 3 to 4 business days replace Shopify\'s two');
    await writeIn(boxOf(card, 'Button text'), 'Ways to get it');
    await click(save(container));
    await wait(60);
    const sent = JSON.parse(page.posts[0].config);
    assert.equal(sent.delivery.heading, 'Ways to get it');
    assert.deepEqual(sent.delivery.services, saved, 'what the page last saw is passed on unchanged; the server keeps what is saved on the Shipping page anyway');
  } finally { await page.unmount(); }
});

test('the button that opens the delivery options has its own words, size and position, in the preview and when saved', async () => {
  const page = await mountPage({ services });
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=delivery]');
    await check(find(card, 's-checkbox'), true);
    assert.deepEqual(findAll(card, '.rt-field').map(item => item.getAttribute('data-field')), ['Button text', 'Message for a guaranteed service', 'Message for a service that is not guaranteed']);
    assert.equal(boxOf(card, 'Button text').textContent, 'View Delivery Options', 'the default words');
    assert.match(editorOf(card, 'Button text').textContent, /opens the list of delivery options/);
    const button = () => find(container, 'aside .sc__delivery');
    assert.equal(button().getAttribute('data-button-align'), 'left');
    assert.equal(button().style.getPropertyValue('--sc-delivery-size'), '16px');
    await writeIn(boxOf(card, 'Button text'), 'See how it can reach you');
    assert.equal(find(container, 'aside .sc__delivery-heading').textContent, 'See how it can reach you');
    await type(controls(card, 's-number-field', 'Button text size (px)'), '20');
    assert.equal(button().style.getPropertyValue('--sc-delivery-size'), '20px');
    await change(controls(card, 's-select', 'Button position'), 'center');
    assert.equal(button().getAttribute('data-button-align'), 'center');
    await type(controls(card, 's-number-field', 'Button text size (px)'), '9');
    assert.match(container.textContent, /button text size must be a whole number from 10 to 32/);
    assert.equal(save(container).disabled, true);
    await type(controls(card, 's-number-field', 'Button text size (px)'), '20');
    await selectChars(boxOf(card, 'Button text'), 0, 3);
    await click(find(editorOf(card, 'Button text'), '.rt-toolbar button'));
    assert.equal(find(container, 'aside .sc__delivery-heading strong').textContent, 'See', 'the words can be formatted too');
    await click(save(container));
    await wait(60);
    const sent = JSON.parse(page.posts[0].config).delivery;
    assert.deepEqual([sent.heading, sent.buttonSize, sent.buttonAlign], ['[bold]See[/bold] how it can reach you', 20, 'center']);
  } finally { await page.unmount(); }
});

test('before the services have been read from Shopify the step says so, and a saved setting is still used', async () => {
  const page = await mountPage({ services: null });
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=delivery]');
    await check(find(card, 's-checkbox'), true);
    assert.match(card.textContent, /The services have not been read from Shopify yet/);
    assert.equal(findAll(container, 'details[data-service]').length, 0);
    assert.equal(find(container, 'aside .sc__delivery'), null);
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

test('the preview lists the options in the order set on the Shipping page, and saving here keeps that order', async () => {
  const listed = name => ({ name, label: '', show: true, guaranteed: false, cutoffTime: '', days: [false, true, true, true, true, true, false], onBankHolidays: false, transitMin: null, transitMax: null });
  const delivery = sort => ({ enabled: true, heading: 'View Delivery Options', buttonSize: 16, buttonAlign: 'left', sort, guaranteedText: 'Delivery by {date}', estimatedText: 'Delivery by {date} (Non-Guaranteed)', services: [listed('Collection'), listed(AMAZON), listed(DPD)] });
  const soonest = await mountPage({ services, config: { delivery: delivery('soonest') } });
  try {
    await previewAt(soonest.container, '2026-10-20', '10', '00');
    assert.deepEqual(options(soonest.container).map(row => row[0]), [DPD, AMAZON], 'soonest first');
  } finally { await soonest.unmount(); }
  const manual = await mountPage({ services, config: { delivery: delivery('manual') } });
  try {
    const { container } = manual;
    await previewAt(container, '2026-10-20', '10', '00');
    assert.deepEqual(options(container).map(row => row[0]), [AMAZON, DPD], 'the order set, though DPD arrives sooner (Collection has no delivery time, so no line)');
    await writeIn(boxOf(find(container, 'details[data-step=delivery]'), 'Button text'), 'Ways to get it');
    await click(save(container));
    await wait(60);
    assert.equal(JSON.parse(manual.posts[0].config).delivery.sort, 'manual', 'the page passes on the order it was given; the server keeps what is saved on the Shipping page');
  } finally { await manual.unmount(); }
});

test('the dates in the preview are in the dispatch colour, like the dispatch date, and the words round them are not', async () => {
  const page = await mountPage({ services });
  try {
    const { container } = page;
    await check(find(container, 'details[data-step=delivery] s-checkbox'), true);
    await previewAt(container, '2026-10-20', '10', '00');
    const rows = findAll(container, 'aside .sc__option-date');
    assert.equal(rows[0].innerHTML, 'Delivery by <span class="sc__dispatch">Wed 21st Oct</span> (Non-Guaranteed)');
    assert.equal(find(container, 'aside .sc__main .sc__dispatch').textContent.length > 0, true, 'the dispatch date is the same class');
  } finally { await page.unmount(); }
});

test('the header banner step: switched on it shows in the preview above the product page, in its own colours, and is saved', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=banner]');
    assert.match(card.querySelector('summary').textContent, /Header banner\s*Off/);
    assert.equal(find(container, 'aside shipping-countdown-banner'), null, 'nothing in the preview while it is off');
    assert.equal(find(card, '.rt-field'), null, 'and nothing to set');
    await previewAt(container, '2026-10-20', '10', '00');
    await check(find(card, 's-checkbox'), true);
    assert.match(card.querySelector('summary').textContent, /On · 14px text · centre/);
    const banner = find(container, 'aside shipping-countdown-banner');
    assert.ok(banner, "the block's own markup");
    assert.equal(banner.getAttribute('classname'), null, 'no stray attribute');
    assert.equal(banner.textContent.replace(/\s+/g, ' ').trim(), 'Order in the next 5 hours for dispatch on Tuesday 20 Oct');
    assert.equal(find(banner, '.sc__countdown').textContent, '5 hours', 'the time left takes the highlight colour');
    assert.equal(find(banner, '.sc__dispatch').textContent, 'Tuesday 20 Oct', 'and the day its own');
    assert.equal(banner.getAttribute('data-align'), 'center');
    assert.equal(banner.style.getPropertyValue('--scb-bg'), '#00507a');
    assert.equal(banner.style.getPropertyValue('--scb-highlight'), '#ffa3c8');
    assert.ok(banner.compareDocumentPosition(find(container, 'aside shipping-countdown')) & 4, 'the header comes before the product page block');
    const rows = findAll(card, 's-table-row').map(row => findAll(row, 's-table-cell').map(cell => cell.textContent.trim()));
    assert.deepEqual(rows.map(row => [row[0], row[2]]), [['{time}', '5 hours'], ['{date}', 'Tuesday 20 Oct']]);
    await writeIn(boxOf(card, 'Message'), 'Ships [bold]{date}[/bold]');
    assert.equal(find(container, 'aside shipping-countdown-banner').textContent.trim(), 'Ships Tuesday 20 Oct');
    await change(find(card, 's-select[label="Text alignment"]'), 'left');
    assert.equal(find(container, 'aside shipping-countdown-banner').getAttribute('data-align'), 'left');
    await type(find(card, 's-number-field[label="Text size (px)"]'), '18');
    assert.equal(find(container, 'aside shipping-countdown-banner').style.getPropertyValue('--scb-size'), '18px');
    await type(find(card, 's-color-field[label="Background"]'), '#112233', 'change');
    await type(find(card, 's-color-field[label="Dispatch day"]'), '#ffee00', 'change');
    assert.equal(find(container, 'aside shipping-countdown-banner').style.getPropertyValue('--scb-bg'), '#112233');
    assert.equal(find(container, 'aside shipping-countdown-banner').style.getPropertyValue('--scb-dispatch'), '#ffee00');
    await click(save(container));
    await wait(60);
    const sent = JSON.parse(page.posts[0].config).banner;
    assert.deepEqual(sent, { enabled: true, message: 'Ships [bold]{date}[/bold]', textSize: 18, align: 'left', background: '#112233', text: '#ffffff', highlight: '#ffa3c8', dispatch: '#ffee00' });
  } finally { await page.unmount(); }
});

test('the header banner: a typo in its message is pointed out, and it must say when', async () => {
  const page = await mountPage();
  try {
    const card = find(page.container, 'details[data-step=banner]');
    await check(find(card, 's-checkbox'), true);
    await writeIn(boxOf(card, 'Message'), 'Ships {dat}');
    assert.match(find(editorOf(card, 'Message'), '.rt-error').textContent, /\{dat\} is not a placeholder\. Use \{time\}, \{date\}\./);
    assert.equal(save(page.container).disabled, true);
    await writeIn(boxOf(card, 'Message'), 'No placeholders at all');
    assert.match(page.container.textContent, /must include \{time\} or \{date\}/);
  } finally { await page.unmount(); }
});

test('the header banner: colours that are hard to read are questioned', async () => {
  const page = await mountPage();
  try {
    const card = find(page.container, 'details[data-step=banner]');
    await check(find(card, 's-checkbox'), true);
    const notes = () => (find(card, 's-banner') ? find(card, 's-banner').textContent : '');
    assert.equal(notes(), '', 'the colours it starts with can all be read');
    await type(find(card, 's-color-field[label="Highlight and time left"]'), '#ff3d8b', 'change');
    assert.match(notes(), /Time left on the banner background is [\d.]+ to 1/, 'pink on this blue is flagged, as the product block flags its own colours');
    await type(find(card, 's-color-field[label="Highlight and time left"]'), '#ffffff', 'change');
    assert.doesNotMatch(notes(), /Time left/, 'white on this blue is readable');
    await type(find(card, 's-color-field[label="Background"]'), '#ffffff', 'change');
    assert.match(notes(), /Time left on the banner background is 1\.0 to 1/, 'white on white is not');
    assert.match(notes(), /Text on the banner background is 1\.0 to 1/, 'and neither is the text');
  } finally { await page.unmount(); }
});

test('the header banner: its colours and size can be reset, and it stays on', async () => {
  const page = await mountPage();
  try {
    const card = find(page.container, 'details[data-step=banner]');
    await check(find(card, 's-checkbox'), true);
    await type(find(card, 's-color-field[label="Background"]'), '#112233', 'change');
    await click(byText(card, 's-button', 'Reset the banner colours and size'));
    assert.equal(find(card, 's-color-field[label="Background"]').value, '#00507a');
    assert.equal(find(card, 's-checkbox').checked, true);
  } finally { await page.unmount(); }
});
