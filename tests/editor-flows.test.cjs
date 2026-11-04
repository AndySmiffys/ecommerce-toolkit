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
  assert.deepEqual(toasts, ['Promotion created. Website status is Draft, so it is not showing on the storefront.'], 'a Draft website status is called out in the confirmation');
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
  assert.deepEqual(toasts, ['Promotion saved. Website status is Draft, so it is not showing on the storefront.']);
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
  assert.match(view.container.textContent, /Promotions for specific customers or segments are not shown on the website yet/);
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

test('saving with the website status on Draft warns that the promotion is hidden until it is enabled', async () => {
  const { PromotionEditor, placeholderDraft, defaultDesign } = await loaded();
  toasts.length = 0;
  const view = await mount(PromotionEditor, { ...savedProps(savedDraft(placeholderDraft)), initialWebsite: site(defaultDesign, { websiteEnabled: false }) }, '/app/promotions/new', { respond: intent => intent === 'updatePromotion' ? { success: true } : undefined });
  const warning = () => findAll(view.container, 's-banner[heading="Website status is Draft"]');
  assert.equal(warning().length, 0, 'nothing to warn about before saving');
  await type(value(view), '25');
  await click(saveButton(view));
  await settle(100);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /Website status is Draft/);
  assert.equal(warning().length, 1, 'a banner stays on the page after the save');
  await change(find(view.container, 's-select[label="Website promotion status"]'), 'enabled');
  assert.equal(warning().length, 0, 'enabling the website status removes the warning');
  await view.unmount();
});

test('the design preset sits with the campaign images, and the focal point is set by clicking in a modal', async () => {
  const { PromotionEditor, placeholderDraft, defaultDesign } = await loaded();
  const design = { ...defaultDesign(), desktopImage: 'https://cdn.example.com/hero.jpg', imageLayout: 'half-right', focalX: 50, focalY: 50 };
  const view = await mount(PromotionEditor, { ...savedProps(savedDraft(placeholderDraft)), initialWebsite: site(() => design, { showCollectionPage: true, showProductPage: true }) }, '/app/promotions/new');
  const groups = findAll(view.container, '[data-promo-design]');
  assert.equal(groups.length, 1, 'one preset control, not one per block');
  assert.ok(groups[0].closest('section[aria-label="Campaign content and style"]'), 'it is in the campaign content and style section');
  assert.match(groups[0].textContent, /Collection Promo Design/);
  const cards = findAll(groups[0], 's-clickable');
  assert.equal(cards.length, 4, 'each design is a card');
  assert.match(cards[0].textContent, /Simple offer.*Selected/);
  assert.match(cards[1].textContent, /Image campaign.*background/);
  assert.match(cards[2].textContent, /Image only.*already carries the message/);
  assert.equal(find(view.container, 'input[aria-label="Image overlay"]'), null, 'the dark image overlay is gone');
  assert.equal(find(view.container, 'input[aria-label="Horizontal focal point"]'), null, 'the focal point sliders are gone');

  await click(cards[1]);
  assert.match(findAll(view.container, '[data-promo-design] s-clickable')[1].textContent, /Selected/);
  await click(saveButton(view));
  await settle(100);
  const [request] = view.requests.filter(item => item.intent === 'updatePromotion');
  for (const id of ['collection', 'product']) assert.equal(request.payload.website.design.blocks[id].style.imageLayout, 'full', `${id} takes the preset's layout`);

  assert.equal(find(view.container, 'input[aria-label="Image overlay"]'), null);
  const blocks = findAll(view.container, 'details[data-promotion-block]');
  assert.ok(blocks.length >= 2);
  for (const block of blocks) {
    assert.equal(findAll(block, 's-clickable[accessibilityLabel*="image"]').length, 0, 'no image boxes in the fine-tune sections');
    assert.equal(find(block, 's-text-field[label="Image description (alt text)"]'), null, 'no alt text in the fine-tune sections');
    assert.ok(!byText(block, 's-button', 'Set focal point'), 'no focal point in the fine-tune sections');
  }
  const desktop = find(view.container, 's-clickable[accessibilityLabel="Edit desktop image: focal point and alt text"]');
  assert.ok(desktop, 'once an image is chosen, clicking it edits it');
  assert.ok(byText(view.container, 's-button', 'Change image') && byText(view.container, 's-button', 'Edit alt text') && byText(view.container, 's-button', 'Remove image'), 'the image menu offers change, alt text and remove');
  await click(desktop);
  await settle(50);
  const surface = find(document.body, '[role="button"][aria-label^="Focal point"]');
  assert.ok(surface, 'the modal shows the image to click');
  assert.match(surface.getAttribute('aria-label'), /50% across and 50% down/);
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown']) surface.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
  await settle(50);
  assert.match(find(document.body, '[role="button"][aria-label^="Focal point"]').getAttribute('aria-label'), /52% across and 51% down/);
  await type(find(document.body, 's-text-field[label="Image description (alt text)"]'), 'A family in costumes');
  await click(byText(document.body, 's-button', 'Apply'));
  await settle(50);
  await click(saveButton(view));
  await settle(100);
  const saved = view.requests.filter(item => item.intent === 'updatePromotion').pop();
  for (const id of ['collection', 'product']) {
    const style = saved.payload.website.design.blocks[id].style;
    assert.equal(style.focalX, 52, `${id} takes the focal point`);
    assert.equal(style.focalY, 51);
    assert.equal(style.imageAlt, 'A family in costumes', `${id} takes the alt text`);
  }
  await view.unmount();
});

