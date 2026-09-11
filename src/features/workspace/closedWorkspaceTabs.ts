import { createDockLeaf, dockLeaves, findDockLeaf, insertDockSplit } from "./dockTree";
import {
  maxWorkspacePanels,
  type DockSplitDirection,
  type WorkspaceDockNode,
  type WorkspaceLayout,
  type WorkspaceLayoutTab,
  type WorkspaceTab,
  type WorkspacePane,
} from "./model";

export interface ClosedPanelPlacement {
  splitId: string;
  anchorNodeId: string;
  direction: DockSplitDirection;
  ratio: number;
}

export interface ClosedWorkspaceTab {
  layoutTab?: WorkspaceLayoutTab;
  layoutTabId?: string;
  pane?: WorkspacePane;
  tab: WorkspaceTab;
  windowId: string;
  paneId: string;
  panelPlacement?: ClosedPanelPlacement;
}

export function rememberClosedWorkspaceTab(
  layout: WorkspaceLayout,
  tab: WorkspaceTab,
  windowId: string,
): ClosedWorkspaceTab {
  const pane = dockLeaves(layout.root).find((candidate) =>
    candidate.tabs.some((item) => item.id === tab.id),
  );
  return {
    tab,
    windowId,
    paneId: pane?.id ?? "",
    pane,
    panelPlacement:
      pane?.tabs.length === 1 ? findClosedPanelPlacement(layout.root, pane.id) : undefined,
  };
}

export function restoreClosedWorkspaceTab(
  layout: WorkspaceLayout,
  closed: ClosedWorkspaceTab,
  tab: WorkspaceTab,
): WorkspaceLayout {
  const placement = closed.panelPlacement;
  if (placement && dockLeaves(layout.root).length < maxWorkspacePanels) {
    const pane = closed.pane
      ? { ...closed.pane, tabs: [tab], activeTabId: tab.id }
      : createDockLeaf([tab]);
    if (closed.paneId) pane.id = closed.paneId;
    const root = restorePanelAtAnchor(layout.root, placement, pane);
    if (root !== layout.root) return { root, focusedPaneId: pane.id };
  }

  const anchor = findDockLeaf(layout.root, layout.focusedPaneId) ?? dockLeaves(layout.root)[0];
  const pane = closed.pane
    ? { ...closed.pane, tabs: [tab], activeTabId: tab.id }
    : createDockLeaf([tab]);
  if (closed.paneId && !findDockLeaf(layout.root, closed.paneId)) pane.id = closed.paneId;
  return {
    ...layout,
    root: insertDockSplit(layout.root, anchor.id, pane, "right"),
    focusedPaneId: pane.id,
  };
}

export function migrateClosedWorkspaceTabs(value: unknown): ClosedWorkspaceTab[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    if ("tab" in candidate) return [candidate as ClosedWorkspaceTab];
    return [{ tab: candidate as WorkspaceTab, windowId: "", paneId: "" }];
  });
}

function findClosedPanelPlacement(
  node: WorkspaceDockNode,
  paneId: string,
): ClosedPanelPlacement | undefined {
  if (node.type === "leaf") return undefined;
  if (node.first.type === "leaf" && node.first.id === paneId) {
    return placementFor(node, node.second.id, true);
  }
  if (node.second.type === "leaf" && node.second.id === paneId) {
    return placementFor(node, node.first.id, false);
  }
  return (
    findClosedPanelPlacement(node.first, paneId) ?? findClosedPanelPlacement(node.second, paneId)
  );
}

function placementFor(
  split: Extract<WorkspaceDockNode, { type: "split" }>,
  anchorNodeId: string,
  closedFirst: boolean,
): ClosedPanelPlacement {
  return {
    splitId: split.id,
    anchorNodeId,
    direction:
      split.direction === "horizontal"
        ? closedFirst
          ? "left"
          : "right"
        : closedFirst
          ? "up"
          : "down",
    ratio: split.ratio,
  };
}

function restorePanelAtAnchor(
  node: WorkspaceDockNode,
  placement: ClosedPanelPlacement,
  pane: Extract<WorkspaceDockNode, { type: "leaf" }>,
): WorkspaceDockNode {
  if (node.id === placement.anchorNodeId) {
    const paneFirst = placement.direction === "left" || placement.direction === "up";
    return {
      type: "split",
      id: placement.splitId,
      direction:
        placement.direction === "left" || placement.direction === "right"
          ? "horizontal"
          : "vertical",
      ratio: placement.ratio,
      first: paneFirst ? pane : node,
      second: paneFirst ? node : pane,
    };
  }
  if (node.type === "leaf") return node;
  const first = restorePanelAtAnchor(node.first, placement, pane);
  const second = restorePanelAtAnchor(node.second, placement, pane);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}
