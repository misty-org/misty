import * as Y from "yjs";
import { WorkbookEngine } from "../formula/engine";
import { parseA1Range } from "./a1";
import { chartFromInput, chartToInput, type ChartInput } from "./charts";
import { newId, newIds } from "./ids";
import {
  defaultColCount,
  defaultRowCount,
  defaultWorkbookCellLimit,
  filledCellCount,
  maxCharts,
  maxSheets,
  newSheetMap,
  type CellInput,
  type ChartJSON,
} from "./schema";
import {
  cleanSheetName,
  columnAt,
  deleteCols,
  deleteRows,
  dropUndefined,
  editContext,
  insertCols,
  insertRows,
  partsOf,
  reindex,
  resolveSheet,
  uniqueSheetName,
  usedExtent,
  writeRows,
  type EditContext,
} from "./sheetEdit";
import { inputText } from "./values";

type Rows = CellInput[][];

/** The ops `workbook.apply` takes (plan D6). `sheet` is a name or id; the first sheet if left out. */
export type WorkbookOp =
  | { op: "set_range"; sheet?: string; range: string; values: Rows }
  | { op: "append_rows"; sheet?: string; rows: Rows }
  | { op: "insert_rows"; sheet?: string; at: number; count?: number; rows?: Rows }
  | { op: "delete_rows"; sheet?: string; at: number; count?: number }
  | { op: "insert_cols"; sheet?: string; at: string | number; count?: number }
  | { op: "delete_cols"; sheet?: string; at: string | number; count?: number }
  | { op: "add_sheet"; name: string; rows?: Rows }
  | { op: "rename_sheet"; sheet: string; name: string }
  | { op: "delete_sheet"; sheet: string }
  | { op: "add_chart"; chart: ChartInput }
  | { op: "update_chart"; chart_id: string; chart: Partial<ChartInput> }
  | { op: "delete_chart"; chart_id: string }
  | { op: "pin_to_dashboard"; chart_id: string; pinned?: boolean };

export interface WorkbookErrorReport {
  sheet: string;
  cell: string;
  error: string;
}

export interface WorkbookApplyResult {
  applied: number;
  /** Each add_chart's new id, in order. */
  chart_ids: string[];
  /** The one new chart's id, when exactly one was added. */
  chart_id?: string;
  /** Formula errors (#REF!, #NAME?, …) the change caused. */
  errors: WorkbookErrorReport[];
}

export interface ApplyOptions {
  /** The transaction's origin, so an undo manager can tell whose change it was. */
  origin?: unknown;
  /** Filled cells allowed, from the Space's level; 100,000 when it sets none. */
  cellLimit?: number;
}

const textRows = (rows: Rows | undefined): (string | null)[][] =>
  (rows ?? []).map((line) => (Array.isArray(line) ? line.map(inputText) : []));

function count(value: number | undefined, fallback = 1): number {
  const number = Math.floor(Number(value ?? fallback));
  if (!Number.isFinite(number) || number < 1) throw new Error("count must be 1 or more.");
  return Math.min(number, 100_000);
}

function rowAt(at: number): number {
  const row = Math.floor(Number(at)) - 1;
  if (!Number.isFinite(row) || row < 0) throw new Error("at must be a row number from 1.");
  return row;
}

function colAt(at: string | number): number {
  const col = columnAt(at);
  if (col < 0) throw new Error(`"${String(at)}" isn't a column.`);
  return col;
}

/** Adds a sheet with its rows; the caller fills it after every sheet exists. */
export function addSheet(
  context: EditContext,
  name: string,
  rows: number,
  cols: number,
  fixedId?: string,
): string {
  if (context.index.sheets.length >= maxSheets)
    throw new Error(`A workbook holds at most ${maxSheets} sheets.`);
  const id = fixedId ?? newId();
  const clean = uniqueSheetName(context, cleanSheetName(name) || "Sheet");
  context.parts.sheets.set(
    id,
    newSheetMap(
      clean,
      newIds(Math.max(defaultRowCount, rows)),
      newIds(Math.max(defaultColCount, cols)),
    ),
  );
  context.parts.order.push([id]);
  reindex(context);
  return id;
}

