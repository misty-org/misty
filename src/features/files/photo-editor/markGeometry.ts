import { positiveBox, type Box, type Mark, type Point } from "./imageEdit";
import { orderedMarks, textMetrics } from "./markRender";

/**
 * Where marks are and how they move, in the image's own space (fractions of its longer side).
 * Pointer positions arrive here already mapped into that space, so this never needs to know how
 * the image is turned, cropped or zoomed.
 */

/** Text is measured at this many pixels to the longer side; marks scale with the image. */
const measureSide = 1000;

/** A mark's bounds, its stroke included, in the image's own space. */
export function markBounds(mark: Mark): Box {
  const pad =
    mark.kind === "text" || mark.kind === "redact" || mark.kind === "sticker" ? 0 : mark.size / 2;
  switch (mark.kind) {
    case "pen": {
      const xs = mark.points.map((point) => point.x);
      const ys = mark.points.map((point) => point.y);
      return padded(
        {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        },
        pad,
      );
    }
    case "line":
    case "arrow":
      return padded(
        positiveBox({
          ...mark.from,
          width: mark.to.x - mark.from.x,
          height: mark.to.y - mark.from.y,
        }),
        pad,
      );
    case "rect":
    case "ellipse":
      return padded(mark.box, mark.fill ? 0 : pad);
    case "redact":
    case "sticker":
      return mark.box;
    case "text": {
      const metrics = textMetrics(mark.text || " ", mark.size, measureSide);
      return {
        x: mark.at.x,
        y: mark.at.y,
        width: Math.max(metrics.width, metrics.pixels * 0.5) / measureSide,
        height: metrics.height / measureSide,
      };
    }
  }
}

