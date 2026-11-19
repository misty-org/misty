import { resolveAnchor, scanAnchors, type AnchorToken } from "../workbook/anchors";
import type { SheetIndex, WorkbookIndex } from "../workbook/workbookIndex";
import { splitValueKey, valueKey, type Bounds } from "./engineValues";

/** A formula's reference, by id: a cell, or a range checked against positions when asked. */
export type Dependency =
  | { sheet: string; kind: "cell"; key: string }
  | { sheet: string; kind: "range"; token: AnchorToken };

export function dependenciesOf(formula: string, sheetId: string): Dependency[] {
  return scanAnchors(formula).map((token) => {
    const sheet = token.from.s ?? token.to?.s ?? sheetId;
    if (!token.to && token.from.r && token.from.c)
      return { sheet, kind: "cell", key: valueKey(sheet, token.from.r, token.from.c) };
    return { sheet, kind: "range", token };
  });
}

/**
 * Which formulas read which cells, by id. Single references are looked up directly; ranges are
 * filed under each column they cover (`*` for whole rows), so a change checks only the ranges
 * over its own column. Formulas are also filed by column, so a range finds the formulas inside
 * it without walking the whole sheet.
 */
export class DependencyGraph {
  private readonly dependencies = new Map<string, Dependency[]>();
  private readonly cellReaders = new Map<string, Set<string>>();
  private readonly rangeReaders = new Map<string, Map<string, Map<string, AnchorToken[]>>>();
  private readonly rangeSpots = new Map<string, Array<[string, string]>>();
  private readonly bySheet = new Map<string, Set<string>>();
  private readonly byColumn = new Map<string, Map<string, Set<string>>>();
  private generation = 0;
  private readonly boundsCache = new WeakMap<
    AnchorToken,
    { generation: number; sheet: string; box: Bounds | null }
  >();

  constructor(private readonly index: () => WorkbookIndex) {}

  clear(): void {
    this.dependencies.clear();
    this.cellReaders.clear();
    this.rangeReaders.clear();
    this.rangeSpots.clear();
    this.bySheet.clear();
    this.byColumn.clear();
    this.reindexed();
  }

  /** Rows or columns moved: every range's bounds are measured again. */
  reindexed(): void {
    this.generation += 1;
  }

  has(key: string): boolean {
    return this.dependencies.has(key);
  }

  dependenciesFor(key: string): readonly Dependency[] {
    return this.dependencies.get(key) ?? [];
  }

  /** Every formula, by sheet. */
  sheets(): IterableIterator<[string, Set<string>]> {
    return this.bySheet.entries();
  }

  register(key: string, formula: string, sheetId: string): void {
    const dependencies = dependenciesOf(formula, sheetId);
    this.dependencies.set(key, dependencies);
    let own = this.bySheet.get(sheetId);
    if (!own) this.bySheet.set(sheetId, (own = new Set()));
    own.add(key);
    const colId = splitValueKey(key)[2];
    let columns = this.byColumn.get(sheetId);
    if (!columns) this.byColumn.set(sheetId, (columns = new Map()));
    let inColumn = columns.get(colId);
    if (!inColumn) columns.set(colId, (inColumn = new Set()));
    inColumn.add(key);
    const spots: Array<[string, string]> = [];
    for (const dependency of dependencies) {
      if (dependency.kind === "cell") {
        let readers = this.cellReaders.get(dependency.key);
        if (!readers) this.cellReaders.set(dependency.key, (readers = new Set()));
        readers.add(key);
        continue;
      }
      const sheet = this.index().byId.get(dependency.sheet);
      const box = sheet ? this.bounds(dependency.token, sheet) : null;
      if (!sheet || !box) continue;
      const covered =
        dependency.token.from.c === undefined ? ["*"] : sheet.colIds.slice(box.left, box.right + 1);
      let ranges = this.rangeReaders.get(dependency.sheet);
      if (!ranges) this.rangeReaders.set(dependency.sheet, (ranges = new Map()));
      for (const column of covered) {
        let readers = ranges.get(column);
        if (!readers) ranges.set(column, (readers = new Map()));
        const tokens = readers.get(key) ?? [];
        tokens.push(dependency.token);
        readers.set(key, tokens);
        spots.push([dependency.sheet, column]);
      }
    }
    if (spots.length) this.rangeSpots.set(key, spots);
  }

