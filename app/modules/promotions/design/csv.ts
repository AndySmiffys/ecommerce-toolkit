// Tables downloaded from the Reports pages. Text that a spreadsheet could read as a formula (it starts with =, +, - or @)
// is prefixed with an apostrophe, so a discount title cannot run anything when the file is opened in Excel.

export type Cell = string | number | null | undefined;

function escape(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  let text = String(cell);
  if (typeof cell === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Comma-separated text with a header line, ready to save as a .csv file. A byte-order mark makes Excel read it as UTF-8. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  return "﻿" + [headers, ...rows].map(line => line.map(escape).join(",")).join("\r\n") + "\r\n";
}

/** Money in minor units as a plain decimal for a spreadsheet, for example 123456 as 1234.56. */
export const decimal = (cents: number) => (cents / 100).toFixed(2);
