/*
 * How the action bar gives way: a plan from measured widths to what each item shows. It is plain
 * arithmetic, so it needs no layout to run.
 */

/** gap-1 between controls. */
export const gapPx = 4;
const defaultMinWidth = 80;

export type ActionBarPlacement = "full" | "icon" | "folded";

export type ActionBarMeasure = {
  id: string;
  priority: number;
  shrink?: boolean;
  /** Natural width with its label. */
  full: number;
  /** Width in icon form. */
  icon: number;
  /** The shrink item's narrowest width. */
  minWidth?: number;
};

export type ActionBarPlan = {
  placements: Record<string, ActionBarPlacement>;
  /** Width to hold the shrink item to, or null when it shows in full. */
  shrinkWidth: number | null;
  /** Even with everything folded the bar is too narrow. */
  overflowing: boolean;
};

/**
 * The order items give way in: lowest priority first, and among equals the rightmost first. It
 * depends only on priorities and positions, so the bar always gives way the same way.
 */
export function actionBarGiveWayOrder(
  items: ReadonlyArray<Pick<ActionBarMeasure, "id" | "priority">>,
): string[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.priority - b.item.priority || b.index - a.index)
    .map(({ item }) => item.id);
}

/**
 * Decides what each item shows at a given width. The bar walks one fixed sequence and stops at
 * the first step that fits: (1) labels turn into icons, lowest priority first, the shrink item
 * excepted; (2) the shrink item fades down to its minimum width; (3) items fold into a trailing ⋯,
 * lowest priority first. Because it is one sequence, a narrower bar is never less folded than a
 * wider one.
 */
export function planActionBar(input: {
  available: number;
  items: ReadonlyArray<ActionBarMeasure>;
  /** Width of the ⋯ button. */
  more: number;
  /** Width of the `end` slot, or 0 when there is none. */
  end: number;
  gap?: number;
}): ActionBarPlan {
  const { available, items, more, end } = input;
  const gap = input.gap ?? gapPx;
  const placements: Record<string, ActionBarPlacement> = {};
  for (const item of items) placements[item.id] = "full";
  const shrinkItem = items.find((item) => item.shrink);
  const order = actionBarGiveWayOrder(items);

  // Width of everything except the shrink item, and how many controls sit in the row.
  const fixedWidth = () => {
    let width = 0;
    let count = 0;
    let folded = false;
    for (const item of items) {
      const placement = placements[item.id];
      if (placement === "folded") {
        folded = true;
        continue;
      }
      count += 1;
      if (item !== shrinkItem) width += placement === "full" ? item.full : item.icon;
    }
    if (folded) {
      width += more;
      count += 1;
    }
    if (end > 0) {
      width += end;
      count += 1;
    }
    return width + Math.max(0, count - 1) * gap;
  };
  const shrinkVisible = () => Boolean(shrinkItem && placements[shrinkItem.id] !== "folded");
  // The width left for the shrink item, or the whole row's fit when there is none.
  const room = () => available - fixedWidth();
  const result = (shrinkWidth: number | null, overflowing = false): ActionBarPlan => ({
    placements: { ...placements },
    shrinkWidth,
    overflowing,
  });
  const fitsInFull = () => room() >= (shrinkVisible() ? shrinkItem!.full : 0);
  const fitsShrunk = () => {
    if (!shrinkVisible()) return null;
    const left = room();
    const min = Math.min(shrinkItem!.minWidth ?? defaultMinWidth, shrinkItem!.full);
    if (left < min) return null;
    return left >= shrinkItem!.full ? null : Math.floor(left);
  };

  if (fitsInFull()) return result(null);
  for (const id of order) {
    if (id === shrinkItem?.id) continue;
    placements[id] = "icon";
    if (fitsInFull()) return result(null);
  }
  const shrunk = fitsShrunk();
  if (shrunk !== null) return result(shrunk);
  for (const id of order) {
    placements[id] = "folded";
    if (fitsInFull()) return result(null);
    const width = fitsShrunk();
    if (width !== null) return result(width);
  }
  return result(null, room() < 0);
}

export function samePlan(a: ActionBarPlan, b: ActionBarPlan) {
  if (a.shrinkWidth !== b.shrinkWidth || a.overflowing !== b.overflowing) return false;
  const keys = Object.keys(a.placements);
  if (keys.length !== Object.keys(b.placements).length) return false;
  return keys.every((key) => a.placements[key] === b.placements[key]);
}
