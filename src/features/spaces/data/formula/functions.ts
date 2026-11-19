import * as formulajs from "@formulajs/formulajs";
import FormulaParser, { type FormulaArgument } from "fast-formula-parser";

/*
 * The functions fast-formula-parser doesn't have itself, from @formulajs/formulajs (MIT) or
 * written here. Together with the parser's own they cover the plan's v1 set: SUM, AVERAGE, MIN,
 * MAX, COUNT, COUNTA, SUMIF(S), COUNTIF(S), AVERAGEIF, IF, IFS, AND, OR, IFERROR, ROUND, ABS,
 * VLOOKUP, XLOOKUP, INDEX, MATCH, TEXT, CONCAT, LEFT, RIGHT, LEN, UPPER, LOWER, TRIM, DATE,
 * TODAY and NOW.
 */

const { FormulaError } = FormulaParser;

function failWith(code: string): never {
  throw new FormulaError(code);
}

/** The first formula error inside a value or a range, thrown so the call returns it. */
function throwErrors(value: unknown): void {
  if (value instanceof FormulaError) throw value;
  if (Array.isArray(value)) for (const item of value) throwErrors(item);
}

function plain(argument: FormulaArgument | undefined): unknown {
  if (!argument || argument.omitted) return undefined;
  throwErrors(argument.value);
  return argument.value;
}

/** A formulajs result, with its Error objects turned into the parser's errors. */
function settle(result: unknown): unknown {
  if (result instanceof Error)
    failWith(result.message.startsWith("#") ? result.message : "#VALUE!");
  return result;
}

const viaFormulajs =
  (name: keyof typeof formulajs) =>
  (...args: FormulaArgument[]) => {
    const fn = formulajs[name] as unknown as (...values: unknown[]) => unknown;
    return settle(fn(...args.map(plain)));
  };

function flatten(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [value];
  return value.flatMap((item) => flatten(item));
}

/** The numbers MIN and MAX read: numbers in ranges, and numbers or numeric text given directly. */
function extremeOf(args: FormulaArgument[], pick: (a: number, b: number) => number): number {
  let best: number | null = null;
  for (const argument of args) {
    const value = plain(argument);
    const items = argument.isArray || argument.isRangeRef ? flatten(value) : [value];
    for (const item of items) {
      let number: number | null = null;
      if (typeof item === "number") number = item;
      else if (!argument.isArray && !argument.isRangeRef) {
        if (typeof item === "boolean") number = item ? 1 : 0;
        else if (typeof item === "string" && item.trim() !== "" && Number.isFinite(Number(item)))
          number = Number(item);
        else if (typeof item === "string") failWith("#VALUE!");
      }
      if (number !== null) best = best === null ? number : pick(best, number);
    }
  }
  return best ?? 0;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (typeof left === "string" && typeof right === "string")
    return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

/** XLOOKUP(lookup, lookup_array, return_array, [if_not_found], [match_mode], [search_mode]). */
function xlookup(...args: FormulaArgument[]): unknown {
  const lookup = plain(args[0]);
  const keys = flatten(plain(args[1]));
  const returns = plain(args[2]);
  const rows = Array.isArray(returns) ? (returns as unknown[][]) : [[returns]];
  const notFound = args[3] && !args[3].omitted ? args[3].value : undefined;
  const mode = Number(plain(args[4]) ?? 0);
  const reverse = Number(plain(args[5]) ?? 1) < 0;
  const vertical = rows.length >= keys.length || rows.length > 1;
  const pickAt = (index: number) => (vertical ? rows[index]?.[0] : rows[0]?.[index]);
  const order = keys.map((_, index) => index);
  if (reverse) order.reverse();
  let best = -1;
  for (const index of order) {
    const key = keys[index];
    if (sameValue(key, lookup)) {
      best = index;
      break;
    }
    if (mode === -1 || mode === 1) {
      if (typeof key !== typeof lookup || key === null) continue;
      const better =
        mode === -1
          ? (key as number) < (lookup as number) &&
            (best < 0 || (key as number) > (keys[best] as number))
          : (key as number) > (lookup as number) &&
            (best < 0 || (key as number) < (keys[best] as number));
      if (better) best = index;
    }
  }
  if (best < 0) return notFound !== undefined ? notFound : failWith("#N/A");
  const found = pickAt(best);
  return found === undefined || found === null ? 0 : found;
}

function textCase(transform: (text: string) => string) {
  return (...args: FormulaArgument[]) => {
    const value = plain(args[0]);
    if (Array.isArray(value)) failWith("#VALUE!");
    return transform(value === null || value === undefined ? "" : String(value));
  };
}

export const workbookFunctions: Record<string, (...args: FormulaArgument[]) => unknown> = {
  MAX: (...args) => extremeOf(args, Math.max),
  MIN: (...args) => extremeOf(args, Math.min),
  COUNTA: (...args) =>
    args.reduce((total, argument) => {
      if (argument.omitted) return total;
      const items =
        argument.isArray || argument.isRangeRef ? flatten(argument.value) : [argument.value];
      return (
        total + items.filter((item) => item !== null && item !== undefined && item !== "").length
      );
    }, 0),
  MATCH: viaFormulajs("MATCH"),
  SUMIFS: viaFormulajs("SUMIFS"),
  COUNTIFS: viaFormulajs("COUNTIFS"),
  AVERAGEIFS: viaFormulajs("AVERAGEIFS"),
  XLOOKUP: xlookup,
  UPPER: textCase((text) => text.toUpperCase()),
  LOWER: textCase((text) => text.toLowerCase()),
};
