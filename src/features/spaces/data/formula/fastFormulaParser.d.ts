// Types for fast-formula-parser (MIT), which ships none. Only what the engine uses.
declare module "fast-formula-parser" {
  export interface FormulaPosition {
    sheet: string;
    row: number;
    col: number;
  }

  export interface FormulaRangeRef {
    sheet: string;
    from: { row: number; col: number };
    to: { row: number; col: number };
  }

  /** A function's argument as the parser hands it over: ranges arrive as 2-D arrays. */
  export interface FormulaArgument {
    value: unknown;
    isArray: boolean;
    isRangeRef?: boolean;
    isCellRef?: boolean;
    omitted?: boolean;
  }

  export class FormulaError extends Error {
    constructor(error: string, message?: string, details?: unknown);
    readonly error: string;
    details?: unknown;
  }

  export interface FormulaParserConfig {
    functions?: Record<string, (...args: FormulaArgument[]) => unknown>;
    onCell?: (ref: FormulaPosition) => unknown;
    onRange?: (ref: FormulaRangeRef) => unknown[][];
    onVariable?: (name: string, sheet: string) => unknown;
  }

  export default class FormulaParser {
    constructor(config?: FormulaParserConfig);
    parse(formula: string, position: FormulaPosition, allowReturnArray?: boolean): unknown;
    static FormulaError: typeof FormulaError;
    static MAX_ROW: number;
    static MAX_COLUMN: number;
  }
}
