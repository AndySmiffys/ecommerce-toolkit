/* eslint-env node */
/* global globalThis */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { buildSync } = require('esbuild');
const Module = require('node:module');
const React = require('react');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.example/app/storefront-priorities' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const reportError = console.error;
console.error = (...args) => { if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return; reportError(...args); };
const { createRoot } = require('react-dom/client');
const { createMemoryRouter, RouterProvider, Outlet, useLoaderData, useSearchParams } = require('react-router');
const bundled = buildSync({ entryPoints: ['app/modules/promotions/components/PromotionPriorityManager.tsx'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false, plugins: [] });
const component = new Module(__filename); component.paths = module.paths;
component._compile(bundled.outputFiles[0].text, __filename);
const { PromotionPriorityManager, moveTo } = component.exports;
// Exercise the real SaveBar wrapper with a minimal Shopify custom element.
class SaveBar extends HTMLElement { show() { this.open = true; } hide() { this.open = false; } }
window.customElements.define('ui-save-bar', SaveBar);
let toast;
window.shopify = { toast: { show: message => { toast = message; } } };
const wait = () => new Promise(resolve => setTimeout(resolve, 30));

const promotion = (id, title, priority, extra = {}) => ({ id: `gid://shopify/DiscountNode/${id}`, routeId: String(id), title, priority, status: 'Active', blocks: ['Header', 'Product badge'], audience: 'All customers', restricted: false, schedule: 'No end date', warning: null, ...extra });
const titles = () => [...document.querySelectorAll('[role=listitem]')].map(item => item.querySelector('a').textContent);
const button = label => [...document.querySelectorAll('button')].find(button => button.textContent === label);
const rowAt = index => document.querySelectorAll('[role=listitem]')[index];
const click = async element => { await React.act(async () => { element.click(); await wait(); }); };
function drag(from, to) {
  const data = {}; const transfer = { effectAllowed: '', setData: (type, value) => { data[type] = value; }, getData: type => data[type] };
  const fire = (element, type) => { const event = new window.Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: transfer }); element.dispatchEvent(event); };
  // A browser delivers each drag event on its own, so each gets its own turn to update the page.
  return (async () => {
    for (const [index, type] of [[from, 'dragstart'], [to, 'dragover'], [to, 'drop'], [from, 'dragend']]) await React.act(async () => { fire(rowAt(index), type); await wait(); });
  })();
}

async function mountPage({ rows, hidden = [], search = '', respond }) {
  const submissions = [];
  let current = rows;
  function Page() { const data = useLoaderData(); const [params] = useSearchParams(); return React.createElement(PromotionPriorityManager, { ...data, highlight: params.get('highlight'), refreshing: false, onRefresh() {} }); }
  const router = createMemoryRouter([{ path: '/app', id: 'routes/app', loader: () => ({ shop: 'test.myshopify.com' }), Component: Outlet, children: [{ path: 'storefront-priorities', Component: Page, loader: () => ({ rows: current, hidden, errors: [] }), action: async ({ request }) => {
    const changes = JSON.parse((await request.formData()).get('changes'));
    submissions.push(changes);
    const answer = respond ? respond(changes) : { success: true, error: null };
    if (answer.success) current = current.map(row => ({ ...row, priority: changes.find(change => change.id === row.id)?.priority ?? row.priority })).sort((a, b) => b.priority - a.priority);
    return answer;
  } }] }], { initialEntries: [`/app/storefront-priorities${search}`] });
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => { root.render(React.createElement(RouterProvider, { router })); await wait(); });
  return { submissions, unmount: async () => { await React.act(async () => root.unmount()); router.dispose(); } };
}

const three = () => [promotion(1, 'Halloween sale', 30), promotion(2, 'Free shipping', 20, { blocks: ['Header'] }), promotion(3, 'Costume badge', 10, { status: 'Scheduled', schedule: 'Starts 1 Dec 2026', restricted: true, audience: 'Selected customer segments (login required)' })];

