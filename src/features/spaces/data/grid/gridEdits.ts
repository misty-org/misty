import type * as Y from "yjs";
import type { WorkbookEngine } from "../formula/engine";
import { localEditOrigin } from "../editOrigin";
import { formatA1Range, shiftA1Formula } from "../workbook/a1";
import { a1Formula, anchorFormula } from "../workbook/anchors";
import { chartFromInput } from "../workbook/charts";
import { newId } from "../workbook/ids";
import { addSheet, runWorkbookOps } from "../workbook/ops";
import {
  cellKey,
  defaultWorkbookCellLimit,
  filledCellCount,
  maxCharts,
  maxColWidth,
  minColWidth,
  type CellFormat,
  type ChartType,
} from "../workbook/schema";
import {
  cleanSheetName,
  editContext,
  growSheet,
  indexOf,
  partsOf,
  setCell,
  setCellInput,
  uniqueSheetName,
  usedExtent,
  type EditContext,
} from "../workbook/sheetEdit";
import { isFormula } from "../workbook/values";
import type { WorkbookClipboard } from "./clipboard";
import type { Rect } from "./selection";

/*
 * The grid's edits. Each is one transaction with this person's origin, so it merges as one and
 * their undo takes it back in one step. Rows here are sheet rows (a filter's hidden rows are
 * left out by the caller).
 */

export function editWorkbook<T>(doc: Y.Doc, change: (context: EditContext) => T): T {
  let result!: T;
  doc.transact(() => {
    result = change(editContext(doc));
  }, localEditOrigin);
  return result;
}

export function commitInput(
  doc: Y.Doc,
  sheetId: string,
  row: number,
  col: number,
  text: string,
): void {
  editWorkbook(doc, (context) => setCellInput(context, sheetId, row, col, text));
}

/** Clears values in the given rows and columns, keeping their formats. */
export function clearCells(
  doc: Y.Doc,
  sheetId: string,
  rows: readonly number[],
  left: number,
  right: number,
): void {
  editWorkbook(doc, (context) => {
    const sheet = indexOf(context, sheetId);
    const cells = partsOf(context, sheetId).cells;
    for (const row of rows) {
      const rowId = sheet.rowIds[row];
      if (!rowId) continue;
      for (let col = left; col <= Math.min(right, sheet.colIds.length - 1); col += 1) {
        const key = cellKey(rowId, sheet.colIds[col]);
        const cell = cells.get(key);
        if (cell?.v) setCell(cells, key, "", cell.fmt);
      }
    }
  });
}

/** The paste's cells as the person typed them, or as stored when copied from this workbook. */
export type PasteBlock =
  { kind: "text"; rows: string[][] } | { kind: "workbook"; clip: WorkbookClipboard };

export class CellLimitError extends Error {}

/**
 * Pastes a block with its top-left at (`rows[0]`, `col`), growing the sheet as needed. Formulas
 * copied here move by how far they were pasted. A paste that would take the workbook past its
 * cell limit is refused before anything changes.
 */
export function pasteCells(
  doc: Y.Doc,
  sheetId: string,
  rows: readonly number[],
  col: number,
  block: PasteBlock,
  limit = defaultWorkbookCellLimit,
): void {
  const inputs =
    block.kind === "text"
      ? block.rows.map((line) => line.map((v) => ({ v, fmt: undefined })))
      : block.clip.cells;
  editWorkbook(doc, (context) => {
    const sheet = indexOf(context, sheetId);
    const width = inputs.reduce((most, line) => Math.max(most, line.length), 0);
    const lastRow = Math.max(...rows, 0);
    growSheet(
      context,
      sheet,
      Math.max(sheet.rowIds.length, lastRow + 1),
      Math.max(sheet.colIds.length, col + width),
    );
    const cells = partsOf(context, sheetId).cells;
    let added = 0;
    inputs.forEach((line, offset) =>
      line.forEach((input, step) => {
        const row = rows[offset];
        const key = cellKey(sheet.rowIds[row], sheet.colIds[col + step]);
        added += (input.v ? 1 : 0) - (cells.get(key)?.v ? 1 : 0);
      }),
    );
    if (added > 0 && filledCellCount(doc) + added > limit)
      throw new CellLimitError(
        `This paste would take the workbook past ${limit.toLocaleString("en-US")} filled cells. Paste fewer cells, or make room first.`,
      );
    const source = block.kind === "workbook" ? block.clip : null;
    const sourceSheet = source ? context.index.byId.get(source.sheet) : undefined;
    inputs.forEach((line, offset) =>
      line.forEach((input, step) => {
        const row = rows[offset];
        const target = col + step;
        let v = input.v;
        if (source && sourceSheet && isFormula(v)) {
          const a1 = a1Formula(v, sourceSheet.id, context.index);
          const moved = shiftA1Formula(
            a1,
            row - (source.row + offset),
            target - (source.col + step),
          );
          v = anchorFormula(moved, sheetId, context.index, context.grow);
        } else if (!source || !sourceSheet) {
          v = isFormula(v) ? anchorFormula(v, sheetId, context.index, context.grow) : v;
        }
        const key = cellKey(sheet.rowIds[row], sheet.colIds[target]);
        const fmt =
          (input.fmt as CellFormat | undefined) ?? (source ? undefined : cells.get(key)?.fmt);
        setCell(cells, key, v, fmt);
      }),
    );
  });
}

