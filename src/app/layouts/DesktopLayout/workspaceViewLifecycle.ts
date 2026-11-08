import { dockWidgetRegistry, workspaceTabsById, type WorkspaceView } from "@/features/app-windows";
import { releaseWorkspaceViewRouteHistory } from "@/features/app-windows";

export { workspaceTabsById };

export function disposeWorkspaceTab(tab: WorkspaceView): void {
  releaseWorkspaceViewRouteHistory(tab.id);
  dockWidgetRegistry.get(tab.surfaceId).dispose?.(tab.state);
}
