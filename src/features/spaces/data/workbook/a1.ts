/*
 * A1 names: column letters, cell names and ranges as people type them. The id-anchored forms
 * formulas are stored in live in anchors.ts; this file knows nothing of ids.
 */

export const maxColumns = 18_278; // ZZZ
export const maxRows = 1_048_576;

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnLabel(index: number): string {
  let label = "";
  let rest = index + 1;
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    label = String.fromCharCode(65 + digit) + label;
    rest = Math.floor((rest - 1) / 26);
  }
  return label;
}

/** "A" → 0, "aa" → 26; -1 for anything that isn't one to three letters. */
export function columnIndex(label: string): number {
  if (!/^[A-Za-z]{1,3}$/.test(label)) return -1;
  let index = 0;
  for (const character of label.toUpperCase()) index = index * 26 + (character.charCodeAt(0) - 64);
  return index - 1;
}

/** (0, 0) → "A1". */
export function cellName(row: number, col: number): string {
  return `${columnLabel(col)}${row + 1}`;
}

/** One end of a range: a cell, or a whole column or row when the other part is missing. */
export interface A1Point {
  row?: number;
  col?: number;
  absRow?: boolean;
  absCol?: boolean;
}

export interface A1Range {
  /** The sheet named before `!`, unquoted, when there was one. */
  sheet?: string;
  start: A1Point;
  end: A1Point;
}

const cellPattern = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;
const colPattern = /^(\$?)([A-Za-z]{1,3})$/;
const rowPattern = /^(\$?)(\d+)$/;

export function parseA1Point(text: string): A1Point | null {
  const cell = cellPattern.exec(text);
  if (cell) {
    const col = columnIndex(cell[2]);
    const row = Number(cell[4]) - 1;
    if (col < 0 || col >= maxColumns || row < 0 || row >= maxRows) return null;
    return { row, col, absCol: cell[1] === "$", absRow: cell[3] === "$" };
  }
  const column = colPattern.exec(text);
  if (column) {
    const col = columnIndex(column[2]);
    return col < 0 ? null : { col, absCol: column[1] === "$" };
  }
  const row = rowPattern.exec(text);
  if (row) {
    const index = Number(row[2]) - 1;
    return index < 0 || index >= maxRows ? null : { row: index, absRow: row[1] === "$" };
  }
  return null;
}

/** Splits `'My sheet'!A1:B2` or `Data!A:A` into its sheet and the rest. */
export function splitSheetPrefix(text: string): { sheet?: string; rest: string } {
  const trimmed = text.trim();
  const quoted = /^'((?:[^']|'')+)'!(.*)$/s.exec(trimmed);
  if (quoted) return { sheet: quoted[1].replace(/''/g, "'"), rest: quoted[2] };
  const bare = /^([^!'"]+)!(.*)$/s.exec(trimmed);
  if (bare) return { sheet: bare[1], rest: bare[2] };
  return { rest: trimmed };
}

/**
 * "B2", "A1:C10", "A:C", "2:5", optionally after a sheet name. A single cell is a range of one.
 * Both ends must be the same shape (two cells, two columns or two rows).
 */
export function parseA1Range(text: string): A1Range | null {
  const { sheet, rest } = splitSheetPrefix(text);
  const parts = rest.split(":");
  if (parts.length > 2 || !parts[0]) return null;
  const start = parseA1Point(parts[0]);
  const end = parts.length === 2 ? parseA1Point(parts[1]) : start;
  if (!start || !end) return null;
  const shape = (point: A1Point) =>
    point.row !== undefined && point.col !== undefined
      ? "cell"
      : point.col !== undefined
        ? "col"
        : "row";
  if (shape(start) !== shape(end)) return null;
  if (parts.length === 1 && shape(start) !== "cell") return null;
  return { sheet, start, end };
}

/** A sheet's name as a formula writes it: quoted when it isn't a plain word. */
export function formulaSheetName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name)
    ? name
    : `'${name.replace(/'/g, "''")}'`;
}

export function formatA1Point(point: A1Point): string {
  const col = point.col === undefined ? "" : `${point.absCol ? "$" : ""}${columnLabel(point.col)}`;
  const row = point.row === undefined ? "" : `${point.absRow ? "$" : ""}${point.row + 1}`;
  return col + row;
}

/** The range back as text, "A1:B2", or "A1" for a single cell. */
export function formatA1Range(range: A1Range): string {
  const prefix = range.sheet ? `${formulaSheetName(range.sheet)}!` : "";
  const start = formatA1Point(range.start);
  const end = formatA1Point(range.end);
  return prefix + (start === end && range.start.row !== undefined ? start : `${start}:${end}`);
}

