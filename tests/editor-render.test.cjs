/* eslint-env node */
/* global globalThis */
// Renders the real promotion editor in jsdom, drives it, and checks what it produces. The recorded
// output (tests/editor-render.golden.json) catches any change to the editor's behaviour or markup,
// which is how the editor was safely split into smaller files. Run with UPDATE_GOLDEN=1 to re-record
// after an intended change.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const Module = require('node:module');
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');
const React = require('react');

const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.example/app/promotions/new', pretendToBeVisual: true });
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event, ResizeObserver: ResizeObserverStub, IS_REACT_ACT_ENVIRONMENT: true });
dom.window.ResizeObserver = ResizeObserverStub;
class SaveBar extends HTMLElement { show() { this.open = true; } hide() { this.open = false; } }
dom.window.customElements.define('ui-save-bar', SaveBar);
// Polaris fields expose their value as a property, which React 18 does not set on unknown elements.
class Field extends HTMLElement {
  get value() { return this.currentValue ?? this.getAttribute('value') ?? ''; }
  set value(value) { this.currentValue = value; }
  get checked() { return this.currentChecked ?? this.hasAttribute('checked'); }
  set checked(value) { this.currentChecked = value; }
  get values() { return this.currentValues ?? []; }
  set values(value) { this.currentValues = value; }
}
for (const tag of ['s-text-field', 's-number-field', 's-text-area', 's-search-field', 's-color-field', 's-date-field', 's-select', 's-choice-list', 's-checkbox']) {
  dom.window.customElements.define(tag, class extends Field {});
}
dom.window.shopify = { toast: { show() {} }, resourcePicker: async () => undefined };
const { createRoot } = require('react-dom/client');
const { createMemoryRouter, RouterProvider } = require('react-router');

const rawPlugin = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, args => ({ path: require('node:path').resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: fs.readFileSync(args.path, 'utf8'), loader: 'text' }));
  },
};
const goldenFile = 'tests/editor-render.golden.json';
const golden = fs.existsSync(goldenFile) ? JSON.parse(fs.readFileSync(goldenFile, 'utf8')) : {};
const recorded = {};
const normalise = value => value.replace(/(:r|-r)[0-9a-z]+:?/g, '$1X');
const wait = () => new Promise(resolve => setTimeout(resolve, 30));

async function loadEditor() {
  const result = await build({
    stdin: { contents: "export { PromotionEditor } from './app/modules/promotions/components/PromotionEditor'; export { placeholderDraft } from './app/modules/promotions/design/stepValidation';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false, plugins: [rawPlugin],
  });
  const compiled = new Module(__filename); compiled.paths = module.paths;
  compiled._compile(result.outputFiles[0].text, __filename);
  return compiled.exports;
}

async function mount(Editor, props, url) {
  const container = document.createElement('div'); document.body.appendChild(container);
  const stub = () => ({ key: '', products: [], resources: [], eligibilityResources: [], error: null });
  const router = createMemoryRouter([
    { path: '/app/promotions/new', Component: () => React.createElement(Editor, props), action: stub },
    { path: '/app/promotion-preview', action: stub },
    { path: '/app/promotion-assets', action: stub },
    { path: '/app/link-destinations', loader: stub },
  ], { initialEntries: [url] });
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(RouterProvider, { router })); await wait(); });
  return { container, unmount: async () => { await React.act(async () => root.unmount()); router.dispose(); container.remove(); } };
}
const find = (container, selector) => container.querySelector(selector);
const byText = (container, tag, text) => [...container.querySelectorAll(tag)].find(element => element.textContent.trim() === text);
async function type(element, value, event = 'input') { await React.act(async () => { element.value = value; element.dispatchEvent(new window.Event(event, { bubbles: true })); await wait(); }); }
async function click(element) { await React.act(async () => { element.click(); await wait(); }); }
function record(name, container) {
  const html = normalise(container.innerHTML);
  const text = normalise(container.textContent).replace(/\s+/g, ' ').trim();
  recorded[name] = { hash: crypto.createHash('sha256').update(html).digest('hex'), text };
  if (golden[name]) {
    assert.equal(recorded[name].text, golden[name].text, `${name}: the editor's text changed`);
    assert.equal(recorded[name].hash, golden[name].hash, `${name}: the editor's markup changed`);
  }
}

