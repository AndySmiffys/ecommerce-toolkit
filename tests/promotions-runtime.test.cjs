const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const script = readFileSync('extensions/promotion-engine/assets/promotion-ui.js', 'utf8');
function harness(clipboard, fallback = false) {
  let now = Date.parse('2026-10-10T00:00:00Z') - 61000;
  const units = {}, listeners = {}, intervals = new Map(), timeouts = new Map();
  let sequence = 0;
  const values = Object.fromEntries(['days', 'hours', 'minutes', 'seconds'].map(unit => [unit, {}]));
  const ended = {};
  const timer = { dataset: { peCountdown: '2026-10-10T00:00:00Z' }, querySelector(selector) {
    if (selector === '[data-pe-compact-value]') return null;
    if (selector === '[data-pe-units]') return units;
    if (selector === '[data-pe-ended]') return ended;
    return values[selector.match(/"(\w+)"/)[1]];
  }, setAttribute(name, value) { this[name] = value; } };
  const label = {}, status = {};
  const button = { dataset: { peCopyCode: 'SAVE20' }, querySelector: () => label, parentElement: { querySelector: () => status }, focus() {} };
  let textareas = 0;
  const root = { querySelectorAll: () => [timer], contains: target => target === button, append: () => { textareas++; }, addEventListener(name, handler) { listeners[name] = handler; }, removeEventListener(name) { delete listeners[name]; } };
  const window = { dispatchEvent() {} };
  runInNewContext(script, { window, navigator: { clipboard }, document: { querySelector: () => null, createElement: () => ({ style: {}, focus() {}, select() {}, remove() { textareas--; } }), execCommand: () => fallback }, Event: class {}, Date: { now: () => now, parse: Date.parse }, setInterval(fn) { intervals.set(++sequence, fn); return sequence; }, clearInterval(id) { intervals.delete(id); }, setTimeout(fn) { timeouts.set(++sequence, fn); return sequence; }, clearTimeout(id) { timeouts.delete(id); } });
  const cleanup = window.SmiffysPromotionUI.mount(root);
  return { values, units, ended, timer, label, status, button, intervals, timeouts, cleanup, click: () => listeners.click({ target: { closest: () => button } }), advance(ms) { now += ms; intervals.forEach(fn => fn()); }, get textareas() { return textareas; }, get listening() { return Boolean(listeners.click); } };
}
test('live timer ticks to expiry and mount cleanup removes timers and listener', () => {
  const h = harness();
  assert.equal(h.values.minutes.textContent, '01');
  assert.equal(h.values.seconds.textContent, '01');
  h.advance(1000);
  assert.equal(h.values.seconds.textContent, '00');
  h.advance(60000);
  assert.equal(h.units.hidden, true);
  assert.equal(h.ended.hidden, false);
  assert.equal(h.timer['aria-label'], 'Offer ended');
  h.cleanup();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.listening, false);
});
test('copy uses actual code, announces success and restores button', async () => {
  let code;
  const h = harness({ async writeText(value) { code = value; } });
  await h.click();
  assert.equal(code, 'SAVE20');
  assert.equal(h.label.textContent, 'Copied');
  assert.equal(h.status.textContent, 'Discount code copied.');
  assert.equal(h.button.disabled, true);
  h.timeouts.forEach(fn => fn());
  assert.equal(h.button.disabled, false);
  assert.equal(h.label.textContent, 'Copy code');
  h.cleanup();
});
test('clipboard blocking uses fallback and reports failure honestly', async () => {
  for (const fallback of [true, false]) {
    const h = harness({ async writeText() { throw new Error('Denied'); } }, fallback);
    await h.click();
    assert.equal(h.label.textContent, fallback ? 'Copied' : 'Copy code');
    assert.match(h.status.textContent, fallback ? /Discount code copied/ : /copy it manually/);
    assert.equal(h.textareas, 0);
    h.cleanup();
    assert.equal(h.timeouts.size, 0);
  }
});
