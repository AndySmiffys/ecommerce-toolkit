/* eslint-env node */
// Drives the real promotion editor through what a merchant does: fill it in and save, hit a rejected
// save, discard, search and pick resources, and choose customers. Shopify's endpoints are stubbed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadEditor, mount, find, findAll, byText, step, settle, type, change, check, click, toasts, window } = require('./helpers/editor-harness.cjs');

const base = { products: [], shippingCountries: null };
const halloween = { id: 'gid://shopify/Collection/1', title: 'Halloween', handle: 'halloween' };
let editor;
async function loaded() { editor ??= await loadEditor(); return editor; }
const saveButton = view => byText(view.container, 'button', 'Save');
const discardButton = view => byText(view.container, 'button', 'Discard');
function savedDraft(placeholderDraft, change = {}) {
  return {
    ...placeholderDraft({ discountType: 'product', method: 'code', codeMode: 'single' }),
    discountCode: 'SAVE20', appliesTo: 'collections', selectedProducts: [], selectedCollections: [halloween],
    buySelection: [], getSelection: [], selectedEligibility: [], countryMode: 'all', ...change,
  };
}
const savedProps = draft => ({ ...base, promotionId: 'gid://shopify/DiscountNode/1', shopifyStatus: 'ACTIVE', initialDiscount: draft });
const overview = view => find(view.container, '[aria-label="Promotion overview"]');
const field = (view, label) => find(view.container, `s-text-field[label="${label}"]`);
const value = view => find(step(view.container, 'value'), 's-number-field[label="Value"]');

test('a new promotion is filled in, saved, and the merchant lands on it', async () => {
  const { PromotionEditor } = await loaded();
  toasts.length = 0;
  window.shopify.resourcePicker = async () => [halloween];
  const view = await mount(PromotionEditor, base, '/app/promotions/new?type=product', { respond: intent => intent === 'createPromotion' ? { success: true, savedId: 'gid://shopify/DiscountNode/9', redirectId: '9' } : {} });
  assert.ok(!saveButton(view) || saveButton(view).disabled, 'nothing to save yet');

  await type(field(view, 'Discount code'), 'spooky20');
  await click(byText(view.container, 's-button', 'Continue to discount value'));
  await type(value(view), '20');
  await click(byText(step(view.container, 'value'), 's-button', 'Browse'));
  assert.match(view.container.textContent, /20% off 1 selected collection/, 'the summary follows what was entered');
  assert.equal(saveButton(view).disabled, false, 'a complete promotion can be saved');

  await click(saveButton(view));
  await settle(100);
  const [request] = view.requests.filter(item => item.intent === 'createPromotion');
  assert.ok(request, 'the save was sent');
  assert.equal(request.payload.discount.discountType, 'product');
  assert.equal(request.payload.discount.method, 'code');
  assert.equal(request.payload.discount.discountCode, 'spooky20'.toUpperCase());
  assert.equal(request.payload.discount.discountValue, '20');
  assert.deepEqual(request.payload.discount.selectedCollections.map(item => item.id), [halloween.id]);
  assert.equal(request.payload.discount.eligibility, 'all');
  assert.ok(request.payload.requestKey, 'every save carries a key so it can be retried safely');
  assert.ok(request.payload.website, 'the website design travels with the discount');
  assert.deepEqual(toasts, ['Promotion created']);
  assert.equal(view.router.state.location.pathname, '/app/promotions/9', 'the merchant lands on the new promotion');
  await view.unmount();
});

test('a save that Shopify rejects shows why and opens the step it belongs to', async () => {
  const { PromotionEditor } = await loaded();
  toasts.length = 0;
  window.shopify.resourcePicker = async () => [halloween];
  const view = await mount(PromotionEditor, base, '/app/promotions/new?type=product', { respond: intent => intent === 'createPromotion' ? { success: false, error: 'Select at least one product variant.' } : {} });
  await type(field(view, 'Discount code'), 'spooky20');
  await click(byText(view.container, 's-button', 'Continue to discount value'));
  await type(value(view), '20');
  await click(byText(step(view.container, 'value'), 's-button', 'Browse'));
  await click(byText(find(view.container, 'details[data-step=value]'), 's-button', 'Continue to who can use it'));
  assert.ok(step(view.container, 'who').hasAttribute('open'));

  await click(saveButton(view));
  await settle(100);
  const banner = find(view.container, 's-banner[tone=critical]');
  assert.ok(banner, 'the failure is shown in a banner');
  assert.equal(banner.getAttribute('heading'), 'Not saved');
  assert.match(banner.textContent, /Select at least one product variant\./);
  assert.ok(step(view.container, 'value').hasAttribute('open'), 'the step the message belongs to opens');
  assert.deepEqual(toasts, [], 'a failed save is not confirmed');
  assert.equal(view.router.state.location.pathname, '/app/promotions/new', 'the merchant stays on the form');
  await view.unmount();
});

