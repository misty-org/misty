import { ShapeSelection, cn, type SelectionHandle } from "@misty/ui";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { MarkStyle, MarkupTool, TextDraft } from "./editorTypes";
import {
  newMarkId,
  positiveBox,
  topZ,
  type Box,
  type ImageEdit,
  type Mark,
  type Point,
  type TextMark,
} from "./imageEdit";
import {
  boxHandles,
  dragBox,
  fitMark,
  handleSpot,
  markAt,
  markBounds,
  marksIn,
  moveMark,
  simplifyStroke,
  unionBounds,
  type BoxHandle,
} from "./markGeometry";
import type { ImageDocument } from "./useImageDocument";

type Gesture =
  | { kind: "draw"; start: Point; mark: Mark }
  | {
      kind: "move";
      start: Point;
      origin: Record<string, Mark>;
      moved: boolean;
      /** A text picked with the text tool: let go without moving it, and it opens to edit. */
      opens?: TextMark;
    }
  | {
      kind: "resize";
      start: Point;
      handle: BoxHandle;
      bounds: Box;
      origin: Record<string, Mark>;
      moved: boolean;
    }
  | { kind: "end"; start: Point; id: string; end: "from" | "to"; origin: Mark; moved: boolean }
  | { kind: "marquee"; start: Point; additive: boolean; base: string[] };

/** How close, in screen pixels, the pointer must come to a mark to pick it. */
const pickSlack = 6;

/**
 * Drawing and arranging marks over the image. It covers the image's box and works in the image's
 * own space through `toUnits` and `toBox`, so turning, cropping and zooming never change how it
 * behaves. Every move of a drag shows to everyone as it happens; the drag is one undo step.
 */
