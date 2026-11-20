import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Surface, Textarea } from "@misty/ui";
import type { WorkbookEngine } from "../formula/engine";
import { defaultColWidth } from "../workbook/schema";
import { ColumnHeader } from "./ColumnHeader";
import { GridBand, RowNumbers } from "./GridCells";
import { bandBox, CellEditor, FillPreview, PeerOverlay, SelectionOverlay } from "./GridOverlays";
import { rectOf, type CellPos, type Direction, type Rect, type Selection } from "./selection";
import { columnAtX, headerHeight, rowHeaderWidth, rowHeight, type SheetView } from "./sheetView";

export interface GridEditing {
  position: CellPos;
  text: string;
  mode: "enter" | "edit";
  /** Edited in the cell itself, rather than in the formula bar. */
  inCell: boolean;
}

export interface GridPeer {
  key: string;
  name: string;
  rect: Rect;
}

export interface DataGridProps {
  view: SheetView;
  engine: WorkbookEngine;
  selection: Selection;
  editing: GridEditing | null;
  peers: readonly GridPeer[];
  canEdit: boolean;
  filteredCols: ReadonlySet<string>;
  gridRef: RefObject<HTMLDivElement | null>;
  columnMenu(col: number): ReactNode;
  onSelect(selection: Selection): void;
  onEdit(position: CellPos, mode: "enter" | "edit"): void;
  onEditText(text: string): void;
  onCommit(direction: Direction | null): void;
  onCancel(): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  onCopy(event: ClipboardEvent<HTMLDivElement>): void;
  onCut(event: ClipboardEvent<HTMLDivElement>): void;
  onPaste(event: ClipboardEvent<HTMLDivElement>): void;
  onFill(source: Rect, target: Rect): void;
  onResizeColumn(col: number, width: number): void;
  onSelectColumn(col: number, extend: boolean): void;
  onSelectRow(position: number, extend: boolean): void;
}

/** Where a fill drag reaches: the selection stretched down or across toward the pointer. */
function fillTarget(source: Rect, to: CellPos): Rect {
  const down = to.row - source.bottom;
  const up = source.top - to.row;
  const right = to.col - source.right;
  const left = source.left - to.col;
  const most = Math.max(down, up, right, left);
  if (most <= 0) return source;
  if (most === down) return { ...source, bottom: to.row };
  if (most === up) return { ...source, top: to.row };
  if (most === right) return { ...source, right: to.col };
  return { ...source, left: to.col };
}

/**
 * The sheet as a virtualized grid: only the rows and columns in view are drawn, so a sheet of
 * 100,000 cells scrolls as fast as a small one. Column letters stay along the top, row numbers
 * down the left and frozen rows under the letters.
 */
