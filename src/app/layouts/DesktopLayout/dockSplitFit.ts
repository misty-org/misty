import {
  canFitDockSplit,
  dockLeaves,
  dockWidgetRegistry,
  maxWorkspacePanes,
  useWorkspaceStore,
  type DockDropZone,
  type WorkspacePane,
  type WorkspaceView,
} from "@/features/workspace";

export function dropZoneAt(rect: DOMRect, x: number, y: number): DockDropZone {
  const localX = (x - rect.left) / Math.max(1, rect.width);
  const localY = (y - rect.top) / Math.max(1, rect.height);
  const edge = 0.24;
  if (localX < edge) return "left";
  if (localX > 1 - edge) return "right";
  if (localY < edge) return "up";
  if (localY > 1 - edge) return "down";
  return "center";
}

export function dockSplitFits(
  pane: WorkspacePane,
  available: { width: number; height: number },
  zone: DockDropZone,
  movingTab: WorkspaceView,
): boolean {
  if (zone === "center") return true;
  if (dockLeaves(useWorkspaceStore.getState().layout.root).length >= maxWorkspacePanes)
    return false;
  const remaining = pane.views.filter((tab) => tab.id !== movingTab.id);
  if (!remaining.length) return false;
  return canFitDockSplit(
    available,
    zone,
    minimumForWorkspaceViews(remaining),
    dockWidgetRegistry.get(movingTab.surfaceId).minimumSize,
  );
}

export function minimumForWorkspaceViews(tabs: WorkspaceView[]): { width: number; height: number } {
  return tabs.reduce(
    (minimum, tab) => {
      const next = dockWidgetRegistry.get(tab.surfaceId).minimumSize;
      return {
        width: Math.max(minimum.width, next.width),
        height: Math.max(minimum.height, next.height),
      };
    },
    { width: 280, height: 180 },
  );
}