/**
 * Fills `target` from `source` (both sheet rectangles, the source at the target's top or left),
 * repeating the source and moving its formulas, as ⌘D and the fill handle do.
 */
export function fillCells(doc: Y.Doc, sheetId: string, source: Rect, target: Rect): void {
  editWorkbook(doc, (context) => {
    const sheet = indexOf(context, sheetId);
    growSheet(
      context,
      sheet,
      Math.max(sheet.rowIds.length, target.bottom + 1),
      Math.max(sheet.colIds.length, target.right + 1),
    );
    const cells = partsOf(context, sheetId).cells;
    const height = source.bottom - source.top + 1;
    const width = source.right - source.left + 1;
    for (let row = target.top; row <= target.bottom; row += 1) {
      for (let col = target.left; col <= target.right; col += 1) {
        if (row >= source.top && row <= source.bottom && col >= source.left && col <= source.right)
          continue;
        const fromRow = source.top + ((((row - source.top) % height) + height) % height);
        const fromCol = source.left + ((((col - source.left) % width) + width) % width);
        const from = cells.get(cellKey(sheet.rowIds[fromRow], sheet.colIds[fromCol]));
        let v = from?.v ?? "";
        if (isFormula(v)) {
          const moved = shiftA1Formula(
            a1Formula(v, sheetId, context.index),
            row - fromRow,
            col - fromCol,
          );
          v = anchorFormula(moved, sheetId, context.index, context.grow);
        }
        setCell(cells, cellKey(sheet.rowIds[row], sheet.colIds[col]), v, from?.fmt);
      }
    }
  });
}

export type FormatChange = Partial<CellFormat> | { toggle: "bold" };

/**
 * Changes the format of the given cells. A selection running past the filled cells (a whole
 * column) stops at the last filled row, so empty cells don't fill up with formats.
 */
export function formatCells(
  doc: Y.Doc,
  sheetId: string,
  rows: readonly number[],
  left: number,
  right: number,
  change: FormatChange,
): void {
  editWorkbook(doc, (context) => {
    const sheet = indexOf(context, sheetId);
    const parts = partsOf(context, sheetId);
    const used = usedExtent(parts, sheet);
    const shown =
      rows.length > 1 ? rows.filter((row) => row < Math.max(used.rows, rows[0] + 1)) : rows;
    const lastCol = right > left ? Math.min(right, Math.max(used.cols - 1, left)) : right;
    const keys: string[] = [];
    for (const row of shown)
      for (let col = left; col <= lastCol; col += 1)
        if (sheet.rowIds[row] && sheet.colIds[col])
          keys.push(cellKey(sheet.rowIds[row], sheet.colIds[col]));
    const boldNow =
      "toggle" in change ? !keys.every((key) => parts.cells.get(key)?.fmt?.bold) : undefined;
    for (const key of keys) {
      const cell = parts.cells.get(key);
      const fmt: CellFormat = { ...(cell?.fmt ?? {}) };
      if ("toggle" in change) {
        if (boldNow) fmt.bold = true;
        else delete fmt.bold;
      } else {
        for (const [name, value] of Object.entries(change) as Array<[keyof CellFormat, unknown]>) {
          if (value === undefined) delete fmt[name];
          else (fmt as Record<string, unknown>)[name] = value;
        }
      }
      setCell(parts.cells, key, cell?.v ?? "", fmt);
    }
  });
}

