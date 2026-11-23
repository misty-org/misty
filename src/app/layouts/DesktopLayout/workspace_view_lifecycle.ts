import { dockWidgetRegistry, workspaceTabsById, type WorkspaceView } from "@/features/app-windows";
import { releaseWorkspaceViewRouteHistory } from "@/features/app-windows";
import { endNewChatTerminals } from "@/features/agents";

export { workspaceTabsById };

export function disposeWorkspaceTab(tab: WorkspaceView): void {
  releaseWorkspaceViewRouteHistory(tab.id);
  dockWidgetRegistry.get(tab.surfaceId).dispose?.(tab.state);
  if (tab.surfaceId === "agents") endNewChatTerminals(tab.id);
}