/** The rectangle a range covers, clamped to a sheet of `rows` × `cols`, with ends in order. */
export function rangeBounds(
  range: A1Range,
  rows: number,
  cols: number,
): { top: number; left: number; bottom: number; right: number } {
  const top = Math.min(range.start.row ?? 0, range.end.row ?? 0);
  const bottom = Math.max(range.start.row ?? rows - 1, range.end.row ?? rows - 1);
  const left = Math.min(range.start.col ?? 0, range.end.col ?? 0);
  const right = Math.max(range.start.col ?? cols - 1, range.end.col ?? cols - 1);
  return { top, left, bottom, right };
}

/** The string literals in a formula, so reference scanning can step over them. */
export function stringLiteralEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === '"') {
      if (text[index + 1] === '"') {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return text.length;
}

/** A reference as typed in a formula: its text span and what it names. */
export interface A1Token {
  start: number;
  end: number;
  range: A1Range;
  /** The `A1` in `A1`, rather than the `A1:B2` range form. */
  single: boolean;
}

const sheetPrefix = String.raw`(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!`;
const cellRef = String.raw`\$?[A-Za-z]{1,3}\$?\d+`;
const refPattern = new RegExp(
  String.raw`(${sheetPrefix})?(?:(${cellRef})(?::(${cellRef}))?|(\$?[A-Za-z]{1,3}):(\$?[A-Za-z]{1,3})|(\$?\d+):(\$?\d+))`,
  "y",
);
const identifierChar = /[A-Za-z0-9_.$]/;

/**
 * Every reference in an A1 formula, outside its string literals: `B2`, `$A$1`, `A1:C3`, `A:A`,
 * `2:4`, `Sheet2!B2`, `'My data'!A:B`. Function names that look like cells (`LOG10(`) are not.
 */
export function scanA1References(formula: string): A1Token[] {
  const tokens: A1Token[] = [];
  let index = 0;
  while (index < formula.length) {
    const character = formula[index];
    if (character === '"') {
      index = stringLiteralEnd(formula, index);
      continue;
    }
    if (index > 0 && identifierChar.test(formula[index - 1])) {
      index += 1;
      continue;
    }
    refPattern.lastIndex = index;
    const match = refPattern.exec(formula);
    if (!match) {
      index += 1;
      continue;
    }
    const end = index + match[0].length;
    const next = formula[end];
    if (next !== undefined && (identifierChar.test(next) || next === "(" || next === "!")) {
      index += 1;
      continue;
    }
    const prefix = match[1] ? splitSheetPrefix(`${match[1]}A1`).sheet : undefined;
    const startText = match[2] ?? match[4] ?? match[6];
    const endText = match[3] ?? match[5] ?? match[7] ?? startText;
    const start = parseA1Point(startText);
    const stop = parseA1Point(endText);
    if (!start || !stop) {
      index = end;
      continue;
    }
    tokens.push({
      start: index,
      end,
      range: { sheet: prefix, start, end: stop },
      single: Boolean(match[2]) && !match[3],
    });
    index = end;
  }
  return tokens;
}

/**
 * An A1 formula moved by `rows` and `cols`, as paste moves one: relative parts shift, absolute
 * ones stay, and a reference pushed off the sheet's top or left becomes #REF!.
 */
export function shiftA1Formula(formula: string, rows: number, cols: number): string {
  if (!rows && !cols) return formula;
  const tokens = scanA1References(formula);
  if (!tokens.length) return formula;
  const move = (point: A1Point): A1Point | null => {
    const row = point.row === undefined || point.absRow ? point.row : point.row + rows;
    const col = point.col === undefined || point.absCol ? point.col : point.col + cols;
    if (
      (row !== undefined && (row < 0 || row >= maxRows)) ||
      (col !== undefined && (col < 0 || col >= maxColumns))
    )
      return null;
    return { ...point, row, col };
  };
  let out = "";
  let at = 0;
  for (const token of tokens) {
    const start = move(token.range.start);
    const end = move(token.range.end);
    const prefix = token.range.sheet ? `${formulaSheetName(token.range.sheet)}!` : "";
    const text =
      start && end
        ? prefix +
          (token.single ? formatA1Point(start) : `${formatA1Point(start)}:${formatA1Point(end)}`)
        : "#REF!";
    out += formula.slice(at, token.start) + text;
    at = token.end;
  }
  return out + formula.slice(at);
}
