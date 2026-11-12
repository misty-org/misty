/** A label laid over the scene: where its figure is on screen, its size, and how much it matters. */
export interface Label {
  id: string;
  /** The point it hangs from, in pixels: its top centre, or its bottom centre when it goes up. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Lower goes first and keeps its place; 0 is never hidden. */
  priority: number;
  /** Labels over a head stack upward; names under the feet stack downward. */
  up?: boolean;
}

export interface Placed {
  /** How far it was moved from its point to keep clear of the labels before it. */
  dy: number;
  hidden: boolean;
}

/** Gap kept between two labels, in pixels. */
const GAP = 3;
/** How many label heights one may be pushed before it is hidden instead. */
const MOST_STEPS = 4;

/**
 * Keeps labels from covering each other: the ones that matter most are placed first where they
 * belong, and each one after is pushed away from its figure, a label's height at a time, until it
 * is clear. One that would have to go too far is hidden, unless nothing may hide it.
 */
export function spreadLabels(labels: readonly Label[]): Map<string, Placed> {
  const order = [...labels].sort((a, b) => a.priority - b.priority || a.y - b.y);
  const boxes: { left: number; right: number; top: number; bottom: number }[] = [];
  const placed = new Map<string, Placed>();
  for (const label of order) {
    const left = label.x - label.w / 2;
    const right = label.x + label.w / 2;
    let dy = 0;
    let clear = false;
    for (let step = 0; step <= MOST_STEPS; step += 1) {
      const top = label.up ? label.y - label.h + dy : label.y + dy;
      const bottom = top + label.h;
      clear = !boxes.some(
        (box) =>
          left < box.right + GAP &&
          right > box.left - GAP &&
          top < box.bottom + GAP &&
          bottom > box.top - GAP,
      );
      if (clear) {
        boxes.push({ left, right, top, bottom });
        break;
      }
      dy += (label.h + GAP) * (label.up ? -1 : 1);
    }
    if (!clear && label.priority === 0) {
      const top = label.up ? label.y - label.h : label.y;
      boxes.push({ left, right, top, bottom: top + label.h });
      dy = 0;
    }
    placed.set(label.id, { dy, hidden: !clear && label.priority !== 0 });
  }
  return placed;
}
