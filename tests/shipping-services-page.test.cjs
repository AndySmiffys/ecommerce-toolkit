/* eslint-env node */
// Mounts the Shipping page with its delivery services editor in a simulated browser: the options Shopify offers, and what the app adds to each.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');
const { React, find, findAll, byText, type, change, check, click, wait, toasts } = require('./helpers/editor-harness.cjs');
const { createRoot } = require('react-dom/client');
const { createMemoryRouter, RouterProvider, useFetcher } = require('react-router');

const rawPlugin = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: require('node:fs').readFileSync(args.path, 'utf8'), loader: 'text' }));
  },
};
let ShippingReviewPage;
async function load() {
  if (ShippingReviewPage) return ShippingReviewPage;
  const result = await build({
    stdin: { contents: "export { ShippingReviewPage } from './app/modules/shipping/ShippingReviewPage';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false, plugins: [rawPlugin],
  });
  const compiled = new Module(__filename); compiled.paths = module.paths;
  compiled._compile(result.outputFiles[0].text, __filename);
  ShippingReviewPage = compiled.exports.ShippingReviewPage;
  return ShippingReviewPage;
}

const DPD = 'DPD Next Working Day Delivery (Order Before 2pm for Delivery Mon - Fri by 6pm)';
const AMAZON = 'Amazon 2 Day (Order Before 2pm) Non Guaranteed';
const services = {
  version: 1, currency: 'GBP',
  zones: { z0: { name: 'Domestic', services: [
    { name: DPD, tiers: [{ from: 0, price: 699 }, { from: 3000, price: 499 }], transit: { minDays: 1, maxDays: 1 } },
    { name: AMAZON, tiers: [{ from: 0, price: 399 }, { from: 3000, price: 0 }], transit: { minDays: 2, maxDays: 2 } },
    { name: 'Collection', tiers: [{ from: 0, price: 0 }] },
  ] } },
  countries: { GB: 'z0' }, restOfWorld: null,
};
const snapshot = { shopCurrency: 'GBP', shipsTo: ['GB'], markets: null, profiles: [{ id: 'p', name: 'General', isDefault: true, variantCount: 10, zones: [{ id: 'z0', name: 'Domestic', countries: ['GB'], restOfWorld: false, rates: [] }] }] };
const setting = (name, changes = {}) => ({ name, label: '', show: true, guaranteed: false, cutoffTime: '', days: [false, true, true, true, true, true, false], onBankHolidays: false, transitMin: null, transitMax: null, ...changes });

/** The Shipping page, with a host that can change what it is given (as a fresh read of Shopify does). */
async function mountPage({ servicesTable = services, settings = [], enabled = true, respond } = {}) {
  const Page = await load();
  const container = document.createElement('div'); document.body.appendChild(container);
  const posts = [];
  let update;
  function Host() {
    const [data, setData] = React.useState({ servicesTable, settings, enabled });
    update = setData;
    const fetcher = useFetcher();
    return React.createElement(Page, {
      data: { ok: true, snapshot, findings: [], checkedAt: '2026-10-27T10:30:00Z', services: data.servicesTable, delivery: { settings: data.settings, enabled: data.enabled, cutoffTime: '15:00' } },
      checking: false, onCheck: () => undefined, fetcher,
    });
  }
  const router = createMemoryRouter([{
    path: '/app/shipping', Component: Host,
    action: async ({ request }) => {
      const data = Object.fromEntries((await request.formData()).entries());
      posts.push(data);
      return respond ? respond(data) : { ok: true, intent: data.intent, errors: [], services: JSON.parse(data.services) };
    },
  }], { initialEntries: ['/app/shipping'] });
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(RouterProvider, { router })); await wait(); });
  return {
    container, posts,
    refresh: async next => { await React.act(async () => { update(current => ({ ...current, ...next })); await wait(); }); },
    unmount: async () => { await React.act(async () => root.unmount()); router.dispose(); container.remove(); },
  };
}
const card = (container, name) => findAll(container, 'details[data-service]').find(item => item.getAttribute('data-service') === name);
const control = (scope, tag, label) => findAll(scope, tag).find(element => element.getAttribute('label') === label);
const summary = item => find(item, 'summary').textContent.replace(/\s+/g, ' ').trim();
const saveButton = container => byText(container, 'button', 'Save');

