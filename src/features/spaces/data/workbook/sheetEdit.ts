import type * as Y from "yjs";
import { columnIndex } from "./a1";
import {
  anchorFormula,
  formatAnchor,
  resolveAnchor,
  rewriteTokens,
  scanAnchors,
  type AnchorToken,
  type GrowSheet,
} from "./anchors";
import { newIds } from "./ids";
import {
  cellKey,
  orderedSheets,
  sheetName,
  sheetParts,
  splitCellKey,
  workbookParts,
  type CellFormat,
  type CellJSON,
  type ChartJSON,
  type SheetParts,
  type WorkbookParts,
} from "./schema";
import { isFormula } from "./values";
import {
  appendToIndex,
  buildWorkbookIndex,
  type SheetIndex,
  type WorkbookIndex,
} from "./workbookIndex";

/**
 * Edits to a workbook's document, shared by the grid, the agent tools' ops and import. None of
 * them opens a transaction: the caller wraps a whole change in one, with its own origin, so it
 * merges as one and undoes as one.
 */
export interface EditContext {
  doc: Y.Doc;
  parts: WorkbookParts;
  index: WorkbookIndex;
  grow: GrowSheet;
}

export function editContext(doc: Y.Doc): EditContext {
  const parts = workbookParts(doc);
  const context: EditContext = {
    doc,
    parts,
    index: buildWorkbookIndex(doc),
    grow: (sheet, rows, cols) => growSheet(context, sheet, rows, cols),
  };
  return context;
}

/** Reads the index again after rows, columns or sheets changed. */
export function reindex(context: EditContext): void {
  context.index = buildWorkbookIndex(context.doc);
}

export function partsOf(context: EditContext, sheetId: string): SheetParts {
  const map = context.parts.sheets.get(sheetId);
  if (!map) throw new Error("That sheet no longer exists.");
  return sheetParts(sheetId, map);
}

export function indexOf(context: EditContext, sheetId: string): SheetIndex {
  const sheet = context.index.byId.get(sheetId);
  if (!sheet) throw new Error("That sheet no longer exists.");
  return sheet;
}

/** A sheet by id or by name (any case); the first sheet when none is named. */
export function resolveSheet(context: EditContext, ref?: string | null): SheetIndex {
  if (ref === undefined || ref === null || ref === "") {
    const first = context.index.sheets[0];
    if (!first) throw new Error("This workbook has no sheets.");
    return first;
  }
  const sheet = context.index.byId.get(ref) ?? context.index.byName.get(ref.toLowerCase());
  if (!sheet) throw new Error(`There is no sheet named "${ref}".`);
  return sheet;
}

/** Makes a sheet at least `rows` × `cols`, adding ids at its end. */
export function growSheet(
  context: EditContext,
  sheet: SheetIndex,
  rows: number,
  cols: number,
): void {
  const parts = partsOf(context, sheet.id);
  const newRows = rows > sheet.rowIds.length ? newIds(rows - sheet.rowIds.length) : [];
  const newCols = cols > sheet.colIds.length ? newIds(cols - sheet.colIds.length) : [];
  if (newRows.length) parts.rows.push(newRows);
  if (newCols.length) parts.cols.push(newCols);
  appendToIndex(sheet, newRows, newCols);
}

/** A column given as a letter ("C") or a 1-based number, as a 0-based index. */
export function columnAt(at: string | number): number {
  if (typeof at === "number") return Math.floor(at) - 1;
  const trimmed = at.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) - 1;
  return columnIndex(trimmed);
}

/** What a typed entry is stored as: formulas anchored to ids, everything else as typed. */
export function storedInput(context: EditContext, sheetId: string, input: string): string {
  return isFormula(input) ? anchorFormula(input, sheetId, context.index, context.grow) : input;
}

/**
 * Puts what was typed into a cell (growing the sheet to reach it). Empty input clears the value
 * but keeps the cell's format; `format` replaces the format when given.
 */
