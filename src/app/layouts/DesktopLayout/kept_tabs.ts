import { dockTreeViews } from "@/features/app-windows";
import type { WorkspaceDockNode, WorkspaceView } from "@/features/app-windows";

export function keepsLayoutWhileHidden(view: WorkspaceView): boolean {
  if (view.placeholder) return false;
  return view.surfaceId === "space" || view.surfaceId === "agents" || view.surfaceId === "direct";
}

export function treeKeepsLayoutWhileHidden(root: WorkspaceDockNode): boolean {
  const views = dockTreeViews(root);
  return views.length > 0 && views.every(keepsLayoutWhileHidden);
}