test('discard puts every changed field back as it was saved', async () => {
  const { PromotionEditor, placeholderDraft } = await loaded();
  const view = await mount(PromotionEditor, savedProps(savedDraft(placeholderDraft)), '/app/promotions/new');
  assert.equal(value(view).value, '10');
  assert.ok(saveButton(view).disabled, 'nothing is saved while nothing has changed');

  await type(value(view), '25');
  assert.equal(saveButton(view).disabled, false, 'a change can be saved');
  assert.match(view.container.textContent, /25% off/);
  await click(discardButton(view));
  await settle(50);
  assert.equal(value(view).value, '10', 'the value is back');
  assert.match(view.container.textContent, /10% off/);
  assert.ok(saveButton(view).disabled, 'discarding leaves nothing to save');
  assert.equal(view.requests.length, 0, 'discarding sends nothing to Shopify');
  await view.unmount();
});

test('saving an existing promotion sends an update and confirms with a toast', async () => {
  const { PromotionEditor, placeholderDraft } = await loaded();
  toasts.length = 0;
  const view = await mount(PromotionEditor, savedProps(savedDraft(placeholderDraft)), '/app/promotions/new');
  await type(value(view), '25');
  await click(saveButton(view));
  await settle(100);
  const [request] = view.requests.filter(item => item.intent === 'updatePromotion');
  assert.ok(request, 'an update was sent');
  assert.equal(request.payload.updateRules, true, 'changed discount rules are sent to Shopify');
  assert.equal(request.payload.discount.discountValue, '25');
  assert.equal(request.payload.savedId, undefined);
  assert.deepEqual(toasts, ['Promotion saved']);
  assert.ok(saveButton(view).disabled, 'once saved there is nothing left to save');
  assert.equal(view.router.state.location.pathname, '/app/promotions/new', 'an existing promotion stays open');
  await view.unmount();
});

test('a website-only change does not touch the discount rules', async () => {
  const { PromotionEditor, placeholderDraft } = await loaded();
  const view = await mount(PromotionEditor, savedProps(savedDraft(placeholderDraft)), '/app/promotions/new');
  await change(find(view.container, 's-select[label="Website promotion status"]'), 'enabled');
  assert.ok(saveButton(view).disabled, 'a website with no block chosen cannot be saved');
  await check(find(view.container, 's-checkbox[label="Header"]'));
  assert.ok(saveButton(view).disabled, 'a header with no headline cannot be saved');
  await type(find(view.container, 's-text-field[label="Headline"]'), 'Frightfully good fun');
  await click(saveButton(view));
  await settle(100);
  const [request] = view.requests.filter(item => item.intent === 'updatePromotion');
  assert.ok(request, 'the website change was saved');
  assert.equal(request.payload.updateRules, false, 'the discount rules are left alone');
  assert.equal(request.payload.website.websiteEnabled, true);
  await view.unmount();
});

test('typing in the search box finds collections, and picking one selects it', async () => {
  const { PromotionEditor } = await loaded();
  const view = await mount(PromotionEditor, base, '/app/promotions/new?type=product', {
    respond: (intent, payload, data) => intent === 'searchResources' ? { resources: [{ id: halloween.id, title: 'Halloween', handle: 'halloween', imageUrl: null }, { id: 'gid://shopify/Collection/2', title: 'Hat shop', handle: 'hats', imageUrl: null }] } : {},
  });
  await type(field(view, 'Discount code'), 'spooky20');
  await click(byText(view.container, 's-button', 'Continue to discount value'));
  await type(find(step(view.container, 'value'), 's-text-field[label="Search collections"]'), 'hal');
  await settle(400);
  const search = view.requests.find(item => item.intent === 'searchResources');
  assert.ok(search, 'the search was sent after a pause');
  assert.equal(search.data.query, 'hal');
  assert.equal(search.data.resourceType, 'collection');
  const results = findAll(step(view.container, 'value'), 's-clickable');
  assert.deepEqual(results.map(item => item.textContent.trim()), ['Halloween', 'Hat shop']);
  await click(results[0]);
  assert.match(view.container.textContent, /1 selected collection/);
  assert.ok(byText(step(view.container, 'value'), 's-button', 'Remove'), 'the selection can be removed');
  await click(byText(step(view.container, 'value'), 's-button', 'Remove'));
  assert.doesNotMatch(view.container.textContent, /1 selected collection/);
  await view.unmount();
});

