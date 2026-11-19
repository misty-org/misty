import type { Cell, CellValue as ExcelValue, Worksheet } from "exceljs";
import { cleanSheetName } from "../workbook/sheetEdit";
import type { CellFormat } from "../workbook/schema";
import { decimalsFromExcel, excelWidthToPixels, formatFromExcel, loadExcel } from "./excelModule";
import type { ImportedSheet } from "./index";

/** A JavaScript date as an Excel serial (days since 1899-12-30, UTC). */
export function dateToSerial(date: Date): number {
  return date.getTime() / 86_400_000 + 25569;
}

/** Excel's own prefixes on newer functions (`_xlfn.XLOOKUP`), which formulas here don't use. */
export function cleanExcelFormula(formula: string): string {
  return `=${formula.replace(/^=/, "").replace(/_xl(?:fn|ws)\.(?:_xlws\.)?/gi, "")}`;
}

function plainText(value: ExcelValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return String(dateToSerial(value));
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText))
      return value.richText.map((part) => part.text).join("");
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("error" in value && typeof value.error === "string") return value.error;
    if ("result" in value) return plainText((value as { result?: ExcelValue }).result ?? null);
  }
  return "";
}

/** What the cell holds as typed text here: its formula when it has one, otherwise its value. */
function cellInput(cell: Cell): string {
  const formula = cell.formula;
  if (typeof formula === "string" && formula.trim()) return cleanExcelFormula(formula);
  const text = plainText(cell.value);
  // Text that reads as a number or formula but was text in Excel keeps being text.
  if (
    typeof cell.value === "string" &&
    (/^[=']/.test(text) || /^[-+$€£\d.,%\s]+$/.test(text)) &&
    text.trim()
  )
    return `'${text}`;
  return text;
}

function cellFormat(cell: Cell): CellFormat | undefined {
  const format: CellFormat = {};
  const num = cell.value instanceof Date ? "date" : formatFromExcel(cell.numFmt);
  if (num) format.num = num;
  if (num === "number" || num === "percent" || num === "currency") {
    const decimals = decimalsFromExcel(cell.numFmt);
    if (decimals !== undefined && decimals !== 2) format.decimals = decimals;
  }
  if (cell.font?.bold) format.bold = true;
  const align = cell.alignment?.horizontal;
  if (align === "left" || align === "center" || align === "right") format.align = align;
  return Object.keys(format).length ? format : undefined;
}

function readWorksheet(sheet: Worksheet): ImportedSheet {
  const cells: ImportedSheet["cells"] = [];
  let rows = 0;
  let cols = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const input = cellInput(cell);
      const fmt = cellFormat(cell);
      if (!input && !fmt) return;
      cells.push({ row: rowNumber - 1, col: colNumber - 1, input, fmt });
      rows = Math.max(rows, rowNumber);
      cols = Math.max(cols, colNumber);
    });
  });
  const colWidths: Array<number | undefined> = [];
  for (let col = 1; col <= cols; col += 1) {
    const width = sheet.getColumn(col).width;
    colWidths.push(width ? excelWidthToPixels(width) : undefined);
  }
  const view = sheet.views?.[0] as { state?: string; ySplit?: number } | undefined;
  const frozenRows = view?.state === "frozen" && view.ySplit ? Math.floor(view.ySplit) : 0;
  return {
    name: cleanSheetName(sheet.name) || "Sheet",
    rows,
    cols,
    cells,
    colWidths,
    frozenRows: frozenRows || undefined,
  };
}

/** An Excel workbook's worksheets: values, formulas, names and basic number formats. */
export async function parseXlsx(data: ArrayBuffer): Promise<ImportedSheet[]> {
  const Excel = await loadExcel();
  const workbook = new Excel.Workbook();
  try {
    await workbook.xlsx.load(data);
  } catch {
    throw new Error("This Excel file couldn't be read. Save it as .xlsx and try again.");
  }
  return workbook.worksheets.map(readWorksheet);
}
