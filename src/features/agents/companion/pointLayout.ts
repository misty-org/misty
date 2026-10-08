import { normalizeCompanionSize } from "./companionSize";
import type { Point } from "./motion";
import type { DisplayFrame, PresentedPoint } from "./protocol";

/** The ring drawn when no real control frame is known. */
export const POINT_RING_RADIUS = 11;
const FRAME_PADDING = 3;
const GAP = 4;
const POINTER_PHRASES = [
  "right here!",
  "this one!",
  "over here!",
  "click this!",
  "here it is!",
  "found it!",
];

export interface PointLayout {
  /** The marker's box in overlay pixels: a ring, or the control's outline. */
  marker: { x: number; y: number; width: number; height: number; ring: boolean };
  /** Where the companion's center parks, beside the marker rather than on it. */
  companion: Point;
}

/**
 * Places a point's marker on the exact spot and parks the companion beside
 * it, down and to the right like beside the cursor, flipping to the other
 * side at a display edge so the character never covers what it points at.
 * `factor` converts the display's global units to overlay pixels.
 */
export function pointLayout(
  point: PresentedPoint,
  display: Pick<DisplayFrame, "x" | "y" | "width" | "height">,
  factor: number,
  size: number | undefined,
): PointLayout {
  const width = display.width / factor,
    height = display.height / factor;
  const local = (x: number, y: number) => ({
    x: (x - display.x) / factor,
    y: (y - display.y) / factor,
  });
  let marker: PointLayout["marker"];
  if (point.frame) {
    const corner = local(point.frame.x, point.frame.y);
    marker = {
      x: corner.x - FRAME_PADDING,
      y: corner.y - FRAME_PADDING,
      width: point.frame.width / factor + FRAME_PADDING * 2,
      height: point.frame.height / factor + FRAME_PADDING * 2,
      ring: false,
    };
  } else {
    const center = local(point.x, point.y);
    marker = {
      x: center.x - POINT_RING_RADIUS,
      y: center.y - POINT_RING_RADIUS,
      width: POINT_RING_RADIUS * 2,
      height: POINT_RING_RADIUS * 2,
      ring: true,
    };
  }
  const radius = (16 * normalizeCompanionSize(size)) / 100;
  const margin = radius + GAP;
  let x = marker.x + marker.width + radius + GAP;
  if (x > width - margin) x = marker.x - radius - GAP;
  let y = marker.y + marker.height / 2 + radius / 2;
  y = Math.max(margin, Math.min(height - margin, y));
  x = Math.max(margin, Math.min(width - margin, x));
  return { marker, companion: { x, y } };
}

/** What the pointing bubble says: the step and the action, never a filler when one is known. */
export function pointBubbleText(point: PresentedPoint, random = Math.random) {
  const label = point.label.trim();
  const said = label || POINTER_PHRASES[Math.floor(random() * POINTER_PHRASES.length)];
  return point.guide ? `${point.guide.step} of ${point.guide.total} · ${said}` : said;
}
