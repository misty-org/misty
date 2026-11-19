import type { CellAlign, CellFormat, CellInput } from "./schema";

/** A formula's failure, shown as its code: #REF!, #NAME?, #DIV/0!, #VALUE!, #CYCLE!, … */
export interface CellError {
  error: string;
}

export type CellValue = number | string | boolean | null | CellError;

export const isCellError = (value: unknown): value is CellError =>
  typeof value === "object" && value !== null && typeof (value as CellError).error === "string";

export const cellError = (code: string): CellError => ({ error: code });

export const errorCodes = [
  "#REF!",
  "#NAME?",
  "#DIV/0!",
  "#VALUE!",
  "#N/A",
  "#NUM!",
  "#NULL!",
  "#CYCLE!",
  "#ERROR!",
] as const;

export const isFormula = (input: string) => input.startsWith("=") && input.length > 1;

const plainNumber = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

function readNumber(text: string): number | null {
  if (!plainNumber.test(text) || !/\d/.test(text)) return null;
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

/**
 * What a typed entry is worth before any formula: a number (with thousands separators, a
 * trailing % or a leading currency sign), TRUE or FALSE, or the text itself. A leading
 * apostrophe keeps the rest as text.
 */
export function literalValue(input: string): CellValue {
  if (input === "") return null;
  if (input.startsWith("'")) return input.slice(1);
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  const number = readNumber(trimmed);
  if (number !== null) return number;
  if (trimmed.endsWith("%")) {
    const percent = readNumber(trimmed.slice(0, -1).trim());
    if (percent !== null) return percent / 100;
  }
  const currency = /^(-?)\s*[$€£¥]\s*(.+)$/.exec(trimmed);
  if (currency) {
    const amount = readNumber(currency[2]);
    if (amount !== null) return currency[1] ? -amount : amount;
  }
  return input;
}

/** What a cell holds as typed text, for createWorkbook and set_range's plain values. */
export function inputText(value: CellInput): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  return String(value);
}

const grouped = (digits: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const formatters = new Map<number, Intl.NumberFormat>();
function fixed(value: number, digits: number): string {
  let formatter = formatters.get(digits);
  if (!formatter) {
    formatter = grouped(digits);
    formatters.set(digits, formatter);
  }
  return formatter.format(value);
}

/** An Excel date serial (days since 1899-12-30) as YYYY-MM-DD. */
export function serialToIsoDate(serial: number): string {
  const time = Math.round((serial - 25569) * 86_400_000);
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return String(serial);
  return date.toISOString().slice(0, 10);
}

function generalNumber(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const short = Number(value.toPrecision(10));
  return Math.abs(short) >= 1e15 || (short !== 0 && Math.abs(short) < 1e-9)
    ? short.toExponential(4)
    : String(short);
}

/** A value as the cell shows it. */
export function displayValue(value: CellValue, format?: CellFormat): string {
  if (value === null) return "";
  if (isCellError(value)) return value.error;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value;
  const digits = format?.decimals ?? 2;
  switch (format?.num) {
    case "number":
      return fixed(value, digits);
    case "percent":
      return `${fixed(value * 100, digits)}%`;
    case "currency":
      return value < 0 ? `-$${fixed(-value, digits)}` : `$${fixed(value, digits)}`;
    case "date":
      return serialToIsoDate(value);
    default:
      return generalNumber(value);
  }
}

/** Numbers sit right, logicals in the middle, text and errors left, unless the cell says. */
export function cellAlignment(value: CellValue, format?: CellFormat): CellAlign {
  if (format?.align) return format.align;
  if (typeof value === "number") return "right";
  if (typeof value === "boolean" || isCellError(value)) return "center";
  return "left";
}

/** A value as plain data for agents and exports: errors as their code. */
export function plainValue(value: CellValue): string | number | boolean | null {
  return isCellError(value) ? value.error : value;
}

/** A number from a value for charts: text and errors count as nothing. */
export function numericValue(value: CellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const literal = literalValue(value);
    return typeof literal === "number" ? literal : null;
  }
  return null;
}
