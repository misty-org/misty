import { dockWidgetRegistry, workspaceTabsById, type WorkspaceView } from "@/features/workspace";
import { releaseWorkspaceViewRouteHistory } from "@/features/workspace/WorkspaceViewRouteScope";

export { workspaceTabsById };

export function disposeWorkspaceTab(tab: WorkspaceView): void {
  releaseWorkspaceViewRouteHistory(tab.id);
  dockWidgetRegistry.get(tab.surfaceId).dispose?.(tab.state);
}
