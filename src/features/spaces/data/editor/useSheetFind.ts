import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkbookEngine } from "../formula/engine";
import { shownPosition, type SheetView } from "../grid/sheetView";
import type { CellPos } from "../grid/selection";
import { splitCellKey } from "../workbook/schema";
import { displayValue, isFormula } from "../workbook/values";

/** The cells on the open sheet whose shown text (or formula) holds `query`, in reading order. */
export function findInSheet(
  view: SheetView,
  engine: WorkbookEngine,
  query: string,
  matchCase: boolean,
): CellPos[] {
  const needle = matchCase ? query : query.toLowerCase();
  if (!needle) return [];
  const index = engine.sheet(view.id);
  if (!index) return [];
  const found: CellPos[] = [];
  view.cells.forEach((cell, key) => {
    if (!cell.v) return;
    const [rowId, colId] = splitCellKey(key);
    const row = index.rowAt.get(rowId);
    const col = index.colAt.get(colId);
    if (row === undefined || col === undefined) return;
    const shown = displayValue(engine.value(view.id, rowId, colId), cell.fmt);
    const typed = isFormula(cell.v) ? engine.inputText(view.id, rowId, colId) : "";
    const hit = (text: string) => (matchCase ? text : text.toLowerCase()).includes(needle);
    if (!hit(shown) && !hit(typed)) return;
    const position = shownPosition(view, row);
    if (position >= 0) found.push({ row: position, col });
  });
  return found.sort((a, b) => a.row - b.row || a.col - b.col);
}

/** Find on the open sheet with the shared FindBar: typing jumps to the first match. */
export function useSheetFind(
  view: SheetView | null,
  engine: WorkbookEngine,
  onMatch: (cell: CellPos) => void,
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [at, setAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(
    () => (open && view ? findInSheet(view, engine, query, matchCase) : []),
    [open, view, engine, query, matchCase],
  );
  const onMatchRef = useRef(onMatch);
  const matchesRef = useRef(matches);
  useEffect(() => {
    onMatchRef.current = onMatch;
    matchesRef.current = matches;
  });
  // A new search jumps to its first match; edits while it's open don't move the selection.
  useEffect(() => {
    setAt(0);
    const first = matchesRef.current[0];
    if (first) onMatchRef.current(first);
  }, [query, matchCase, open]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const step = (by: number) => {
    if (!matches.length) return;
    const next = (at + by + matches.length) % matches.length;
    setAt(next);
    onMatchRef.current(matches[next]);
  };

  return {
    open,
    show: () => {
      setOpen(true);
      inputRef.current?.focus();
    },
    close: () => setOpen(false),
    bar: {
      label: "Find in sheet",
      find: { value: query, onChange: setQuery, inputRef },
      caseSensitive: matchCase,
      onCaseSensitive: () => setMatchCase((current) => !current),
      count: matches.length ? `${Math.min(at, matches.length - 1) + 1}/${matches.length}` : "0/0",
      empty: Boolean(query) && matches.length === 0,
      canStep: matches.length > 0,
      onPrevious: () => step(-1),
      onNext: () => step(1),
    },
  };
}
