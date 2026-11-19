import FormulaParser from "fast-formula-parser";
import { splitCellKey } from "../workbook/schema";
import { cellError, isCellError, type CellValue } from "../workbook/values";

const { FormulaError } = FormulaParser;

export interface Bounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Where a value lives: `<sheetId>!<rowId>:<colId>`. Ids never hold `!` or `:`. */
export const valueKey = (sheetId: string, rowId: string, colId: string) =>
  `${sheetId}!${rowId}:${colId}`;

export function splitValueKey(key: string): [string, string, string] {
  const at = key.indexOf("!");
  const [row, col] = splitCellKey(key.slice(at + 1));
  return [key.slice(0, at), row, col];
}

export function toParser(value: CellValue): unknown {
  return isCellError(value) ? new FormulaError(value.error) : value;
}

export function fromParser(result: unknown): CellValue {
  if (result instanceof FormulaError) return cellError(result.error);
  if (result === null || result === undefined) return 0;
  if (Array.isArray(result)) return fromParser(result[0]?.[0] ?? result[0]);
  if (typeof result === "number") return Number.isFinite(result) ? result : cellError("#NUM!");
  if (typeof result === "string" || typeof result === "boolean") return result;
  return cellError("#VALUE!");
}

export function thrownError(error: unknown): CellValue {
  if (error instanceof FormulaError) {
    const details = error.details as { error?: string } | undefined;
    if (details?.error === "#NAME?" || /not implemented/i.test(error.message))
      return cellError("#NAME?");
    if (error.error && error.error !== "#ERROR!") return cellError(error.error);
  }
  return cellError("#ERROR!");
}
