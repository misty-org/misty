import { type VisibleNode } from "./visibleTree";

export const NODE_W = 240;
export const NODE_H = 54;
const COLUMN_GAP = 84;
const ROW_GAP = 14;

export interface Point {
  x: number;
  y: number;
}

/**
 * A left-to-right tidy tree: one column per depth, every leaf on its own row, and each
 * parent centred on its children. Pure, so the canvas can animate between two layouts.
 */
export function layoutTree(nodes: readonly VisibleNode[]): Map<string, Point> {
  const kids = new Map<string, string[]>();
  for (const { id, parent } of nodes) {
    if (parent !== null) kids.set(parent, [...(kids.get(parent) ?? []), id]);
  }
  const depth = new Map(nodes.map((n) => [n.id, n.depth]));
  const positions = new Map<string, Point>();
  let row = 0;
  const place = (id: string): number => {
    const children = kids.get(id) ?? [];
    let y: number;
    if (children.length === 0) {
      y = row * (NODE_H + ROW_GAP);
      row += 1;
    } else {
      const ys = children.map(place);
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    positions.set(id, { x: (depth.get(id) ?? 0) * (NODE_W + COLUMN_GAP), y });
    return y;
  };
  const root = nodes.find((n) => n.parent === null);
  if (root) place(root.id);
  return positions;
}
