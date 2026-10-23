import { isAuthPath } from "@/features/app-shell/routes";
import { getAppliedAppRenderScale } from "@/shared/hooks/useAppZoom";
import { useBrowserRuntimeStore } from "@/features/webviews/browserRuntime";
import type { BrowserBounds } from "@/features/webviews/types";
import { dockLeaves, useWorkspaceStore, type WorkspaceLayout } from "@/features/workspace";
import { browserBoundsAtAppZoom } from "./browserHostBounds";

// What useBrowserWebviewGeometry asks about the window and its panes, and its prewarm queue.

export function currentWindowSize(): string {
  return `${window.innerWidth}:${window.innerHeight}`;
}

export function isMacNativeRuntime(): boolean {
  return /Mac/.test(navigator.platform);
}

/** Another browser tab is now showing and this one is no longer any pane's active view. */
export function browserTabReplaced(tabId: string): boolean {
  if (!browserSurfaceStillActive()) return false;
  return !dockLeaves(useWorkspaceStore.getState().layout.root).some(
    (pane) => pane.activeViewId === tabId,
  );
}

let prewarmQueue: Promise<void> = Promise.resolve();

/**
 * Resolves once the page on screen has been drawn, or when no browser page is on screen to wait
 * for. A restored window of tabs then draws the tab in front first instead of starting every
 * page's process beside it.
 */
function whenFirstPagePresented(): Promise<void> {
  const ready = () =>
    !browserSurfaceStillActive() ||
    Object.values(useBrowserRuntimeStore.getState().presented).some(Boolean);
  return new Promise<void>((resolve) => {
    if (ready()) return resolve();
    const stops = [useBrowserRuntimeStore, useWorkspaceStore].map((store) =>
      store.subscribe(() => {
        if (!ready()) return;
        stops.forEach((stop) => stop());
        resolve();
      }),
    );
  });
}

/** Background page loads run one at a time while the app is idle, so they never crowd out what
 * the person is doing. */
export function queueBrowserPrewarm(run: () => Promise<void> | void): void {
  prewarmQueue = prewarmQueue
    .then(whenFirstPagePresented)
    .then(
      () =>
        new Promise<void>((resolve) => {
          if (typeof window.requestIdleCallback === "function")
            window.requestIdleCallback(() => resolve(), { timeout: 1500 });
          else window.setTimeout(resolve, 200);
        }),
    )
    .then(run)
    .catch(() => undefined);
}

/** The size a page has once its tab is shown: a page on screen now, else a pane on screen. */
export function shownPageBounds(): BrowserBounds | null {
  for (const selector of ["[data-browser-page-host]", "[data-workspace-pane]"]) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const rect = element.getBoundingClientRect();
      const x = Math.max(0, rect.left);
      const y = Math.max(0, rect.top);
      const width = Math.min(window.innerWidth, rect.right) - x;
      const height = Math.min(window.innerHeight, rect.bottom) - y;
      if (width >= 2 && height >= 2)
        return browserBoundsAtAppZoom({ x, y, width, height }, getAppliedAppRenderScale());
    }
  }
  return null;
}

/** Some pane of the shown tab has this view in front. */
export function viewActive(root: WorkspaceLayout["root"], viewId: string): boolean {
  return dockLeaves(root).some((pane) => pane.activeViewId === viewId);
}

/**
 * Whether some pane still shows a browser tab, as when switching between them. Signed-out pages
 * show no pane at all, whatever the layout remembers, so no page is coming to take over.
 */
export function browserSurfaceStillActive(): boolean {
  if (isAuthPath(window.location.pathname)) return false;
  return dockLeaves(useWorkspaceStore.getState().layout.root).some(
    (pane) => pane.views.find((view) => view.id === pane.activeViewId)?.surfaceId === "browser",
  );
}