export function setCellInput(
  context: EditContext,
  sheetId: string,
  row: number,
  col: number,
  input: string | null,
  format?: CellFormat | null,
): void {
  const sheet = indexOf(context, sheetId);
  if (row >= sheet.rowIds.length || col >= sheet.colIds.length)
    growSheet(
      context,
      sheet,
      Math.max(row + 1, sheet.rowIds.length),
      Math.max(col + 1, sheet.colIds.length),
    );
  const cells = partsOf(context, sheetId).cells;
  const key = cellKey(sheet.rowIds[row], sheet.colIds[col]);
  const existing = cells.get(key);
  const fmt = format === null ? undefined : (format ?? existing?.fmt);
  const v = input ? storedInput(context, sheetId, input) : "";
  setCell(cells, key, v, fmt);
}

/** Stores a cell already in its stored form, dropping it when it holds nothing. */
export function setCell(cells: Y.Map<CellJSON>, key: string, v: string, fmt?: CellFormat): void {
  const cleanFormat = fmt && Object.keys(fmt).length ? fmt : undefined;
  if (!v && !cleanFormat) {
    if (cells.has(key)) cells.delete(key);
    return;
  }
  const existing = cells.get(key);
  if (existing && existing.v === v && JSON.stringify(existing.fmt) === JSON.stringify(cleanFormat))
    return;
  cells.set(key, cleanFormat ? { v, fmt: cleanFormat } : { v });
}

/** Writes a block of values with its top-left at (`row`, `col`). */
export function writeRows(
  context: EditContext,
  sheetId: string,
  row: number,
  col: number,
  rows: ReadonlyArray<ReadonlyArray<string | null>>,
): void {
  const sheet = indexOf(context, sheetId);
  const width = rows.reduce((most, line) => Math.max(most, line.length), 0);
  growSheet(
    context,
    sheet,
    Math.max(sheet.rowIds.length, row + rows.length),
    Math.max(sheet.colIds.length, col + width),
  );
  rows.forEach((line, offset) =>
    line.forEach((input, step) => setCellInput(context, sheetId, row + offset, col + step, input)),
  );
}

/** The last row and column (0-based) holding anything, or -1 for an empty sheet. */
export function usedExtent(
  parts: Pick<SheetParts, "cells">,
  sheet: SheetIndex,
): { rows: number; cols: number } {
  let lastRow = -1;
  let lastCol = -1;
  parts.cells.forEach((cell, key) => {
    if (!cell.v) return;
    const [rowId, colId] = splitCellKey(key);
    const row = sheet.rowAt.get(rowId);
    const col = sheet.colAt.get(colId);
    if (row === undefined || col === undefined) return;
    if (row > lastRow) lastRow = row;
    if (col > lastCol) lastCol = col;
  });
  return { rows: lastRow + 1, cols: lastCol + 1 };
}

export function insertRows(context: EditContext, sheetId: string, at: number, count: number): void {
  const parts = partsOf(context, sheetId);
  const index = Math.max(0, Math.min(at, parts.rows.length));
  parts.rows.insert(index, newIds(Math.max(1, count)));
  reindex(context);
}

export function insertCols(context: EditContext, sheetId: string, at: number, count: number): void {
  const parts = partsOf(context, sheetId);
  const index = Math.max(0, Math.min(at, parts.cols.length));
  parts.cols.insert(index, newIds(Math.max(1, count)));
  reindex(context);
}

/**
 * Pulls a range's ends in off rows or columns about to go, so `SUM(A1:A10)` keeps summing what
 * is left when row 10 is deleted. A range left with nothing in it, and single references to a
 * deleted cell, turn into #REF! on their own.
 */
function shrinkToken(
  token: AnchorToken,
  sheet: SheetIndex,
  axis: "r" | "c",
  doomed: ReadonlySet<string>,
): string | null {
  if (!token.to) return null;
  const fromId = token.from[axis];
  const toId = token.to[axis];
  if (fromId === undefined || toId === undefined) return null;
  if (!doomed.has(fromId) && !doomed.has(toId)) return null;
  const ids = axis === "r" ? sheet.rowIds : sheet.colIds;
  const at = axis === "r" ? sheet.rowAt : sheet.colAt;
  const start = at.get(fromId);
  const end = at.get(toId);
  if (start === undefined || end === undefined) return null;
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  let first = low;
  while (first <= high && doomed.has(ids[first])) first += 1;
  let last = high;
  while (last >= low && doomed.has(ids[last])) last -= 1;
  if (first > last) return null;
  const forward = start <= end;
  const from = { ...token.from, [axis]: ids[forward ? first : last] };
  const to = { ...token.to, [axis]: ids[forward ? last : first] };
  if (!resolveAnchor(from, sheet) || !resolveAnchor(to, sheet)) return null;
  return `${formatAnchor(from)}:${formatAnchor(to)}`;
}