test('the editor renders every discount type, gates its steps, and keeps its markup', async () => {
  const { PromotionEditor, placeholderDraft } = await loadEditor();
  const base = { products: [], shippingCountries: null };
  const run = async (name, url, props = base) => { const view = await mount(PromotionEditor, props, url); return { ...view, name }; };

  // every discount type opens on its first step
  for (const type of ['product', 'order', 'bxgy', 'shipping']) {
    const view = await run(`create-${type}`, `/app/promotions/new?type=${type}`);
    assert.ok(find(view.container, 'details[data-step=type]').hasAttribute('open'), `${type}: the first step is open`);
    record(`create-${type}`, view.container);
    await view.unmount();
  }

  // steps are gated on completion
  const view = await run('gating', '/app/promotions/new?type=product');
  const next = () => byText(view.container, 's-button', 'Continue to discount value');
  assert.ok(next().hasAttribute('disabled'), 'Continue is greyed out until the step is complete');
  assert.match(view.container.textContent, /Complete this step to continue: Enter a discount code/);
  assert.match(find(view.container, 'details[data-step=value] summary').textContent, /Complete the earlier steps first\./);
  find(view.container, 'details[data-step=value] summary').click();
  assert.ok(!find(view.container, 'details[data-step=value]').hasAttribute('open'), 'a locked step cannot be opened');
  record('gating-initial', view.container);

  await type(find(view.container, 's-text-field[label="Discount code"]'), 'spooky20');
  assert.ok(!next().hasAttribute('disabled'), 'a valid code enables Continue');
  assert.match(view.container.textContent, /code spooky20/);
  record('gating-code-entered', view.container);
  await click(next());
  assert.ok(find(view.container, 'details[data-step=value]').hasAttribute('open'), 'Continue opens the next step');
  assert.ok(!find(view.container, 'details[data-step=type]').hasAttribute('open'), 'only one step is open at a time');
  assert.ok(byText(view.container, 's-button', 'Continue to who can use it').hasAttribute('disabled'), 'the value step needs a value and a selection');
  record('gating-value-step', view.container);

  await view.unmount();

  // switching to an automatic discount asks for a title instead of a code

  const automatic = await run('automatic', '/app/promotions/new?type=order');
  const methods = find(automatic.container, 's-choice-list[label="Discount method"]');
  await React.act(async () => { methods.values = ['automatic']; methods.dispatchEvent(new window.Event('change', { bubbles: true })); await wait(); });
  assert.ok(find(automatic.container, 's-text-field[label="Title"]'), 'automatic discounts ask for a title');
  record('create-order-automatic', automatic.container);
  await automatic.unmount();

  // a saved promotion opens with every step filled in and unlocked
  const draft = {
    ...placeholderDraft({ discountType: 'product', method: 'code', codeMode: 'single' }),
    discountCode: 'SAVE20', appliesTo: 'collections', selectedProducts: [],
    selectedCollections: [{ id: 'gid://shopify/Collection/1', title: 'Halloween', handle: 'halloween' }],
    buySelection: [], getSelection: [], selectedEligibility: [], countryMode: 'all',
  };
  const saved = await run('edit', '/app/promotions/new', { ...base, promotionId: 'gid://shopify/DiscountNode/1', shopifyStatus: 'ACTIVE', initialDiscount: draft });
  assert.ok(!byText(saved.container, 's-button', 'Continue to discount value').hasAttribute('disabled'), 'a saved promotion is not gated');
  assert.equal(find(saved.container, 'details[data-step=value] summary').getAttribute('aria-disabled'), null);
  assert.match(saved.container.textContent, /20% off|SAVE20/);
  record('edit-product', saved.container);
  await saved.unmount();

  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(goldenFile, JSON.stringify(recorded, null, 1) + '\n');
  else if (!Object.keys(golden).length) assert.fail('tests/editor-render.golden.json is missing; run with UPDATE_GOLDEN=1');
});
