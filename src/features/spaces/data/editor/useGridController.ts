import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { notify } from "@misty/ui";
import type { WorkbookSession } from "../session";
import {
  readWorkbookClipboard,
  parseTsv,
  toHtmlTable,
  toTsv,
  workbookClipboardType,
  type WorkbookClipboard,
} from "../grid/clipboard";
import type { GridEditing, GridPeer } from "../grid/DataGrid";
import {
  CellLimitError,
  clearCells,
  commitInput,
  fillCells,
  formatCells,
  pasteCells,
  type FormatChange,
} from "../grid/gridEdits";
import { publishCursor, type Peer } from "../grid/presence";
import {
  cellSelection,
  clampPos,
  gridKeyAction,
  moveSelection,
  rectOf,
  type CellPos,
  type Direction,
  type Rect,
  type Selection,
} from "../grid/selection";
import { sheetRow, sheetRows, shownPosition, type SheetView } from "../grid/sheetView";
import { cellName, formatA1Range } from "../workbook/a1";
import { cellKey } from "../workbook/schema";
import { usedExtent } from "../workbook/sheetEdit";
import { displayValue } from "../workbook/values";

const copyCap = 200_000;

function failed(error: unknown, fallback: string): void {
  const message =
    error instanceof CellLimitError || error instanceof Error ? error.message : fallback;
  notify({ message: message.replace(/^Op \d+ \([^)]*\): /, "") || fallback, tone: "error" });
}

/**
 * The open sheet's selection, in-place editing, keyboard, clipboard and fill, over the sheet
 * as it's shown. Every change goes through the grid edits, one transaction each.
 */
