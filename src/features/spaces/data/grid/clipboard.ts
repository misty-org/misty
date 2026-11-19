import Papa from "papaparse";

/*
 * Copy and paste as TSV, the format Excel, Numbers and Google Sheets put on the clipboard as
 * plain text, plus an HTML table for apps that prefer one. Copies within Data also carry the
 * cells as stored, so formulas paste as formulas, moved like Excel moves them.
 */

export const workbookClipboardType = "application/x-misty-workbook";

/** Cells copied from a workbook, as stored, with where they came from. */
export interface WorkbookClipboard {
  /** The document they came from: formulas only move between copies of the same workbook. */
  doc: string;
  sheet: string;
  /** The sheet row and column of the top-left cell. */
  row: number;
  col: number;
  cells: Array<Array<{ v: string; fmt?: Record<string, unknown> }>>;
}

function tsvField(text: string): string {
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toTsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(tsvField).join("\t")).join("\n");
}

/** Clipboard text as rows: tabs between cells, quoted cells may hold tabs and line breaks. */
export function parseTsv(text: string): string[][] {
  const clean = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (!clean.includes("\t") && !clean.includes("\n")) return [[clean]];
  const parsed = Papa.parse<string[]>(clean, { delimiter: "\t", newline: "\n", quoteChar: '"' });
  const rows = parsed.data.map((row) => row.map((cell) => cell ?? ""));
  return rows.length ? rows : [[""]];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toHtmlTable(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<meta charset="utf-8"><table>${body}</table>`;
}

export function readWorkbookClipboard(text: string | undefined | null): WorkbookClipboard | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as WorkbookClipboard;
    return Array.isArray(value.cells) && typeof value.doc === "string" ? value : null;
  } catch {
    return null;
  }
}
