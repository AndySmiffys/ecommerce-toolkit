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
const { createRoot } = require('react-dom/client');
const { createMemoryRouter, RouterProvider, Outlet, useLoaderData } = require('react-router');
const bundled = buildSync({ entryPoints: ['app/modules/promotions/components/PromotionPriorityManager.tsx'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false, plugins: [] });
const component = new Module(__filename); component.paths = module.paths;
component._compile(bundled.outputFiles[0].text, __filename);
const { PromotionPriorityManager } = component.exports;
class NumberField extends HTMLElement {
  get value() { return this.currentValue ?? this.getAttribute('value'); }
  set value(value) { this.currentValue = value; }
}
window.customElements.define('s-number-field', NumberField);
window.shopify = {};
const wait = () => new Promise(resolve => setTimeout(resolve, 30));
test('Editing priority shares values across placements, supports Discard, and submits one priority-only save', async () => {
  let priority = 17, submitted, fail = false;
  const row = () => ({ id: 'gid://shopify/DiscountNode/1', routeId: '1', title: 'Offer 1', priority, audience: 'All customers', status: 'Available', detail: 'Eligible' });
  const sections = () => [{ id: 'header', title: 'Header', rows: [row()] }, { id: 'product', title: 'Product', rows: [row()] }];
  function Page() { const data = useLoaderData(); return React.createElement(PromotionPriorityManager, { ...data, refreshing: false, onRefresh() {} }); }
  const router = createMemoryRouter([{ path: '/app', id: 'routes/app', loader: () => ({ shop: 'test.myshopify.com' }), Component: Outlet, children: [{ path: 'storefront-priorities', Component: Page, loader: () => ({ sections: sections(), errors: [] }), action: async ({ request }) => {
    submitted = JSON.parse((await request.formData()).get('changes'));
    if (fail) return { success: false, error: 'Save failed. Please retry.' };
    priority = submitted[0].priority;
    return { success: true, error: null };
  } }] }], { initialEntries: ['/app/storefront-priorities'] });
  const root = createRoot(document.getElementById('root'));
  const fields = () => [...document.querySelectorAll('s-number-field')];
  const button = label => [...document.querySelectorAll('button')].find(button => button.textContent === label);
  async function change(value, type = 'change') { await React.act(async () => { fields()[0].value = value; fields()[0].dispatchEvent(new window.Event(type)); }); }
  try {
    await React.act(async () => { root.render(React.createElement(RouterProvider, { router })); await wait(); });
    assert.equal(fields().length, 2);
    await change('100');
    assert.deepEqual(fields().map(field => field.value), ['100', '100']);
    assert.equal(button('Save').disabled, false);
    assert.match(document.body.textContent, /Unsaved changes/);
    await React.act(async () => button('Discard').click());
    assert.deepEqual(fields().map(field => field.value), ['17', '17']);
    assert.equal(submitted, undefined);
    assert.equal(button('Save'), undefined, 'the bar is hidden when nothing has changed');
    await change('10000', 'input');
    assert.equal(button('Save').disabled, true);
    assert.match(document.body.textContent, /Complete before saving: Enter whole-number priorities between 0 and 9999\./);
    await change('100', 'input');
    await React.act(async () => { button('Save').click(); await wait(); });
    assert.deepEqual(submitted, [{ id: 'gid://shopify/DiscountNode/1', priority: 100, expectedPriority: 17 }]);
    assert.deepEqual(fields().map(field => field.value), ['100', '100']);
    assert.equal(button('Save'), undefined, 'a saved form needs no Save button');
    assert.match(document.body.textContent, /Saved/);
    fail = true;
    await change('200');
    await React.act(async () => { button('Save').click(); await wait(); });
    assert.match(document.body.textContent, /Not saved: Save failed\. Please retry\./);
    assert.deepEqual(fields().map(field => field.value), ['200', '200']);
    await React.act(async () => button('Discard').click());
    assert.deepEqual(fields().map(field => field.value), ['100', '100']);
    assert.doesNotMatch(document.body.textContent, /Header connection check/);
  } finally { await React.act(async () => root.unmount()); router.dispose(); window.close(); }
});
