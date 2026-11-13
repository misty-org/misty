import { dockTreeViews } from "@/features/app-windows";
import type { WorkspaceDockNode, WorkspaceView } from "@/features/app-windows";

/**
 * Whether a hidden tab keeps its layout instead of leaving the page (`[data-tab-kept]`, which
 * skips its rendering but not its laid out boxes). Showing a Space or Agents page again is then
 * one paint instead of a fresh style and layout pass over the whole page. A view this build has
 * no page for leaves the page.
 */
export function keepsLayoutWhileHidden(view: WorkspaceView): boolean {
  // An idle pane is cheap to lay out again, and WebKit doesn't restart Misty's flight in a
  // subtree that `content-visibility: hidden` skipped, so it leaves the page instead.
  if (view.placeholder) return false;
  return view.surfaceId === "space" || view.surfaceId === "agents";
}

/** A tab strip tab keeps its layout only while every view in its panes does. */
export function treeKeepsLayoutWhileHidden(root: WorkspaceDockNode): boolean {
  const views = dockTreeViews(root);
  return views.length > 0 && views.every(keepsLayoutWhileHidden);
}
