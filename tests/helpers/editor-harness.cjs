/* eslint-env node */
/* global globalThis */
// Shared setup for the tests that mount the real promotion editor in jsdom: browser globals,
// stand-ins for Shopify's custom elements, a build of the editor, and helpers to drive it.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');
const React = require('react');

// The router and fetchers settle on their own after a test has awaited them, which React reports as an update
// outside act(). Those reports are noise here, so only that one message is dropped; every other error still shows.
const reportError = console.error;
console.error = (...args) => { if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return; reportError(...args); };

const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.example/app/promotions/new', pretendToBeVisual: true });
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event, ResizeObserver: ResizeObserverStub, IS_REACT_ACT_ENVIRONMENT: true });
dom.window.ResizeObserver = ResizeObserverStub;

class SaveBar extends HTMLElement { show() { this.open = true; } hide() { this.open = false; } }
dom.window.customElements.define('ui-save-bar', SaveBar);
// Polaris fields expose their value as a property, which React 18 does not set on unknown elements.
class Field extends HTMLElement {
  // Like Shopify's fields, a new value attribute replaces whatever was typed.
  static get observedAttributes() { return ['value']; }
  attributeChangedCallback() { this.currentValue = undefined; }
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
// Shopify's modal is opened and closed with these methods, and says when it has finished closing.
dom.window.customElements.define('s-modal', class extends HTMLElement {
  showOverlay() { this.isOpen = true; this.dispatchEvent(new window.Event('show')); }
  hideOverlay() { if (!this.isOpen) return; this.isOpen = false; this.dispatchEvent(new window.Event('hide')); setTimeout(() => this.dispatchEvent(new window.Event('afterhide')), 0); }
});

const toasts = [];
dom.window.shopify = { toast: { show: message => toasts.push(message) }, resourcePicker: async () => undefined };
const { createRoot } = require('react-dom/client');
const { createMemoryRouter, RouterProvider, useParams } = require('react-router');

const rawPlugin = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: fs.readFileSync(args.path, 'utf8'), loader: 'text' }));
  },
};

const wait = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));

async function loadEditor() {
  const result = await build({
    stdin: { contents: "export { PromotionEditor } from './app/modules/promotions/components/PromotionEditor'; export { placeholderDraft } from './app/modules/promotions/design/stepValidation';", resolveDir: process.cwd(), loader: 'ts', sourcefile: 'entry.ts' },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false, plugins: [rawPlugin],
  });
  const compiled = new Module(__filename); compiled.paths = module.paths;
  compiled._compile(result.outputFiles[0].text, __filename);
  return compiled.exports;
}

/**
 * Mount the editor at `url`. `respond(intent, payload)` answers the editor's form posts; every post is
 * recorded in `requests`. The editor's other endpoints (preview, assets, link picker) are stubbed.
 */
async function mount(Editor, props, url, { respond = () => ({}) } = {}) {
  const container = document.createElement('div'); document.body.appendChild(container);
  const requests = [];
  const answer = async ({ request }) => {
    const data = Object.fromEntries((await request.formData()).entries());
    const payload = data.payload ? JSON.parse(data.payload) : undefined;
    requests.push({ intent: data.intent, data, payload });
    const base = data.intent === 'searchResources' ? { resources: [] } : data.intent === 'searchEligibility' ? { eligibilityResources: [] } : { success: true };
    return { ...base, ...respond(data.intent, payload, data) };
  };
  const stub = () => ({ key: '', products: [], resources: [], eligibilityResources: [], error: null });
  const Landed = () => React.createElement('div', { id: 'landed' }, useParams().id);
  const router = createMemoryRouter([
    { path: '/app/promotions/new', Component: () => React.createElement(Editor, props), action: answer },
    { path: '/app/promotions/:id', Component: Landed },
    { path: '/app/promotion-preview', action: stub },
    { path: '/app/promotion-assets', action: stub },
    { path: '/app/link-destinations', loader: stub },
  ], { initialEntries: [url] });
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(RouterProvider, { router })); await wait(); });
  return { container, router, requests, unmount: async () => { await React.act(async () => root.unmount()); router.dispose(); container.remove(); } };
}

const find = (container, selector) => container.querySelector(selector);
const findAll = (container, selector) => [...container.querySelectorAll(selector)];
const byText = (container, tag, text) => findAll(container, tag).find(element => element.textContent.trim() === text);
const step = (container, id) => find(container, `details[data-step=${id}]`);
async function settle(ms = 30) { await React.act(async () => { await wait(ms); }); }
async function type(element, value, event = 'input') { await React.act(async () => { element.value = value; element.dispatchEvent(new window.Event(event, { bubbles: true })); await wait(); }); }
async function change(element, values) { await React.act(async () => { if (Array.isArray(values)) element.values = values; else element.value = values; element.dispatchEvent(new window.Event('change', { bubbles: true })); await wait(); }); }
async function check(element, checked = true) { await React.act(async () => { element.checked = checked; element.dispatchEvent(new window.Event('change', { bubbles: true })); await wait(); }); }
async function click(element) { await React.act(async () => { element.click(); await wait(); }); }

module.exports = { React, loadEditor, mount, find, findAll, byText, step, settle, type, change, check, click, wait, toasts, window: dom.window };
