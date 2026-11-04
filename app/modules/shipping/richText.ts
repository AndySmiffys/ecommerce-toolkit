import { shippingLogic } from "./logic";

/**
 * The editing model behind the formatting editor. A message is stored as text with [bold] and [highlight] tags (what the product page reads),
 * but is edited as one cell per character with what applies to it, so "make these characters bold" is the same operation whatever tags
 * are already there. The reader is the storefront script's own, so the editor and the product page cannot disagree about what a message means.
 */

export type Format = "bold" | "highlight";
export type Cell = { char: string; bold: boolean; highlight: boolean };

/** One cell per UTF-16 code unit, which is how the browser counts positions in the editor. */
export function toCells(markup: string): Cell[] {
  return shippingLogic.parseRich(markup).flatMap(run => run.text.split("").map(char => ({ char, bold: run.bold, highlight: run.highlight })));
}

/** The stored text for some cells: bold outside, highlight inside, and runs that touch joined so no tag is repeated for nothing. */
export function fromCells(cells: Cell[]): string {
  let out = "";
  let i = 0;
  while (i < cells.length) {
    let j = i;
    while (j < cells.length && cells[j].bold === cells[i].bold && cells[j].highlight === cells[i].highlight) j++;
    let piece = cells.slice(i, j).map(cell => cell.char).join("");
    if (cells[i].highlight) piece = `[highlight]${piece}[/highlight]`;
    if (cells[i].bold) piece = `[bold]${piece}[/bold]`;
    out += piece;
    i = j;
  }
  let before: string;
  do {
    before = out;
    out = out.replace("[/highlight][/bold][bold][highlight]", "").replace("[/bold][bold]", "").replace("[/highlight][highlight]", "");
  } while (out !== before);
  return out;
}

/** The words with no formatting at all. */
export const plainText = (markup: string) => toCells(markup).map(cell => cell.char).join("");

/** Whether every character from `start` to `end` has the format. False for nothing selected. */
export function hasFormat(markup: string, start: number, end: number, format: Format): boolean {
  const range = toCells(markup).slice(Math.max(0, start), Math.max(0, end));
  return range.length > 0 && range.every(cell => cell[format]);
}

/** Turns the format on for the selected characters, or off when they all have it already. Nothing selected changes nothing. */
export function toggleFormat(markup: string, start: number, end: number, format: Format): string {
  const cells = toCells(markup);
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(cells.length, Math.max(start, end));
  if (from >= to) return markup;
  const turnOn = !cells.slice(from, to).every(cell => cell[format]);
  return fromCells(cells.map((cell, index) => (index >= from && index < to ? { ...cell, [format]: turnOn } : cell)));
}
