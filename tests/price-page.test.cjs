/* eslint-env node */
// Mounts the real Discounted price settings page in a simulated browser, using the same stand-ins for Shopify's elements as the other editor tests.
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
    stdin: { contents: "export { PriceDisplayPage } from './app/modules/price/PriceDisplayPage'; export { defaultPriceDisplay } from './app/modules/price/config';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false, plugins: [rawPlugin],
  });
  const compiled = new Module(__filename); compiled.paths = module.paths;
  compiled._compile(result.outputFiles[0].text, __filename);
  return compiled.exports;
}

let exportsOf;
async function mountPage({ saved = true, respond, patch = null, notShown = undefined, prices = undefined } = {}) {
  exportsOf ??= await loadPage();
  const { PriceDisplayPage, defaultPriceDisplay } = exportsOf;
  const container = document.createElement('div'); document.body.appendChild(container);
  const posts = [];
  function Page() {
    const fetcher = useFetcher();
    return React.createElement(PriceDisplayPage, { initial: patch ? { ...defaultPriceDisplay, ...patch } : defaultPriceDisplay, saved, notShown, prices, fetcher });
  }
  const router = createMemoryRouter([{
    path: '/app/discounted-price', Component: Page,
    action: async ({ request }) => {
      const data = Object.fromEntries((await request.formData()).entries());
      posts.push(data);
      const config = data.config ? JSON.parse(data.config) : undefined;
      return respond ? respond(data) : { ok: true, intent: data.intent, errors: [], config };
    },
  }], { initialEntries: ['/app/discounted-price'] });
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(RouterProvider, { router })); await wait(); });
  return { container, posts, unmount: async () => { await React.act(async () => root.unmount()); router.dispose(); container.remove(); } };
}
const field = (container, tag, label) => findAll(container, tag).find(element => element.getAttribute('label') === label);
const save = container => byText(container, 'button', 'Save');
const shown = container => {
  const host = find(container, 'aside discounted-price');
  return { now: find(host, '.dp__now')?.textContent ?? null, was: find(host, '.dp__was')?.textContent ?? null, save: find(host, '.dp__save')?.textContent ?? null, auto: find(host, '.dp__auto')?.textContent ?? null, code: find(host, '.dp__code')?.textContent ?? null };
};
const example = (container, id) => change(field(container, 's-select', 'Example'), id);

test('the page is laid out like the other editors: a preview that stays in view, then numbered step cards', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const steps = findAll(container, 'details[data-step]');
    assert.deepEqual(steps.map(item => item.getAttribute('data-step')), ['wording', 'appearance']);
    assert.deepEqual(steps.filter(item => item.open).map(item => item.getAttribute('data-step')), ['wording']);
    assert.match(steps[0].querySelector('summary').textContent, /1\s*Savings and codes/);
    assert.match(steps[1].querySelector('summary').textContent, /2\s*Appearance/);
    assert.ok(find(container, '.create-discount-layout aside.desktop-preview-panel'));
    assert.match(find(container, 'aside.desktop-preview-panel').textContent, /Storefront preview/);
    assert.ok(find(container, 's-button[data-preview-toggle]'), 'a Preview button for narrow screens');
    assert.ok(find(container, 's-banner[heading="How the price is worked out"]'), 'how it works is said up front');
    assert.match(container.textContent, /The cart and checkout always decide the final price/);
    assert.equal(save(container).disabled, true, 'nothing to save yet');
  } finally { await page.unmount(); }
});

test('nothing saved yet is said, and the settings are offered for saving', async () => {
  const page = await mountPage({ saved: false });
  try {
    assert.ok(find(page.container, 's-banner[heading="Nothing is saved yet"]'));
    assert.equal(save(page.container).disabled, false);
  } finally { await page.unmount(); }
});

