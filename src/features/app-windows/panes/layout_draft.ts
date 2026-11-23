import {
  collapseEmptyDockLeaves,
  createDockLeaf,
  dockLeaves,
  findDockLeaf,
  insertDockSplit,
  isGridLayout,
  mapDockLeaf,
  swapDockLeaves,
} from "./dock_tree";
import { removeDockView } from "../tabs/workspace_view_operations";
import {
  maxWorkspacePanes,
  type DockDropZone,
  type WorkspaceDockNode,
  type WorkspacePane,
  type WorkspaceView,
} from "../tabs/workspace_views";

export function draftRemove(root: WorkspaceDockNode, viewId: string): WorkspaceDockNode | null {
  return collapseEmptyDockLeaves(removeDockView(root, viewId));
}

export function draftPlace(
  root: WorkspaceDockNode,
  view: WorkspaceView,
  paneId: string,
  zone: DockDropZone,
  source?: WorkspacePane,
): WorkspaceDockNode | null {
  const target = findDockLeaf(root, paneId);
  if (!target || target.views[0]?.id === view.id) return null;
  const inDraft = dockLeaves(root).find((pane) => pane.views[0]?.id === view.id);
  if (inDraft && zone === "center") return swapDockLeaves(root, inDraft.id, paneId);
  const moving = inDraft ?? source ?? createDockLeaf([view]);
  const base = inDraft ? draftRemove(root, view.id) : root;
  if (!base || !findDockLeaf(base, paneId)) return null;
  if (zone === "center") return mapDockLeaf(base, paneId, () => moving);
  if (dockLeaves(base).length >= maxWorkspacePanes) return null;
  const split = insertDockSplit(base, paneId, moving, zone);
  return isGridLayout(split) ? split : null;
}

export function draftAdd(
  root: WorkspaceDockNode,
  view: WorkspaceView,
  source?: WorkspacePane,
): WorkspaceDockNode | null {
  const panes = dockLeaves(root);
  for (const zone of ["right", "down", "left", "up"] as const)
    for (const pane of [...panes].reverse()) {
      const next = draftPlace(root, view, pane.id, zone, source);
      if (next) return next;
    }
  return null;
}
