import type * as Y from "yjs";
import { WorkbookEngine } from "../formula/engine";
import { excelNumFmt, loadExcel, pixelsToExcelWidth } from "../import/excelModule";
import { toCsv } from "../import/csv";
import { a1Formula } from "../workbook/anchors";
import { cellKey, orderedSheets, sheetName, workbookParts } from "../workbook/schema";
import { usedExtent } from "../workbook/sheetEdit";
import {
  displayValue,
  isCellError,
  isFormula,
  literalValue,
  type CellValue,
} from "../workbook/values";
import { buildWorkbookIndex } from "../workbook/workbookIndex";

const xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function excelValue(value: CellValue): string | number | boolean | { error: string } | null {
  if (isCellError(value)) return { error: value.error === "#CYCLE!" ? "#REF!" : value.error };
  return value;
}

/**
 * The workbook as an .xlsx (exceljs, MIT) that opens in Excel, Numbers and Google Sheets: every
 * sheet with its values, formulas (with their last computed results), number formats, bold,
 * alignment, column widths and a frozen top row.
 */
export async function exportWorkbookXlsx(doc: Y.Doc): Promise<Blob> {
  const Excel = await loadExcel();
  const engine = new WorkbookEngine(doc, { observe: false });
  const index = buildWorkbookIndex(doc);
  const workbook = new Excel.Workbook();
  workbook.creator = "Misty";
  workbook.title = String(workbookParts(doc).meta.get("title") ?? "");
  for (const parts of orderedSheets(doc)) {
    const sheet = index.byId.get(parts.id);
    if (!sheet) continue;
    const frozen = Number(parts.map.get("frozenRows") ?? 0) || 0;
    const worksheet = workbook.addWorksheet(sheetName(parts.map).slice(0, 31), {
      views: frozen ? [{ state: "frozen", ySplit: frozen, xSplit: 0 }] : undefined,
    });
    const used = usedExtent(parts, sheet);
    for (let col = 0; col < used.cols; col += 1) {
      const width = parts.colWidths.get(sheet.colIds[col]);
      if (width) worksheet.getColumn(col + 1).width = pixelsToExcelWidth(width);
    }
    parts.cells.forEach((stored, key) => {
      const [rowId, colId] = key.split(":");
      const row = sheet.rowAt.get(rowId);
      const col = sheet.colAt.get(colId);
      if (row === undefined || col === undefined) return;
      const cell = worksheet.getCell(row + 1, col + 1);
      if (isFormula(stored.v)) {
        const formula = a1Formula(stored.v, sheet.id, index).slice(1);
        const result = excelValue(engine.value(sheet.id, rowId, colId));
        cell.value = { formula, result: result ?? undefined } as never;
      } else if (stored.v) {
        cell.value = excelValue(literalValue(stored.v)) as never;
      }
      const numFmt = excelNumFmt(stored.fmt);
      if (numFmt) cell.numFmt = numFmt;
      if (stored.fmt?.bold) cell.font = { bold: true };
      if (stored.fmt?.align) cell.alignment = { horizontal: stored.fmt.align };
    });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer as ArrayBuffer], { type: xlsxType });
}

/** One sheet as CSV, each cell as it shows (computed, formatted). */
export function exportSheetCsv(doc: Y.Doc, sheetId: string): string {
  const engine = new WorkbookEngine(doc, { observe: false });
  const parts = orderedSheets(doc).find((sheet) => sheet.id === sheetId);
  const sheet = engine.sheet(sheetId);
  if (!parts || !sheet) throw new Error("That sheet no longer exists.");
  const used = usedExtent(parts, sheet);
  const rows: string[][] = [];
  for (let row = 0; row < used.rows; row += 1) {
    const line: string[] = [];
    for (let col = 0; col < used.cols; col += 1) {
      const rowId = sheet.rowIds[row];
      const colId = sheet.colIds[col];
      const format = parts.cells.get(cellKey(rowId, colId))?.fmt;
      line.push(displayValue(engine.value(sheetId, rowId, colId), format));
    }
    rows.push(line);
  }
  return toCsv(rows);
}

/** A file name from a title: what the person called it, never empty. */
export function exportFilename(title: string, extension: string): string {
  const base =
    title
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Untitled data";
  return `${base}.${extension}`;
}

/** Saves a file the way the app saves exports: a download into the person's Downloads. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