export function MarkupLayer(props: {
  edit: ImageEdit;
  /** From the image's own space to this layer's pixels, and back. */
  toBox: (point: Point) => { x: number; y: number };
  toUnits: (x: number, y: number) => Point;
  /** How much of the image's own space one screen pixel is. */
  unitsPerPixel: number;
  tool: MarkupTool;
  style: MarkStyle;
  selection: string[];
  onSelection: (ids: string[]) => void;
  document: Pick<ImageDocument, "change" | "preview" | "commit">;
  author?: string;
  /** The mark being drawn right now, shown on the image and to everyone else. */
  onDraft: (mark: Mark | null) => void;
  /** Opens the text box for a new text mark, or one being changed. */
  onText: (draft: TextDraft) => void;
  /** The stage is being moved instead (Space held): the layer lets the pointer through. */
  panning: boolean;
}) {
  const { edit, toBox, toUnits, unitsPerPixel, tool, style, selection } = props;
  const layer = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [overMark, setOverMark] = useState(false);

  const unitsAt = (event: { clientX: number; clientY: number }): Point => {
    const box = layer.current?.getBoundingClientRect();
    return toUnits(event.clientX - (box?.left ?? 0), event.clientY - (box?.top ?? 0));
  };
  const picked = (ids: string[]) =>
    Object.fromEntries(ids.filter((id) => edit.marks[id]).map((id) => [id, edit.marks[id]]));
  const withMarks = (current: ImageEdit, changed: Record<string, Mark>): ImageEdit => {
    const marks = { ...current.marks };
    // A mark someone else removed mid-drag stays removed.
    for (const [id, mark] of Object.entries(changed)) if (id in marks) marks[id] = mark;
    return { ...current, marks };
  };

  const capture = (event: ReactPointerEvent<Element>) => {
    event.preventDefault();
    event.stopPropagation();
    layer.current?.setPointerCapture(event.pointerId);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || props.panning) return;
    const point = unitsAt(event);
    const slack = pickSlack * unitsPerPixel;
    if (tool === "select") {
      capture(event);
      const hit = markAt(edit.marks, point, slack);
      if (hit && event.detail >= 2 && hit.kind === "text") {
        gesture.current = null;
        props.onText({ at: hit.at, markId: hit.id, text: hit.text });
        return;
      }
      if (hit) {
        let ids = selection;
        if (event.shiftKey)
          ids = selection.includes(hit.id)
            ? selection.filter((id) => id !== hit.id)
            : [...selection, hit.id];
        else if (!selection.includes(hit.id)) ids = [hit.id];
        props.onSelection(ids);
        gesture.current = ids.includes(hit.id)
          ? { kind: "move", start: point, origin: picked(ids), moved: false }
          : null;
        return;
      }
      if (!event.shiftKey) props.onSelection([]);
      gesture.current = {
        kind: "marquee",
        start: point,
        additive: event.shiftKey,
        base: event.shiftKey ? selection : [],
      };
      setMarquee({ x: point.x, y: point.y, width: 0, height: 0 });
      return;
    }
    if (tool === "text") {
      const hit = markAt(edit.marks, point, slack);
      // A text is picked and can be dragged; let go where it was and it opens to edit.
      if (hit?.kind === "text") {
        capture(event);
        props.onSelection([hit.id]);
        gesture.current = {
          kind: "move",
          start: point,
          origin: picked([hit.id]),
          moved: false,
          opens: hit,
        };
        return;
      }
      event.preventDefault();
      props.onSelection([]);
      // The text's first line sits centered on where the person clicked.
      props.onText({ at: { x: point.x, y: point.y - style.text * 0.6 }, text: "" });
      return;
    }
    capture(event);
    props.onSelection([]);
    const mark = startMark(tool, point, style, props.author);
    gesture.current = { kind: "draw", start: point, mark };
    props.onDraft(mark);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    const point = unitsAt(event);
    if (!current) {
      if (tool === "select")
        setOverMark(Boolean(markAt(edit.marks, point, pickSlack * unitsPerPixel)));
      else if (tool === "text")
        setOverMark(markAt(edit.marks, point, pickSlack * unitsPerPixel)?.kind === "text");
      return;
    }
    const dx = point.x - current.start.x;
    const dy = point.y - current.start.y;
    switch (current.kind) {
      case "draw":
        current.mark = extendMark(
          current.mark,
          current.start,
          point,
          event.shiftKey,
          unitsPerPixel,
        );
        props.onDraft(current.mark);
        return;
      case "move": {
        if (!current.moved && Math.hypot(dx, dy) < 2 * unitsPerPixel) return;
        current.moved = true;
        const moved = Object.fromEntries(
          Object.entries(current.origin).map(([id, mark]) => [id, moveMark(mark, dx, dy)]),
        );
        props.document.preview((edit) => withMarks(edit, moved));
        return;
      }
      case "resize": {
        current.moved = true;
        const box = dragBox(
          current.bounds,
          current.handle,
          dx,
          dy,
          event.shiftKey,
          4 * unitsPerPixel,
        );
        const sized = Object.fromEntries(
          Object.entries(current.origin).map(([id, mark]) => [
            id,
            fitMark(mark, current.bounds, box),
          ]),
        );
        props.document.preview((edit) => withMarks(edit, sized));
        return;
      }
      case "end": {
        current.moved = true;
        const origin = current.origin;
        if (origin.kind !== "line" && origin.kind !== "arrow") return;
        const fixed = current.end === "from" ? origin.to : origin.from;
        const moving = current.end === "from" ? origin.from : origin.to;
        const raw = { x: moving.x + dx, y: moving.y + dy };
        const target = event.shiftKey ? snapAngle(fixed, raw) : raw;
        props.document.preview((edit) =>
          withMarks(edit, { [current.id]: { ...origin, [current.end]: target } }),
        );
        return;
      }
      case "marquee":
        setMarquee({ x: current.start.x, y: current.start.y, width: dx, height: dy });
        return;
    }
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const current = gesture.current;
    gesture.current = null;
    if (layer.current?.hasPointerCapture(event.pointerId))
      layer.current.releasePointerCapture(event.pointerId);
    if (!current) return;
    switch (current.kind) {
      case "draw": {
        props.onDraft(null);
        if (cancelled) return;
        const mark = finishMark(current.mark, unitsPerPixel);
        if (!mark) return;
        props.document.change((edit) => ({
          ...edit,
          marks: { ...edit.marks, [mark.id]: { ...mark, z: topZ(edit.marks) + 1 } },
        }));
        // A shape just drawn is picked, so it can be sized or restyled straight away.
        if (mark.kind !== "pen") props.onSelection([mark.id]);
        return;
      }
      case "move":
        if (current.moved) props.document.commit();
        else if (current.opens && !cancelled) {
          const { at, id, text } = current.opens;
          props.onText({ at, markId: id, text });
        }
        return;
      case "resize":
      case "end":
        if (current.moved) props.document.commit();
        return;
      case "marquee": {
        setMarquee(null);
        if (cancelled) return;
        const box = marquee ?? { x: current.start.x, y: current.start.y, width: 0, height: 0 };
        const area = positiveBox(box);
        if (area.width < 2 * unitsPerPixel && area.height < 2 * unitsPerPixel) return;
        const found = marksIn(edit.marks, area);
        props.onSelection(current.additive ? [...new Set([...current.base, ...found])] : found);
        return;
      }
    }
  };

  const onHandlePointerDown = (id: string, event: ReactPointerEvent<SVGRectElement>) => {
    if (event.button !== 0 || props.panning) return;
    capture(event);
    const point = unitsAt(event);
    if (id === "from" || id === "to") {
      const mark = edit.marks[selection[0]];
      if (mark)
        gesture.current = {
          kind: "end",
          start: point,
          id: mark.id,
          end: id,
          origin: mark,
          moved: false,
        };
      return;
    }
    const origin = picked(selection);
    const bounds = unionBounds(Object.values(origin).map(markBounds));
    if (bounds)
      gesture.current = {
        kind: "resize",
        start: point,
        handle: id as BoxHandle,
        bounds,
        origin,
        moved: false,
      };
  };

  // The selection's frame, in this layer's pixels.
  const selected = selection
    .map((id) => edit.marks[id])
    .filter((mark): mark is Mark => Boolean(mark));
  let outline: { x: number; y: number }[] = [];
  let handles: SelectionHandle[] = [];
  const single = selected.length === 1 ? selected[0] : null;
  if (single && (single.kind === "line" || single.kind === "arrow")) {
    const from = toBox(single.from);
    const to = toBox(single.to);
    outline = [from, to];
    handles = [
      { id: "from", ...from, cursor: "move" },
      { id: "to", ...to, cursor: "move" },
    ];
  } else {
    const bounds = unionBounds(selected.map(markBounds));
    if (bounds) {
      const at = (fx: number, fy: number) =>
        toBox({ x: bounds.x + bounds.width * fx, y: bounds.y + bounds.height * fy });
      outline = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];
      const center = at(0.5, 0.5);
      handles = boxHandles.map((handle) => {
        const spot = handleSpot(handle);
        const place = at(spot.x, spot.y);
        return { id: handle, ...place, cursor: handleCursor(handle, place, center) };
      });
    }
  }
  const marqueeOutline = marquee
    ? (() => {
        const box = positiveBox(marquee);
        return [
          toBox(box),
          toBox({ x: box.x + box.width, y: box.y }),
          toBox({ x: box.x + box.width, y: box.y + box.height }),
          toBox({ x: box.x, y: box.y + box.height }),
        ];
      })()
    : null;

  return (
    <div
      ref={layer}
      data-markup-layer=""
      className={cn(
        "absolute inset-0 touch-none select-none",
        props.panning && "pointer-events-none",
        overMark && (tool === "select" || tool === "text")
          ? "cursor-move"
          : tool === "select"
            ? "cursor-default"
            : tool === "text"
              ? "cursor-text"
              : "cursor-crosshair",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
      onPointerLeave={() => setOverMark(false)}
    >
      {outline.length ? (
        <ShapeSelection
          outline={outline}
          handles={handles}
          onHandlePointerDown={onHandlePointerDown}
        />
      ) : null}
      {marqueeOutline ? <ShapeSelection outline={marqueeOutline} dashed /> : null}
    </div>
  );
}

/** A new mark of the tool's kind, begun at `point`. */
function startMark(
  tool: Exclude<MarkupTool, "select" | "text">,
  point: Point,
  style: MarkStyle,
  author?: string,
): Mark {
  const base = {
    id: newMarkId(),
    z: 0,
    color: style.color,
    size: style.stroke,
    ...(author ? { author } : {}),
  };
  switch (tool) {
    case "pen":
      return { ...base, kind: "pen", points: [point] };
    case "line":
    case "arrow":
      return { ...base, kind: tool, from: point, to: point };
    case "rect":
    case "ellipse":
      return { ...base, kind: tool, box: { ...point, width: 0, height: 0 }, fill: style.fill };
    case "redact":
      return { ...base, kind: "redact", box: { ...point, width: 0, height: 0 } };
  }
}

/** The mark as the pointer moves on: Shift holds lines to 45° steps and shapes to squares. */
function extendMark(
  mark: Mark,
  start: Point,
  point: Point,
  shift: boolean,
  unitsPerPixel: number,
): Mark {
  switch (mark.kind) {
    case "pen": {
      const last = mark.points[mark.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) < 0.75 * unitsPerPixel) return mark;
      return { ...mark, points: [...mark.points, point] };
    }
    case "line":
    case "arrow":
      return { ...mark, to: shift ? snapAngle(start, point) : point };
    case "rect":
    case "ellipse":
    case "redact": {
      let width = point.x - start.x;
      let height = point.y - start.y;
      if (shift) {
        const side = Math.max(Math.abs(width), Math.abs(height));
        width = Math.sign(width || 1) * side;
        height = Math.sign(height || 1) * side;
      }
      return { ...mark, box: { x: start.x, y: start.y, width, height } };
    }
    case "text":
    case "sticker":
      return mark;
  }
}