test('customer segments are chosen in the picker and shown on the step', async () => {
  const { PromotionEditor, placeholderDraft } = await loaded();
  const view = await mount(PromotionEditor, savedProps(savedDraft(placeholderDraft)), '/app/promotions/new', {
    respond: intent => intent === 'searchEligibility' ? { eligibilityResources: [{ id: 'gid://shopify/Segment/1', name: 'VIP customers', secondary: '12 customers' }, { id: 'gid://shopify/Segment/2', name: 'Newsletter', secondary: null }] } : {},
  });
  await change(find(step(view.container, 'who'), 's-select[label="Eligibility"]'), 'segments');
  assert.match(view.container.textContent, /Only logged-in customers who belong to a selected segment/);
  assert.equal(saveButton(view).disabled, true, 'an audience with nobody in it cannot be saved');

  await click(byText(step(view.container, 'who'), 's-button', 'Browse'));
  await settle(50);
  const modal = find(view.container, 's-modal[heading="Select customer segments"]');
  assert.ok(modal && modal.isOpen, 'the picker opens');
  const list = find(modal, 's-choice-list');
  assert.deepEqual(findAll(list, 's-choice').map(item => item.textContent.trim()), ['VIP customers (12 customers)', 'Newsletter']);
  await change(list, ['gid://shopify/Segment/1']);
  await click(byText(modal, 's-button', 'Done'));
  await settle(50);
  assert.ok(!modal.isOpen, 'Done closes the picker');
  assert.match(step(view.container, 'who').textContent, /VIP customers/);
  assert.match(view.container.textContent, /1 selected customer segment/);
  assert.equal(saveButton(view).disabled, false, 'a chosen audience can be saved');
  await view.unmount();
});

test('closing the picker with its own close button leaves the form in step', async () => {
  const { PromotionEditor, placeholderDraft } = await loaded();
  const view = await mount(PromotionEditor, savedProps(savedDraft(placeholderDraft, { eligibility: 'segments', selectedEligibility: [] })), '/app/promotions/new');
  await click(byText(step(view.container, 'who'), 's-button', 'Browse'));
  await settle(50);
  const modal = find(view.container, 's-modal[heading="Select customer segments"]');
  assert.ok(modal.isOpen && find(modal, 's-search-field'), 'the picker is open with its content');
  modal.hideOverlay();
  await settle(60);
  assert.equal(findAll(modal, 's-search-field').length, 0, 'the content is removed once the modal has closed');
  await click(byText(step(view.container, 'who'), 's-button', 'Browse'));
  await settle(50);
  assert.ok(modal.isOpen && find(modal, 's-search-field'), 'it can be opened again');
  await view.unmount();
});

test('a generated code list asks for its settings and keeps the website in draft', async () => {
  const { PromotionEditor } = await loaded();
  const view = await mount(PromotionEditor, base, '/app/promotions/new?type=order');
  assert.equal(find(view.container, 's-text-field[label="Code list name"]'), null);
  await change(find(view.container, 's-select[label="Code format"]'), 'bulk');
  assert.ok(find(view.container, 's-text-field[label="Code list name"]'), 'the list needs a name');
  assert.ok(find(view.container, 's-number-field[label="Number of codes"]'), 'and a size');
  assert.match(view.container.textContent, /Keep this promotion in website Draft status/);
  await type(find(view.container, 's-text-field[label="Code list name"]'), 'Halloween');
  assert.ok(!byText(view.container, 's-button', 'Continue to discount value').hasAttribute('disabled'), 'a named list can continue');
  await view.unmount();
});

const site = (defaultDesign, change = {}) => ({
  websiteEnabled: true, showProductPage: false, showCollectionPage: false, showProductBadge: false, showCountdown: false, showHeaderBanner: true,
  headline: 'Halloween', body: '', badgeText: '', countdownText: '', buttonText: '', buttonUrl: '', backgroundColour: '#ffffff', textColour: '#000000', badgeColour: '#d72c0d', priority: 3, design: defaultDesign(), ...change,
});