test('the delivery services sit on the Shipping page, one card per Shopify option, with what the app adds', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const section = find(container, 's-section[heading="Delivery services"]');
    assert.ok(section, 'a section of the Shipping page');
    assert.deepEqual(findAll(section, 'details[data-service]').map(item => item.getAttribute('data-service')), [DPD, AMAZON, 'Collection'], "every option, in Shopify's order");
    assert.match(summary(card(container, DPD)), /Non-guaranteed · Mon–Fri · the shop's cut-off · 1 business day \(Shopify\)$/, 'nothing is guaranteed unless chosen');
    assert.match(summary(card(container, AMAZON)), /2 business days \(Shopify\)$/);
    assert.match(summary(card(container, 'Collection')), /no delivery time$/);
    assert.equal(find(card(container, 'Collection'), 's-badge').textContent, 'No delivery time', 'flagged, since no date can be given for it');
    const dpd = card(container, DPD);
    assert.match(dpd.textContent, /offered in Domestic/);
    assert.match(dpd.textContent, /Price: £6\.99, or £4\.99 on orders of £30 or more\./);
    assert.match(dpd.textContent, /Delivery time in Shopify: 1 business day\./);
    assert.match(card(container, 'Collection').textContent, /Shopify has no delivery time for it/);
    assert.equal(saveButton(container).disabled, true, 'listing them is not a change');
    assert.equal(find(container, 's-banner[heading="Delivery options are switched off on the product page"]'), null, 'they are on');
  } finally { await page.unmount(); }
});

test('when delivery options are switched off on the product page, the page says where to turn them on', async () => {
  const page = await mountPage({ enabled: false });
  try {
    const banner = find(page.container, 's-banner[heading="Delivery options are switched off on the product page"]');
    assert.ok(banner);
    assert.match(find(banner, 's-link').getAttribute('href'), /\/app\/shipping-countdown/);
    assert.equal(findAll(page.container, 'details[data-service]').length, 3, 'they can still be set up first');
  } finally { await page.unmount(); }
});

test('a service can be set as guaranteed, renamed, given its own days and cut-off, and only what was changed is saved', async () => {
  toasts.length = 0;
  const page = await mountPage();
  try {
    const { container } = page;
    const dpd = card(container, DPD);
    await type(control(dpd, 's-text-field', 'Name on the product page'), 'DPD Next Day');
    await check(control(dpd, 's-checkbox', 'Guaranteed by the carrier'), true);
    await type(control(dpd, 's-text-field', 'Cut-off time for this service'), '16:00');
    await change(find(dpd, 's-choice-list'), ['1', '2', '3', '4', '5', '6']);
    assert.match(summary(dpd), /^DPD Next DayGuaranteed · Mon–Sat · cut-off 16:00 · 1 business day \(Shopify\)$/);
    assert.equal(saveButton(container).disabled, false);
    await click(saveButton(container));
    await wait(60);
    assert.equal(page.posts.length, 1);
    assert.equal(page.posts[0].intent, 'saveServices');
    assert.deepEqual(JSON.parse(page.posts[0].services), [setting(DPD, { label: 'DPD Next Day', guaranteed: true, cutoffTime: '16:00', days: [false, true, true, true, true, true, true] })], 'the other two are untouched, so nothing is saved for them');
    assert.ok(toasts.includes('Delivery services saved'));
    assert.equal(saveButton(container).disabled, true, 'saved');
    assert.match(summary(card(container, DPD)), /Guaranteed · Mon–Sat/);
  } finally { await page.unmount(); }
});

test('a delivery time typed in replaces Shopify\'s, half of one is rejected, and a service can be hidden', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const amazon = card(container, AMAZON);
    const shortest = () => control(amazon, 's-number-field', 'Shortest delivery time (business days)');
    const longest = () => control(amazon, 's-number-field', 'Longest delivery time (business days)');
    await type(shortest(), '3');
    assert.match(container.textContent, /Enter both the shortest and the longest delivery time/);
    assert.equal(saveButton(container).disabled, true, 'half a delivery time cannot be saved');
    await type(longest(), '4');
    assert.match(summary(amazon), /3 to 4 business days \(set here\)/);
    await type(shortest(), '5');
    assert.match(container.textContent, /shortest delivery time for .* cannot be longer than the longest/);
    assert.equal(saveButton(container).disabled, true);
    await type(shortest(), '70');
    assert.match(container.textContent, /whole business days from 0 to 60/);
    await type(shortest(), '3');
    await check(control(card(container, DPD), 's-checkbox', 'Show in the delivery options'), false);
    assert.match(summary(card(container, DPD)), /Hidden/);
    await type(control(card(container, DPD), 's-text-field', 'Cut-off time for this service'), '9pm');
    assert.match(container.textContent, /cut-off time for .* must be a 24-hour time/);
    await type(control(card(container, DPD), 's-text-field', 'Cut-off time for this service'), '');
    await click(saveButton(container));
    await wait(60);
    assert.deepEqual(JSON.parse(page.posts[0].services), [setting(DPD, { show: false }), setting(AMAZON, { transitMin: 3, transitMax: 4 })]);
  } finally { await page.unmount(); }
});

test('a service must keep at least one delivery day', async () => {
  const page = await mountPage();
  try {
    await change(find(card(page.container, DPD), 's-choice-list'), []);
    assert.match(page.container.textContent, /Choose at least one delivery day for/);
    assert.equal(saveButton(page.container).disabled, true);
    assert.match(summary(card(page.container, DPD)), /No delivery days/);
  } finally { await page.unmount(); }
});

