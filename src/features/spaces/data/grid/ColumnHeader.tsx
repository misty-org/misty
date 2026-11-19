import { memo, useRef, useState, type ReactNode } from "react";
import { RowActions, Surface, Text } from "@/shared/ui";
import { columnLabel } from "../workbook/a1";
import { minColWidth, maxColWidth } from "../workbook/schema";
import { headerHeight, rowHeaderWidth } from "./sheetView";

/**
 * A column's header: its letter, its actions (the ⋯ on hover, or a right-click), and a seam at
 * its right edge to drag its width. Clicking selects the column.
 */
export const ColumnHeader = memo(function ColumnHeader(props: {
  col: number;
  left: number;
  width: number;
  selected: boolean;
  filtered: boolean;
  canEdit: boolean;
  menu: (col: number) => ReactNode;
  onSelect(col: number, extend: boolean): void;
  onResize(col: number, width: number): void;
}) {
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const start = useRef<{ x: number; width: number } | null>(null);
  const width = dragWidth ?? props.width;
  return (
    <Surface
      role="columnheader"
      tone={props.selected ? "active" : "page"}
      className="group/row absolute top-0 flex items-center gap-1 border-b border-r pl-2 pr-1"
      style={{ left: rowHeaderWidth + props.left, width, height: headerHeight }}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("button,[data-seam]"))
          return;
        event.preventDefault();
        props.onSelect(props.col, event.shiftKey);
      }}
    >
      <Text
        size="caption"
        tone={props.selected ? "bright" : "muted"}
        weight={props.filtered ? "semibold" : "regular"}
        className="min-w-0 flex-1 text-center"
      >
        {columnLabel(props.col)}
      </Text>
      <RowActions label={`Column ${columnLabel(props.col)} actions`}>
        {props.menu(props.col)}
      </RowActions>
      {props.canEdit ? (
        <div
          data-seam
          aria-hidden
          className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = { x: event.clientX, width: props.width };
            setDragWidth(props.width);
          }}
          onPointerMove={(event) => {
            if (!start.current) return;
            const next = start.current.width + event.clientX - start.current.x;
            setDragWidth(Math.max(minColWidth, Math.min(maxColWidth, next)));
          }}
          onPointerUp={(event) => {
            if (!start.current) return;
            const next = start.current.width + event.clientX - start.current.x;
            start.current = null;
            setDragWidth(null);
            props.onResize(props.col, next);
          }}
          onPointerCancel={() => {
            start.current = null;
            setDragWidth(null);
          }}
        />
      ) : null}
    </Surface>
  );
});