/** The mark as it is added, or null when it is too small to be meant. */
function finishMark(mark: Mark, unitsPerPixel: number): Mark | null {
  switch (mark.kind) {
    case "pen":
      return { ...mark, points: simplifyStroke(mark.points, 0.5 * unitsPerPixel) };
    case "line":
    case "arrow":
      return Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y) >= 4 * unitsPerPixel
        ? mark
        : null;
    case "rect":
    case "ellipse":
    case "redact": {
      const box = positiveBox(mark.box);
      return box.width >= 3 * unitsPerPixel && box.height >= 3 * unitsPerPixel
        ? { ...mark, box }
        : null;
    }
    case "text":
    case "sticker":
      return mark;
  }
}

/** `point` turned to the nearest 45° step around `origin`, at the same distance. */
function snapAngle(origin: Point, point: Point): Point {
  const length = Math.hypot(point.x - origin.x, point.y - origin.y);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(point.y - origin.y, point.x - origin.x) / step) * step;
  return { x: origin.x + Math.cos(angle) * length, y: origin.y + Math.sin(angle) * length };
}

/** The resize cursor a handle shows, by where it sits from the selection's middle on screen. */
function handleCursor(
  handle: BoxHandle,
  place: { x: number; y: number },
  center: { x: number; y: number },
): SelectionHandle["cursor"] {
  const dx = place.x - center.x;
  const dy = place.y - center.y;
  if (handle.length === 2) return dx * dy > 0 ? "nwse-resize" : "nesw-resize";
  return Math.abs(dx) > Math.abs(dy) ? "ew-resize" : "ns-resize";
}