function padded(box: Box, pad: number): Box {
  return {
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
}

/** The box around several marks. */
export function unionBounds(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
    : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

const inside = (point: Point, box: Box, slack = 0) =>
  point.x >= box.x - slack &&
  point.x <= box.x + box.width + slack &&
  point.y >= box.y - slack &&
  point.y <= box.y + box.height + slack;

/** Whether `point` is on the mark, within `slack` (the image's own space). */
export function hitsMark(mark: Mark, point: Point, slack: number): boolean {
  const reach = mark.size / 2 + slack;
  switch (mark.kind) {
    case "pen":
      if (mark.points.length === 1)
        return Math.hypot(point.x - mark.points[0].x, point.y - mark.points[0].y) <= reach;
      for (let index = 1; index < mark.points.length; index++)
        if (distanceToSegment(point, mark.points[index - 1], mark.points[index]) <= reach)
          return true;
      return false;
    case "line":
    case "arrow":
      return distanceToSegment(point, mark.from, mark.to) <= reach;
    // Shapes and boxes are picked anywhere inside them, which is how people point at them.
    case "rect":
    case "redact":
    case "sticker":
      return inside(point, mark.box, slack);
    case "ellipse": {
      const { x, y, width, height } = mark.box;
      const rx = width / 2 + reach;
      const ry = height / 2 + reach;
      if (rx <= 0 || ry <= 0) return false;
      return (
        ((point.x - (x + width / 2)) / rx) ** 2 + ((point.y - (y + height / 2)) / ry) ** 2 <= 1
      );
    }
    case "text":
      return inside(point, markBounds(mark), slack);
  }
}

/** The topmost mark under `point`, if any. */
export function markAt(marks: Record<string, Mark>, point: Point, slack: number): Mark | null {
  const ordered = orderedMarks(marks);
  for (let index = ordered.length - 1; index >= 0; index--)
    if (hitsMark(ordered[index], point, slack)) return ordered[index];
  return null;
}

/** The marks whose bounds meet a box, for selecting by dragging over them. */
export function marksIn(marks: Record<string, Mark>, box: Box): string[] {
  const area = positiveBox(box);
  return Object.values(marks)
    .filter((mark) => {
      const bounds = markBounds(mark);
      return (
        bounds.x <= area.x + area.width &&
        bounds.x + bounds.width >= area.x &&
        bounds.y <= area.y + area.height &&
        bounds.y + bounds.height >= area.y
      );
    })
    .map((mark) => mark.id);
}

/** The mark moved by (dx, dy). */
export function moveMark(mark: Mark, dx: number, dy: number): Mark {
  const shift = (point: Point) => ({ x: point.x + dx, y: point.y + dy });
  switch (mark.kind) {
    case "pen":
      return { ...mark, points: mark.points.map(shift) };
    case "line":
    case "arrow":
      return { ...mark, from: shift(mark.from), to: shift(mark.to) };
    case "rect":
    case "ellipse":
    case "redact":
    case "sticker":
      return { ...mark, box: { ...mark.box, x: mark.box.x + dx, y: mark.box.y + dy } };
    case "text":
      return { ...mark, at: shift(mark.at) };
  }
}

/** The handles a selection can be sized by: corners and edges of its box. */
export const boxHandles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type BoxHandle = (typeof boxHandles)[number];
/** A line or arrow is sized by its ends instead. */
export type EndHandle = "from" | "to";

/** Where a handle sits on a box, as fractions of it. */
export function handleSpot(handle: BoxHandle): Point {
  return {
    x: handle.includes("w") ? 0 : handle.includes("e") ? 1 : 0.5,
    y: handle.includes("n") ? 0 : handle.includes("s") ? 1 : 0.5,
  };
}

/**
 * The box after dragging `handle` by (dx, dy). `keepShape` holds its width over height, as a
 * corner dragged with Shift does. It never turns inside out: it stops at `least` across.
 */
export function dragBox(
  start: Box,
  handle: BoxHandle,
  dx: number,
  dy: number,
  keepShape: boolean,
  least: number,
): Box {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes("w")) left = Math.min(left + dx, right - least);
  if (handle.includes("e")) right = Math.max(right + dx, left + least);
  if (handle.includes("n")) top = Math.min(top + dy, bottom - least);
  if (handle.includes("s")) bottom = Math.max(bottom + dy, top + least);
  let box = { x: left, y: top, width: right - left, height: bottom - top };
  const corner = handle.length === 2;
  if (keepShape && corner && start.width > 0 && start.height > 0) {
    const shape = start.width / start.height;
    const scale = Math.max(box.width / start.width, box.height / start.height);
    const width = start.width * scale;
    const height = width / shape;
    box = {
      x: handle.includes("w") ? right - width : left,
      y: handle.includes("n") ? bottom - height : top,
      width,
      height,
    };
  }
  return box;
}

/**
 * The mark carried from one box to another, as when the selection around it is sized: every
 * point and box scales with the selection. Text keeps its shape, growing with the box's height.
 */
export function fitMark(mark: Mark, from: Box, to: Box): Mark {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  const map = (point: Point) => ({
    x: to.x + (point.x - from.x) * sx,
    y: to.y + (point.y - from.y) * sy,
  });
  const mapBox = (box: Box): Box => {
    const corner = map(box);
    return {
      x: corner.x,
      y: corner.y,
      width: Math.max(0.0005, box.width * sx),
      height: Math.max(0.0005, box.height * sy),
    };
  };
  switch (mark.kind) {
    case "pen":
      return { ...mark, points: mark.points.map(map) };
    case "line":
    case "arrow":
      return { ...mark, from: map(mark.from), to: map(mark.to) };
    case "rect":
    case "ellipse":
    case "redact":
    case "sticker":
      return { ...mark, box: mapBox(mark.box) };
    case "text": {
      const scale = Math.max(0.05, sy);
      return { ...mark, at: map(mark.at), size: Math.min(0.5, Math.max(0.004, mark.size * scale)) };
    }
  }
}

/** Points closer than this (in the image's own space) are dropped from a pen stroke. */
export function simplifyStroke(points: Point[], least: number): Point[] {
  if (points.length < 3) return points;
  const kept = [points[0]];
  for (let index = 1; index < points.length - 1; index++) {
    const last = kept[kept.length - 1];
    if (Math.hypot(points[index].x - last.x, points[index].y - last.y) >= least)
      kept.push(points[index]);
  }
  kept.push(points[points.length - 1]);
  return kept;
}