test('Discard puts everything back as it was saved', async () => {
  const page = await mountPage({ settings: [setting(AMAZON, { guaranteed: true })] });
  try {
    const { container } = page;
    assert.match(summary(card(container, AMAZON)), /Guaranteed/);
    await check(control(card(container, AMAZON), 's-checkbox', 'Guaranteed by the carrier'), false);
    await type(control(card(container, DPD), 's-text-field', 'Name on the product page'), 'Renamed');
    assert.equal(saveButton(container).disabled, false);
    await click(byText(container, 'button', 'Discard'));
    assert.match(summary(card(container, AMAZON)), /Guaranteed/);
    assert.doesNotMatch(summary(card(container, DPD)), /Renamed/);
    assert.equal(saveButton(container).disabled, true);
  } finally { await page.unmount(); }
});

test('settings for a service Shopify no longer has are kept at the end, and can be removed', async () => {
  const page = await mountPage({ settings: [setting('Old courier', { guaranteed: true, transitMin: 1, transitMax: 1 }), setting(AMAZON, { label: 'Amazon 2 Day', guaranteed: true })] });
  try {
    const { container } = page;
    assert.deepEqual(findAll(container, 'details[data-service]').map(item => item.getAttribute('data-service')), [DPD, AMAZON, 'Collection', 'Old courier'], 'what Shopify has first, then what it no longer has');
    assert.equal(saveButton(container).disabled, true, 'listing them is not a change');
    assert.match(summary(card(container, AMAZON)), /^Amazon 2 DayGuaranteed/, 'what was saved is shown');
    const old = card(container, 'Old courier');
    assert.equal(find(old, 's-badge[tone=warning]').textContent, 'Not in Shopify now');
    assert.ok(find(old, 's-banner[heading="This option is no longer in your Shopify shipping settings"]'));
    await click(byText(old, 's-button', 'Remove these settings'));
    assert.equal(card(container, 'Old courier'), undefined);
    await click(saveButton(container));
    await wait(60);
    assert.deepEqual(JSON.parse(page.posts[0].services).map(item => item.name), [AMAZON], 'only the service that differs from the defaults, and not the removed one');
  } finally { await page.unmount(); }
});

test('a fresh read of Shopify updates the list, unless there are unsaved changes', async () => {
  const page = await mountPage();
  try {
    const { container } = page;
    const more = { ...services, zones: { z0: { name: 'Domestic', services: [...services.zones.z0.services, { name: 'Evening', tiers: [{ from: 0, price: 899 }], transit: { minDays: 1, maxDays: 1 } }] } } };
    await page.refresh({ servicesTable: more });
    assert.equal(card(container, 'Evening') !== undefined, true, 'a new option appears');
    await type(control(card(container, DPD), 's-text-field', 'Name on the product page'), 'Mine');
    const fewer = { ...services, zones: { z0: { name: 'Domestic', services: services.zones.z0.services.slice(0, 2) } } };
    await page.refresh({ servicesTable: fewer });
    assert.equal(card(container, 'Evening') !== undefined, true, 'unsaved work is not thrown away by a refresh');
    assert.match(summary(card(container, DPD)), /Mine/);
    await click(byText(container, 'button', 'Discard'));
    await page.refresh({ servicesTable: fewer, settings: [setting(AMAZON, { guaranteed: true })] });
    assert.deepEqual(findAll(container, 'details[data-service]').map(item => item.getAttribute('data-service')), [DPD, AMAZON], 'with nothing unsaved, the new read replaces the list');
    assert.match(summary(card(container, AMAZON)), /Guaranteed/);
  } finally { await page.unmount(); }
});

test('a save that is refused says why, and keeps the changes', async () => {
  const page = await mountPage({ respond: data => ({ ok: false, intent: data.intent, errors: ['Shopify did not confirm the save.'] }) });
  try {
    const { container } = page;
    await check(control(card(container, DPD), 's-checkbox', 'Guaranteed by the carrier'), true);
    await click(saveButton(container));
    await wait(60);
    assert.match(container.textContent, /Shopify did not confirm the save\./);
    assert.match(summary(card(container, DPD)), /Guaranteed/, 'nothing lost');
    assert.equal(saveButton(container).disabled, false, 'can try again');
  } finally { await page.unmount(); }
});

test('before the services have been read, and when there are none, the section says so', async () => {
  const none = await mountPage({ servicesTable: { ...services, zones: { z0: { name: 'Domestic', services: [] } } } });
  try {
    assert.ok(find(none.container, 's-banner[heading="No delivery services found"]'));
    assert.equal(findAll(none.container, 'details[data-service]').length, 0);
  } finally { await none.unmount(); }
});
