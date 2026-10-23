import type { DockSplitDirection, WorkspaceDockNode } from "./model";

export function canFitDockSplit(
  available: { width: number; height: number },
  direction: DockSplitDirection,
  firstMinimum: { width: number; height: number },
  secondMinimum: { width: number; height: number },
): boolean {
  return direction === "left" || direction === "right"
    ? available.width >= firstMinimum.width + secondMinimum.width &&
        available.height >= Math.max(firstMinimum.height, secondMinimum.height)
    : available.height >= firstMinimum.height + secondMinimum.height &&
        available.width >= Math.max(firstMinimum.width, secondMinimum.width);
}

/** Project a pane's bounds from the resulting tree, including collapsed source splits. */
export function dockPaneBounds(
  node: WorkspaceDockNode,
  paneId: string,
  bounds: { x: number; y: number; width: number; height: number },
): typeof bounds | null {
  if (node.type === "leaf") return node.id === paneId ? bounds : null;
  const horizontal = node.direction === "horizontal";
  const first = {
    ...bounds,
    width: horizontal ? bounds.width * node.ratio : bounds.width,
    height: horizontal ? bounds.height : bounds.height * node.ratio,
  };
  const second = {
    x: horizontal ? bounds.x + first.width : bounds.x,
    y: horizontal ? bounds.y : bounds.y + first.height,
    width: horizontal ? bounds.width - first.width : bounds.width,
    height: horizontal ? bounds.height : bounds.height - first.height,
  };
  return dockPaneBounds(node.first, paneId, first) ?? dockPaneBounds(node.second, paneId, second);
}

/** Direction toward the sibling that fills the closed pane's space. */
export function dockPaneCloseDirection(
  node: WorkspaceDockNode,
  paneId: string,
): DockSplitDirection | null {
  if (node.type === "leaf") return null;
  if (node.first.type === "leaf" && node.first.id === paneId)
    return node.direction === "horizontal" ? "right" : "down";
  if (node.second.type === "leaf" && node.second.id === paneId)
    return node.direction === "horizontal" ? "left" : "up";
  return dockPaneCloseDirection(node.first, paneId) ?? dockPaneCloseDirection(node.second, paneId);
}
