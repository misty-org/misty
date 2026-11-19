import FormulaParser, { type FormulaPosition, type FormulaRangeRef } from "fast-formula-parser";
import type * as Y from "yjs";
import { cellName } from "../workbook/a1";
import { a1Formula } from "../workbook/anchors";
import { cellKey, splitCellKey, workbookParts, type CellJSON } from "../workbook/schema";
import {
  cellError,
  isCellError,
  isFormula,
  literalValue,
  type CellValue,
} from "../workbook/values";
import { buildWorkbookIndex, type SheetIndex, type WorkbookIndex } from "../workbook/workbookIndex";
import { DependencyGraph, dependenciesOf } from "./dependencyGraph";
import { fromParser, splitValueKey, thrownError, toParser, valueKey } from "./engineValues";
import { workbookFunctions } from "./functions";

export { valueKey } from "./engineValues";

const { FormulaError } = FormulaParser;

export interface EngineChange {
  /** Value keys whose value may have changed, or "all" after a change of shape. */
  cells: Set<string> | "all";
}

export interface FormulaErrorReport {
  sheetId: string;
  sheet: string;
  cell: string;
  error: string;
}

/** Past this many cells to recompute, it's cheaper to forget every formula's value. */
const wideChange = 4000;

/**
 * Computes a workbook's formulas from its Yjs document, client-side only (values are never
 * stored). Its dependency graph is by id, so a change recomputes only the formulas that read it;
 * rows or columns moving recompute everything, since ranges cover positions. Values are computed
 * when asked for, deepest dependency first, so long chains never overflow the stack.
 *
 * `observe: false` makes a one-off engine for a document that won't change while it's read (the
 * agent tools, exports); the editor's engine follows every change.
 */
export class WorkbookEngine {
  private index: WorkbookIndex;
  private readonly parts: ReturnType<typeof workbookParts>;
  private readonly parser: FormulaParser;
  private readonly values = new Map<string, CellValue>();
  private readonly a1Cache = new Map<string, string>();
  private readonly graph: DependencyGraph;
  private readonly listeners = new Set<(change: EngineChange) => void>();
  private observing = false;
  private versionValue = 0;

  constructor(
    private readonly doc: Y.Doc,
    options?: { observe?: boolean },
  ) {
    this.parts = workbookParts(doc);
    this.index = buildWorkbookIndex(doc);
    this.graph = new DependencyGraph(() => this.index);
    this.parser = new FormulaParser({
      functions: workbookFunctions,
      onCell: (ref) => this.readCell(ref),
      onRange: (ref) => this.readRange(ref),
    });
    this.registerAll();
    if (options?.observe !== false) {
      this.parts.sheets.observeDeep(this.onSheets);
      this.parts.order.observe(this.onOrder);
      this.observing = true;
    }
  }

  get version(): number {
    return this.versionValue;
  }

  get workbookIndex(): WorkbookIndex {
    return this.index;
  }

  sheet(sheetId: string): SheetIndex | undefined {
    return this.index.byId.get(sheetId);
  }

