import * as Y from "yjs";

/*
 * The workbook's Yjs layout (docs/plans/space-artifacts-contract.md, "Workbook"). The editor, the
 * tool host and the Worker's projection all read these keys, so they are exact.
 */

export const metaKey = "wb:meta";
export const sheetOrderKey = "wb:sheetOrder";
export const sheetsKey = "wb:sheets";
export const chartsKey = "wb:charts";
export const dashboardKey = "wb:dashboard";

/** How a cell's number shows. Text keeps what was typed, even when it reads as a number. */
export type NumberFormat = "number" | "percent" | "currency" | "date" | "text";
export type CellAlign = "left" | "center" | "right";

export interface CellFormat {
  num?: NumberFormat;
  /** Digits after the point for number, percent and currency; two when unset. */
  decimals?: number;
  bold?: boolean;
  align?: CellAlign;
}

/** One cell: exactly what was typed (formulas id-anchored) and how it shows. */
export interface CellJSON {
  v: string;
  fmt?: CellFormat;
}

export type ChartType = "bar" | "column" | "line" | "area" | "pie" | "donut" | "scatter" | "stat";

export const chartTypes: readonly ChartType[] = [
  "bar",
  "column",
  "line",
  "area",
  "pie",
  "donut",
  "scatter",
  "stat",
];

/**
 * A chart. `range` is the data it was made from, header row included; `x` is the category
 * column and each of `series` one value column, all id-anchored ranges on `sheet` (a sheet id).
 * A stat tile has `formula` (an anchored formula) and no series.
 */
export interface ChartJSON {
  type: ChartType;
  title: string;
  sheet: string;
  range: string;
  x?: string;
  series: string[];
  formula?: string;
}

export interface TileJSON {
  chart: string;
}

export type CellInput = string | number | boolean | null;

export interface WorkbookParts {
  meta: Y.Map<unknown>;
  order: Y.Array<string>;
  sheets: Y.Map<Y.Map<unknown>>;
  charts: Y.Map<ChartJSON>;
  dashboard: Y.Array<TileJSON>;
}

export function workbookParts(doc: Y.Doc): WorkbookParts {
  return {
    meta: doc.getMap(metaKey),
    order: doc.getArray<string>(sheetOrderKey),
    sheets: doc.getMap<Y.Map<unknown>>(sheetsKey),
    charts: doc.getMap<ChartJSON>(chartsKey),
    dashboard: doc.getArray<TileJSON>(dashboardKey),
  };
}

/** One sheet's parts, read from its map. */
export interface SheetParts {
  id: string;
  map: Y.Map<unknown>;
  rows: Y.Array<string>;
  cols: Y.Array<string>;
  cells: Y.Map<CellJSON>;
  colWidths: Y.Map<number>;
}

export function sheetParts(id: string, map: Y.Map<unknown>): SheetParts {
  return {
    id,
    map,
    rows: map.get("rows") as Y.Array<string>,
    cols: map.get("cols") as Y.Array<string>,
    cells: map.get("cells") as Y.Map<CellJSON>,
    colWidths: map.get("colWidths") as Y.Map<number>,
  };
}

export function sheetName(map: Y.Map<unknown>): string {
  const name = map.get("name");
  return typeof name === "string" ? name : "Sheet";
}

export function frozenRows(map: Y.Map<unknown>): number {
  const value = map.get("frozenRows");
  return typeof value === "number" && value > 0 ? Math.floor(value) : 0;
}

/** A new, empty sheet map with its rows and columns; the caller puts it into `wb:sheets`. */
export function newSheetMap(name: string, rowIds: string[], colIds: string[]): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  const rows = new Y.Array<string>();
  const cols = new Y.Array<string>();
  rows.push(rowIds);
  cols.push(colIds);
  map.set("name", name);
  map.set("rows", rows);
  map.set("cols", cols);
  map.set("cells", new Y.Map<CellJSON>());
  map.set("colWidths", new Y.Map<number>());
  map.set("frozenRows", 0);
  return map;
}

/** The sheets in tab order, skipping ids whose sheet is gone. */
export function orderedSheets(doc: Y.Doc): SheetParts[] {
  const { order, sheets } = workbookParts(doc);
  const seen = new Set<string>();
  const out: SheetParts[] = [];
  for (const id of order.toArray()) {
    const map = sheets.get(id);
    if (!map || seen.has(id)) continue;
    seen.add(id);
    out.push(sheetParts(id, map));
  }
  return out;
}

export const cellKey = (rowId: string, colId: string) => `${rowId}:${colId}`;

export function splitCellKey(key: string): [string, string] {
  const at = key.indexOf(":");
  return [key.slice(0, at), key.slice(at + 1)];
}

export const defaultRowCount = 100;
export const defaultColCount = 26;
export const defaultColWidth = 120;
export const minColWidth = 40;
export const maxColWidth = 800;

/** The most filled cells one workbook takes when the Space's level sets none (plan, "Limits"). */
export const defaultWorkbookCellLimit = 100_000;
export const maxSheets = 20;
export const maxCharts = 50;
/** The most cells `readWorkbook` returns in one call. */
export const readCellCap = 2000;

/** How many cells hold a value or formula, across every sheet (a format alone isn't filled). */
export function filledCellCount(doc: Y.Doc): number {
  let total = 0;
  for (const sheet of orderedSheets(doc)) sheet.cells.forEach((cell) => (total += cell.v ? 1 : 0));
  return total;
}