test('moving a promotion with the buttons or by dragging changes the order, and Discard puts it back', async () => {
  toast = undefined;
  const page = await mountPage({ rows: three() });
  try {
    assert.deepEqual(titles(), ['Halloween sale', 'Free shipping', 'Costume badge']);
    assert.match(rowAt(0).textContent, /Active/);
    assert.match(rowAt(0).textContent, /Header/);
    assert.match(rowAt(0).textContent, /Product badge/);
    assert.match(rowAt(2).textContent, /Scheduled/);
    assert.match(rowAt(2).textContent, /Starts 1 Dec 2026/);
    assert.match(rowAt(2).textContent, /Customer restricted/);
    assert.equal(button('Save').disabled, true, 'nothing to save yet');

    await click(rowAt(0).querySelector('s-button[accessibilityLabel="Move Halloween sale down"], s-button[accessibilitylabel="Move Halloween sale down"]'));
    assert.deepEqual(titles(), ['Free shipping', 'Halloween sale', 'Costume badge']);
    assert.equal(button('Save').disabled, false);
    await drag(2, 0);
    assert.deepEqual(titles(), ['Costume badge', 'Free shipping', 'Halloween sale'], 'dragging puts the promotion in the target position');
    assert.equal(rowAt(0).querySelector('s-button[accessibilitylabel="Move Costume badge up"]').hasAttribute('disabled'), true, 'the top row cannot move up');
    assert.equal(rowAt(2).querySelector('s-button[accessibilitylabel="Move Halloween sale down"]').hasAttribute('disabled'), true, 'the bottom row cannot move down');
    assert.match(document.body.textContent, /Moved Halloween sale to position 3 of 3|Moved Costume badge to position 1 of 3/);

    await click(button('Discard'));
    assert.deepEqual(titles(), ['Halloween sale', 'Free shipping', 'Costume badge']);
    assert.equal(button('Save').disabled, true);
    assert.equal(page.submissions.length, 0, 'discarding sends nothing');
  } finally { await page.unmount(); }
});

test('saving sends the new order as priorities, top first, and confirms with a toast', async () => {
  toast = undefined;
  const page = await mountPage({ rows: three() });
  try {
    await drag(2, 0);
    await click(button('Save'));
    await wait();
    assert.deepEqual(page.submissions, [[
      { id: 'gid://shopify/DiscountNode/3', priority: 3, expectedPriority: 10 },
      { id: 'gid://shopify/DiscountNode/1', priority: 2, expectedPriority: 30 },
      { id: 'gid://shopify/DiscountNode/2', priority: 1, expectedPriority: 20 },
    ]], 'every promotion gets a unique priority, highest at the top, checked against what was loaded');
    assert.equal(toast, 'Priority order saved');
    assert.deepEqual(titles(), ['Costume badge', 'Halloween sale', 'Free shipping'], 'the saved order is what comes back');
    assert.equal(button('Save').disabled, true, 'nothing is left to save');
  } finally { await page.unmount(); }
});

test('a failed save says why and keeps the order that was arranged', async () => {
  const page = await mountPage({ rows: three(), respond: () => ({ success: false, error: 'A priority was changed elsewhere.' }) });
  try {
    await click(rowAt(1).querySelector('s-button[accessibilitylabel="Move Free shipping up"]'));
    await click(button('Save'));
    await wait();
    const banner = document.querySelector('s-banner[tone=critical]');
    assert.equal(banner.getAttribute('heading'), 'Not saved');
    assert.match(banner.textContent, /changed elsewhere/);
    assert.deepEqual(titles(), ['Free shipping', 'Halloween sale', 'Costume badge']);
  } finally { await page.unmount(); }
});

test('a promotion that has just entered the order is pointed out, and promotions that cannot appear are explained', async () => {
  const page = await mountPage({ rows: three(), search: '?highlight=1', hidden: [{ id: 'gid://shopify/DiscountNode/9', routeId: '9', title: 'Draft offer', reason: 'Its website status is Draft.' }, { id: 'gid://shopify/DiscountNode/8', routeId: '8', title: 'Old offer', reason: 'It has ended.' }] });
  try {
    const banner = document.querySelector('s-banner[tone=info]');
    assert.equal(banner.getAttribute('heading'), 'Set where Halloween sale ranks');
    assert.match(banner.textContent, /starts at the top/);
    assert.equal(rowAt(0).getAttribute('aria-current'), 'true');
    assert.ok(document.querySelector('s-section[heading="Not in the order (2)"]'));
    assert.match(document.body.textContent, /Draft offer: Its website status is Draft\./);
    assert.match(document.body.textContent, /Old offer: It has ended\./);
  } finally { await page.unmount(); }
});

test('an empty order explains how a promotion joins it', async () => {
  const page = await mountPage({ rows: [] });
  try {
    assert.match(document.body.textContent, /No promotions are in the order yet/);
    assert.equal(document.querySelectorAll('[role=listitem]').length, 0);
  } finally { await page.unmount(); }
});

test('moveTo places an item at the position of another and ignores moves that go nowhere', () => {
  assert.deepEqual(moveTo(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveTo(['a', 'b', 'c', 'd'], 3, 1), ['a', 'd', 'b', 'c']);
  const same = ['a', 'b'];
  assert.equal(moveTo(same, 1, 1), same);
  assert.equal(moveTo(same, 0, 5), same);
  assert.equal(moveTo(same, -1, 0), same);
});