export function useGridController(props: {
  session: WorkbookSession;
  view: SheetView | null;
  canEdit: boolean;
  cellLimit: number;
  peers: readonly Peer[];
  onFind(): void;
}) {
  const { session, view, canEdit } = props;
  const doc = session.doc;
  const engine = session.engine();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<Selection>(() => cellSelection(0, 0));
  const [editing, setEditingState] = useState<GridEditing | null>(null);
  const editingRef = useRef<GridEditing | null>(null);
  const setEditing = (next: GridEditing | null) => {
    editingRef.current = next;
    setEditingState(next);
  };

  const bounds = useMemo(
    () => ({ rows: Math.max(1, view?.rowCount ?? 1), cols: Math.max(1, view?.colIds.length ?? 1) }),
    [view?.rowCount, view?.colIds.length],
  );
  const sheetId = view?.id ?? null;

  // A new sheet starts at its first cell; a smaller one keeps the selection inside it.
  useEffect(() => {
    setSelection(cellSelection(0, 0));
    editingRef.current = null;
    setEditingState(null);
  }, [sheetId]);
  useEffect(() => {
    setSelection((current) => {
      const anchor = clampPos(current.anchor, bounds);
      const focus = clampPos(current.focus, bounds);
      return anchor.row === current.anchor.row &&
        anchor.col === current.anchor.col &&
        focus.row === current.focus.row &&
        focus.col === current.focus.col
        ? current
        : { anchor, focus };
    });
  }, [bounds]);

  const rect = rectOf(selection);
  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });

  // What others see: this person's selection, by row and column id.
  const awareness = session.provider.awareness;
  const anchorRow = view ? view.rowIds[sheetRow(view, selection.anchor.row)] : undefined;
  const anchorCol = view?.colIds[selection.anchor.col];
  const focusRowId = view ? view.rowIds[sheetRow(view, selection.focus.row)] : undefined;
  const focusColId = view?.colIds[selection.focus.col];
  useEffect(() => {
    if (!sheetId || !anchorRow || !anchorCol || !focusRowId || !focusColId) return;
    publishCursor(awareness, {
      sheet: sheetId,
      anchor: { r: anchorRow, c: anchorCol },
      focus: { r: focusRowId, c: focusColId },
    });
  }, [awareness, sheetId, anchorRow, anchorCol, focusRowId, focusColId]);
  useEffect(() => () => publishCursor(awareness, null), [awareness]);

  const peers = useMemo<GridPeer[]>(() => {
    if (!view) return [];
    return props.peers.flatMap((peer) => {
      const cursor = peer.cursor;
      if (!cursor || cursor.sheet !== view.id) return [];
      const index = engine.sheet(view.id);
      const rows = [cursor.anchor.r, cursor.focus.r].map((id) => index?.rowAt.get(id));
      const cols = [cursor.anchor.c, cursor.focus.c].map((id) => index?.colAt.get(id));
      if (rows.some((row) => row === undefined) || cols.some((col) => col === undefined)) return [];
      const shown = rows.map((row) => shownPosition(view, row!));
      if (shown.some((row) => row < 0)) return [];
      return [
        {
          key: String(peer.clientId),
          name: peer.user.name,
          rect: rectOf({
            anchor: { row: shown[0], col: cols[0]! },
            focus: { row: shown[1], col: cols[1]! },
          }),
        },
      ];
    });
  }, [props.peers, view, engine]);

  const rowsOf = (area: Rect) =>
    view ? sheetRows(view, area.top, area.bottom - area.top + 1) : [];
  const sheetRect = (area: Rect): Rect =>
    view ? { ...area, top: sheetRow(view, area.top), bottom: sheetRow(view, area.bottom) } : area;

  const inputAt = (position: CellPos) => {
    if (!view) return "";
    const rowId = view.rowIds[sheetRow(view, position.row)];
    const colId = view.colIds[position.col];
    return rowId && colId ? engine.inputText(view.id, rowId, colId) : "";
  };

  const startEdit = (position: CellPos, mode: "enter" | "edit", text?: string, inCell = true) => {
    if (!canEdit || !view) return;
    setSelection(cellSelection(position.row, position.col));
    setEditing({ position, mode, inCell, text: text ?? inputAt(position) });
  };

  const commit = (direction: Direction | null) => {
    const current = editingRef.current;
    if (!current || !view) return;
    setEditing(null);
    if (current.text !== inputAt(current.position)) {
      try {
        commitInput(
          doc,
          view.id,
          sheetRow(view, current.position.row),
          current.position.col,
          current.text,
        );
      } catch (error) {
        failed(error, "That cell couldn't be saved.");
      }
    }
    const here = cellSelection(current.position.row, current.position.col);
    setSelection(direction ? moveSelection(here, direction, {}, bounds) : here);
    // A commit from the keyboard goes back to the grid; one from clicking elsewhere stays there.
    if (direction) focusGrid();
  };

  const cancel = () => {
    const current = editingRef.current;
    setEditing(null);
    if (current?.inCell) focusGrid();
  };

  const format = (change: FormatChange) => {
    if (!view || !canEdit) return;
    try {
      formatCells(doc, view.id, rowsOf(rect), rect.left, rect.right, change);
    } catch (error) {
      failed(error, "The format couldn't be changed.");
    }
  };

  const fill = (source: Rect, target: Rect) => {
    if (!view || !canEdit) return;
    try {
      fillCells(doc, view.id, sheetRect(source), sheetRect(target));
      setSelection({
        anchor: { row: target.top, col: target.left },
        focus: { row: target.bottom, col: target.right },
      });
    } catch (error) {
      failed(error, "Those cells couldn't be filled.");
    }
  };

  const fillFrom = (direction: "down" | "right") => {
    if (direction === "down") {
      if (rect.bottom > rect.top) fill({ ...rect, bottom: rect.top }, rect);
      else if (rect.top > 0)
        fill({ ...rect, top: rect.top - 1, bottom: rect.top - 1 }, { ...rect, top: rect.top - 1 });
    } else if (rect.right > rect.left) fill({ ...rect, right: rect.left }, rect);
    else if (rect.left > 0)
      fill(
        { ...rect, left: rect.left - 1, right: rect.left - 1 },
        { ...rect, left: rect.left - 1 },
      );
  };

  const usedEnd = () => {
    const index = view ? engine.sheet(view.id) : undefined;
    return view && index ? usedExtent({ cells: view.cells }, index) : { rows: 1, cols: 1 };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !view) return;
    const action = gridKeyAction(event);
    if (!action) return;
    const extend = (pos: CellPos) => ({ anchor: selection.anchor, focus: clampPos(pos, bounds) });
    switch (action.type) {
      case "move":
        setSelection(moveSelection(selection, action.direction, action, bounds));
        break;
      case "step":
        setSelection(
          moveSelection(
            cellSelection(selection.anchor.row, selection.anchor.col),
            action.direction,
            {},
            bounds,
          ),
        );
        break;
      case "home": {
        const to = {
          row: action.jump ? 0 : (action.extend ? selection.focus : selection.anchor).row,
          col: 0,
        };
        setSelection(action.extend ? extend(to) : cellSelection(to.row, to.col));
        break;
      }
      case "end": {
        const used = usedEnd();
        const from = action.extend ? selection.focus : selection.anchor;
        const to = {
          row: action.jump ? Math.max(0, used.rows - 1) : from.row,
          col: Math.max(0, used.cols - 1),
        };
        setSelection(action.extend ? extend(to) : cellSelection(to.row, to.col));
        break;
      }
      case "edit":
        startEdit(selection.anchor, "edit");
        break;
      case "type":
        if (!canEdit) return;
        startEdit(selection.anchor, "enter", action.text);
        break;
      case "clear":
        if (!canEdit) return;
        clearCells(doc, view.id, rowsOf(rect), rect.left, rect.right);
        break;
      case "selectAll":
        setSelection({
          anchor: { row: 0, col: 0 },
          focus: { row: bounds.rows - 1, col: bounds.cols - 1 },
        });
        break;
      case "fillDown":
      case "fillRight":
        if (!canEdit) return;
        fillFrom(action.type === "fillDown" ? "down" : "right");
        break;
      case "undo":
        if (canEdit) session.undo().undo();
        break;
      case "redo":
        if (canEdit) session.undo().redo();
        break;
      case "bold":
        format({ toggle: "bold" });
        break;
      case "find":
        props.onFind();
        break;
      case "escape":
        setSelection(cellSelection(selection.anchor.row, selection.anchor.col));
        break;
    }
    event.preventDefault();
  };

  const copyRect = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!view || editingRef.current) return false;
    const rows = rowsOf(rect);
    if (rows.length * (rect.right - rect.left + 1) > copyCap) {
      notify({ message: "That's too many cells to copy at once. Select fewer.", tone: "error" });
      event.preventDefault();
      return false;
    }
    const shown: string[][] = [];
    const stored: WorkbookClipboard["cells"] = [];
    for (const row of rows) {
      const rowId = view.rowIds[row];
      const line: string[] = [];
      const cells: WorkbookClipboard["cells"][number] = [];
      for (let col = rect.left; col <= rect.right; col += 1) {
        const colId = view.colIds[col];
        const cell = rowId && colId ? view.cells.get(cellKey(rowId, colId)) : undefined;
        line.push(cell?.v ? displayValue(engine.value(view.id, rowId, colId), cell.fmt) : "");
        cells.push({ v: cell?.v ?? "", fmt: cell?.fmt as Record<string, unknown> | undefined });
      }
      shown.push(line);
      stored.push(cells);
    }
    const clip: WorkbookClipboard = {
      doc: doc.guid,
      sheet: view.id,
      row: rows[0] ?? 0,
      col: rect.left,
      cells: stored,
    };
    event.clipboardData.setData("text/plain", toTsv(shown));
    event.clipboardData.setData("text/html", toHtmlTable(shown));
    event.clipboardData.setData(workbookClipboardType, JSON.stringify(clip));
    event.preventDefault();
    return true;
  };

  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => void copyRect(event);
  const onCut = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!canEdit || !view) return;
    if (copyRect(event)) clearCells(doc, view.id, rowsOf(rect), rect.left, rect.right);
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!canEdit || !view || editingRef.current) return;
    event.preventDefault();
    const clip = readWorkbookClipboard(event.clipboardData.getData(workbookClipboardType));
    const ours = clip && clip.doc === doc.guid ? clip : null;
    let height: number;
    let width: number;
    let block: Parameters<typeof pasteCells>[4];
    if (ours) {
      block = { kind: "workbook", clip: ours };
      height = ours.cells.length;
      width = ours.cells[0]?.length ?? 0;
    } else {
      const text = event.clipboardData.getData("text/plain");
      if (!text) return;
      let rows = parseTsv(text);
      // One value pasted over a selection fills all of it, as spreadsheets do.
      if (
        rows.length === 1 &&
        rows[0].length === 1 &&
        (rect.bottom > rect.top || rect.right > rect.left)
      )
        rows = Array.from({ length: rect.bottom - rect.top + 1 }, () =>
          Array.from({ length: rect.right - rect.left + 1 }, () => rows[0][0]),
        );
      block = { kind: "text", rows };
      height = rows.length;
      width = rows.reduce((most, row) => Math.max(most, row.length), 0);
    }
    try {
      pasteCells(
        doc,
        view.id,
        sheetRows(view, rect.top, height),
        rect.left,
        block,
        props.cellLimit,
      );
      setSelection({
        anchor: { row: rect.top, col: rect.left },
        focus: { row: rect.top + height - 1, col: rect.left + Math.max(0, width - 1) },
      });
    } catch (error) {
      failed(error, "Those cells couldn't be pasted.");
    }
  };

  const selectColumn = useCallback(
    (col: number, extend: boolean) => {
      setSelection((current) => ({
        anchor: { row: 0, col: extend ? current.anchor.col : col },
        focus: { row: bounds.rows - 1, col },
      }));
      focusGrid();
    },
    [bounds.rows],
  );
  const selectRow = useCallback(
    (row: number, extend: boolean) => {
      setSelection((current) => ({
        anchor: { row: extend ? current.anchor.row : row, col: 0 },
        focus: { row, col: bounds.cols - 1 },
      }));
      focusGrid();
    },
    [bounds.cols],
  );

  const name = view
    ? rect.top === rect.bottom && rect.left === rect.right
      ? cellName(sheetRow(view, rect.top), rect.left)
      : formatA1Range({
          start: { row: sheetRow(view, rect.top), col: rect.left },
          end: { row: sheetRow(view, rect.bottom), col: rect.right },
        })
    : "";
  const barText = editing ? editing.text : inputAt(selection.anchor);

  return {
    gridRef,
    selection,
    setSelection,
    rect,
    editing,
    peers,
    name,
    barText,
    rowsOf,
    startEdit,
    editText: (text: string) => {
      const current = editingRef.current;
      if (current) setEditing({ ...current, text });
    },
    startBarEdit: () => {
      if (!editingRef.current) startEdit(selection.anchor, "edit", undefined, false);
    },
    commit,
    cancel,
    clear: () => {
      if (canEdit && view) clearCells(doc, view.id, rowsOf(rect), rect.left, rect.right);
    },
    format,
    fill,
    onKeyDown,
    onCopy,
    onCut,
    onPaste,
    selectColumn,
    selectRow,
    focusGrid,
  };
}

export type GridController = ReturnType<typeof useGridController>;
