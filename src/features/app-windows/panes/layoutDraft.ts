import {
  collapseEmptyDockLeaves,
  createDockLeaf,
  dockLeaves,
  findDockLeaf,
  insertDockSplit,
  isGridLayout,
  mapDockLeaf,
  swapDockLeaves,
} from "./dockTree";
import { removeDockView } from "../tabs/workspaceViewOperations";
import {
  maxWorkspacePanes,
  type DockDropZone,
  type WorkspaceDockNode,
  type WorkspacePane,
  type WorkspaceView,
} from "../tabs/workspaceViews";

/**
 * Edits to a draft layout for the layout popup. A draft is a copy of a window tab's pane tree
 * that nothing else sees until it is applied, and each pane holds one view.
 */

/** Takes a view out of the draft; panes left empty fold away. Null when nothing is left. */
export function draftRemove(root: WorkspaceDockNode, viewId: string): WorkspaceDockNode | null {
  return collapseEmptyDockLeaves(removeDockView(root, viewId));
}

/**
 * Puts a view into the draft: onto a pane's edge it splits that pane, onto its middle it takes the
 * pane's place and the pane's old view leaves the draft. A view already in the draft moves, or
 * trades places with the pane it is dropped on.
 * Null when the drop is not allowed.
 */
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
  // A pane dropped on another pane's middle trades places with it.
  if (inDraft && zone === "center") return swapDockLeaves(root, inDraft.id, paneId);
  const moving = inDraft ?? source ?? createDockLeaf([view]);
  const base = inDraft ? draftRemove(root, view.id) : root;
  if (!base || !findDockLeaf(base, paneId)) return null;
  if (zone === "center") return mapDockLeaf(base, paneId, () => moving);
  if (dockLeaves(base).length >= maxWorkspacePanes) return null;
  const split = insertDockSplit(base, paneId, moving, zone);
  return isGridLayout(split) ? split : null;
}

/** Adds a view where the grid has room for it: beside a pane, trying the right and below first.
 * Null when no pane can take another. */
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
