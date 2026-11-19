/*
 * The grid's selection and keyboard, as plain functions the grid and its tests share. Rows are
 * positions among the rows shown (a filter hides some), columns are column indexes.
 */

export interface CellPos {
  row: number;
  col: number;
}

export interface Selection {
  /** Where the selection started: the active cell. */
  anchor: CellPos;
  /** Where it was extended to; the anchor itself for one cell. */
  focus: CellPos;
}

export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface GridBounds {
  rows: number;
  cols: number;
}

export const cellSelection = (row: number, col: number): Selection => ({
  anchor: { row, col },
  focus: { row, col },
});

export function rectOf(selection: Selection): Rect {
  return {
    top: Math.min(selection.anchor.row, selection.focus.row),
    bottom: Math.max(selection.anchor.row, selection.focus.row),
    left: Math.min(selection.anchor.col, selection.focus.col),
    right: Math.max(selection.anchor.col, selection.focus.col),
  };
}

export const rectSize = (rect: Rect) => (rect.bottom - rect.top + 1) * (rect.right - rect.left + 1);

export function clampPos(pos: CellPos, bounds: GridBounds): CellPos {
  return {
    row: Math.max(0, Math.min(bounds.rows - 1, pos.row)),
    col: Math.max(0, Math.min(bounds.cols - 1, pos.col)),
  };
}

export type Direction = "up" | "down" | "left" | "right";

const steps: Record<Direction, CellPos> = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
};

/**
 * Moves the active cell, or the far end of the selection while extending. A jump goes to the
 * sheet's edge in that direction, as ⌘ and an arrow do.
 */
export function moveSelection(
  selection: Selection,
  direction: Direction,
  options: { extend?: boolean; jump?: boolean; by?: number },
  bounds: GridBounds,
): Selection {
  const from = options.extend ? selection.focus : selection.anchor;
  const step = steps[direction];
  const by = options.by ?? 1;
  const next = options.jump
    ? {
        row: step.row < 0 ? 0 : step.row > 0 ? bounds.rows - 1 : from.row,
        col: step.col < 0 ? 0 : step.col > 0 ? bounds.cols - 1 : from.col,
      }
    : { row: from.row + step.row * by, col: from.col + step.col * by };
  const clamped = clampPos(next, bounds);
  return options.extend
    ? { anchor: selection.anchor, focus: clamped }
    : { anchor: clamped, focus: clamped };
}

/** What a key does on the grid while no cell is being edited. */
export type GridKeyAction =
  | { type: "move"; direction: Direction; extend: boolean; jump: boolean; by?: number }
  | { type: "step"; direction: Direction }
  | { type: "home"; jump: boolean; extend: boolean }
  | { type: "end"; jump: boolean; extend: boolean }
  | { type: "edit" }
  | { type: "type"; text: string }
  | { type: "clear" }
  | { type: "selectAll" }
  | { type: "fillDown" }
  | { type: "fillRight" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "bold" }
  | { type: "find" }
  | { type: "escape" };

export interface KeyLike {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

const arrows: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export const pageRows = 20;

export function gridKeyAction(event: KeyLike): GridKeyAction | null {
  const command = Boolean(event.metaKey || event.ctrlKey);
  const shift = Boolean(event.shiftKey);
  const direction = arrows[event.key];
  if (direction) return { type: "move", direction, extend: shift, jump: command };
  if (command && !event.altKey) {
    switch (event.key.toLowerCase()) {
      case "a":
        return { type: "selectAll" };
      case "d":
        return { type: "fillDown" };
      case "r":
        return { type: "fillRight" };
      case "z":
        return shift ? { type: "redo" } : { type: "undo" };
      case "y":
        return { type: "redo" };
      case "b":
        return { type: "bold" };
      case "f":
        return { type: "find" };
    }
    if (event.key === "Home") return { type: "home", jump: true, extend: shift };
    if (event.key === "End") return { type: "end", jump: true, extend: shift };
    return null;
  }
  switch (event.key) {
    case "Enter":
      return { type: "step", direction: shift ? "up" : "down" };
    case "Tab":
      return { type: "step", direction: shift ? "left" : "right" };
    case "F2":
      return { type: "edit" };
    case "Delete":
    case "Backspace":
      return { type: "clear" };
    case "Escape":
      return { type: "escape" };
    case "Home":
      return { type: "home", jump: false, extend: shift };
    case "End":
      return { type: "end", jump: false, extend: shift };
    case "PageDown":
      return { type: "move", direction: "down", extend: shift, jump: false, by: pageRows };
    case "PageUp":
      return { type: "move", direction: "up", extend: shift, jump: false, by: pageRows };
  }
  if (event.key.length === 1 && !event.altKey) return { type: "type", text: event.key };
  return null;
}

/** What a key does while a cell is being edited in place. */
export type EditKeyAction =
  { type: "commit"; direction: Direction | null } | { type: "cancel" } | null;

/**
 * Enter and Tab commit and move; Escape cancels. An edit started by typing ("enter" mode)
 * also commits on an arrow, as spreadsheets do; one started with F2 or a double-click ("edit"
 * mode) keeps arrows for moving through the text.
 */
export function editKeyAction(event: KeyLike, mode: "enter" | "edit"): EditKeyAction {
  if (event.key === "Escape") return { type: "cancel" };
  if (event.key === "Enter" && !event.altKey)
    return { type: "commit", direction: event.shiftKey ? "up" : "down" };
  if (event.key === "Tab") return { type: "commit", direction: event.shiftKey ? "left" : "right" };
  const direction = arrows[event.key];
  if (direction && mode === "enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey)
    return { type: "commit", direction };
  return null;
}
