import type * as Y from "yjs";
import { orderedSheets, type SheetParts } from "./schema";

/** Where a sheet's rows and columns are, by id and by position. */
export interface SheetIndex {
  id: string;
  name: string;
  rowIds: string[];
  colIds: string[];
  rowAt: Map<string, number>;
  colAt: Map<string, number>;
}

export interface WorkbookIndex {
  sheets: SheetIndex[];
  byId: Map<string, SheetIndex>;
  /** By lowercased name: formulas name sheets case-insensitively. */
  byName: Map<string, SheetIndex>;
}

function positions(ids: string[]): Map<string, number> {
  const at = new Map<string, number>();
  ids.forEach((id, index) => at.set(id, index));
  return at;
}

export function sheetIndexOf(parts: SheetParts, name: string): SheetIndex {
  const rowIds = parts.rows.toArray();
  const colIds = parts.cols.toArray();
  return { id: parts.id, name, rowIds, colIds, rowAt: positions(rowIds), colAt: positions(colIds) };
}

export function indexFromSheets(sheets: SheetIndex[]): WorkbookIndex {
  const byId = new Map<string, SheetIndex>();
  const byName = new Map<string, SheetIndex>();
  for (const sheet of sheets) {
    byId.set(sheet.id, sheet);
    if (!byName.has(sheet.name.toLowerCase())) byName.set(sheet.name.toLowerCase(), sheet);
  }
  return { sheets, byId, byName };
}

export function buildWorkbookIndex(doc: Y.Doc): WorkbookIndex {
  return indexFromSheets(
    orderedSheets(doc).map((parts) =>
      sheetIndexOf(parts, String(parts.map.get("name") ?? "Sheet")),
    ),
  );
}

/** Adds rows or columns to a sheet's index in place, for a reference that reaches past it. */
export function appendToIndex(sheet: SheetIndex, rowIds: string[], colIds: string[]): void {
  for (const id of rowIds) {
    sheet.rowAt.set(id, sheet.rowIds.length);
    sheet.rowIds.push(id);
  }
  for (const id of colIds) {
    sheet.colAt.set(id, sheet.colIds.length);
    sheet.colIds.push(id);
  }
}
