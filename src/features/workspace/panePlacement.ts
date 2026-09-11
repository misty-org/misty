import type { DockDropZone, WorkspaceDockNode } from "./model";
import {
  dockLeaves,
  dockPaneBounds,
  moveDockPane,
  normalizePaneLayout,
  removeDockLeaf,
  swapDockLeaves,
} from "./dockTree";

export function panePlacement(
  root: WorkspaceDockNode,
  source: string,
  x: number,
  y: number,
  bounds: { x: number; y: number; width: number; height: number },
) {
  const four = dockLeaves(root).length === 4;
  const base = four ? normalizePaneLayout(root) : removeDockLeaf(root, source);
  if (!base || !dockLeaves(root).some((pane) => pane.id === source)) return null;
  for (const pane of dockLeaves(base)) {
    const rect = dockPaneBounds(base, pane.id, bounds)!;
    if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) continue;
    if (pane.id === source) return null;
    const dx = (x - rect.x) / rect.width,
      dy = (y - rect.y) / rect.height;
    // The source has been lifted out. Every point must describe a destination
    // in the expanded remainder, never a swap into a pre-lift slot.
    const edges = [
      { zone: "left" as const, distance: dx },
      { zone: "right" as const, distance: 1 - dx },
      { zone: "up" as const, distance: dy },
      { zone: "down" as const, distance: 1 - dy },
    ];
    let zone: DockDropZone = four
      ? "center"
      : edges.reduce((nearest, edge) => (edge.distance < nearest.distance ? edge : nearest)).zone;
    const outerEdge =
      !four &&
      zone !== "center" &&
      base.type === "split" &&
      ((base.direction === "horizontal" && (zone === "left" || zone === "right")) ||
        (base.direction === "vertical" && (zone === "up" || zone === "down")));
    if (outerEdge && base.type === "split") {
      zone =
        base.direction === "horizontal"
          ? x < bounds.x + bounds.width / 2
            ? "left"
            : "right"
          : y < bounds.y + bounds.height / 2
            ? "up"
            : "down";
    }
    const target = outerEdge ? "" : pane.id;
    const next =
      zone === "center"
        ? swapDockLeaves(normalizePaneLayout(root), source, pane.id)
        : moveDockPane(root, source, zone, target || undefined);
    return {
      target,
      zone,
      bounds: dockPaneBounds(next, zone === "center" ? pane.id : source, bounds)!,
    };
  }
  return null;
}