test('the preview is the block itself: its markup, its stylesheet, and the shop\'s sums, for each situation', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const host = find(container, 'aside discounted-price.dp');
    assert.ok(host, "the block's own element with its own class");
    assert.equal(host.getAttribute('classname'), null, 'no stray attribute');
    assert.deepEqual(shown(container), { now: '£20.00', was: null, save: null, auto: '£16.00 with the automatic discount', code: null }, 'an automatic 20% off £20.00, on its own line; the main price is left alone');
    assert.equal(find(container, 'aside .dp__now--sale'), null, 'and is not marked as a sale');
    await example(container, 'none');
    assert.deepEqual(shown(container), { now: '£20.00', was: null, save: null, auto: null, code: null });
    await example(container, 'compare');
    assert.deepEqual(shown(container), { now: '£15.00', was: '£25.00', save: null, auto: null, code: null }, 'a reduction made in Shopify');
    assert.ok(find(host, '.dp__now--sale'));
    await example(container, 'compareAuto');
    assert.deepEqual(shown(container), { now: '£15.00', was: '£25.00', save: null, auto: '£12.00 with the automatic discount', code: null }, '20% off £15.00 on top, on its own line');
    await example(container, 'code');
    assert.deepEqual(shown(container), { now: '£20.00', was: null, save: null, auto: null, code: '£15.00 with code SAVE25' }, 'the price does not change until the code is used');
    await example(container, 'both');
    assert.deepEqual(shown(container), { now: '£20.00', was: null, save: null, auto: '£18.00 with the automatic discount', code: '£15.00 with code SAVE25' }, 'an automatic discount and a code that can be combined, each on its own line');
    await example(container, 'exclusive');
    assert.deepEqual(shown(container), { now: '£20.00', was: null, save: null, auto: '£18.00 with the automatic discount', code: null }, 'an automatic discount that cannot be combined with codes: the code is not a price they can have');
  } finally { await page.unmount(); }
});

test('the automatic discounts that change prices but cannot be shown are listed, with why and a link to each', async () => {
  const list = [{ id: 'gid://shopify/DiscountNode/5', routeId: '5', title: 'Spend and save', reason: 'It needs a minimum spend or quantity, so the price depends on the cart.' }, { id: 'gid://shopify/DiscountNode/6', routeId: '6', title: 'Order amount', reason: 'It takes an amount off the whole order, which is spread over what is in the cart.' }];
  const page = await mountPage({ notShown: list });
  try {
    const banner = find(page.container, 's-banner[heading="Automatic discounts that change prices but cannot be shown here"]');
    assert.ok(banner, 'a warning');
    assert.match(banner.textContent, /Spend and save: It needs a minimum spend or quantity/);
    assert.match(banner.textContent, /Order amount: It takes an amount off the whole order/);
    assert.deepEqual(findAll(banner, 's-link').map(link => link.getAttribute('href').split('/').pop()), ['5', '6']);
    assert.match(banner.textContent, /Shoppers get these in the cart/);
  } finally { await page.unmount(); }
  for (const none of [[], null, undefined]) {
    const quiet = await mountPage({ notShown: none });
    try { assert.equal(find(quiet.container, 's-banner[heading="Automatic discounts that change prices but cannot be shown here"]'), null, 'nothing to warn about'); } finally { await quiet.unmount(); }
  }
});

test('the saving can be switched on and worded, with placeholders that copy, and a typo is pointed out', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=wording]');
    assert.equal(find(card, 's-text-field[label="Saving message"]'), null, 'nothing to word while it is off');
    await check(find(card, 's-checkbox[label="Show how much is saved beside the old price"]'), true);
    await example(container, 'compare');
    assert.equal(shown(container).save, 'Save £10.00');
    await example(container, 'code');
    const rows = findAll(card, 's-table-row').map(row => findAll(row, 's-table-cell').map(cell => cell.textContent.trim()));
    assert.deepEqual(rows.map(row => [row[0], row[2]]), [['{amount}', '£4.00'], ['{percent}', '20'], ['{price}', '£15.00'], ['{amount}', '£5.00'], ['{percent}', '25'], ['{price}', '£15.00'], ['{code}', 'SAVE25'], ['{amount}', '£5.00'], ['{percent}', '25']], 'the saving ones, the automatic discount ones, then the code ones, each filled in for the example');
    await example(container, 'compare');
    await type(field(card, 's-text-field', 'Saving message'), '{percent}% off');
    assert.equal(shown(container).save, '40% off', '£10.00 off the £25.00 it was');
    const copied = [];
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied.push(value); } } });
    await click(findAll(card, 's-table-row s-button')[0]);
    assert.deepEqual(copied, ['{amount}']);
    assert.ok(toasts.includes('Copied {amount}'));
    await type(field(card, 's-text-field', 'Saving message'), 'Save {amont}');
    assert.match(container.textContent, /Saving message uses \{amont\}, which is not a placeholder/);
    assert.equal(save(container).disabled, true, 'it cannot be saved');
    assert.match(container.textContent, /Fix the problem shown above the settings to see a preview/);
    await type(field(card, 's-text-field', 'Saving message'), 'Save {amount}');
    assert.equal(shown(container).save, 'Save £10.00');
  } finally { await page.unmount(); }
});

