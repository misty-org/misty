import {
  formulaSheetName,
  formatA1Point,
  maxColumns,
  maxRows,
  scanA1References,
  stringLiteralEnd,
  type A1Point,
  type A1Range,
} from "./a1";
import type { SheetIndex, WorkbookIndex } from "./workbookIndex";

/*
 * Formulas are stored id-anchored (contract, "Workbook"): a reference names its row and column
 * by id, so it follows them when rows move and turns into #REF! when one is deleted.
 *
 *   {r:<rowId>,c:<colId>}             a cell on the formula's own sheet
 *   {s:<sheetId>,r:..,c:..}           a cell on another sheet
 *   {r:..,c:..}:{r:..,c:..}           a range (the sheet, if any, on its first end)
 *   {c:<colId>}:{c:<colId>}           whole columns, A:B
 *   {r:<rowId>}:{r:<rowId>}           whole rows, 2:5
 *   a:r | a:c | a:rc                  which parts were absolute ($), so fill and paste keep them
 */

export interface Anchor {
  s?: string;
  r?: string;
  c?: string;
  /** Which parts are absolute: "r", "c" or "rc". */
  a?: string;
}

export interface AnchorToken {
  start: number;
  end: number;
  from: Anchor;
  /** The far end of a range; missing for a single cell. */
  to?: Anchor;
}

const idPattern = /^[A-Za-z0-9_-]+$/;

export function parseAnchorBody(body: string): Anchor | null {
  const anchor: Anchor = {};
  for (const part of body.split(",")) {
    const at = part.indexOf(":");
    if (at <= 0) return null;
    const key = part.slice(0, at);
    const value = part.slice(at + 1);
    if (!idPattern.test(value)) return null;
    if (key === "s" || key === "r" || key === "c" || key === "a") anchor[key] = value;
    else return null;
  }
  return anchor.r !== undefined || anchor.c !== undefined ? anchor : null;
}

export function formatAnchor(anchor: Anchor): string {
  const parts: string[] = [];
  if (anchor.s) parts.push(`s:${anchor.s}`);
  if (anchor.r) parts.push(`r:${anchor.r}`);
  if (anchor.c) parts.push(`c:${anchor.c}`);
  if (anchor.a) parts.push(`a:${anchor.a}`);
  return `{${parts.join(",")}}`;
}

const anchorAt = /\{([a-z]:[A-Za-z0-9_-]+(?:,[a-z]:[A-Za-z0-9_-]+)*)\}/y;

function anchorFrom(text: string, index: number): { anchor: Anchor; end: number } | null {
  anchorAt.lastIndex = index;
  const match = anchorAt.exec(text);
  if (!match) return null;
  const anchor = parseAnchorBody(match[1]);
  return anchor ? { anchor, end: index + match[0].length } : null;
}

/** Every anchor or anchored range in a stored formula, outside its string literals. */
export function scanAnchors(text: string): AnchorToken[] {
  const tokens: AnchorToken[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      index = stringLiteralEnd(text, index);
      continue;
    }
    if (character !== "{") {
      index += 1;
      continue;
    }
    const first = anchorFrom(text, index);
    if (!first) {
      index += 1;
      continue;
    }
    const second = text[first.end] === ":" ? anchorFrom(text, first.end + 1) : null;
    tokens.push({
      start: index,
      end: second ? second.end : first.end,
      from: first.anchor,
      to: second?.anchor,
    });
    index = second ? second.end : first.end;
  }
  return tokens;
}

/** Replaces each token with what `replace` returns for it. */
export function rewriteTokens<T extends { start: number; end: number }>(
  text: string,
  tokens: readonly T[],
  replace: (token: T) => string,
): string {
  if (!tokens.length) return text;
  let out = "";
  let at = 0;
  for (const token of tokens) {
    out += text.slice(at, token.start) + replace(token);
    at = token.end;
  }
  return out + text.slice(at);
}

/** Grows a sheet (in the document and its index) to at least `rows` × `cols`. */
export type GrowSheet = (sheet: SheetIndex, rows: number, cols: number) => void;

function absFlags(point: A1Point): string | undefined {
  const flags = `${point.absRow ? "r" : ""}${point.absCol ? "c" : ""}`;
  return flags || undefined;
}

/** The anchor for a point on `sheet`, or null when the sheet doesn't reach it and can't grow. */
export function anchorPoint(
  sheet: SheetIndex,
  point: A1Point,
  grow?: GrowSheet,
  sheetId?: string,
): Anchor | null {
  const needRows = point.row === undefined ? 0 : point.row + 1;
  const needCols = point.col === undefined ? 0 : point.col + 1;
  if (needRows > sheet.rowIds.length || needCols > sheet.colIds.length) {
    if (!grow || needRows > maxRows || needCols > maxColumns) return null;
    grow(sheet, Math.max(needRows, sheet.rowIds.length), Math.max(needCols, sheet.colIds.length));
  }
  return {
    s: sheetId,
    r: point.row === undefined ? undefined : sheet.rowIds[point.row],
    c: point.col === undefined ? undefined : sheet.colIds[point.col],
    a: absFlags(point),
  };
}

