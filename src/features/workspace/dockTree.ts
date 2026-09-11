import type { DockSplitDirection, WorkspaceDockNode, WorkspacePane, WorkspaceTab } from "./model";

export function createDockId(prefix: "pane" | "split" | "tab"): string {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 9)}`;
}

export function createDockLeaf(tabs: WorkspaceTab[] = []): WorkspacePane {
  return {
    type: "leaf",
    id: createDockId("pane"),
    tabs,
    activeTabId: tabs[tabs.length - 1]?.id ?? null,
  };
}

export function fillEmptyDockLeaves(
  node: WorkspaceDockNode,
  createTab?: () => WorkspaceTab,
): WorkspaceDockNode {
  if (node.type === "leaf") {
    if (node.tabs.length || !createTab) return node;
    const tab = createTab();
    return { ...node, tabs: [tab], activeTabId: tab.id };
  }
  const first = fillEmptyDockLeaves(node.first, createTab);
  const second = fillEmptyDockLeaves(node.second, createTab);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function dockLeaves(node: WorkspaceDockNode): WorkspacePane[] {
  return node.type === "leaf" ? [node] : [...dockLeaves(node.first), ...dockLeaves(node.second)];
}

export function dockTabs(node: WorkspaceDockNode): WorkspaceTab[] {
  return dockLeaves(node).flatMap((leaf) => leaf.tabs);
}

/** Relocate an existing pane without creating or discarding any pane contents. */
export function moveDockPane(
  root: WorkspaceDockNode,
  paneId: string,
  direction: DockSplitDirection,
  targetPaneId?: string,
): WorkspaceDockNode {
  const pane = findDockLeaf(root, paneId);
  if (!pane || paneId === targetPaneId || (targetPaneId && !findDockLeaf(root, targetPaneId)))
    return root;
  const leaves = dockLeaves(root);
  if (leaves.length >= 4) {
    const grid = normalizePaneLayout(root);
    const ordered = dockLeaves(grid);
    const index = ordered.findIndex((leaf) => leaf.id === paneId);
    const neighbor =
      direction === "left"
        ? index >= 2
          ? index - 2
          : index
        : direction === "right"
          ? index < 2
            ? index + 2
            : index
          : direction === "up"
            ? index % 2
              ? index - 1
              : index
            : index % 2 === 0
              ? index + 1
              : index;
    return swapDockLeaves(grid, paneId, targetPaneId ?? ordered[neighbor].id);
  }
  const remaining = removeDockLeaf(root, paneId);
  if (!remaining) return root;
  if (targetPaneId)
    return normalizePaneLayout(insertDockSplit(remaining, targetPaneId, pane, direction));
  const first = direction === "left" || direction === "up";
  return normalizePaneLayout({
    type: "split",
    id: createDockId("split"),
    direction: direction === "left" || direction === "right" ? "horizontal" : "vertical",
    ratio: 0.5,
    first: first ? pane : remaining,
    second: first ? remaining : pane,
  });
}

export function capDockLeaves(node: WorkspaceDockNode, maximum: number): WorkspaceDockNode {
  const leaves = dockLeaves(node);
  if (leaves.length <= maximum) return node;
  const kept = leaves.slice(0, Math.max(1, maximum));
  const overflowTabs = leaves.slice(kept.length).flatMap((leaf) => leaf.tabs);
  if (overflowTabs.length) {
    const target = kept[kept.length - 1];
    kept[kept.length - 1] = {
      ...target,
      tabs: [...target.tabs, ...overflowTabs],
      activeTabId: overflowTabs[0]?.id ?? target.activeTabId,
    };
  }
  return dockGrid(kept);
}

function dockGrid(leaves: WorkspacePane[]): WorkspaceDockNode {
  if (leaves.length === 1) return leaves[0];
  const split = (
    direction: "horizontal" | "vertical",
    first: WorkspaceDockNode,
    second: WorkspaceDockNode,
  ): WorkspaceDockNode => ({
    type: "split",
    id: createDockId("split"),
    direction,
    ratio: 0.5,
    first,
    second,
  });
  if (leaves.length === 2) return split("horizontal", leaves[0], leaves[1]);
  if (leaves.length === 3)
    return split("horizontal", leaves[0], split("vertical", leaves[1], leaves[2]));
  return split(
    "horizontal",
    split("vertical", leaves[0], leaves[2]),
    split("vertical", leaves[1], leaves[3]),
  );
}

export function findDockLeaf(node: WorkspaceDockNode, paneId: string): WorkspacePane | null {
  if (node.type === "leaf") return node.id === paneId ? node : null;
  return findDockLeaf(node.first, paneId) ?? findDockLeaf(node.second, paneId);
}

export function mapDockLeaf(
  node: WorkspaceDockNode,
  paneId: string,
  update: (leaf: WorkspacePane) => WorkspacePane,
): WorkspaceDockNode {
  if (node.type === "leaf") return node.id === paneId ? update(node) : node;
  const first = mapDockLeaf(node.first, paneId, update);
  const second = mapDockLeaf(node.second, paneId, update);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function swapDockLeaves(
  node: WorkspaceDockNode,
  firstPaneId: string,
  secondPaneId: string,
): WorkspaceDockNode {
  if (firstPaneId === secondPaneId) return node;
  const first = findDockLeaf(node, firstPaneId);
  const second = findDockLeaf(node, secondPaneId);
  if (!first || !second) return node;
  return mapDockLeaf(
    mapDockLeaf(node, firstPaneId, (pane) => ({
      ...pane,
      tabs: second.tabs,
      activeTabId: second.activeTabId,
    })),
    secondPaneId,
    (pane) => ({ ...pane, tabs: first.tabs, activeTabId: first.activeTabId }),
  );
}

export function mapDockTabs(
  node: WorkspaceDockNode,
  update: (tab: WorkspaceTab) => WorkspaceTab,
): WorkspaceDockNode {
  if (node.type === "leaf") {
    const tabs = node.tabs.map(update);
    return tabs.every((tab, index) => tab === node.tabs[index]) ? node : { ...node, tabs };
  }
  const first = mapDockTabs(node.first, update);
  const second = mapDockTabs(node.second, update);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function insertDockSplit(
  node: WorkspaceDockNode,
  targetPaneId: string,
  newLeaf: WorkspacePane,
  direction: DockSplitDirection,
): WorkspaceDockNode {
  if (node.type === "leaf") {
    if (node.id !== targetPaneId) return node;
    const newFirst = direction === "left" || direction === "up";
    return {
      type: "split",
      id: createDockId("split"),
      direction: direction === "left" || direction === "right" ? "horizontal" : "vertical",
      ratio: 0.5,
      first: newFirst ? newLeaf : node,
      second: newFirst ? node : newLeaf,
    };
  }
  const first = insertDockSplit(node.first, targetPaneId, newLeaf, direction);
  if (first !== node.first) return { ...node, first };
  const second = insertDockSplit(node.second, targetPaneId, newLeaf, direction);
  return second === node.second ? node : { ...node, second };
}

export function collapseEmptyDockLeaves(node: WorkspaceDockNode): WorkspaceDockNode | null {
  if (node.type === "leaf") return node.tabs.length ? node : null;
  const first = collapseEmptyDockLeaves(node.first);
  const second = collapseEmptyDockLeaves(node.second);
  if (!first) return second;
  if (!second) return first;
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function removeDockLeaf(node: WorkspaceDockNode, paneId: string): WorkspaceDockNode | null {
  if (node.type === "leaf") return node.id === paneId ? null : node;
  const first = removeDockLeaf(node.first, paneId);
  const second = removeDockLeaf(node.second, paneId);
  if (!first) return second;
  if (!second) return first;
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function updateDockSplitRatio(
  node: WorkspaceDockNode,
  splitId: string,
  ratio: number,
): WorkspaceDockNode {
  if (node.type === "leaf") return node;
  if (node.id === splitId) {
    const nextRatio = clampDockRatio(ratio);
    return Math.abs(nextRatio - node.ratio) < 0.0005 ? node : { ...node, ratio: nextRatio };
  }
  const first = updateDockSplitRatio(node.first, splitId, ratio);
  const second = updateDockSplitRatio(node.second, splitId, ratio);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function clampDockRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(0.85, Math.max(0.15, ratio));
}

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

export function normalizeDockNode(node: WorkspaceDockNode): WorkspaceDockNode {
  if (node.type === "leaf") {
    const activeTabId = node.tabs.some((tab) => tab.id === node.activeTabId)
      ? node.activeTabId
      : (node.tabs[node.tabs.length - 1]?.id ?? null);
    return activeTabId === node.activeTabId ? node : { ...node, activeTabId };
  }
  const ratio = clampDockRatio(node.ratio);
  const first = normalizeDockNode(node.first);
  const second = normalizeDockNode(node.second);
  return ratio === node.ratio && first === node.first && second === node.second
    ? node
    : { ...node, ratio, first, second };
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

/** Supported arrangements: two halves, a large pane beside two halves, or four quadrants. */
export function normalizePaneLayout(root: WorkspaceDockNode): WorkspaceDockNode {
  const leaves = dockLeaves(root);
  if (leaves.length === 4) {
    if (
      root.type === "split" &&
      root.direction === "horizontal" &&
      root.first.type === "split" &&
      root.second.type === "split" &&
      root.first.direction === "vertical" &&
      root.second.direction === "vertical"
    )
      return root;
    const bounds = { x: 0, y: 0, width: 1, height: 1 };
    const ordered = [...leaves].sort((a, b) => {
      const aa = dockPaneBounds(root, a.id, bounds)!,
        bb = dockPaneBounds(root, b.id, bounds)!;
      return aa.y - bb.y || aa.x - bb.x;
    });
    return dockGrid(ordered);
  }
  if (leaves.length === 3 && root.type === "split") {
    const direction = root.direction === "horizontal" ? "vertical" : "horizontal";
    return {
      ...root,
      first: root.first.type === "split" ? { ...root.first, direction } : root.first,
      second: root.second.type === "split" ? { ...root.second, direction } : root.second,
    };
  }
  return root;
}