test('the code message must say the price and the code', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=wording]');
    await example(container, 'code');
    await type(field(card, 's-text-field', 'Code message'), 'Use code {code} and pay {price}');
    assert.equal(shown(container).code, 'Use code SAVE25 and pay £15.00');
    await type(field(card, 's-text-field', 'Code message'), '{percent}% off with {code}: {price} (save {amount})');
    assert.equal(shown(container).code, '25% off with SAVE25: £15.00 (save £5.00)');
    await type(field(card, 's-text-field', 'Code message'), 'Use a code');
    assert.match(container.textContent, /Code message must include \{price\}|Code message must include \{code\}/);
    assert.equal(save(container).disabled, true);
  } finally { await page.unmount(); }
});

test('the look changes the preview at once: size, weight, space and colours', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=appearance]');
    const host = () => find(container, 'aside discounted-price');
    assert.equal(host().style.getPropertyValue('--dp-size'), '', "the theme's own size by default");
    assert.equal(host().style.getPropertyValue('--dp-sale'), '#b12704');
    await type(find(card, 's-number-field[label="Text size (px)"]'), '22');
    assert.equal(host().style.getPropertyValue('--dp-size'), '22px');
    await change(field(card, 's-select', 'Price font weight'), '700');
    assert.equal(host().style.getPropertyValue('--dp-weight'), '700');
    await type(find(card, 's-number-field[label="Space above and below (px)"]'), '12');
    assert.equal(host().style.getPropertyValue('--dp-margin'), '12px');
    await type(find(card, 's-color-field[label="Sale price"]'), '#112233', 'change');
    assert.equal(host().style.getPropertyValue('--dp-sale'), '#112233');
    assert.equal(host().style.getPropertyValue('--dp-text'), 'inherit', "the theme's own text colour until one is chosen");
    await type(find(card, 's-color-field[label="Price with no discount"]'), '#222222', 'change');
    assert.equal(host().style.getPropertyValue('--dp-text'), '#222222');
    await click(byText(card, 's-button', "Use the theme’s text colour for the price"));
    assert.equal(host().style.getPropertyValue('--dp-text'), 'inherit');
  } finally { await page.unmount(); }
});

test('colours that are hard to read on a white page are questioned, and the appearance can be reset', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=appearance]');
    const notes = () => (find(card, 's-banner') ? find(card, 's-banner').textContent : '');
    assert.equal(notes(), '', 'the colours it starts with can all be read');
    await type(find(card, 's-color-field[label="Sale price"]'), '#ffaaaa', 'change');
    assert.match(notes(), /Sale price on its background is [\d.]+ to 1/);
    await type(find(card, 's-number-field[label="Text size (px)"]'), '30');
    await click(byText(card, 's-button', 'Reset the appearance to the original look'));
    assert.equal(notes(), '');
    assert.equal(find(card, 's-color-field[label="Sale price"]').value, '#b12704');
    assert.equal(find(card, 's-number-field[label="Text size (px)"]').value, '0', 'size goes back to the theme\'s own');
    await check(find(find(container, 'details[data-step=wording]'), 's-checkbox'), true);
    await type(find(card, 's-color-field[label="Saving text"]'), '#b12704', 'change');
    assert.match(notes(), /Saving on its background is/, 'the saving\'s text against its own background');
    await click(byText(card, 's-button', 'Reset the appearance to the original look'));
    assert.equal(find(find(container, 'details[data-step=wording]'), 's-checkbox').checked, true, 'the wording is not reset');
  } finally { await page.unmount(); }
});

