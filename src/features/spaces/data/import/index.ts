import type * as Y from "yjs";
import { anchorFormula } from "../workbook/anchors";
import { addSheet } from "../workbook/ops";
import {
  cellKey,
  defaultWorkbookCellLimit,
  filledCellCount,
  maxSheets,
  type CellFormat,
} from "../workbook/schema";
import { editContext, partsOf, reindex, setCell } from "../workbook/sheetEdit";
import { isFormula } from "../workbook/values";
import type { WorkbookIndex } from "../workbook/workbookIndex";
import { parseDelimited } from "./csv";
import { parseXlsx } from "./xlsx";

/** One sheet read from a file, before it goes into the document. */
export interface ImportedSheet {
  name: string;
  rows: number;
  cols: number;
  cells: Array<{ row: number; col: number; input: string; fmt?: CellFormat }>;
  /** Column widths in pixels, by column index. */
  colWidths?: Array<number | undefined>;
  frozenRows?: number;
}

export interface ImportSummary {
  sheets: Array<{ id: string; name: string; rows: number; cols: number }>;
}

export interface ImportOptions {
  origin?: unknown;
  /** Filled cells allowed, from the Space's level; 100,000 when it sets none. */
  cellLimit?: number;
}

export type ImportKind = "csv" | "tsv" | "xlsx";

/** What kind of file this is, by its name or type; null for one Data can't read. */
export function importKind(file: { name?: string; type?: string }): ImportKind | null {
  const name = (file.name ?? "").toLowerCase();
  const type = (file.type ?? "").toLowerCase();
  if (name.endsWith(".xlsx") || type.includes("spreadsheetml")) return "xlsx";
  if (name.endsWith(".tsv") || name.endsWith(".tab") || type === "text/tab-separated-values")
    return "tsv";
  if (name.endsWith(".csv") || type === "text/csv") return "csv";
  return null;
}

function baseName(name: string | undefined): string {
  return (name ?? "").replace(/\.[^.]+$/, "").trim() || "Imported";
}

export async function readImportFile(file: Blob & { name?: string }): Promise<ImportedSheet[]> {
  const kind = importKind(file);
  if (!kind) throw new Error("Data opens CSV, TSV and Excel (.xlsx) files.");
  if (kind === "xlsx") return parseXlsx(await file.arrayBuffer());
  return [
    parseDelimited(await file.text(), baseName(file.name), kind === "tsv" ? "\t" : undefined),
  ];
}

/**
 * Adds a file's sheets to a workbook in one transaction: a CSV or TSV becomes one sheet, an
 * Excel file one sheet per worksheet, with values, formulas, sheet names, basic number formats,
 * bold, alignment, column widths and a frozen top row. An import that would pass the workbook's
 * cell limit is refused, with the reason, before anything is written. A workbook that only held
 * its first empty sheet loses it, so the file's sheets are all there is.
 */
export async function importWorkbookFile(
  doc: Y.Doc,
  file: Blob & { name?: string },
  options?: ImportOptions,
): Promise<ImportSummary> {
  return importSheets(doc, await readImportFile(file), options);
}

export function importSheets(
  doc: Y.Doc,
  sheets: ImportedSheet[],
  options?: ImportOptions,
): ImportSummary {
  if (!sheets.length) throw new Error("The file has no sheets.");
  const limit = options?.cellLimit ?? defaultWorkbookCellLimit;
  const context = editContext(doc);
  const lone = context.index.sheets.length === 1 ? context.index.sheets[0] : null;
  const replaceLone =
    lone !== null && partsOf(context, lone.id).cells.size === 0 && context.parts.charts.size === 0;
  const existing = replaceLone ? 0 : filledCellCount(doc);
  const incoming = sheets.reduce(
    (total, sheet) => total + sheet.cells.filter((cell) => cell.input).length,
    0,
  );
  if (existing + incoming > limit)
    throw new Error(
      `This file has ${incoming.toLocaleString("en-US")} filled cells; a workbook holds at most ${limit.toLocaleString("en-US")}` +
        (existing ? `, and this one already has ${existing.toLocaleString("en-US")}.` : "."),
    );
  const room = maxSheets - (replaceLone ? 0 : context.index.sheets.length);
  if (sheets.length > room) throw new Error(`A workbook holds at most ${maxSheets} sheets.`);

  const made: ImportSummary["sheets"] = [];
  doc.transact(() => {
    if (replaceLone && lone) {
      const order = context.parts.order.toArray();
      for (let index = order.length - 1; index >= 0; index -= 1)
        if (order[index] === lone.id) context.parts.order.delete(index, 1);
      context.parts.sheets.delete(lone.id);
      reindex(context);
    }
    const ids = sheets.map((sheet) => addSheet(context, sheet.name, sheet.rows, sheet.cols));
    // Formulas name the file's sheets by the names the file gave them, even where a sheet here
    // took that name first and the imported one was numbered.
    const names = new Map(context.index.byName);
    sheets.forEach((sheet, index) => {
      const target = context.index.byId.get(ids[index]);
      if (target) names.set(sheet.name.toLowerCase(), target);
    });
    const index: WorkbookIndex = { ...context.index, byName: names };
    sheets.forEach((sheet, at) => {
      const target = index.byId.get(ids[at]);
      if (!target) return;
      const parts = partsOf(context, target.id);
      for (const cell of sheet.cells) {
        if (cell.row >= target.rowIds.length || cell.col >= target.colIds.length)
          context.grow(
            target,
            Math.max(cell.row + 1, target.rowIds.length),
            Math.max(cell.col + 1, target.colIds.length),
          );
        const v = isFormula(cell.input)
          ? anchorFormula(cell.input, target.id, index, context.grow)
          : cell.input;
        setCell(
          parts.cells,
          cellKey(target.rowIds[cell.row], target.colIds[cell.col]),
          v,
          cell.fmt,
        );
      }
      sheet.colWidths?.forEach((width, col) => {
        if (width && target.colIds[col]) parts.colWidths.set(target.colIds[col], width);
      });
      if (sheet.frozenRows) parts.map.set("frozenRows", sheet.frozenRows);
      made.push({ id: target.id, name: target.name, rows: sheet.rows, cols: sheet.cols });
    });
  }, options?.origin ?? "workbook-import");
  return { sheets: made };
}
