import { useEffect, useRef, type PointerEvent } from "react";
import { Avatar, AvatarFallback, Input, Surface, Tooltip } from "@misty/ui";
import { personInitials } from "@/shared/lib/personInitials";
import { editKeyAction, type Direction, type Rect } from "./selection";
import { rowHeaderWidth, rowHeight, type SheetView } from "./sheetView";

export interface BandBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a shown-row rectangle falls inside a band covering shown rows [`first`, `end`). */
export function bandBox(view: SheetView, rect: Rect, first: number, end: number): BandBox | null {
  const top = Math.max(rect.top, first);
  const bottom = Math.min(rect.bottom, end - 1);
  const right = Math.min(rect.right, view.colIds.length - 1);
  if (top > bottom || rect.left > right) return null;
  const left = view.offsets[rect.left];
  return {
    left: rowHeaderWidth + left,
    top: (top - first) * rowHeight,
    width: view.offsets[right] + view.widths[right] - left,
    height: (bottom - top + 1) * rowHeight,
  };
}

/** The selection: a neutral wash over a range, a bright outline round it and the fill handle. */
export function SelectionOverlay(props: {
  range: BandBox | null;
  active: BandBox | null;
  wash: boolean;
  showHandle: boolean;
  onFillStart?(event: PointerEvent<HTMLDivElement>): void;
}) {
  const { range, active } = props;
  return (
    <>
      {range && props.wash ? (
        <Surface tone="faint" className="pointer-events-none absolute" style={range} />
      ) : null}
      {range ? (
        <Surface tone="none" edge="bright" className="pointer-events-none absolute" style={range} />
      ) : null}
      {active && props.wash ? (
        <Surface
          tone="none"
          edge="strong"
          className="pointer-events-none absolute"
          style={active}
        />
      ) : null}
      {range && props.showHandle ? (
        <Surface
          tone="inverse"
          aria-hidden
          className="absolute size-2 cursor-crosshair"
          style={{ left: range.left + range.width - 4, top: range.top + range.height - 4 }}
          onPointerDown={props.onFillStart}
        />
      ) : null}
    </>
  );
}

/** Where a fill drag would reach, outlined while it's dragged. */
export function FillPreview(props: { box: BandBox | null }) {
  if (!props.box) return null;
  return (
    <Surface tone="none" edge="dashed" className="pointer-events-none absolute" style={props.box} />
  );
}

/** Another person's selection: a neutral outline with their initial at its corner. */
export function PeerOverlay(props: { box: BandBox; name: string }) {
  return (
    <>
      <Surface
        tone="none"
        edge="strong"
        className="pointer-events-none absolute"
        style={props.box}
      />
      <Tooltip content={props.name}>
        <Avatar
          size="xs"
          className="absolute"
          style={{ left: props.box.left + props.box.width - 10, top: props.box.top - 6 }}
        >
          <AvatarFallback>{personInitials(props.name).slice(0, 1)}</AvatarFallback>
        </Avatar>
      </Tooltip>
    </>
  );
}

/** The field over a cell while it is edited in place. */
export function CellEditor(props: {
  box: BandBox;
  text: string;
  mode: "enter" | "edit";
  onChange(text: string): void;
  onCommit(direction: Direction | null): void;
  onCancel(): void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const input = field.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, []);
  return (
    <Surface
      tone="card"
      edge="bright"
      className="absolute z-10 flex items-center px-2 select-text"
      style={{ ...props.box, width: Math.max(props.box.width, 160), height: rowHeight }}
    >
      <Input
        ref={field}
        variant="bare"
        aria-label="Cell contents"
        value={props.text}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          const action = editKeyAction(event, props.mode);
          if (!action) return;
          event.preventDefault();
          done.current = true;
          if (action.type === "cancel") props.onCancel();
          else props.onCommit(action.direction);
        }}
        onBlur={() => {
          if (!done.current) props.onCommit(null);
        }}
      />
    </Surface>
  );
}