function widest(rows: (string | null)[][]): number {
  return rows.reduce((most, line) => Math.max(most, line.length), 0);
}

function removeChart(context: EditContext, chartId: string): void {
  context.parts.charts.delete(chartId);
  const tiles = context.parts.dashboard.toArray();
  for (let index = tiles.length - 1; index >= 0; index -= 1)
    if (tiles[index]?.chart === chartId) context.parts.dashboard.delete(index, 1);
}

function applyOne(context: EditContext, op: WorkbookOp, chartIds: string[]): void {
  switch (op.op) {
    case "set_range": {
      const sheet = resolveSheet(context, op.sheet);
      const range = parseA1Range(op.range);
      if (!range || range.start.row === undefined || range.start.col === undefined)
        throw new Error(`"${op.range}" isn't a cell or range.`);
      const target = range.sheet ? resolveSheet(context, range.sheet) : sheet;
      const top = Math.min(range.start.row, range.end.row ?? range.start.row);
      const left = Math.min(range.start.col, range.end.col ?? range.start.col);
      writeRows(context, target.id, top, left, textRows(op.values));
      return;
    }
    case "append_rows": {
      const sheet = resolveSheet(context, op.sheet);
      const used = usedExtent(partsOf(context, sheet.id), sheet);
      writeRows(context, sheet.id, used.rows, 0, textRows(op.rows));
      return;
    }
    case "insert_rows": {
      const sheet = resolveSheet(context, op.sheet);
      const rows = textRows(op.rows);
      const at = rowAt(op.at);
      insertRows(context, sheet.id, at, count(op.count, rows.length || 1));
      if (rows.length) writeRows(context, sheet.id, at, 0, rows);
      return;
    }
    case "delete_rows":
      deleteRows(context, resolveSheet(context, op.sheet).id, rowAt(op.at), count(op.count));
      return;
    case "insert_cols":
      insertCols(context, resolveSheet(context, op.sheet).id, colAt(op.at), count(op.count));
      return;
    case "delete_cols":
      deleteCols(context, resolveSheet(context, op.sheet).id, colAt(op.at), count(op.count));
      return;
    case "add_sheet": {
      const rows = textRows(op.rows);
      const id = addSheet(context, op.name, rows.length, widest(rows));
      if (rows.length) writeRows(context, id, 0, 0, rows);
      return;
    }
    case "rename_sheet": {
      const sheet = resolveSheet(context, op.sheet);
      const name = cleanSheetName(op.name);
      if (!name) throw new Error("A sheet needs a name.");
      partsOf(context, sheet.id).map.set("name", uniqueSheetName(context, name, sheet.id));
      reindex(context);
      return;
    }
    case "delete_sheet": {
      const sheet = resolveSheet(context, op.sheet);
      if (context.index.sheets.length <= 1) throw new Error("A workbook keeps at least one sheet.");
      context.parts.charts.forEach((chart, id) => {
        if (chart.sheet === sheet.id) removeChart(context, id);
      });
      const order = context.parts.order.toArray();
      for (let index = order.length - 1; index >= 0; index -= 1)
        if (order[index] === sheet.id) context.parts.order.delete(index, 1);
      context.parts.sheets.delete(sheet.id);
      reindex(context);
      return;
    }
    case "add_chart": {
      if (context.parts.charts.size >= maxCharts)
        throw new Error(`A workbook holds at most ${maxCharts} charts.`);
      const id = newId();
      context.parts.charts.set(id, chartFromInput(context, op.chart));
      chartIds.push(id);
      return;
    }
    case "update_chart": {
      const current = context.parts.charts.get(op.chart_id);
      if (!current) throw new Error(`There is no chart "${op.chart_id}".`);
      const merged = mergeChart(context, current, op.chart);
      context.parts.charts.set(op.chart_id, merged);
      return;
    }
    case "delete_chart":
      if (!context.parts.charts.has(op.chart_id))
        throw new Error(`There is no chart "${op.chart_id}".`);
      removeChart(context, op.chart_id);
      return;
    case "pin_to_dashboard": {
      if (!context.parts.charts.has(op.chart_id))
        throw new Error(`There is no chart "${op.chart_id}".`);
      const tiles = context.parts.dashboard.toArray();
      const at = tiles.findIndex((tile) => tile.chart === op.chart_id);
      if (op.pinned === false) {
        if (at >= 0) context.parts.dashboard.delete(at, 1);
      } else if (at < 0) context.parts.dashboard.push([{ chart: op.chart_id }]);
      return;
    }
    default:
      throw new Error(`"${String((op as { op?: unknown }).op)}" isn't a workbook op.`);
  }
}