  unregister(key: string, sheetId: string): void {
    const dependencies = this.dependencies.get(key);
    this.dependencies.delete(key);
    this.bySheet.get(sheetId)?.delete(key);
    this.byColumn.get(sheetId)?.get(splitValueKey(key)[2])?.delete(key);
    for (const dependency of dependencies ?? [])
      if (dependency.kind === "cell") this.cellReaders.get(dependency.key)?.delete(key);
    for (const [sheet, column] of this.rangeSpots.get(key) ?? [])
      this.rangeReaders.get(sheet)?.get(column)?.delete(key);
    this.rangeSpots.delete(key);
  }

  /**
   * The changed cells and every formula reading them, directly or through others; "all" once
   * there are more than `limit`, when forgetting every value is cheaper.
   */
  dependents(changed: readonly string[], limit: number): Set<string> | "all" {
    const dirty = new Set<string>(changed);
    const queue = [...changed];
    while (queue.length) {
      const key = queue.pop()!;
      for (const reader of this.readersOf(key)) {
        if (dirty.has(reader)) continue;
        dirty.add(reader);
        queue.push(reader);
        if (dirty.size > limit) return "all";
      }
    }
    return dirty;
  }

  private *readersOf(key: string): Iterable<string> {
    yield* this.cellReaders.get(key) ?? [];
    const [sheetId, rowId, colId] = splitValueKey(key);
    const ranges = this.rangeReaders.get(sheetId);
    const sheet = this.index().byId.get(sheetId);
    if (!ranges || !sheet) return;
    const row = sheet.rowAt.get(rowId);
    const col = sheet.colAt.get(colId);
    if (row === undefined || col === undefined) return;
    for (const column of [colId, "*"]) {
      const readers = ranges.get(column);
      if (!readers) continue;
      for (const [reader, tokens] of readers)
        if (tokens.some((token) => covers(this.bounds(token, sheet), row, col))) yield reader;
    }
  }

  bounds(token: AnchorToken, sheet: SheetIndex): Bounds | null {
    const cached = this.boundsCache.get(token);
    if (cached && cached.generation === this.generation && cached.sheet === sheet.id)
      return cached.box;
    const box = measure(token, sheet);
    this.boundsCache.set(token, { generation: this.generation, sheet: sheet.id, box });
    return box;
  }

  /** The formulas a dependency covers for which `pending` holds. */
  collect(dependency: Dependency, pending: (key: string) => boolean, out: string[]): void {
    if (dependency.kind === "cell") {
      if (this.dependencies.has(dependency.key) && pending(dependency.key))
        out.push(dependency.key);
      return;
    }
    const sheet = this.index().byId.get(dependency.sheet);
    const columns = this.byColumn.get(dependency.sheet);
    if (!sheet || !columns?.size) return;
    const box = this.bounds(dependency.token, sheet);
    if (!box) return;
    for (let col = box.left; col <= box.right; col += 1) {
      const keys = columns.get(sheet.colIds[col]);
      if (!keys?.size) continue;
      for (const key of keys) {
        if (!pending(key)) continue;
        const row = sheet.rowAt.get(splitValueKey(key)[1]);
        if (row !== undefined && row >= box.top && row <= box.bottom) out.push(key);
      }
    }
  }
}

function covers(box: Bounds | null, row: number, col: number): boolean {
  return Boolean(box && row >= box.top && row <= box.bottom && col >= box.left && col <= box.right);
}

function measure(token: AnchorToken, sheet: SheetIndex): Bounds | null {
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