test('saving sends the settings, says so, and discarding puts back what was saved', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const wording = find(container, 'details[data-step=wording]');
    await check(find(wording, 's-checkbox'), true);
    await type(field(wording, 's-text-field', 'Saving message'), '{percent}% off');
    assert.equal(save(container).disabled, false);
    await click(byText(container, 'button', 'Discard'));
    assert.equal(find(wording, 's-text-field[label="Saving message"]'), null, 'back to what was saved');
    assert.equal(save(container).disabled, true);
    await check(find(wording, 's-checkbox'), true);
    await type(field(wording, 's-text-field', 'Saving message'), '{percent}% off');
    await click(save(container));
    await wait(60);
    assert.equal(page.posts.length, 1);
    assert.equal(page.posts[0].intent, 'save');
    const sent = JSON.parse(page.posts[0].config);
    assert.deepEqual([sent.showSavings, sent.savingsText, sent.size, sent.margin, sent.textColour], [true, '{percent}% off', 0, 0, '']);
    assert.ok(toasts.includes('Discounted price saved'));
    assert.equal(save(container).disabled, true, 'saved');
  } finally { await page.unmount(); }
});

test('a save that fails says why and keeps what was typed', async () => {
  const page = await mountPage({ respond: data => ({ ok: false, intent: data.intent, errors: ['Shopify did not confirm the save.'] }) });
  try {
    const { container } = page;
    const wording = find(container, 'details[data-step=wording]');
    await check(find(wording, 's-checkbox'), true);
    await click(save(container));
    await wait(60);
    assert.match(container.textContent, /Shopify did not confirm the save\./);
    assert.equal(find(wording, 's-checkbox').checked, true);
    assert.equal(save(container).disabled, false, 'it can be tried again');
  } finally { await page.unmount(); }
});

test('settings saved earlier are shown when the page opens', async () => {
  const page = await mountPage({ patch: { showSavings: true, savingsText: '{percent}% off', size: 18, saleColour: '#123456', textColour: '#222222' } });
  try {
    const { container } = page;
    await example(container, 'compare');
    assert.equal(shown(container).save, '40% off');
    assert.equal(find(container, 'aside discounted-price').style.getPropertyValue('--dp-size'), '18px');
    assert.equal(find(container, 'aside discounted-price').style.getPropertyValue('--dp-sale'), '#123456');
    assert.equal(save(container).disabled, true, 'showing what is saved is not a change');
    assert.match(find(container, 'details[data-step=appearance] summary').textContent, /18px/);
  } finally { await page.unmount(); }
});

test('the storefront prices can be updated from the page, without touching the settings', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const button = byText(container, 's-button', 'Update the storefront prices now');
    assert.ok(button, 'a button, with words about when to use it');
    assert.match(container.textContent, /Use this if a change in Shopify has not shown up on a product page/);
    await click(button);
    await wait(60);
    assert.equal(page.posts.length, 1);
    assert.deepEqual(page.posts[0], { intent: 'republish' }, 'only the request, no settings');
    assert.ok(toasts.includes('Storefront prices updated'));
    assert.equal(save(container).disabled, true, 'nothing to save: the settings are untouched');
  } finally { await page.unmount(); }
});

test('an update that fails says why and leaves the settings alone', async () => {
  const page = await mountPage({ respond: data => ({ ok: false, intent: data.intent, errors: ['Shopify is busy. Try again in a moment.'] }) });
  try {
    const { container } = page;
    const wording = find(container, 'details[data-step=wording]');
    await check(find(wording, 's-checkbox'), true);
    await click(byText(container, 's-button', 'Update the storefront prices now'));
    await wait(60);
    assert.match(container.textContent, /Shopify is busy\. Try again in a moment\./);
    assert.equal(find(wording, 's-checkbox').checked, true, 'what was typed is kept');
  } finally { await page.unmount(); }
});

