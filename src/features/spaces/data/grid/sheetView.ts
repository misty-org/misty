import { useMemo, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import type { WorkbookEngine } from "../formula/engine";
import {
  cellKey,
  defaultColWidth,
  frozenRows,
  sheetParts,
  workbookParts,
  type CellJSON,
} from "../workbook/schema";
import { usedExtent } from "../workbook/sheetEdit";
import { displayValue } from "../workbook/values";

/** The grid's fixed geometry, in pixels: every row the same height, so a row's top is a sum. */
export const rowHeight = 28;
export const headerHeight = 28;
export const rowHeaderWidth = 48;

const versions = new WeakMap<
  Y.Doc,
  { value: number; listeners: Set<() => void>; detach: () => void }
>();

function versionEntry(doc: Y.Doc) {
  let entry = versions.get(doc);
  if (!entry) {
    const listeners = new Set<() => void>();
    const bump = () => {
      const current = versions.get(doc);
      if (!current) return;
      current.value += 1;
      for (const listener of [...listeners]) listener();
    };
    doc.on("update", bump);
    entry = { value: 0, listeners, detach: () => doc.off("update", bump) };
    versions.set(doc, entry);
  }
  return entry;
}

/** A number that changes with every change to the document, local or remote. */
export function useDocVersion(doc: Y.Doc | null): number {
  return useSyncExternalStore(
    (listener) => {
      if (!doc) return () => undefined;
      const entry = versionEntry(doc);
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    () => (doc ? versionEntry(doc).value : 0),
  );
}

/** Values a column's filter lets through, by the text each cell shows. */
export type ColumnFilters = ReadonlyMap<string, ReadonlySet<string>>;

export interface SheetView {
  id: string;
  name: string;
  rowIds: string[];
  colIds: string[];
  widths: number[];
  /** Each column's left edge, after the row header. */
  offsets: number[];
  totalWidth: number;
  frozen: number;
  /** Sheet rows by the position they show at; null when every row shows. */
  shown: number[] | null;
  rowCount: number;
  cells: Y.Map<CellJSON>;
}

/** The sheet row at a shown position (past the last shown row, the rows after it). */
export function sheetRow(view: SheetView, position: number): number {
  if (!view.shown) return position;
  if (position < view.shown.length) return view.shown[position];
  const last = view.shown[view.shown.length - 1] ?? -1;
  return last + 1 + (position - view.shown.length);
}

/** The shown position of a sheet row, or -1 when a filter hides it. */
export function shownPosition(view: SheetView, row: number): number {
  if (!view.shown) return row;
  return view.shown.indexOf(row);
}

/** Sheet rows for the shown positions from `start`, `count` of them. */
export function sheetRows(view: SheetView, start: number, count: number): number[] {
  const rows: number[] = [];
  for (let position = start; position < start + count; position += 1)
    rows.push(sheetRow(view, position));
  return rows;
}

export function columnAtX(view: SheetView, x: number): number {
  let low = 0;
  let high = view.colIds.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (view.offsets[mid] <= x) low = mid;
    else high = mid - 1;
  }
  return Math.max(0, low);
}

/**
 * The open sheet as the grid draws it. It's rebuilt only when the document changes or a filter
 * does; a filter reads shown values, so it waits for the engine.
 */
export function useSheetView(
  doc: Y.Doc | null,
  engine: WorkbookEngine | null,
  sheetId: string | null,
  filters: ColumnFilters,
  version: number,
): SheetView | null {
  return useMemo(() => {
    void version;
    if (!doc || !engine || !sheetId) return null;
    const index = engine.sheet(sheetId);
    const map = workbookParts(doc).sheets.get(sheetId);
    if (!index || !map) return null;
    const parts = sheetParts(sheetId, map);
    const widths = index.colIds.map((id) => parts.colWidths.get(id) ?? defaultColWidth);
    const offsets: number[] = [];
    let x = 0;
    for (const width of widths) {
      offsets.push(x);
      x += width;
    }
    const frozen = Math.min(frozenRows(map), index.rowIds.length);
    let shown: number[] | null = null;
    const active = [...filters].filter(([colId]) => index.colAt.has(colId));
    if (active.length) {
      const used = usedExtent(parts, index);
      // The frozen rows, or the first row when none are, are the header a filter leaves alone.
      const header = Math.max(frozen, 1);
      shown = [];
      for (let row = 0; row < index.rowIds.length; row += 1) {
        if (row < header || row >= used.rows) {
          shown.push(row);
          continue;
        }
        const keep = active.every(([colId, allowed]) => {
          const rowId = index.rowIds[row];
          const fmt = parts.cells.get(cellKey(rowId, colId))?.fmt;
          return allowed.has(displayValue(engine.value(sheetId, rowId, colId), fmt));
        });
        if (keep) shown.push(row);
      }
    }
    return {
      id: sheetId,
      name: index.name,
      rowIds: index.rowIds,
      colIds: index.colIds,
      widths,
      offsets,
      totalWidth: x,
      frozen,
      shown,
      rowCount: shown ? shown.length : index.rowIds.length,
      cells: parts.cells,
    };
  }, [doc, engine, sheetId, filters, version]);
}

/** The distinct values a column shows under the frozen rows, for its filter, at most `cap`. */
export function columnValues(
  engine: WorkbookEngine,
  view: SheetView,
  col: number,
  cap = 500,
): { values: string[]; capped: boolean } {
  const colId = view.colIds[col];
  const found = new Set<string>();
  const index = engine.sheet(view.id);
  if (!index || !colId) return { values: [], capped: false };
  const used = usedExtent({ cells: view.cells }, index);
  for (let row = Math.max(view.frozen, 1); row < used.rows; row += 1) {
    const rowId = view.rowIds[row];
    found.add(
      displayValue(engine.value(view.id, rowId, colId), view.cells.get(cellKey(rowId, colId))?.fmt),
    );
    if (found.size > cap) return { values: [...found].slice(0, cap).sort(), capped: true };
  }
  return {
    values: [...found].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    capped: false,
  };
}
