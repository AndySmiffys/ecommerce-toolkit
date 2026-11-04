import test from "node:test";
import assert from "node:assert/strict";
import { fromCells, hasFormat, plainText, toCells, toggleFormat } from "../app/modules/shipping/richText";

test("a message is edited as one cell per character, and writes back to the same text", () => {
  for (const text of ["", "plain", "[bold]a[/bold] b", "a [highlight]b[/highlight]", "[bold]a [highlight]b[/highlight][/bold] c", "[bold][highlight]all[/highlight][/bold]", "x [highlight]y[/highlight] [bold]z[/bold]"]) {
    assert.equal(fromCells(toCells(text)), text, text);
  }
  assert.equal(toCells("[bold]ab[/bold]c").length, 3);
  assert.deepEqual(toCells("[bold]a[/bold]b"), [{ char: "a", bold: true, highlight: false }, { char: "b", bold: false, highlight: false }]);
  assert.equal(plainText("Order [bold]now[/bold] for [highlight]free[/highlight]"), "Order now for free");
});

test("text written by hand in a different shape is tidied when it is next edited", () => {
  assert.equal(fromCells(toCells("[highlight][bold]a[/bold][/highlight]")), "[bold][highlight]a[/highlight][/bold]", "one consistent nesting");
  assert.equal(fromCells(toCells("[bold]a[/bold][bold]b[/bold]")), "[bold]ab[/bold]", "no tag repeated for nothing");
  assert.equal(fromCells(toCells("[highlight]a[/highlight][highlight]b[/highlight]")), "[highlight]ab[/highlight]");
  assert.equal(fromCells(toCells("a[/bold]b[bold]c")), "ab[bold]c[/bold]", "what was not balanced is repaired");
});

test("selected characters become bold, or lose it when they all have it", () => {
  assert.equal(toggleFormat("Order now please", 6, 9, "bold"), "Order [bold]now[/bold] please");
  assert.equal(toggleFormat("Order [bold]now[/bold] please", 6, 9, "bold"), "Order now please", "the same selection again turns it off");
  assert.equal(toggleFormat("Order [bold]now[/bold] please", 0, 16, "bold"), "[bold]Order now please[/bold]", "part bold: the rest joins it, rather than undoing it");
  assert.equal(toggleFormat("Order now please", 6, 9, "highlight"), "Order [highlight]now[/highlight] please");
  assert.equal(toggleFormat("abc", 1, 1, "bold"), "abc", "nothing selected, nothing changes");
  assert.equal(toggleFormat("abc", 2, 0, "bold"), "[bold]ab[/bold]c", "a selection made backwards is the same");
  assert.equal(toggleFormat("abc", -5, 99, "bold"), "[bold]abc[/bold]", "a selection past the ends is clamped");
});

test("the two formats combine, in either order, and come off one at a time", () => {
  const bold = toggleFormat("Last orders soon", 5, 11, "bold");
  const both = toggleFormat(bold, 5, 11, "highlight");
  assert.equal(both, "Last [bold][highlight]orders[/highlight][/bold] soon");
  assert.equal(toggleFormat(toggleFormat("Last orders soon", 5, 11, "highlight"), 5, 11, "bold"), both, "the order they were applied in does not matter");
  assert.equal(toggleFormat(both, 5, 11, "bold"), "Last [highlight]orders[/highlight] soon");
  assert.equal(toggleFormat(both, 5, 11, "highlight"), "Last [bold]orders[/bold] soon");
  assert.equal(toggleFormat(toggleFormat(both, 5, 11, "bold"), 5, 11, "highlight"), "Last orders soon");
  // Overlapping formats: bold over most of it, then highlight over a different stretch.
  assert.equal(toggleFormat("[bold]abcd[/bold]ef", 2, 6, "highlight"), "[bold]ab[highlight]cd[/highlight][/bold][highlight]ef[/highlight]");
});

test("the buttons know what a selection already has", () => {
  const text = "a [bold]b[/bold] [highlight]c[/highlight] [bold][highlight]d[/highlight][/bold]";
  assert.equal(hasFormat(text, 2, 3, "bold"), true);
  assert.equal(hasFormat(text, 2, 3, "highlight"), false);
  assert.equal(hasFormat(text, 4, 5, "highlight"), true);
  assert.equal(hasFormat(text, 6, 7, "bold"), true, "both on the last word");
  assert.equal(hasFormat(text, 6, 7, "highlight"), true);
  assert.equal(hasFormat(text, 0, 3, "bold"), false, "only part of the selection");
  assert.equal(hasFormat(text, 2, 2, "bold"), false, "nothing selected");
});

test("positions count the way the browser does, in code units, so emoji and accents survive", () => {
  const word = "Café ☕ ready";
  const marked = toggleFormat(word, 0, 4, "bold");
  assert.equal(marked, "[bold]Café[/bold] ☕ ready");
  assert.equal(plainText(marked), word);
  const emoji = toggleFormat("a😀b", 1, 3, "highlight");
  assert.equal(emoji, "a[highlight]😀[/highlight]b", "a character made of two code units is formatted as one");
  assert.equal(toggleFormat(emoji, 1, 3, "highlight"), "a😀b");
});
