import type * as Y from "yjs";
import { WorkbookEngine } from "../formula/engine";
import { formatA1Range, parseA1Range, rangeBounds } from "./a1";
import { chartToInput, type ChartInput } from "./charts";
import { editContext, partsOf, resolveSheet, usedExtent } from "./sheetEdit";
import { cellKey, readCellCap, workbookParts } from "./schema";
import { isFormula, plainValue } from "./values";

export interface WorkbookReadArgs {
  /** A sheet name or id; the first sheet when a range is given without one. */
  sheet?: string;
  /** "A1:D20", "B:C" or "3:9"; without it the call returns a summary. */
  range?: string;
}

export type PlainValue = string | number | boolean | null;

export interface WorkbookReadCell {
  value: PlainValue;
  /** The formula in A1, for a cell holding one. */
  formula?: string;
}

export interface WorkbookSheetSummary {
  id: string;
  name: string;
  /** How far the filled cells reach. */
  rows: number;
  cols: number;
  /** The first row's values, as headers usually are. */
  header: PlainValue[];
  frozen_rows: number;
}

export interface WorkbookSummary {
  title: string;
  sheets: WorkbookSheetSummary[];
  charts: Array<{ id: string; type: string; title: string; pinned: boolean } & ChartInput>;
  errors: Array<{ sheet: string; cell: string; error: string }>;
}

export interface WorkbookRangeRead {
  sheet: string;
  /** The range read, which may be smaller than asked for. */
  range: string;
  cells: WorkbookReadCell[][];
  /** Set when the range held more than the 2,000 cells one read returns. */
  truncated?: boolean;
}

const headerCap = 50;
const errorCap = 50;

/**
 * What a workbook holds, with formulas computed here: no grid needs to be open. Without a range
 * it summarizes the sheets (or the one named), their sizes, header rows and charts.
 */
export function readWorkbook(
  doc: Y.Doc,
  args: WorkbookReadArgs = {},
): WorkbookSummary | WorkbookRangeRead {
  const engine = new WorkbookEngine(doc, { observe: false });
  const context = editContext(doc);
  if (args.range) {
    const range = parseA1Range(args.range);
    if (!range) throw new Error(`"${args.range}" isn't a range.`);
    const sheet = resolveSheet(context, range.sheet ?? args.sheet);
    const used = usedExtent(partsOf(context, sheet.id), sheet);
    const box = rangeBounds(range, Math.max(used.rows, 1), Math.max(used.cols, 1));
    const bottomLimit = Math.min(box.bottom, sheet.rowIds.length - 1);
    const rightLimit = Math.min(box.right, sheet.colIds.length - 1);
    const right = Math.min(rightLimit, box.left + readCellCap - 1);
    const width = Math.max(0, right - box.left + 1);
    const maxRows = width ? Math.max(1, Math.floor(readCellCap / width)) : 0;
    const bottom = Math.min(bottomLimit, box.top + maxRows - 1);
    const cells: WorkbookReadCell[][] = [];
    const parts = partsOf(context, sheet.id);
    for (let row = box.top; row <= bottom; row += 1) {
      const line: WorkbookReadCell[] = [];
      for (let col = box.left; col <= right; col += 1) {
        const rowId = sheet.rowIds[row];
        const colId = sheet.colIds[col];
        const input = parts.cells.get(cellKey(rowId, colId))?.v ?? "";
        const value = plainValue(engine.value(sheet.id, rowId, colId));
        line.push(
          isFormula(input)
            ? { value, formula: engine.inputText(sheet.id, rowId, colId) }
            : { value },
        );
      }
      cells.push(line);
    }
    const read = formatA1Range({
      start: { row: box.top, col: box.left },
      end: { row: Math.max(box.top, bottom), col: Math.max(box.left, right) },
    });
    return {
      sheet: sheet.name,
      range: read,
      cells,
      ...(bottom < bottomLimit || right < rightLimit ? { truncated: true } : {}),
    };
  }

  const parts = workbookParts(doc);
  const pinned = new Set(parts.dashboard.toArray().map((tile) => tile.chart));
  const only = args.sheet ? resolveSheet(context, args.sheet).id : null;
  const sheets = context.index.sheets
    .filter((sheet) => !only || sheet.id === only)
    .map((sheet): WorkbookSheetSummary => {
      const sheetParts = partsOf(context, sheet.id);
      const used = usedExtent(sheetParts, sheet);
      const header: PlainValue[] = [];
      for (let col = 0; col < Math.min(used.cols, headerCap); col += 1)
        header.push(plainValue(engine.value(sheet.id, sheet.rowIds[0], sheet.colIds[col])));
      const frozen = Number(sheetParts.map.get("frozenRows") ?? 0) || 0;
      return {
        id: sheet.id,
        name: sheet.name,
        rows: used.rows,
        cols: used.cols,
        header,
        frozen_rows: frozen,
      };
    });
  const charts: WorkbookSummary["charts"] = [];
  parts.charts.forEach((chart, id) => {
    if (only && chart.sheet !== only) return;
    charts.push({
      ...chartToInput(context, chart),
      id,
      type: chart.type,
      title: chart.title,
      pinned: pinned.has(id),
    });
  });
  const errors = engine
    .errors()
    .filter((report) => !only || report.sheetId === only)
    .slice(0, errorCap)
    .map(({ sheet, cell, error }) => ({ sheet, cell, error }));
  return { title: String(parts.meta.get("title") ?? ""), sheets, charts, errors };
}
