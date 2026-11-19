import { memo, type ReactNode } from "react";
import { Surface, Text, cn } from "@/shared/ui";
import type { WorkbookEngine } from "../formula/engine";
import { cellKey, type CellAlign } from "../workbook/schema";
import { cellAlignment, displayValue, isCellError } from "../workbook/values";
import { rowHeaderWidth, rowHeight, sheetRow, type SheetView } from "./sheetView";

const alignClass: Record<CellAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

interface GridCellProps {
  left: number;
  top: number;
  width: number;
  text: string;
  align: CellAlign;
  bold: boolean;
  error: boolean;
}

/** One cell as drawn: its text clipped at its edges, the way a spreadsheet's cells are. */
const GridCell = memo(function GridCell(props: GridCellProps) {
  return (
    <div
      role="gridcell"
      className={cn(
        "absolute overflow-hidden whitespace-nowrap border-b border-r px-2 leading-7 tabular-nums",
        alignClass[props.align],
      )}
      style={{ left: props.left, top: props.top, width: props.width, height: rowHeight }}
    >
      <Text
        bare
        size="control"
        tone={props.error ? "danger" : "default"}
        weight={props.bold ? "semibold" : "regular"}
      >
        {props.text}
      </Text>
    </div>
  );
});

/**
 * The cells of one band of the grid (the frozen rows, or the scrolling body): `positions` are the
 * shown rows it draws, `first` the shown row at its top edge.
 */
export function GridBand(props: {
  view: SheetView;
  engine: WorkbookEngine;
  positions: readonly number[];
  columns: readonly number[];
  first: number;
}) {
  const { view, engine } = props;
  const out: ReactNode[] = [];
  for (const position of props.positions) {
    const row = sheetRow(view, position);
    const rowId = view.rowIds[row];
    if (!rowId) continue;
    const top = (position - props.first) * rowHeight;
    for (const col of props.columns) {
      const colId = view.colIds[col];
      if (!colId) continue;
      const cell = view.cells.get(cellKey(rowId, colId));
      const value = cell?.v ? engine.value(view.id, rowId, colId) : null;
      out.push(
        <GridCell
          key={`${rowId}:${colId}`}
          left={rowHeaderWidth + view.offsets[col]}
          top={top}
          width={view.widths[col]}
          text={displayValue(value, cell?.fmt)}
          align={cellAlignment(value, cell?.fmt)}
          bold={Boolean(cell?.fmt?.bold)}
          error={isCellError(value)}
        />,
      );
    }
  }
  return <>{out}</>;
}

/** The row numbers down a band's left edge, staying put as the grid scrolls sideways. */
export function RowNumbers(props: {
  view: SheetView;
  positions: readonly number[];
  first: number;
  height: number;
  selectedTop: number;
  selectedBottom: number;
  onSelectRow(position: number, extend: boolean): void;
}) {
  return (
    <div
      className="sticky left-0 z-10"
      style={{ width: rowHeaderWidth, height: props.height }}
      onPointerDown={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const position = props.first + Math.floor((event.clientY - box.top) / rowHeight);
        event.preventDefault();
        props.onSelectRow(position, event.shiftKey);
      }}
    >
      {props.positions.map((position) => {
        const selected = position >= props.selectedTop && position <= props.selectedBottom;
        return (
          <Surface
            key={position}
            tone={selected ? "active" : "page"}
            className="absolute left-0 flex items-center justify-end border-b border-r pr-2"
            style={{
              top: (position - props.first) * rowHeight,
              width: rowHeaderWidth,
              height: rowHeight,
            }}
          >
            <Text bare size="caption" tone={selected ? "bright" : "muted"} className="tabular-nums">
              {sheetRow(props.view, position) + 1}
            </Text>
          </Surface>
        );
      })}
    </div>
  );
}