/** A chart with some fields changed: a new range or type re-reads its columns. */
function mergeChart(
  context: EditContext,
  current: ChartJSON,
  change: Partial<ChartInput>,
): ChartJSON {
  const reshaped =
    change.range !== undefined ||
    change.x !== undefined ||
    change.series !== undefined ||
    change.formula !== undefined ||
    change.sheet !== undefined ||
    (change.type !== undefined && (change.type === "stat") !== (current.type === "stat"));
  if (!reshaped)
    return dropUndefined({
      ...current,
      type: change.type ?? current.type,
      title: change.title === undefined ? current.title : change.title.trim().slice(0, 200),
    });
  const sheet = context.index.byId.get(current.sheet);
  const existing: Partial<ChartInput> = sheet ? chartToInput(context, current) : {};
  return chartFromInput(context, {
    ...existing,
    ...dropUndefined(change),
    type: change.type ?? current.type,
    title: change.title ?? current.title,
    sheet: change.sheet ?? sheet?.name,
    // A new range picks its own columns unless they're given too.
    x: change.range !== undefined && change.x === undefined ? undefined : (change.x ?? existing.x),
    series:
      change.range !== undefined && change.series === undefined
        ? undefined
        : (change.series ?? existing.series),
  } as ChartInput);
}

/** Runs ops on a document inside the caller's transaction. Returns the new charts' ids. */
export function runWorkbookOps(doc: Y.Doc, ops: readonly WorkbookOp[]): string[] {
  const context = editContext(doc);
  const chartIds: string[] = [];
  ops.forEach((op, index) => {
    try {
      applyOne(context, op, chartIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Op ${index + 1} (${String(op?.op)}): ${message}`);
    }
  });
  return chartIds;
}

const errorKey = (report: WorkbookErrorReport) =>
  `${report.sheet}\n${report.cell}\n${report.error}`;

function errorsOf(doc: Y.Doc): WorkbookErrorReport[] {
  const engine = new WorkbookEngine(doc, { observe: false });
  return engine.errors().map(({ sheet, cell, error }) => ({ sheet, cell, error }));
}

export function assertCellLimit(doc: Y.Doc, limit = defaultWorkbookCellLimit): void {
  const filled = filledCellCount(doc);
  if (filled > limit)
    throw new Error(
      `That would make ${filled.toLocaleString("en-US")} filled cells; a workbook holds at most ${limit.toLocaleString("en-US")}.`,
    );
}

/**
 * Applies agent ops as one Yjs transaction, so they merge with people editing at the same time.
 * They are tried on a copy first: an op that fails, or a change past the cell limit, leaves the
 * workbook as it was. Returns the formula errors the change caused.
 */
export function applyWorkbookOps(
  doc: Y.Doc,
  ops: readonly WorkbookOp[],
  options?: ApplyOptions,
): WorkbookApplyResult {
  if (!Array.isArray(ops)) throw new Error("ops must be a list.");
  const trial = new Y.Doc();
  Y.applyUpdate(trial, Y.encodeStateAsUpdate(doc));
  trial.transact(() => runWorkbookOps(trial, ops));
  assertCellLimit(trial, options?.cellLimit);
  trial.destroy();

  const before = new Set(errorsOf(doc).map(errorKey));
  let chartIds: string[] = [];
  doc.transact(() => {
    chartIds = runWorkbookOps(doc, ops);
  }, options?.origin ?? "workbook-ops");
  const errors = errorsOf(doc).filter((report) => !before.has(errorKey(report)));
  return {
    applied: ops.length,
    chart_ids: chartIds,
    ...(chartIds.length === 1 ? { chart_id: chartIds[0] } : {}),
    errors,
  };
}