/** An A1 range on `sheet` as an anchored range (or a lone anchor for one cell). */
export function anchorRange(
  sheet: SheetIndex,
  range: A1Range,
  grow?: GrowSheet,
  sheetId?: string,
  single = false,
): string | null {
  const from = anchorPoint(sheet, range.start, grow, sheetId);
  const to = anchorPoint(sheet, range.end, grow);
  if (!from || !to) return null;
  return single ? formatAnchor(from) : `${formatAnchor(from)}:${formatAnchor(to)}`;
}

/** An A1 formula ("=SUM(A1:B2)") in its stored, anchored form. */
export function anchorFormula(
  formula: string,
  hostSheetId: string,
  index: WorkbookIndex,
  grow?: GrowSheet,
): string {
  const tokens = scanA1References(formula);
  return rewriteTokens(formula, tokens, (token) => {
    const sheet = token.range.sheet
      ? index.byName.get(token.range.sheet.toLowerCase())
      : index.byId.get(hostSheetId);
    if (!sheet) return "#REF!";
    const other = sheet.id === hostSheetId ? undefined : sheet.id;
    return anchorRange(sheet, token.range, grow, other, token.single) ?? "#REF!";
  });
}

export interface ResolvedPoint {
  row?: number;
  col?: number;
  absRow: boolean;
  absCol: boolean;
}

/** Where an anchor points now, or null once its row or column is gone. */
export function resolveAnchor(anchor: Anchor, sheet: SheetIndex): ResolvedPoint | null {
  const row = anchor.r === undefined ? undefined : sheet.rowAt.get(anchor.r);
  const col = anchor.c === undefined ? undefined : sheet.colAt.get(anchor.c);
  if (
    (anchor.r !== undefined && row === undefined) ||
    (anchor.c !== undefined && col === undefined)
  )
    return null;
  const flags = anchor.a ?? "";
  return { row, col, absRow: flags.includes("r"), absCol: flags.includes("c") };
}

/** The sheet a token's references are on. */
export function tokenSheet(
  token: AnchorToken,
  hostSheetId: string,
  index: WorkbookIndex,
): SheetIndex | undefined {
  return index.byId.get(token.from.s ?? token.to?.s ?? hostSheetId);
}

/** A stored formula as people read it, in A1. References to deleted rows read `#REF!`. */
export function a1Formula(text: string, hostSheetId: string, index: WorkbookIndex): string {
  return rewriteTokens(text, scanAnchors(text), (token) => {
    const sheet = tokenSheet(token, hostSheetId, index);
    if (!sheet) return "#REF!";
    const from = resolveAnchor(token.from, sheet);
    const to = token.to ? resolveAnchor(token.to, sheet) : from;
    if (!from || !to) return "#REF!";
    const prefix = sheet.id === hostSheetId ? "" : `${formulaSheetName(sheet.name)}!`;
    const start = formatA1Point(from);
    return token.to ? `${prefix}${start}:${formatA1Point(to)}` : prefix + start;
  });
}

/**
 * A stored formula moved by `rows` and `cols`, as fill and paste move one: relative parts shift,
 * absolute ones stay. A reference shifted off the sheet's top or left becomes #REF!.
 */
export function shiftFormula(
  text: string,
  hostSheetId: string,
  index: WorkbookIndex,
  rows: number,
  cols: number,
  grow?: GrowSheet,
): string {
  if (!rows && !cols) return text;
  return rewriteTokens(text, scanAnchors(text), (token) => {
    const sheet = tokenSheet(token, hostSheetId, index);
    if (!sheet) return "#REF!";
    const move = (point: ResolvedPoint | null): A1Point | null => {
      if (!point) return null;
      const row = point.row === undefined || point.absRow ? point.row : point.row + rows;
      const col = point.col === undefined || point.absCol ? point.col : point.col + cols;
      if ((row !== undefined && row < 0) || (col !== undefined && col < 0)) return null;
      return { row, col, absRow: point.absRow, absCol: point.absCol };
    };
    const from = move(resolveAnchor(token.from, sheet));
    const to = token.to ? move(resolveAnchor(token.to, sheet)) : from;
    if (!from || !to) return "#REF!";
    const other = token.from.s ?? token.to?.s;
    return anchorRange(sheet, { start: from, end: to }, grow, other, !token.to) ?? "#REF!";
  });
}

/** The rectangle an anchored range covers now, or null once an end is gone. */
export function resolveAnchoredRange(
  text: string,
  sheet: SheetIndex,
): { top: number; left: number; bottom: number; right: number } | null {
  const [token] = scanAnchors(text);
  if (!token) return null;
  const from = resolveAnchor(token.from, sheet);
  const to = token.to ? resolveAnchor(token.to, sheet) : from;
  if (!from || !to) return null;
  const lastRow = sheet.rowIds.length - 1;
  const lastCol = sheet.colIds.length - 1;
  return {
    top: Math.min(from.row ?? 0, to.row ?? 0),
    bottom: Math.max(from.row ?? lastRow, to.row ?? lastRow),
    left: Math.min(from.col ?? 0, to.col ?? 0),
    right: Math.max(from.col ?? lastCol, to.col ?? lastCol),
  };
}

/** An anchored range back in A1 on its own sheet, "A1:B9"; "#REF!" once an end is gone. */
export function a1Range(text: string, sheet: SheetIndex): string {
  return a1Formula(text, sheet.id, {
    sheets: [sheet],
    byId: new Map([[sheet.id, sheet]]),
    byName: new Map(),
  });
}
