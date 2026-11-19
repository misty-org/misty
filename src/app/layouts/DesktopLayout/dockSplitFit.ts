import {
  canFitDockSplit,
  dockLeaves,
  dockWidgetRegistry,
  maxWorkspacePanes,
  splitKeepsGrid,
  useWorkspaceStore,
  type DockDropZone,
  type WorkspacePane,
  type WorkspaceView,
  workspaceSurfaceFromRoute,
} from "@/features/app-windows";
import { designPx } from "@/shared/lib/uiScale";

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
  const root = useWorkspaceStore.getState().layout.root;
  if (dockLeaves(root).length >= maxWorkspacePanes) return false;
  if (!splitKeepsGrid(root, pane.id, zone)) return false;
  const remaining = pane.views.filter((tab) => tab.id !== movingTab.id);
  if (!remaining.length) return false;
  // Panes are measured in CSS pixels; the minimums are design pixels (shared/lib/uiScale.ts).
  return canFitDockSplit(
    { width: designPx(available.width), height: designPx(available.height) },
    zone,
    minimumForWorkspaceViews(remaining),
    dockWidgetRegistry.get(movingTab.surfaceId).minimumSize,
  );
}

/** Whether a page not open yet (a chat dragged from the sidebar) fits a split of the pane. */
export function dockRouteFits(
  pane: WorkspacePane,
  available: { width: number; height: number },
  zone: DockDropZone,
  route: string,
): boolean {
  if (zone === "center") return true;
  const surface = workspaceSurfaceFromRoute(route);
  const root = useWorkspaceStore.getState().layout.root;
  if (!surface || !pane.views.length) return false;
  if (dockLeaves(root).length >= maxWorkspacePanes || !splitKeepsGrid(root, pane.id, zone))
    return false;
  return canFitDockSplit(
    { width: designPx(available.width), height: designPx(available.height) },
    zone,
    minimumForWorkspaceViews(pane.views),
    dockWidgetRegistry.get(surface.surfaceId).minimumSize,
  );
}

/** The part of a pane a page dropped in `zone` will take, a little inside its edge. */
export function dropZoneRect(rect: DOMRect, zone: DockDropZone): DOMRect {
  const inset = 6;
  const x = rect.left + inset,
    y = rect.top + inset,
    width = rect.width - inset * 2,
    height = rect.height - inset * 2;
  const halfWidth = (width - inset) / 2,
    halfHeight = (height - inset) / 2;
  if (zone === "left") return new DOMRect(x, y, halfWidth, height);
  if (zone === "right") return new DOMRect(x + width - halfWidth, y, halfWidth, height);
  if (zone === "up") return new DOMRect(x, y, width, halfHeight);
  if (zone === "down") return new DOMRect(x, y + height - halfHeight, width, halfHeight);
  return new DOMRect(x, y, width, height);
}

/** What dropping in each zone does, named in the split preview. */
export const dropZoneLabels: Record<DockDropZone, string> = {
  center: "Open here",
  left: "Split left",
  right: "Split right",
  up: "Split top",
  down: "Split bottom",
};

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
