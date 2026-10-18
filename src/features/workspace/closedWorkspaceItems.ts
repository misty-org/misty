import { createDockLeaf, dockLeaves, findDockLeaf, insertDockSplit } from "./dockTree";
import {
  maxWorkspacePanes,
  type DockSplitDirection,
  type WorkspaceDockNode,
  type WorkspaceLayout,
  type WorkspaceTab,
  type WorkspaceView,
  type WorkspacePane,
} from "./model";

interface ClosedPanePlacement {
  splitId: string;
  anchorNodeId: string;
  direction: DockSplitDirection;
  ratio: number;
}

export interface ClosedWorkspaceItem {
  tab?: WorkspaceTab;
  tabId?: string;
  pane?: WorkspacePane;
  view: WorkspaceView;
  windowId: string;
  paneId: string;
  panePlacement?: ClosedPanePlacement;
}

export function rememberClosedWorkspaceView(
  layout: WorkspaceLayout,
  tab: WorkspaceView,
  windowId: string,
): ClosedWorkspaceItem {
  const pane = dockLeaves(layout.root).find((candidate) =>
    candidate.views.some((item) => item.id === tab.id),
  );
  return {
    view: tab,
    windowId,
    paneId: pane?.id ?? "",
    pane,
    panePlacement:
      pane?.views.length === 1 ? findClosedPanePlacement(layout.root, pane.id) : undefined,
  };
}

export function restoreClosedWorkspaceItem(
  layout: WorkspaceLayout,
  closed: ClosedWorkspaceItem,
  tab: WorkspaceView,
): WorkspaceLayout {
  const placement = closed.panePlacement;
  if (placement && dockLeaves(layout.root).length < maxWorkspacePanes) {
    const pane = closed.pane
      ? { ...closed.pane, tabs: [tab], activeTabId: tab.id }
      : createDockLeaf([tab]);
    if (closed.paneId) pane.id = closed.paneId;
    const root = restorePaneAtAnchor(layout.root, placement, pane);
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

export function migrateClosedWorkspaceItems(value: unknown): ClosedWorkspaceItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    if ("tab" in candidate) return [candidate as ClosedWorkspaceItem];
    return [{ view: candidate as WorkspaceView, windowId: "", paneId: "" }];
  });
}

function findClosedPanePlacement(
  node: WorkspaceDockNode,
  paneId: string,
): ClosedPanePlacement | undefined {
  if (node.type === "leaf") return undefined;
  if (node.first.type === "leaf" && node.first.id === paneId) {
    return placementFor(node, node.second.id, true);
  }
  if (node.second.type === "leaf" && node.second.id === paneId) {
    return placementFor(node, node.first.id, false);
  }
  return (
    findClosedPanePlacement(node.first, paneId) ?? findClosedPanePlacement(node.second, paneId)
  );
}

function placementFor(
  split: Extract<WorkspaceDockNode, { type: "split" }>,
  anchorNodeId: string,
  closedFirst: boolean,
): ClosedPanePlacement {
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

function restorePaneAtAnchor(
  node: WorkspaceDockNode,
  placement: ClosedPanePlacement,
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
  const first = restorePaneAtAnchor(node.first, placement, pane);
  const second = restorePaneAtAnchor(node.second, placement, pane);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}