test('a new promotion that can appear on the website sends the merchant to place it in the priority order', async () => {
  const { PromotionEditor } = await loaded();
  toasts.length = 0;
  window.shopify.resourcePicker = async () => [halloween];
  const view = await mount(PromotionEditor, base, '/app/promotions/new?type=product', { respond: intent => intent === 'createPromotion' ? { success: true, savedId: 'gid://shopify/DiscountNode/9', redirectId: '9', rankEntry: true } : {} });
  await type(field(view, 'Discount code'), 'spooky20');
  await click(byText(view.container, 's-button', 'Continue to discount value'));
  await type(value(view), '20');
  await click(byText(step(view.container, 'value'), 's-button', 'Browse'));
  assert.match(overview(view).textContent, /Not in the order\. Its website status is Draft\./, 'a draft website is outside the order');

  await change(find(view.container, 's-select[label="Website promotion status"]'), 'enabled');
  await check(find(view.container, 's-checkbox[label="Header"]'));
  await type(find(view.container, 's-text-field[label="Headline"]'), 'Frightfully good fun');
  assert.match(overview(view).textContent, /You will place it after saving\. It starts at the top of the order\./);

  await click(saveButton(view));
  await settle(100);
  const [request] = view.requests.filter(item => item.intent === 'createPromotion');
  assert.equal(request.payload.rankEntry, true, 'the save says the promotion is entering the order');
  assert.deepEqual(toasts, ['Promotion created']);
  assert.equal(view.router.state.location.pathname, '/app/storefront-priorities', 'the merchant is taken to the priority page');
  assert.equal(view.router.state.location.search, '?highlight=9', 'with the new promotion pointed out');
  await view.unmount();
});

test('a new promotion that cannot appear on the website goes straight to the promotion', async () => {
  const { PromotionEditor } = await loaded();
  window.shopify.resourcePicker = async () => [halloween];
  const view = await mount(PromotionEditor, base, '/app/promotions/new?type=product', { respond: intent => intent === 'createPromotion' ? { success: true, savedId: 'gid://shopify/DiscountNode/9', redirectId: '9', rankEntry: false } : {} });
  await type(field(view, 'Discount code'), 'spooky20');
  await click(byText(view.container, 's-button', 'Continue to discount value'));
  await type(value(view), '20');
  await click(byText(step(view.container, 'value'), 's-button', 'Browse'));
  await click(saveButton(view));
  await settle(100);
  const [request] = view.requests.filter(item => item.intent === 'createPromotion');
  assert.equal(request.payload.rankEntry, false);
  assert.equal(view.router.state.location.pathname, '/app/promotions/9');
  await view.unmount();
});

test('editing a promotion so that it joins the order takes the merchant to place it', async () => {
  const { PromotionEditor, placeholderDraft, defaultDesign } = await loaded();
  toasts.length = 0;
  const view = await mount(PromotionEditor, { ...savedProps(savedDraft(placeholderDraft)), initialWebsite: site(defaultDesign, { websiteEnabled: false }) }, '/app/promotions/new', { respond: intent => intent === 'updatePromotion' ? { success: true, rankEntry: true } : {} });
  assert.match(overview(view).textContent, /Its website status is Draft\./);
  await change(find(view.container, 's-select[label="Website promotion status"]'), 'enabled');
  assert.match(overview(view).textContent, /You will place it after saving/);
  await click(saveButton(view));
  await settle(100);
  const [request] = view.requests.filter(item => item.intent === 'updatePromotion');
  assert.equal(request.payload.rankEntry, true);
  assert.equal(request.payload.website.websiteEnabled, true);
  assert.equal(request.payload.website.priority, 3, 'the editor sends no new priority; the server decides it');
  assert.deepEqual(toasts, ['Promotion saved']);
  assert.equal(view.router.state.location.pathname, '/app/storefront-priorities');
  assert.equal(view.router.state.location.search, '?highlight=1');
  await view.unmount();
});

test('a promotion already in the order shows its position, links to change it, and stays put when saved', async () => {
  const { PromotionEditor, placeholderDraft, defaultDesign } = await loaded();
  const view = await mount(PromotionEditor, { ...savedProps(savedDraft(placeholderDraft)), initialWebsite: site(defaultDesign), priorityInfo: { position: 2, total: 5 } }, '/app/promotions/new');
  const note = overview(view);
  assert.match(note.textContent, /Position 2 of 5/);
  const link = byText(note, 's-link', 'Change priority');
  assert.ok(link.getAttribute('href').endsWith('/app/storefront-priorities?highlight=1'), 'the link goes to the priority page with this promotion pointed out');
  assert.doesNotMatch(note.textContent, /You will place it after saving/);

  await type(value(view), '25');
  await click(saveButton(view));
  await settle(100);
  const [request] = view.requests.filter(item => item.intent === 'updatePromotion');
  assert.equal(request.payload.rankEntry, false, 'staying in the order is not entering it');
  assert.equal(view.router.state.location.pathname, '/app/promotions/new', 'the merchant stays on the promotion');
  await view.unmount();
});

