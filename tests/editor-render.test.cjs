/* eslint-env node */
// Renders the real promotion editor in jsdom, drives it, and checks what it produces. The recorded
// output (tests/editor-render.golden.json) catches any change to the editor's behaviour or markup,
// which is how the editor was safely split into smaller files. Run with UPDATE_GOLDEN=1 to re-record
// after an intended change.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { loadEditor, mount, find, byText, type, click, change } = require('./helpers/editor-harness.cjs');

const goldenFile = 'tests/editor-render.golden.json';
const golden = fs.existsSync(goldenFile) ? JSON.parse(fs.readFileSync(goldenFile, 'utf8')) : {};
const recorded = {};
const normalise = value => value.replace(/(:r|-r)[0-9a-z]+:?/g, '$1X');

function record(name, container) {
  const html = normalise(container.innerHTML);
  const text = normalise(container.textContent).replace(/\s+/g, ' ').trim();
  recorded[name] = { hash: crypto.createHash('sha256').update(html).digest('hex'), text };
  if (golden[name] && !process.env.UPDATE_GOLDEN) {
    assert.equal(recorded[name].text, golden[name].text, `${name}: the editor's text changed`);
    assert.equal(recorded[name].hash, golden[name].hash, `${name}: the editor's markup changed`);
  }
}

test('the editor renders every discount type, gates its steps, and keeps its markup', async () => {
  const { PromotionEditor, placeholderDraft } = await loadEditor();
  const base = { products: [], shippingCountries: null };
  const run = (url, props = base) => mount(PromotionEditor, props, url);

  // every discount type opens on its first step
  for (const discountType of ['product', 'order', 'bxgy', 'shipping']) {
    const view = await run(`/app/promotions/new?type=${discountType}`);
    assert.ok(find(view.container, 'details[data-step=type]').hasAttribute('open'), `${discountType}: the first step is open`);
    record(`create-${discountType}`, view.container);
    await view.unmount();
  }

  // steps are gated on completion
  const view = await run('/app/promotions/new?type=product');
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
  const automatic = await run('/app/promotions/new?type=order');
  await change(find(automatic.container, 's-choice-list[label="Discount method"]'), ['automatic']);
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
  const saved = await run('/app/promotions/new', { ...base, promotionId: 'gid://shopify/DiscountNode/1', shopifyStatus: 'ACTIVE', initialDiscount: draft });
  assert.ok(!byText(saved.container, 's-button', 'Continue to discount value').hasAttribute('disabled'), 'a saved promotion is not gated');
  assert.equal(find(saved.container, 'details[data-step=value] summary').getAttribute('aria-disabled'), null);
  assert.match(saved.container.textContent, /20% off|SAVE20/);
  record('edit-product', saved.container);
  await saved.unmount();

  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(goldenFile, JSON.stringify(recorded, null, 1) + '\n');
  else if (!Object.keys(golden).length) assert.fail('tests/editor-render.golden.json is missing; run with UPDATE_GOLDEN=1');
});
