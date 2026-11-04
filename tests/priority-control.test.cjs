/* eslint-env node */
/* global globalThis */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { buildSync } = require('esbuild');
const Module = require('node:module');
const React = require('react');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.example' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = require('react-dom/client');
const bundled = buildSync({ entryPoints: ['app/modules/promotions/components/PolarisControls.tsx'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false });
const component = new Module(__filename); component.paths = module.paths;
component._compile(bundled.outputFiles[0].text, __filename);
const { PolarisNumberField } = component.exports;
class NumberField extends HTMLElement {
  get value() { return this.currentValue ?? this.getAttribute('value'); }
  set value(value) { this.currentValue = value; }
}
window.customElements.define('s-number-field', NumberField);
test('Priority captures committed stepper changes and non-bubbling input, and restores the saved value', async () => {
  let saved = 0;
  function Editor() {
    const [priority, setPriority] = React.useState(0);
    const update = event => setPriority(Number(event.currentTarget.value));
    return React.createElement(React.Fragment, null,
      React.createElement(PolarisNumberField, { label: 'Promotion priority', value: String(priority), onInput: update, onChange: update }),
      React.createElement('button', { onClick: () => { saved = priority; } }, 'Save'),
      React.createElement('button', { onClick: () => setPriority(saved) }, 'Discard'),
      React.createElement('output', null, priority));
  }
  const root = createRoot(document.getElementById('root'));
  try {
    // Reproduce the previous input-only control: a committed change never
    // reaches its handler, leaving the value submitted to Save unchanged.
    let previous = 0;
    await React.act(async () => root.render(React.createElement('s-number-field', { value: '0', onInput: event => { previous = Number(event.currentTarget.value); } })));
    const oldField = document.querySelector('s-number-field');
    await React.act(async () => { oldField.value = '100'; oldField.dispatchEvent(new window.Event('change', { bubbles: true })); });
    assert.equal(previous, 0);
    await React.act(async () => root.render(React.createElement(Editor)));
    const field = document.querySelector('s-number-field');
    await React.act(async () => { field.value = '100'; field.dispatchEvent(new window.Event('change')); });
    assert.equal(document.querySelector('output').textContent, '100');
    await React.act(async () => document.querySelector('button').click());
    assert.equal(saved, 100);
    await React.act(async () => { field.value = '250'; field.dispatchEvent(new window.Event('input')); });
    assert.equal(document.querySelector('output').textContent, '250');
    await React.act(async () => document.querySelectorAll('button')[1].click());
    assert.equal(field.value, '100');
  } finally { await React.act(async () => root.unmount()); window.close(); }
});
