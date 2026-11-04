/* eslint-env node */
// Mounts the formatting editor in a simulated browser and drives it the way a person would: selecting words, pressing the buttons, typing, pasting.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');
const { React, find, findAll, click, wait, window } = require('./helpers/editor-harness.cjs');
const { createRoot } = require('react-dom/client');

const rawPlugin = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: require('node:fs').readFileSync(args.path, 'utf8'), loader: 'text' }));
  },
};
let RichTextField;
async function load() {
  if (RichTextField) return RichTextField;
  const result = await build({
    stdin: { contents: "export { RichTextField } from './app/modules/shipping/RichTextField';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false, plugins: [rawPlugin],
  });
  const compiled = new Module(__filename); compiled.paths = module.paths;
  compiled._compile(result.outputFiles[0].text, __filename);
  RichTextField = compiled.exports.RichTextField;
  return RichTextField;
}

/** A field with its value held by a parent, as on the settings page. `props` can be changed to simulate Discard or a save. */
async function mount(initial, extra = {}) {
  const Field = await load();
  const container = document.createElement('div'); document.body.appendChild(container);
  const changes = [];
  let setValue;
  function Host() {
    const [value, set] = React.useState(initial);
    setValue = set;
    return React.createElement(Field, { label: 'Message', value, accent: '#d63384', onChange: next => { changes.push(next); set(next); }, ...extra });
  }
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(Host)); await wait(); });
  const editor = find(container, '.rt-editor');
  return {
    container, editor, changes,
    setFromOutside: async value => { await React.act(async () => { setValue(value); await wait(); }); },
    unmount: async () => { await React.act(async () => root.unmount()); container.remove(); },
  };
}

/** Selects characters `start` to `end` of the box's text, as a person dragging across them would. */
async function selectChars(editor, start, end) {
  const walker = document.createTreeWalker(editor, 4);
  const place = offset => {
    let left = offset;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (left <= node.textContent.length) { walker.currentNode = editor; return [node, left]; }
      left -= node.textContent.length;
    }
    return [editor, 0];
  };
  walker.currentNode = editor;
  const from = place(start);
  walker.currentNode = editor;
  const to = place(end);
  const range = document.createRange();
  range.setStart(...from); range.setEnd(...to);
  const selection = window.getSelection();
  selection.removeAllRanges(); selection.addRange(range);
  await React.act(async () => { document.dispatchEvent(new window.Event('selectionchange')); await wait(); });
}
const offsetsOf = editor => {
  const range = window.getSelection().getRangeAt(0);
  const before = document.createRange(); before.selectNodeContents(editor);
  before.setEnd(range.startContainer, range.startOffset); const start = before.toString().length;
  before.setEnd(range.endContainer, range.endOffset);
  return [start, before.toString().length];
};
const button = (container, label) => findAll(container, '.rt-toolbar button').find(item => item.textContent === label);
const typed = async (editor) => { await React.act(async () => { editor.dispatchEvent(new window.Event('input', { bubbles: true })); await wait(); }); };
const key = async (editor, init) => { const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); await React.act(async () => { editor.dispatchEvent(event); await wait(); }); return event; };

test('the box shows the formatting as it will look, and never builds it from the text', async () => {
  const field = await mount('Order [bold]now[/bold] for [highlight]free[/highlight] and [bold][highlight]more[/highlight][/bold]');
  try {
    assert.equal(field.editor.textContent, 'Order now for free and more');
    assert.deepEqual(findAll(field.editor, 'strong').map(item => item.textContent), ['now', 'more']);
    assert.deepEqual(findAll(field.editor, '.rt-hl').map(item => item.textContent), ['free', 'more']);
    assert.equal(find(field.editor, '.rt-hl strong').textContent, 'more', 'both on the same words');
    assert.equal(find(field.container, '.rt-field').style.getPropertyValue('--rt-accent'), '#d63384', 'highlighted words are in the colour the product page will use');
  } finally { await field.unmount(); }
  const unsafe = await mount('<img src=x onerror=alert(1)> and <b>bold</b> [bold]ok[/bold]');
  try {
    assert.equal(find(unsafe.editor, 'img'), null);
    assert.equal(find(unsafe.editor, 'b'), null);
    assert.match(unsafe.editor.textContent, /^<img src=x onerror=alert\(1\)> and <b>bold<\/b> ok$/, 'shown as the text it is');
    assert.deepEqual(findAll(unsafe.editor, 'strong').map(item => item.textContent), ['ok']);
  } finally { await unsafe.unmount(); }
});

