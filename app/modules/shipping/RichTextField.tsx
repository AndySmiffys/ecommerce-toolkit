import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { fromCells, hasFormat, toggleFormat, type Cell, type Format } from "./richText";
import { shippingLogic } from "./logic";

/**
 * A text box where words can be made bold or highlighted and the box shows it as you type, so nobody has to write [bold] or [highlight].
 * Shopify has no rich text field (the admin only offers plain ones), so this is built by hand and is one of the app's few exceptions to
 * using native components. Underneath it still holds the same text with tags, so the product page, the validation and anything saved before
 * this existed are unchanged. It is one paragraph: Enter does nothing, and pasted text loses its line breaks and its formatting.
 */

const css = `
.rt-field { display: grid; gap: 4px; min-width: 0; }
.rt-label { font-size: 13px; line-height: 20px; color: #303030; }
.rt-toolbar { display: flex; gap: 4px; }
.rt-toolbar button { font: inherit; font-size: 12px; line-height: 16px; padding: 2px 10px; border: 1px solid #c9c9c9; border-radius: 6px; background: #fff; color: #303030; cursor: pointer; }
.rt-toolbar button:hover:not(:disabled) { background: #f7f7f7; }
.rt-toolbar button[aria-pressed="true"] { background: #303030; border-color: #303030; color: #fff; }
.rt-toolbar button:disabled { color: #b5b5b5; cursor: default; }
.rt-toolbar button:focus-visible { outline: 2px solid #005bd3; outline-offset: 1px; }
.rt-editor { box-sizing: border-box; min-height: var(--rt-height, 36px); padding: 7px 12px; border: 1px solid #8a8a8a; border-radius: 8px; background: #fff; color: #303030; font-size: 13px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; outline: none; }
.rt-editor:focus { outline: 2px solid #005bd3; outline-offset: 1px; }
.rt-editor[aria-invalid="true"] { border-color: #8e1f0b; background: #fff5f3; }
.rt-hl { color: var(--rt-accent, #d63384); font-weight: 600; }
.rt-editor strong { font-weight: 700; }
.rt-details { font-size: 12px; line-height: 16px; color: #616161; }
.rt-error { font-size: 12px; line-height: 16px; color: #8e1f0b; }
`;

/** The editing box's content for some text: a text node for each run, wrapped, never built from strings, so nothing typed can become markup. */
function draw(root: HTMLElement, markup: string) {
  root.textContent = "";
  for (const run of shippingLogic.parseRich(markup)) {
    let node: Node = document.createTextNode(run.text);
    if (run.bold) { const strong = document.createElement("strong"); strong.appendChild(node); node = strong; }
    if (run.highlight) { const span = document.createElement("span"); span.className = "rt-hl"; span.appendChild(node); node = span; }
    root.appendChild(node);
  }
}

