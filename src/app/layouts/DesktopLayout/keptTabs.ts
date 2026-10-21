import { dockTreeViews } from "@/features/workspace/dockTree";
import type { WorkspaceDockNode, WorkspaceView } from "@/features/workspace/model";
import { migrateRetiredWorkspaceView } from "@/features/workspace/workspaceMigrations";

/**
 * Whether a hidden tab keeps its layout instead of leaving the page (`[data-tab-kept]`, which
 * skips its rendering but not its laid out boxes). Showing a Space or Agents page again is then
 * one paint, as quick as showing a browser tab, instead of a fresh style and layout pass over
 * the whole page.
 *
 * Browser tabs still leave the page when hidden: their page host is nearly empty, and their
 * native page follows the host's size, which must drop to nothing when the tab is hidden.
 */
export function keepsLayoutWhileHidden(view: WorkspaceView): boolean {
  const surfaceId = migrateRetiredWorkspaceView(view).surfaceId;
  return surfaceId === "space" || surfaceId === "agents" || surfaceId === "scheduled";
}

/** A tab strip tab keeps its layout only while none of its panes holds a browser page. */
export function treeKeepsLayoutWhileHidden(root: WorkspaceDockNode): boolean {
  const views = dockTreeViews(root);
  return views.length > 0 && views.every(keepsLayoutWhileHidden);
}