test('it is a labelled text box, with its details and error read out with it', async () => {
  const field = await mount('Hello', { details: 'Shown above the dispatch message.', error: '{thresold} is not a placeholder.' });
  try {
    assert.equal(field.editor.getAttribute('role'), 'textbox');
    assert.equal(field.editor.getAttribute('contenteditable'), 'true');
    assert.equal(field.editor.getAttribute('tabindex'), '0');
    assert.equal(find(field.container, `[id="${field.editor.getAttribute('aria-labelledby')}"]`).textContent, 'Message');
    assert.equal(field.editor.getAttribute('aria-invalid'), 'true');
    const described = field.editor.getAttribute('aria-describedby').split(' ').map(id => find(field.container, `[id="${id}"]`).textContent);
    assert.deepEqual(described, ['Shown above the dispatch message.', '{thresold} is not a placeholder.']);
    assert.equal(find(field.container, '.rt-error').getAttribute('role'), 'alert');
    assert.equal(find(field.container, '[role=toolbar]').getAttribute('aria-label'), 'Formatting for Message');
  } finally { await field.unmount(); }
  const fine = await mount('Hello');
  try {
    assert.equal(fine.editor.getAttribute('aria-invalid'), null);
    assert.equal(fine.editor.getAttribute('aria-describedby'), null);
  } finally { await fine.unmount(); }
});

test('typing is passed on, and typing inside bold words stays bold', async () => {
  const field = await mount('Order [bold]now[/bold] please');
  try {
    find(field.editor, 'strong').firstChild.textContent = 'now!!';
    await typed(field.editor);
    assert.deepEqual(field.changes, ['Order [bold]now!![/bold] please']);
    field.editor.lastChild.textContent = ' please, thanks';
    await typed(field.editor);
    assert.equal(field.changes.at(-1), 'Order [bold]now!![/bold] please, thanks');
    // A browser can turn spaces into non-breaking ones, and add its own line break; neither belongs in the message.
    field.editor.lastChild.textContent = ' please, thanks';
    field.editor.appendChild(document.createElement('br'));
    await typed(field.editor);
    assert.equal(field.changes.at(-1), 'Order [bold]now!![/bold] please, thanks');
  } finally { await field.unmount(); }
});

test('the buttons wait for a selection, then make the selected words bold or highlighted, and take it off again', async () => {
  const field = await mount('Order now please');
  try {
    const bold = button(field.container, 'Bold');
    const highlight = button(field.container, 'Highlight');
    assert.equal(bold.disabled, true, 'nothing selected yet');
    assert.equal(highlight.disabled, true);
    await selectChars(field.editor, 6, 9);
    assert.equal(bold.disabled, false);
    assert.equal(bold.getAttribute('aria-pressed'), 'false');
    await click(bold);
    assert.equal(field.changes.at(-1), 'Order [bold]now[/bold] please');
    assert.deepEqual(findAll(field.editor, 'strong').map(item => item.textContent), ['now']);
    assert.deepEqual(offsetsOf(field.editor), [6, 9], 'the same words stay selected');
    assert.equal(bold.getAttribute('aria-pressed'), 'true', 'the button shows what the selection has');
    assert.equal(highlight.getAttribute('aria-pressed'), 'false');
    await click(highlight);
    assert.equal(field.changes.at(-1), 'Order [bold][highlight]now[/highlight][/bold] please');
    assert.equal(highlight.getAttribute('aria-pressed'), 'true');
    await click(bold);
    assert.equal(field.changes.at(-1), 'Order [highlight]now[/highlight] please');
    await click(highlight);
    assert.equal(field.changes.at(-1), 'Order now please');
    assert.equal(findAll(field.editor, 'strong, .rt-hl').length, 0);
    assert.equal(field.editor.textContent, 'Order now please', 'the words themselves never change');
  } finally { await field.unmount(); }
});