test('the priority number is no longer an editor field', async () => {
  const { PromotionEditor } = await loaded();
  const view = await mount(PromotionEditor, base, '/app/promotions/new?type=product');
  assert.equal(find(view.container, 's-number-field[label="Promotion priority"]'), null);
  assert.doesNotMatch(view.container.textContent, /Higher numbers take precedence/);
  await view.unmount();
});

test('the overview gathers the name, statuses, summary, priority and what is left to do at the top', async () => {
  const { PromotionEditor, placeholderDraft, defaultDesign } = await loaded();
  const created = await mount(PromotionEditor, base, '/app/promotions/new?type=product');
  const fresh = overview(created).textContent;
  assert.match(fresh, /New discount code/);
  assert.match(fresh, /Amount off products/);
  assert.match(fresh, /Not saved yet/);
  assert.match(fresh, /Not visible on website/);
  assert.match(fresh, /Not in the order/);
  assert.match(fresh, /To save: Enter a discount code/);
  await click(byText(overview(created), 's-button', 'Go to type and method'));
  assert.ok(step(created.container, 'type').hasAttribute('open'), 'the shortcut opens the step that needs attention');
  await type(field(created, 'Discount code'), 'spooky20');
  assert.match(overview(created).textContent, /SPOOKY20|spooky20/);
  assert.equal(findAll(created.container, '[aria-label="Promotion summary"]').length, 1, 'there is a single summary');
  await created.unmount();

  const saved = await mount(PromotionEditor, { ...savedProps(savedDraft(placeholderDraft)), initialWebsite: site(defaultDesign), priorityInfo: { position: 1, total: 3 } }, '/app/promotions/new');
  const live = overview(saved).textContent;
  assert.match(live, /SAVE20/);
  assert.match(live, /Active/);
  assert.match(live, /Visible on website/);
  assert.match(live, /Position 1 of 3/);
  assert.doesNotMatch(live, /To save:/);
  assert.equal(find(saved.container, 's-checkbox[label="Include in promotion sync"]'), null, 'there is no sync checkbox: an enabled promotion syncs');
  await saved.unmount();
});

test('the website status is changed in the overview, which the website step and the preview no longer carry', async () => {
  const { PromotionEditor } = await loaded();
  const view = await mount(PromotionEditor, base, '/app/promotions/new?type=product');
  const select = () => find(overview(view), 's-select[label="Website promotion status"]');
  assert.ok(select(), 'the control is in the overview');
  assert.equal(select().value, 'draft');
  assert.equal(find(step(view.container, 'website'), 's-select[label="Website promotion status"]'), null, 'the website step no longer has it');
  const preview = find(view.container, 's-section[heading="Website preview"]');
  assert.doesNotMatch(preview.textContent, /Visible on website|Not visible yet|Not visible on website/, 'the preview carries no status badge');
  assert.match(overview(view).textContent, /Not visible on website/);

  await change(select(), 'enabled');
  assert.equal(select().value, 'enabled', 'the choice is kept');
  assert.match(overview(view).textContent, /Not visible on website/, 'enabled with no block chosen is still not visible');
  await check(find(view.container, 's-checkbox[label="Header"]'));
  await type(find(view.container, 's-text-field[label="Headline"]'), 'Frightfully good fun');
  assert.match(overview(view).textContent, /Visible on website/, 'with a block chosen the offer is visible');
  assert.doesNotMatch(overview(view).textContent, /Not visible on website/);
  await change(select(), 'draft');
  assert.match(overview(view).textContent, /Not visible on website/);
  await view.unmount();
});

test('a generated code list keeps the website status locked to Draft', async () => {
  const { PromotionEditor } = await loaded();
  const view = await mount(PromotionEditor, base, '/app/promotions/new?type=order');
  const select = () => find(overview(view), 's-select[label="Website promotion status"]');
  assert.equal(select().hasAttribute('disabled'), false);
  await change(find(view.container, 's-select[label="Code format"]'), 'bulk');
  assert.equal(select().hasAttribute('disabled'), true, 'a code list cannot be enabled');
  assert.equal(select().value, 'draft');
  assert.match(select().getAttribute('details'), /Code lists stay in Draft/);
  await view.unmount();
});
