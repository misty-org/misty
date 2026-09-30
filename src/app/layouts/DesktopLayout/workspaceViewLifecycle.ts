import type { useWorkspaceStore } from "@/features/workspace";
import { dockWidgetRegistry, type WorkspaceView } from "@/features/workspace";
import { allLayoutViews } from "@/features/workspace/layoutTabs";
import { releaseWorkspaceViewRouteHistory } from "@/features/workspace/WorkspaceViewRouteScope";
export function disposeWorkspaceTab(tab: WorkspaceView): void {
  releaseWorkspaceViewRouteHistory(tab.id);
  dockWidgetRegistry.get(tab.surfaceId).dispose?.(tab.state);
}

export function workspaceTabsById(
  state: ReturnType<typeof useWorkspaceStore.getState>,
): Map<string, WorkspaceView> {
  return new Map(
    Object.values(state.windowsByScope)
      .filter((windows): windows is NonNullable<typeof windows> => Boolean(windows))
      .flat()
      .flatMap((workspaceWindow) => allLayoutViews(workspaceWindow.layout))
      .map((tab) => [tab.id, tab]),
  );
}
