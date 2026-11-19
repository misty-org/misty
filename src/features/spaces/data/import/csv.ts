import Papa from "papaparse";
import type { ImportedSheet } from "./index";

/**
 * A CSV or TSV file as one sheet, every field kept as typed (papaparse, MIT). The delimiter is
 * detected unless given; trailing empty lines are dropped.
 */
export function parseDelimited(text: string, name: string, delimiter?: string): ImportedSheet {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    delimiter: delimiter ?? "",
    skipEmptyLines: false,
  });
  const rows = parsed.data;
  while (rows.length && rows[rows.length - 1].every((field) => field === "")) rows.pop();
  const cells: ImportedSheet["cells"] = [];
  let cols = 0;
  rows.forEach((line, row) => {
    line.forEach((field, col) => {
      if (field === "") return;
      cells.push({ row, col, input: field });
      if (col + 1 > cols) cols = col + 1;
    });
  });
  return { name, rows: rows.length, cols, cells };
}

/** Rows of text as CSV, quoting where a field needs it. */
export function toCsv(rows: string[][], delimiter = ","): string {
  return Papa.unparse(rows, { delimiter, newline: "\r\n" });
}