export function DataGrid(props: DataGridProps) {
  const { view, engine, selection, gridRef } = props;
  const frozenHeight = view.frozen * rowHeight;
  const bodyCount = Math.max(0, view.rowCount - view.frozen);
  const rows = useVirtualizer({
    count: bodyCount,
    getScrollElement: () => gridRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    scrollMargin: headerHeight + frozenHeight,
  });
  const cols = useVirtualizer({
    horizontal: true,
    count: view.colIds.length,
    getScrollElement: () => gridRef.current,
    estimateSize: (index) => view.widths[index] ?? defaultColWidth,
    overscan: 3,
    scrollMargin: rowHeaderWidth,
  });
  const widthsKey = view.widths.join(",");
  useEffect(() => cols.measure(), [cols, widthsKey]);

  const drag = useRef<{ kind: "select" | "fill"; anchor: CellPos; source: Rect } | null>(null);
  // WebKit only fires copy and paste where there's a selection or a field, so ⌘C, ⌘X and ⌘V
  // briefly hand focus to a hidden field inside the grid; its events reach the grid's handlers.
  const catcher = useRef<HTMLTextAreaElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const command = event.metaKey || event.ctrlKey;
    const letter = event.key.toLowerCase();
    if (
      command &&
      !event.altKey &&
      event.target === event.currentTarget &&
      ["c", "x", "v"].includes(letter)
    ) {
      const field = catcher.current;
      if (field) {
        field.value = " ";
        field.focus({ preventScroll: true });
        field.select();
      }
      return;
    }
    props.onKeyDown(event);
  };
  const clipboard =
    (handle: (event: ClipboardEvent<HTMLDivElement>) => void) =>
    (event: ClipboardEvent<HTMLDivElement>) => {
      handle(event);
      if (event.target === catcher.current) gridRef.current?.focus({ preventScroll: true });
    };
  const [fill, setFill] = useState<Rect | null>(null);

  const positionAt = (clientX: number, clientY: number): CellPos => {
    const element = gridRef.current!;
    const box = element.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    let row: number;
    if (y < headerHeight + frozenHeight)
      row = Math.floor(Math.max(0, y - headerHeight) / rowHeight);
    else
      row =
        view.frozen + Math.floor((y + element.scrollTop - headerHeight - frozenHeight) / rowHeight);
    const col = columnAtX(view, Math.max(0, x + element.scrollLeft - rowHeaderWidth));
    return {
      row: Math.max(0, Math.min(view.rowCount - 1, row)),
      col: Math.max(0, Math.min(view.colIds.length - 1, col)),
    };
  };

  // Keeps the cell being moved to in view, clear of the letters, row numbers and frozen rows.
  const focusRow = selection.focus.row;
  const focusCol = selection.focus.col;
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });
  useEffect(() => {
    const element = gridRef.current;
    const view = viewRef.current;
    const frozenHeight = view.frozen * rowHeight;
    if (!element || focusCol >= view.colIds.length) return;
    const left = rowHeaderWidth + view.offsets[focusCol];
    const right = left + view.widths[focusCol];
    if (left - rowHeaderWidth < element.scrollLeft) element.scrollLeft = left - rowHeaderWidth;
    else if (right > element.scrollLeft + element.clientWidth)
      element.scrollLeft = right - element.clientWidth;
    if (focusRow < view.frozen) return;
    const top = headerHeight + focusRow * rowHeight;
    const bottom = top + rowHeight;
    const clearTop = element.scrollTop + headerHeight + frozenHeight;
    if (top < clearTop) element.scrollTop = top - headerHeight - frozenHeight;
    else if (bottom > element.scrollTop + element.clientHeight)
      element.scrollTop = bottom - element.clientHeight;
  }, [focusRow, focusCol, gridRef]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[role=columnheader],[data-grid-chrome],input,button")) return;
    const position = positionAt(event.clientX, event.clientY);
    event.currentTarget.focus({ preventScroll: true });
    const anchor = event.shiftKey ? selection.anchor : position;
    props.onSelect({ anchor, focus: position });
    drag.current = { kind: "select", anchor, source: rectOf(selection) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const position = positionAt(event.clientX, event.clientY);
    if (current.kind === "select") props.onSelect({ anchor: current.anchor, focus: position });
    else setFill(fillTarget(current.source, position));
  };
  const onPointerUp = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.kind === "fill" && fill) {
      const changed = JSON.stringify(fill) !== JSON.stringify(current.source);
      if (changed) props.onFill(current.source, fill);
    }
    setFill(null);
  };
  const startFill = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const source = rectOf(selection);
    drag.current = { kind: "fill", anchor: selection.anchor, source };
    setFill(source);
    gridRef.current?.setPointerCapture(event.pointerId);
  };

  const columns = cols.getVirtualItems().map((item) => item.index);
  const bodyPositions = rows.getVirtualItems().map((item) => item.index + view.frozen);
  const frozenPositions = Array.from({ length: view.frozen }, (_, index) => index);
  const rect = rectOf(selection);
  const active = {
    top: selection.anchor.row,
    bottom: selection.anchor.row,
    left: selection.anchor.col,
    right: selection.anchor.col,
  };
  const many = rect.top !== rect.bottom || rect.left !== rect.right;
  const width = rowHeaderWidth + view.totalWidth;
  const editing = props.editing?.inCell ? props.editing : null;

  const overlays = (first: number, end: number) => {
    const editBox =
      editing && editing.position.row >= first && editing.position.row < end
        ? bandBox(
            view,
            {
              top: editing.position.row,
              bottom: editing.position.row,
              left: editing.position.col,
              right: editing.position.col,
            },
            first,
            end,
          )
        : null;
    return (
      <>
        {props.peers.map((peer) => {
          const box = bandBox(view, peer.rect, first, end);
          return box ? <PeerOverlay key={peer.key} box={box} name={peer.name} /> : null;
        })}
        <SelectionOverlay
          range={bandBox(view, rect, first, end)}
          active={bandBox(view, active, first, end)}
          wash={many}
          showHandle={props.canEdit && !editing && rect.bottom < end && rect.bottom >= first}
          onFillStart={startFill}
        />
        <FillPreview box={fill ? bandBox(view, fill, first, end) : null} />
        {editBox && editing ? (
          <CellEditor
            key={`${editing.position.row}:${editing.position.col}`}
            box={editBox}
            text={editing.text}
            mode={editing.mode}
            onChange={props.onEditText}
            onCommit={props.onCommit}
            onCancel={props.onCancel}
          />
        ) : null}
      </>
    );
  };

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={`${view.name} cells`}
      aria-rowcount={view.rowCount}
      aria-colcount={view.colIds.length}
      tabIndex={0}
      data-tour="workbook-grid"
      className="relative min-h-0 flex-1 overflow-auto outline-none select-none"
      onKeyDown={onKeyDown}
      onCopy={clipboard(props.onCopy)}
      onCut={clipboard(props.onCut)}
      onPaste={clipboard(props.onPaste)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "[role=columnheader],[data-grid-chrome],input,button",
          )
        )
          return;
        if (props.canEdit) props.onEdit(positionAt(event.clientX, event.clientY), "edit");
      }}
    >
      <Textarea
        ref={catcher}
        aria-hidden
        tabIndex={-1}
        variant="composer"
        className="sr-only"
        defaultValue=""
      />
      <div className="relative" style={{ width, height: headerHeight + view.rowCount * rowHeight }}>
        <Surface tone="page" className="sticky top-0 z-30" style={{ width, height: headerHeight }}>
          <Surface
            tone="page"
            className="sticky left-0 z-10 border-b border-r"
            style={{ width: rowHeaderWidth, height: headerHeight }}
            aria-label="Select all"
            data-grid-chrome
            onPointerDown={(event) => {
              event.preventDefault();
              props.onSelect({
                anchor: { row: 0, col: 0 },
                focus: { row: view.rowCount - 1, col: view.colIds.length - 1 },
              });
            }}
          />
          {columns.map((col) => (
            <ColumnHeader
              key={view.colIds[col]}
              col={col}
              left={view.offsets[col]}
              width={view.widths[col]}
              selected={col >= rect.left && col <= rect.right}
              filtered={props.filteredCols.has(view.colIds[col])}
              canEdit={props.canEdit}
              menu={props.columnMenu}
              onSelect={props.onSelectColumn}
              onResize={props.onResizeColumn}
            />
          ))}
        </Surface>
        {view.frozen > 0 ? (
          <Surface
            tone="page"
            className="sticky z-20"
            style={{ top: headerHeight, width, height: frozenHeight }}
          >
            <div data-grid-chrome className="contents">
              <RowNumbers
                view={view}
                positions={frozenPositions}
                first={0}
                height={frozenHeight}
                selectedTop={rect.top}
                selectedBottom={rect.bottom}
                onSelectRow={props.onSelectRow}
              />
            </div>
            <GridBand
              view={view}
              engine={engine}
              positions={frozenPositions}
              columns={columns}
              first={0}
            />
            {overlays(0, view.frozen)}
          </Surface>
        ) : null}
        <div className="relative" style={{ width, height: bodyCount * rowHeight }}>
          <div data-grid-chrome className="contents">
            <RowNumbers
              view={view}
              positions={bodyPositions}
              first={view.frozen}
              height={bodyCount * rowHeight}
              selectedTop={rect.top}
              selectedBottom={rect.bottom}
              onSelectRow={props.onSelectRow}
            />
          </div>
          <GridBand
            view={view}
            engine={engine}
            positions={bodyPositions}
            columns={columns}
            first={view.frozen}
          />
          {overlays(view.frozen, view.rowCount)}
        </div>
      </div>
    </div>
  );
}
