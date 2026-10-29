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
async function mountPage({ saved = true, respond, patch = null } = {}) {
  exportsOf ??= await loadPage();
  const { PriceDisplayPage, defaultPriceDisplay } = exportsOf;
  const container = document.createElement('div'); document.body.appendChild(container);
  const posts = [];
  function Page() {
    const fetcher = useFetcher();
    return React.createElement(PriceDisplayPage, { initial: patch ? { ...defaultPriceDisplay, ...patch } : defaultPriceDisplay, saved, fetcher });
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
  return { now: find(host, '.dp__now')?.textContent ?? null, was: find(host, '.dp__was')?.textContent ?? null, save: find(host, '.dp__save')?.textContent ?? null, code: find(host, '.dp__code')?.textContent ?? null };
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
    assert.deepEqual(shown(container), { now: '£16.00', was: '£20.00', save: null, code: null }, 'an automatic 20% off £20.00');
    assert.ok(find(host, '.dp__now--sale'));
    await example(container, 'none');
    assert.deepEqual(shown(container), { now: '£20.00', was: null, save: null, code: null });
    assert.equal(find(container, 'aside .dp__now--sale'), null);
    await example(container, 'compare');
    assert.deepEqual(shown(container), { now: '£12.00', was: '£25.00', save: null, code: null }, '20% off £15.00, against the £25.00 it was');
    await example(container, 'code');
    assert.deepEqual(shown(container), { now: '£20.00', was: null, save: null, code: '£15.00 with code SAVE25' }, 'the price does not change until the code is used');
    await example(container, 'both');
    assert.deepEqual(shown(container), { now: '£18.00', was: '£20.00', save: null, code: '£15.00 with code SAVE25' });
  } finally { await page.unmount(); }
});

test('the saving can be switched on and worded, with placeholders that copy, and a typo is pointed out', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const card = find(container, 'details[data-step=wording]');
    assert.equal(find(card, 's-text-field[label="Saving message"]'), null, 'nothing to word while it is off');
    await check(find(card, 's-checkbox[label="Show how much is saved beside the old price"]'), true);
    assert.equal(shown(container).save, 'Save £4.00');
    const rows = findAll(card, 's-table-row').map(row => findAll(row, 's-table-cell').map(cell => cell.textContent.trim()));
    assert.deepEqual(rows.map(row => [row[0], row[2]]), [['{amount}', '£4.00'], ['{percent}', '20'], ['{price}', '£15.00'], ['{code}', 'SAVE25'], ['{amount}', '£5.00'], ['{percent}', '25']], 'the saving ones, then the code ones (which can also say what the code takes off), filled in for the example');
    await type(field(card, 's-text-field', 'Saving message'), '{percent}% off');
    assert.equal(shown(container).save, '20% off');
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
    assert.equal(shown(container).save, 'Save £4.00');
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
    assert.equal(shown(container).save, '20% off');
    assert.equal(find(container, 'aside discounted-price').style.getPropertyValue('--dp-size'), '18px');
    assert.equal(find(container, 'aside discounted-price').style.getPropertyValue('--dp-sale'), '#123456');
    assert.equal(save(container).disabled, true, 'showing what is saved is not a change');
    assert.match(find(container, 'details[data-step=appearance] summary').textContent, /18px/);
  } finally { await page.unmount(); }
});