function shrinkText(
  text: string,
  hostSheetId: string,
  sheet: SheetIndex,
  axis: "r" | "c",
  doomed: ReadonlySet<string>,
): string {
  const tokens = scanAnchors(text);
  let touched = false;
  const out = rewriteTokens(text, tokens, (token) => {
    const target = token.from.s ?? token.to?.s ?? hostSheetId;
    const replaced = target === sheet.id ? shrinkToken(token, sheet, axis, doomed) : null;
    if (replaced) touched = true;
    return replaced ?? text.slice(token.start, token.end);
  });
  return touched ? out : text;
}

function deleteLines(
  context: EditContext,
  sheetId: string,
  axis: "r" | "c",
  at: number,
  count: number,
): void {
  const sheet = indexOf(context, sheetId);
  const parts = partsOf(context, sheetId);
  const ids = axis === "r" ? sheet.rowIds : sheet.colIds;
  const start = Math.max(0, at);
  const end = Math.min(ids.length, start + Math.max(1, count));
  if (start >= end) return;
  const doomed = new Set(ids.slice(start, end));
  // Ranges anywhere in the workbook that end on a line about to go, and charts on this sheet.
  for (const other of orderedSheets(context.doc)) {
    other.cells.forEach((cell, key) => {
      if (!isFormula(cell.v)) return;
      const next = shrinkText(cell.v, other.id, sheet, axis, doomed);
      if (next !== cell.v) other.cells.set(key, { ...cell, v: next });
    });
  }
  context.parts.charts.forEach((chart, id) => {
    if (chart.sheet !== sheetId) return;
    const shrink = (text: string) => shrinkText(text, sheetId, sheet, axis, doomed);
    const next: ChartJSON = {
      ...chart,
      range: shrink(chart.range),
      x: chart.x === undefined ? undefined : shrink(chart.x),
      series: chart.series.map(shrink),
      formula: chart.formula === undefined ? undefined : shrink(chart.formula),
    };
    if (JSON.stringify(next) !== JSON.stringify(chart))
      context.parts.charts.set(id, dropUndefined(next));
  });
  const gone: string[] = [];
  parts.cells.forEach((_, key) => {
    const [rowId, colId] = splitCellKey(key);
    if (doomed.has(axis === "r" ? rowId : colId)) gone.push(key);
  });
  for (const key of gone) parts.cells.delete(key);
  if (axis === "c") for (const id of doomed) parts.colWidths.delete(id);
  (axis === "r" ? parts.rows : parts.cols).delete(start, end - start);
  reindex(context);
}

export const deleteRows = (context: EditContext, sheetId: string, at: number, count: number) =>
  deleteLines(context, sheetId, "r", at, count);

export const deleteCols = (context: EditContext, sheetId: string, at: number, count: number) =>
  deleteLines(context, sheetId, "c", at, count);

export function dropUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

/** A sheet name no other sheet has: "Sheet 3", or `wanted` with a number after it. */
export function uniqueSheetName(context: EditContext, wanted: string, except?: string): string {
  const taken = new Set(
    orderedSheets(context.doc)
      .filter((sheet) => sheet.id !== except)
      .map((sheet) => sheetName(sheet.map).toLowerCase()),
  );
  const base = wanted.trim().slice(0, 100) || "Sheet";
  if (!taken.has(base.toLowerCase())) return base;
  for (let number = 2; ; number += 1) {
    const name = `${base} ${number}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** A sheet's name as typed: no characters that break `Name!A1`, at most 100 characters. */
export function cleanSheetName(name: string): string {
  return name
    .replace(/[!'[\]*?:/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}