test('adding the Header to a live promotion uses the campaign wording instead of asking for a headline', async () => {
  const { PromotionEditor, placeholderDraft, defaultDesign } = await loaded();
  // The wording lives in the collection block (the campaign), and the old top-level headline is empty.
  const { overrides, blocks, palette, ...style } = defaultDesign();
  const collection = { headline: 'Frightfully good fun', body: 'Costumes for everyone', buttonText: 'Shop Halloween', buttonUrl: '/collections/halloween', countdownText: '', backgroundColour: '#ffffff', textColour: '#000000', badgeColour: '#d72c0d', visibility: { headline: true, body: true, image: false, offerNote: true, discountCode: true, countdown: false, button: true }, style };
  const view = await mount(PromotionEditor, { ...savedProps(savedDraft(placeholderDraft)), initialWebsite: site(() => ({ ...defaultDesign(), blocks: { collection } }), { headline: '', showHeaderBanner: false, showCollectionPage: true }) }, '/app/promotions/new');
  try {
    assert.ok(!view.container.textContent.includes('Add a headline for the Header block'));
    await check(find(view.container, 's-checkbox[label="Header"]'), true);
    assert.ok(find(view.container, 'details[data-promotion-block="header"]'), 'the Header block is now selected');
    assert.ok(!view.container.textContent.includes('Add a headline for the Header block'), 'the new block takes the campaign headline');
    assert.equal(find(find(view.container, 'details[data-promotion-block="header"]'), 's-text-field[label="Headline"]').getAttribute('placeholder'), 'Frightfully good fun', 'and shows it as the campaign wording it follows');
  } finally { await view.unmount(); }
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

test('the list bulk bar changes statuses at once, and asks before deleting or deactivating', async () => {
  const { PromotionBulkBar } = await loaded();
  const actions = [];
  const view = await mount(PromotionBulkBar, { titles: ['Halloween', 'Spring', 'Free delivery'], busy: false, onAction: intent => actions.push(intent), onClear: () => actions.push('clear') }, '/app/promotions/new');
  try {
    assert.match(view.container.textContent, /3 selected/);
    for (const label of ['Activate', 'Enable on website', 'Set website to Draft']) await click(byText(view.container, 's-button', label));
    assert.deepEqual(actions, ['activate', 'website-enable', 'website-draft'], 'these run straight away');
    await click(byText(view.container, 's-button', 'Delete'));
    await settle(50);
    const modal = find(view.container, 's-modal');
    assert.equal(modal.getAttribute('heading'), 'Delete 3 promotions?');
    assert.match(modal.textContent, /permanently deletes the discount in Shopify/);
    assert.match(modal.textContent, /Halloween/);
    assert.match(modal.textContent, /Free delivery/);
    assert.equal(actions.length, 3, 'nothing is deleted until it is confirmed');
    await click(byText(modal, 's-button', 'Cancel'));
    await settle(50);
    assert.equal(actions.length, 3, 'cancelling deletes nothing');
    await click(byText(view.container, 's-button', 'Delete'));
    await settle(50);
    await click(byText(find(view.container, 's-modal'), 's-button', 'Delete 3 promotions'));
    assert.equal(actions.at(-1), 'delete');
    await click(byText(view.container, 's-button', 'Deactivate'));
    await settle(50);
    assert.equal(find(view.container, 's-modal').getAttribute('heading'), 'Deactivate 3 discounts?');
    assert.match(find(view.container, 's-modal').textContent, /replaces its end date with now/);
    await click(byText(find(view.container, 's-modal'), 's-button', 'Deactivate 3 discounts'));
    assert.equal(actions.at(-1), 'deactivate');
    await click(byText(view.container, 's-button', 'Clear selection'));
    assert.equal(actions.at(-1), 'clear');
  } finally { await view.unmount(); }
});

test('a promotion is chosen for Google in the editor, with its own title, warnings, and the choice travels with the save and is undone by discard', async () => {
  const { PromotionEditor, placeholderDraft } = await loaded();
  const view = await mount(PromotionEditor, savedProps(savedDraft(placeholderDraft)), '/app/promotions/new');
  const google = step(view.container, 'google');
  const choose = () => find(google, 's-checkbox[label="Send this promotion to Google Merchant Center"]');
  assert.ok(choose(), 'the step is there');
  assert.equal(find(google, 's-text-field[label="Title on Google (optional)"]'), null, 'no title field until it is chosen');
  assert.ok(saveButton(view).disabled, 'looking at the step changes nothing');

  await check(choose(), true);
  assert.equal(saveButton(view).disabled, false, 'choosing it is a change that can be saved');
  assert.ok(find(google, 's-banner[heading="Google would not take this promotion yet"]'), 'a promotion with no dates is warned about at once');
  assert.match(google.textContent, /start date/);
  assert.match(view.container.textContent, /Sending, but needs attention/, 'and the step summary says so');
  await type(find(google, 's-text-field[label="Title on Google (optional)"]'), 'Halloween 20% off');

  await click(discardButton(view));
  await settle(50);
  assert.equal(find(google, 's-text-field[label="Title on Google (optional)"]'), null, 'discard takes the choice back');
  assert.ok(saveButton(view).disabled);

  await check(choose(), true);
  await type(find(google, 's-text-field[label="Title on Google (optional)"]'), 'Halloween 20% off');
  await click(saveButton(view));
  await settle(100);
  const [request] = view.requests.filter(item => item.intent === 'updatePromotion');
  assert.deepEqual(request.payload.google, { enabled: true, title: 'Halloween 20% off' }, 'the choice and the title are saved with the promotion');
  await view.unmount();
});

test('a promotion already sent to Google shows how its last check went, and a code list cannot be sent', async () => {
  const { PromotionEditor, placeholderDraft } = await loaded();
  const sent = { enabled: true, title: 'Spooky offer', status: 'issues', issues: ['It has no end date. Google needs one, and no more than 183 days after the start.'], checkedAt: '2026-10-22T09:00:00.000Z' };
  const view = await mount(PromotionEditor, { ...savedProps(savedDraft(placeholderDraft)), initialGoogle: sent }, '/app/promotions/new');
  const google = step(view.container, 'google');
  assert.equal(find(google, 's-text-field[label="Title on Google (optional)"]').getAttribute('value'), 'Spooky offer', 'the saved title is filled in');
  assert.match(google.textContent, /Last check/);
  assert.match(google.textContent, /Not ready/);
  assert.match(google.textContent, /It has no end date/, 'what to change is shown');
  assert.ok(saveButton(view).disabled, 'showing it is not a change');
  await view.unmount();

  const list = await mount(PromotionEditor, { ...savedProps(savedDraft(placeholderDraft, { codeMode: 'bulk', codeCount: '50', codeListTitle: 'Welcome list' })) }, '/app/promotions/new');
  const listStep = step(list.container, 'google');
  const listBox = find(listStep, 's-checkbox[label="Send this promotion to Google Merchant Center"]');
  assert.ok(listBox.hasAttribute('disabled'), 'a list of individual codes cannot be chosen');
  assert.match(listBox.getAttribute('details'), /Google needs one shared code/);
  await list.unmount();
});