function sortKey(value: ReturnType<WorkbookEngine["value"]>): [number, number | string] {
  if (value === null || value === "") return [3, 0];
  if (typeof value === "number") return [0, value];
  if (typeof value === "boolean") return [2, value ? 1 : 0];
  if (typeof value === "string") return [1, value.toLowerCase()];
  return [2, 2];
}

/** Orders the rows under the frozen ones by a column; empty cells stay last either way. */
export function sortRows(
  doc: Y.Doc,
  engine: WorkbookEngine,
  sheetId: string,
  col: number,
  direction: "ascending" | "descending",
  headerRows: number,
): void {
  editWorkbook(doc, (context) => {
    const sheet = indexOf(context, sheetId);
    const parts = partsOf(context, sheetId);
    const used = usedExtent(parts, sheet);
    const colId = sheet.colIds[col];
    if (!colId || used.rows <= headerRows + 1) return;
    const ids = sheet.rowIds.slice(headerRows, used.rows);
    const keyed = ids.map((id, at) => ({ id, at, key: sortKey(engine.value(sheetId, id, colId)) }));
    const sign = direction === "ascending" ? 1 : -1;
    keyed.sort((a, b) => {
      if (a.key[0] === 3 || b.key[0] === 3) return a.key[0] - b.key[0] || a.at - b.at;
      if (a.key[0] !== b.key[0]) return (a.key[0] - b.key[0]) * sign;
      const left = a.key[1];
      const right = b.key[1];
      const order =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      return order * sign || a.at - b.at;
    });
    if (keyed.every((item, at) => item.at === at)) return;
    parts.rows.delete(headerRows, ids.length);
    parts.rows.insert(
      headerRows,
      keyed.map((item) => item.id),
    );
  });
}

export function setColumnWidth(doc: Y.Doc, sheetId: string, colId: string, width: number): void {
  editWorkbook(doc, (context) =>
    partsOf(context, sheetId).colWidths.set(
      colId,
      Math.round(Math.max(minColWidth, Math.min(maxColWidth, width))),
    ),
  );
}

export function setFrozenRows(doc: Y.Doc, sheetId: string, rows: number): void {
  editWorkbook(doc, (context) =>
    partsOf(context, sheetId).map.set("frozenRows", Math.max(0, Math.floor(rows))),
  );
}

export function addSheetTab(doc: Y.Doc): string {
  return editWorkbook(doc, (context) =>
    addSheet(context, uniqueSheetName(context, `Sheet ${context.index.sheets.length + 1}`), 0, 0),
  );
}

export function renameSheetTab(doc: Y.Doc, sheetId: string, name: string): void {
  runOps(doc, [{ op: "rename_sheet", sheet: sheetId, name: cleanSheetName(name) }]);
}

export function deleteSheetTab(doc: Y.Doc, sheetId: string): void {
  runOps(doc, [{ op: "delete_sheet", sheet: sheetId }]);
}

export function moveSheetTab(doc: Y.Doc, sheetId: string, to: number): void {
  editWorkbook(doc, (context) => {
    const order = context.parts.order.toArray();
    const from = order.indexOf(sheetId);
    if (from < 0) return;
    context.parts.order.delete(from, 1);
    context.parts.order.insert(Math.max(0, Math.min(to, order.length - 1)), [sheetId]);
  });
}

export function runOps(doc: Y.Doc, ops: Parameters<typeof runWorkbookOps>[1]): string[] {
  let ids: string[] = [];
  doc.transact(() => {
    ids = runWorkbookOps(doc, ops);
  }, localEditOrigin);
  return ids;
}

/** A chart from the selected cells (sheet rows and columns), its columns read from the range. */
export function chartFromSelection(
  doc: Y.Doc,
  sheetId: string,
  rect: Rect,
  type: ChartType = "column",
): string {
  return editWorkbook(doc, (context) => {
    if (context.parts.charts.size >= maxCharts)
      throw new Error(`A workbook holds at most ${maxCharts} charts.`);
    const range = formatA1Range({
      start: { row: rect.top, col: rect.left },
      end: { row: rect.bottom, col: rect.right },
    });
    const chart = chartFromInput(context, { type, sheet: sheetId, range, title: "" });
    const id = newId();
    context.parts.charts.set(id, chart);
    return id;
  });
}