  subscribe(listener: (change: EngineChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    if (this.observing) {
      this.parts.sheets.unobserveDeep(this.onSheets);
      this.parts.order.unobserve(this.onOrder);
      this.observing = false;
    }
    this.listeners.clear();
  }

  /** Reads the document afresh, for an engine made with `observe: false`. */
  refresh(): void {
    this.index = buildWorkbookIndex(this.doc);
    this.registerAll();
    this.changed({ cells: "all" });
  }

  /** What a cell holds in the document. */
  cell(sheetId: string, rowId: string, colId: string): CellJSON | undefined {
    const sheet = this.parts.sheets.get(sheetId);
    const cells = sheet?.get("cells") as Y.Map<CellJSON> | undefined;
    return cells?.get(cellKey(rowId, colId));
  }

  value(sheetId: string, rowId: string, colId: string): CellValue {
    const input = this.cell(sheetId, rowId, colId)?.v ?? "";
    if (!isFormula(input)) return literalValue(input);
    const key = valueKey(sheetId, rowId, colId);
    const known = this.values.get(key);
    if (known !== undefined) return known;
    this.prepare([key]);
    return this.compute(key);
  }

  valueAt(sheetId: string, row: number, col: number): CellValue {
    const sheet = this.index.byId.get(sheetId);
    const rowId = sheet?.rowIds[row];
    const colId = sheet?.colIds[col];
    return rowId && colId ? this.value(sheetId, rowId, colId) : null;
  }

  /** A cell's formula in A1 for the formula bar, or its text as typed. */
  inputText(sheetId: string, rowId: string, colId: string): string {
    const input = this.cell(sheetId, rowId, colId)?.v ?? "";
    return isFormula(input) ? this.a1(valueKey(sheetId, rowId, colId), input, sheetId) : input;
  }

  /** Evaluates a stored (anchored) formula as if it sat on `sheetId`, as a stat tile does. */
  evaluate(formula: string, sheetId: string): CellValue {
    const sheet = this.index.byId.get(sheetId);
    if (!sheet) return cellError("#REF!");
    if (!isFormula(formula)) return literalValue(formula);
    const pending: string[] = [];
    for (const dependency of dependenciesOf(formula, sheetId))
      this.graph.collect(dependency, (key) => !this.values.has(key), pending);
    this.prepare(pending);
    return this.run(a1Formula(formula, sheetId, this.index).slice(1), sheet, 0, 0);
  }

  /** Every formula that ends in an error now, for reporting what a change caused. */
  errors(): FormulaErrorReport[] {
    const reports: FormulaErrorReport[] = [];
    for (const [sheetId, keys] of this.graph.sheets()) {
      const sheet = this.index.byId.get(sheetId);
      if (!sheet) continue;
      for (const key of keys) {
        const [, rowId, colId] = splitValueKey(key);
        const value = this.value(sheetId, rowId, colId);
        if (!isCellError(value)) continue;
        const row = sheet.rowAt.get(rowId);
        const col = sheet.colAt.get(colId);
        if (row === undefined || col === undefined) continue;
        reports.push({ sheetId, sheet: sheet.name, cell: cellName(row, col), error: value.error });
      }
    }
    return reports.sort(
      (a, b) =>
        a.sheet.localeCompare(b.sheet) ||
        a.cell.localeCompare(b.cell, undefined, { numeric: true }),
    );
  }

  // -- Following the document -------------------------------------------------------------------

  private registerAll(): void {
    this.values.clear();
    this.a1Cache.clear();
    this.graph.clear();
    for (const sheet of this.index.sheets) {
      const cells = this.parts.sheets.get(sheet.id)?.get("cells") as Y.Map<CellJSON> | undefined;
      cells?.forEach((cell, key) => {
        if (!isFormula(cell.v)) return;
        const [rowId, colId] = splitCellKey(key);
        this.graph.register(valueKey(sheet.id, rowId, colId), cell.v, sheet.id);
      });
    }
  }

  private readonly onOrder = () => {
    this.index = buildWorkbookIndex(this.doc);
    this.registerAll();
    this.changed({ cells: "all" });
  };

  private readonly onSheets = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
    let reshaped = false;
    const edited: Array<[string, string]> = [];
    for (const event of events) {
      const path = event.path;
      if (path.length === 0) {
        reshaped = true;
        continue;
      }
      const sheetId = String(path[0]);
      if (path.length === 1) {
        // The sheet's own map: its name, a part replaced, or its frozen rows (which change nothing).
        const keys = (event as Y.YMapEvent<unknown>).keysChanged;
        if (!keys || ![...keys].every((key) => key === "frozenRows")) reshaped = true;
        continue;
      }
      const part = String(path[1]);
      if (part === "rows" || part === "cols") reshaped = true;
      else if (part === "cells")
        for (const key of (event as Y.YMapEvent<CellJSON>).keysChanged) edited.push([sheetId, key]);
    }
    if (reshaped) {
      this.index = buildWorkbookIndex(this.doc);
      this.registerAll();
      this.changed({ cells: "all" });
      return;
    }
    if (edited.length) this.cellsEdited(edited);
  };

  private cellsEdited(edited: Array<[string, string]>): void {
    const changed: string[] = [];
    for (const [sheetId, key] of edited) {
      const [rowId, colId] = splitCellKey(key);
      const full = valueKey(sheetId, rowId, colId);
      this.graph.unregister(full, sheetId);
      this.a1Cache.delete(full);
      const cell = this.cell(sheetId, rowId, colId);
      if (cell && isFormula(cell.v)) this.graph.register(full, cell.v, sheetId);
      changed.push(full);
    }
    const dirty = this.graph.dependents(changed, wideChange);
    if (dirty === "all") {
      this.values.clear();
      this.changed({ cells: "all" });
      return;
    }
    for (const key of dirty) this.values.delete(key);
    this.changed({ cells: dirty });
  }