test('the automatic discount line can be worded, has its own placeholders, and a message without the price is refused', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=wording]');
    assert.equal(field(card, 's-text-field', 'Automatic discount message').value, '{price} with the automatic discount');
    assert.equal(shown(container).auto, '£16.00 with the automatic discount');
    await type(field(card, 's-text-field', 'Automatic discount message'), 'Extra {percent}% off at checkout: {price} (save {amount})');
    assert.equal(shown(container).auto, 'Extra 20% off at checkout: £16.00 (save £4.00)');
    assert.equal(shown(container).now, '£20.00', 'the main price is the same');
    await type(field(card, 's-text-field', 'Automatic discount message'), 'Automatic {pricee}');
    assert.match(container.textContent, /Automatic discount message uses \{pricee\}, which is not a placeholder/);
    assert.equal(save(container).disabled, true);
    await type(field(card, 's-text-field', 'Automatic discount message'), 'An automatic discount');
    assert.match(container.textContent, /Automatic discount message must include \{price\}/);
    await type(field(card, 's-text-field', 'Automatic discount message'), '{price} automatically');
    assert.equal(shown(container).auto, '£16.00 automatically');
    await click(save(container));
    await wait(60);
    assert.equal(JSON.parse(page.posts[0].config).autoText, '{price} automatically');
  } finally { await page.unmount(); }
});

test('the automatic discount line has its own colour, questioned when hard to read, and reset with the rest of the appearance', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=appearance]');
    const host = () => find(container, 'aside discounted-price');
    assert.equal(host().style.getPropertyValue('--dp-auto'), '#b12704');
    await type(find(card, 's-color-field[label="Automatic discount line"]'), '#ffcccc', 'change');
    assert.equal(host().style.getPropertyValue('--dp-auto'), '#ffcccc');
    assert.match(find(card, 's-banner').textContent, /Automatic discount on its background is [\d.]+ to 1/);
    await click(byText(card, 's-button', 'Reset the appearance to the original look'));
    assert.equal(host().style.getPropertyValue('--dp-auto'), '#b12704');
  } finally { await page.unmount(); }
});

test('the prices the storefront is using are listed beside what Shopify holds now, so a difference is seen here', async () => {
  const rows = [
    { key: '1', routeId: '1', title: 'Black Friday', kind: 'EXTRA10', now: '10% off', published: '10% off', state: 'matches' },
    { key: '2', routeId: '2', title: 'Auto discount', kind: 'Automatic', now: '10% off', published: '20% off', state: 'outdated' },
    { key: '3', routeId: '3', title: 'Brand new', kind: 'Automatic', now: '£5.00 off each item', published: '', state: 'missing' },
    { key: '9', routeId: null, title: 'Discount 9', kind: 'OLD', now: 'No longer applies', published: '5% off', state: 'stale' },
  ];
  const page = await mountPage({ prices: rows });
  try {
    const section = find(page.container, '[data-section=published-prices]');
    assert.ok(section, 'a section of its own');
    const cells = findAll(section, 's-table-row').map(row => findAll(row, 's-table-cell').map(cell => cell.textContent.trim()));
    assert.deepEqual(cells, [
      ['Black Friday', 'With code EXTRA10', '10% off', '10% off', 'Matches Shopify'],
      ['Auto discount', 'Automatically', '10% off', '20% off', 'Out of date'],
      ['Brand new', 'Automatically', '£5.00 off each item', 'Nothing', 'Not published yet'],
      ['Discount 9', 'With code OLD', 'No longer applies', '5% off', 'No longer applies'],
    ]);
    assert.ok(find(section, `s-banner[heading="The storefront is not using Shopify's latest discounts"]`), 'a warning when any row differs');
    assert.deepEqual(findAll(section, 's-link').map(link => link.getAttribute('href').split('/').pop()), ['1', '2', '3'], 'each links to its promotion; one that no longer exists has no link');
    assert.deepEqual(findAll(section, 's-badge').map(badge => badge.getAttribute('tone')), ['success', 'warning', 'warning', 'warning']);
  } finally { await page.unmount(); }
});

test('when everything matches there is no warning, and with nothing to list or nothing readable the section is left out', async () => {
  const matching = await mountPage({ prices: [{ key: '1', routeId: '1', title: 'Black Friday', kind: 'EXTRA10', now: '10% off', published: '10% off', state: 'matches' }] });
  try {
    const section = find(matching.container, '[data-section=published-prices]');
    assert.ok(section);
    assert.equal(find(section, 's-banner'), null, 'nothing to warn about');
  } finally { await matching.unmount(); }
  for (const none of [[], null, undefined]) {
    const quiet = await mountPage({ prices: none });
    try { assert.equal(find(quiet.container, '[data-section=published-prices]'), null); } finally { await quiet.unmount(); }
  }
});