/** The text with its tags, read back from what is in the box. Anything the browser adds that is not bold or highlight counts as plain. */
function read(root: HTMLElement): string {
  const cells: Cell[] = [];
  const walk = (node: Node, bold: boolean, highlight: boolean) => {
    if (node.nodeType === 3) {
      for (const char of (node.textContent ?? "").replace(/\u00a0/g, " ").split("")) cells.push({ char, bold, highlight });
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    if (element.tagName === "BR") return;
    const isBold = bold || element.tagName === "STRONG" || element.tagName === "B";
    const isHighlight = highlight || element.classList.contains("rt-hl");
    element.childNodes.forEach(child => walk(child, isBold, isHighlight));
  };
  root.childNodes.forEach(child => walk(child, false, false));
  return fromCells(cells);
}

/** Where the selection starts and ends, as characters from the start of the box, or null when it is not in this box. */
function selectionIn(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  before.setEnd(range.endContainer, range.endOffset);
  return { start, end: before.toString().length };
}

function select(root: HTMLElement, start: number, end: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const find = (offset: number): { node: Node; offset: number } => {
    const walker = document.createTreeWalker(root, 4);
    let remaining = offset;
    let last: Node = root;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) return { node, offset: remaining };
      remaining -= length;
      last = node;
    }
    return last === root ? { node: root, offset: 0 } : { node: last, offset: last.textContent?.length ?? 0 };
  };
  const from = find(start);
  const to = find(end);
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function RichTextField({ label, value, onChange, accent, details, error, lines = 1 }: {
  label: string;
  /** The text with [bold] and [highlight] tags. */
  value: string;
  onChange: (value: string) => void;
  /** The colour highlighted words are shown in, the same one the product page uses. */
  accent: string;
  details?: string;
  error?: string;
  /** How many lines tall the box starts. It grows with what is written. */
  lines?: number;
}) {
  const id = useId();
  const editor = useRef<HTMLDivElement>(null);
  // The text the box is showing. A different value from outside (Discard, a save, a reset) is drawn; the box's own edits are not redrawn.
  const showing = useRef(value);
  const chosen = useRef({ start: 0, end: 0 });
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const latest = useRef(onChange); latest.current = onChange;

  useLayoutEffect(() => { if (editor.current) draw(editor.current, value); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (value === showing.current || !editor.current) return;
    showing.current = value;
    draw(editor.current, value);
  }, [value]);

  // Remember what is selected, so the buttons still know after they take focus, and show what the selection already has.
  useEffect(() => {
    const changed = () => {
      const root = editor.current;
      const found = root ? selectionIn(root) : null;
      if (!found) return;
      chosen.current = found;
      setSelection(current => (current.start === found.start && current.end === found.end ? current : found));
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, []);

  function edited() {
    if (!editor.current) return;
    const next = read(editor.current);
    showing.current = next;
    latest.current(next);
  }

  function format(kind: Format) {
    const root = editor.current;
    if (!root) return;
    const { start, end } = chosen.current;
    if (start === end) return;
    const next = toggleFormat(showing.current, start, end, kind);
    showing.current = next;
    draw(root, next);
    root.focus();
    select(root, Math.min(start, end), Math.max(start, end));
    latest.current(next);
  }

  function keyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter") { event.preventDefault(); return; }
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === "b") { event.preventDefault(); format("bold"); }
    else if (command && event.shiftKey && event.key.toLowerCase() === "h") { event.preventDefault(); format("highlight"); }
  }

  function paste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain").replace(/[\r\n]+/g, " ");
    const current = window.getSelection();
    if (!text || !current || current.rangeCount === 0) return;
    const range = current.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    current.removeAllRanges();
    current.addRange(range);
    edited();
  }

  const something = selection.start !== selection.end;
  const pressed = (kind: Format) => something && hasFormat(showing.current, selection.start, selection.end, kind);
  const style = { "--rt-accent": accent, "--rt-height": `${16 + lines * 20}px` } as CSSProperties;
  const labelId = `${id}-label`;
  const detailsId = `${id}-details`;
  const errorId = `${id}-error`;

  return <div className="rt-field" data-field={label} style={style}>
    <style>{css}</style>
    <span id={labelId} className="rt-label">{label}</span>
    <div className="rt-toolbar" role="toolbar" aria-label={`Formatting for ${label}`}>
      <button type="button" aria-pressed={pressed("bold")} disabled={!something} title="Select words, then press to make them bold (Ctrl+B)" onMouseDown={event => event.preventDefault()} onClick={() => format("bold")}><strong>Bold</strong></button>
      <button type="button" aria-pressed={pressed("highlight")} disabled={!something} title="Select words, then press to colour them like the countdown (Ctrl+Shift+H)" onMouseDown={event => event.preventDefault()} onClick={() => format("highlight")}><span style={{ color: accent, fontWeight: 600 }}>Highlight</span></button>
    </div>
    <div ref={editor} className="rt-editor" contentEditable suppressContentEditableWarning role="textbox" tabIndex={0} aria-multiline="false" aria-labelledby={labelId}
      aria-describedby={[details ? detailsId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined} aria-invalid={error ? true : undefined} spellCheck
      onInput={edited} onKeyDown={keyDown} onPaste={paste} />
    {details && <span id={detailsId} className="rt-details">{details}</span>}
    {error && <span id={errorId} className="rt-error" role="alert">{error}</span>}
  </div>;
}