  private changed(change: EngineChange): void {
    this.versionValue += 1;
    for (const listener of [...this.listeners]) listener(change);
  }

  // -- Computing --------------------------------------------------------------------------------

  /**
   * Computes the formulas `roots` need, deepest first, without recursion, so every formula's
   * references already have values when it runs. A formula met again on its own path is part of
   * a cycle: every formula on that loop gets #CYCLE!.
   */
  private prepare(roots: string[]): void {
    const state = new Map<string, "open" | "done">();
    const pending = (key: string) => !this.values.has(key);
    for (const root of roots) {
      if (this.values.has(root) || state.has(root)) continue;
      const stack: Array<{ key: string; next: string[] | null }> = [{ key: root, next: null }];
      const path: string[] = [];
      while (stack.length) {
        const frame = stack[stack.length - 1];
        if (frame.next === null) {
          state.set(frame.key, "open");
          path.push(frame.key);
          frame.next = [];
          for (const dependency of this.graph.dependenciesFor(frame.key))
            this.graph.collect(dependency, pending, frame.next);
        }
        const child = frame.next.pop();
        if (child === undefined) {
          stack.pop();
          path.pop();
          state.set(frame.key, "done");
          if (!this.values.has(frame.key)) this.compute(frame.key);
          continue;
        }
        const seen = state.get(child);
        if (seen === "open") {
          for (const key of path.slice(path.indexOf(child)))
            this.values.set(key, cellError("#CYCLE!"));
          continue;
        }
        if (seen === "done" || this.values.has(child)) continue;
        stack.push({ key: child, next: null });
      }
    }
  }

  private a1(key: string, formula: string, sheetId: string): string {
    let text = this.a1Cache.get(key);
    if (text === undefined) {
      text = a1Formula(formula, sheetId, this.index);
      this.a1Cache.set(key, text);
    }
    return text;
  }

  private compute(key: string): CellValue {
    const known = this.values.get(key);
    if (known !== undefined) return known;
    const [sheetId, rowId, colId] = splitValueKey(key);
    const sheet = this.index.byId.get(sheetId);
    const input = this.cell(sheetId, rowId, colId)?.v ?? "";
    const row = sheet?.rowAt.get(rowId);
    const col = sheet?.colAt.get(colId);
    if (!sheet || row === undefined || col === undefined || !isFormula(input))
      return literalValue(input);
    // Marked first, so a reference back to itself met while running reads as a cycle.
    this.values.set(key, cellError("#CYCLE!"));
    const value = this.run(this.a1(key, input, sheetId).slice(1), sheet, row, col);
    this.values.set(key, value);
    return value;
  }

  private run(formula: string, sheet: SheetIndex, row: number, col: number): CellValue {
    const position: FormulaPosition = { sheet: sheet.name, row: row + 1, col: col + 1 };
    try {
      return fromParser(this.parser.parse(formula, position));
    } catch (error) {
      return thrownError(error);
    }
  }

  private sheetNamed(name: string): SheetIndex | undefined {
    return this.index.byName.get(name.toLowerCase());
  }

  private readCell(ref: FormulaPosition): unknown {
    const sheet = this.sheetNamed(ref.sheet);
    const rowId = sheet?.rowIds[ref.row - 1];
    const colId = sheet?.colIds[ref.col - 1];
    if (!sheet || !rowId || !colId) return null;
    return toParser(this.value(sheet.id, rowId, colId));
  }

  private readRange(ref: FormulaRangeRef): unknown[][] {
    const sheet = this.sheetNamed(ref.sheet);
    if (!sheet) throw new FormulaError("#REF!");
    const bottom = Math.min(ref.to.row, sheet.rowIds.length);
    const right = Math.min(ref.to.col, sheet.colIds.length);
    const out: unknown[][] = [];
    for (let row = ref.from.row; row <= bottom; row += 1) {
      const line: unknown[] = [];
      for (let col = ref.from.col; col <= right; col += 1)
        line.push(toParser(this.value(sheet.id, sheet.rowIds[row - 1], sheet.colIds[col - 1])));
      out.push(line);
    }
    return out.length ? out : [[null]];
  }
}