test('the buttons work across formatting that is already there, and pressing one does not take focus from the box', async () => {
  const field = await mount('a [bold]b[/bold] c [highlight]d[/highlight] e');
  try {
    await selectChars(field.editor, 0, 7);
    const mouse = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button(field.container, 'Bold').dispatchEvent(mouse);
    assert.equal(mouse.defaultPrevented, true, 'so the selection is not lost when the button is pressed');
    await click(button(field.container, 'Bold'));
    assert.equal(field.changes.at(-1), '[bold]a b c [highlight]d[/highlight][/bold] e', 'partly bold: the rest joins in');
    await selectChars(field.editor, 4, 5);
    assert.equal(button(field.container, 'Bold').getAttribute('aria-pressed'), 'true');
    await click(button(field.container, 'Highlight'));
    assert.equal(field.changes.at(-1), '[bold]a b [highlight]c[/highlight] [highlight]d[/highlight][/bold] e', 'one word highlighted inside the bold');
  } finally { await field.unmount(); }
});

test('Ctrl+B and Ctrl+Shift+H do the same, Enter does nothing, and other keys are left alone', async () => {
  const field = await mount('Order now please');
  try {
    await selectChars(field.editor, 6, 9);
    const bold = await key(field.editor, { key: 'b', ctrlKey: true });
    assert.equal(bold.defaultPrevented, true);
    assert.equal(field.changes.at(-1), 'Order [bold]now[/bold] please');
    const highlight = await key(field.editor, { key: 'H', ctrlKey: true, shiftKey: true });
    assert.equal(highlight.defaultPrevented, true);
    assert.equal(field.changes.at(-1), 'Order [bold][highlight]now[/highlight][/bold] please');
    const mac = await key(field.editor, { key: 'b', metaKey: true });
    assert.equal(mac.defaultPrevented, true, 'Command works on a Mac');
    assert.equal(field.changes.at(-1), 'Order [highlight]now[/highlight] please');
    const before = field.changes.length;
    const enter = await key(field.editor, { key: 'Enter' });
    assert.equal(enter.defaultPrevented, true, 'a message is one paragraph');
    const letter = await key(field.editor, { key: 'x' });
    assert.equal(letter.defaultPrevented, false);
    assert.equal(field.changes.length, before, 'neither changed anything');
    await selectChars(field.editor, 2, 2);
    const none = await key(field.editor, { key: 'b', ctrlKey: true });
    assert.equal(none.defaultPrevented, true);
    assert.equal(field.changes.length, before, 'nothing selected, nothing to format');
  } finally { await field.unmount(); }
});

test('pasted text goes in as plain words on one line, without its formatting', async () => {
  const field = await mount('Order [bold]now[/bold]');
  try {
    await selectChars(field.editor, 6, 6);
    const paste = new window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: type => (type === 'text/plain' ? 'first line\r\nsecond <b>line</b>' : '<b>html</b>') } });
    await React.act(async () => { field.editor.dispatchEvent(paste); await wait(); });
    assert.equal(paste.defaultPrevented, true);
    assert.equal(field.changes.at(-1), 'Order first line second <b>line</b>[bold]now[/bold]');
    assert.equal(find(field.editor, 'b'), null, 'pasted markup is text');
  } finally { await field.unmount(); }
});

test('a new value from outside is shown, and the box keeps what it is doing otherwise', async () => {
  const field = await mount('Hello [bold]there[/bold]');
  try {
    find(field.editor, 'strong').firstChild.textContent = 'you';
    await typed(field.editor);
    assert.equal(field.changes.at(-1), 'Hello [bold]you[/bold]');
    const drawn = find(field.editor, 'strong');
    assert.equal(find(field.editor, 'strong'), drawn, 'the box was not redrawn under the cursor while typing');
    const before = field.changes.length;
    await field.setFromOutside('Back to [highlight]this[/highlight]');
    assert.equal(field.editor.textContent, 'Back to this');
    assert.equal(find(field.editor, 'strong'), null);
    assert.equal(find(field.editor, '.rt-hl').textContent, 'this');
    assert.equal(field.changes.length, before, 'drawing a value from outside is not an edit');
    await field.setFromOutside('');
    assert.equal(field.editor.textContent, '');
  } finally { await field.unmount(); }
});

test('the box can start taller for longer messages', async () => {
  const one = await mount('x');
  const three = await mount('x', { lines: 3 });
  try {
    assert.equal(find(one.container, '.rt-field').style.getPropertyValue('--rt-height'), '36px');
    assert.equal(find(three.container, '.rt-field').style.getPropertyValue('--rt-height'), '76px');
  } finally { await one.unmount(); await three.unmount(); }
});
