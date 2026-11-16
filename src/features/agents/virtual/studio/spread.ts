/** A label laid over the scene: where its figure is on screen, its size, and how much it matters. */
export interface Label {
  id: string;
  /** The point it hangs from, in pixels: its top centre, or its bottom centre when it goes up. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Lower goes first in its figure's stack, nearest the point. */
  priority: number;
  /** Labels over a head stack upward; names under the feet stack downward. */
  up?: boolean;
  /** The point it hangs from, shared by a figure's own labels (its name and what it says). */
  anchor?: string;
}

interface Placed {
  /** How far it was moved from its point to keep clear of its own figure's labels. */
  dy: number;
}

/** Gap kept between a figure's own labels, in pixels. */
const GAP = 3;

/**
 * Stacks each figure's own labels, so what one says sits over its name rather than on it. Labels
 * of different figures are left where their figures are, covering each other if they must: a name
 * that jumped aside every time someone walked past would be harder to follow than one that
 * overlaps. Who draws on top is the projector's (nearer, and what matters most, over the rest).
 */
export function stackLabels(labels: readonly Label[]): Map<string, Placed> {
  const order = [...labels].sort((a, b) => a.priority - b.priority);
  const reach = new Map<string, number>();
  const placed = new Map<string, Placed>();
  for (const label of order) {
    const anchor = label.anchor ?? label.id;
    const dy = reach.get(anchor) ?? 0;
    placed.set(label.id, { dy });
    reach.set(anchor, dy + (label.h + GAP) * (label.up ? -1 : 1));
  }
  return placed;
}
