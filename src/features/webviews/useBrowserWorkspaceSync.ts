import { useEffect, useLayoutEffect } from "react";
import {
  dockLeaves,
  useWorkspaceStore,
  workspaceTabsById,
  type WorkspaceDockNode,
} from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  browserRuntimeId,
  closeBrowserRuntime,
  parkAllBrowserWebviews,
  switchBrowserPages,
} from "./browserRuntime";

function activeBrowserSurfaceExists(root: WorkspaceDockNode): boolean {
  return dockLeaves(root).some((pane) => {
    const activeTab = pane.views.find((tab) => tab.id === pane.activeViewId);
    return activeTab?.surfaceId === "browser";
  });
}

/** The runtime of every browser tab a pane shows now. */
function activeBrowserRuntimeIds(root: WorkspaceDockNode): string[] {
  return dockLeaves(root)
    .map((pane) => pane.views.find((tab) => tab.id === pane.activeViewId))
    .filter((tab) => tab?.surfaceId === "browser")
    .map((tab) => browserRuntimeId(tab!))
    .sort();
}

/**
 * Windows: the moment the active tabs change, the native pages follow in one call, before
 * React renders the new surface or any page measures itself (`switchBrowserPages`). Switching
 * to or from a browser tab is then one change of stacking order, not a wait for layout.
 */
export function useInstantBrowserSwitch(): void {
  useEffect(() => {
    if (!hasTauriInternals() || !/win/i.test(navigator.platform)) return;
    let current = activeBrowserRuntimeIds(useWorkspaceStore.getState().layout.root).join("\n");
    return useWorkspaceStore.subscribe((state) => {
      const ids = activeBrowserRuntimeIds(state.layout.root);
      const key = ids.join("\n");
      if (key === current) return;
      current = key;
      switchBrowserPages(ids);
    });
  }, []);
}

/** Parks native browser pages while another workspace surface is in front. */
export function useBrowserSurfaceParking(): void {
  const browserSurfaceActive = useWorkspaceStore((state) =>
    activeBrowserSurfaceExists(state.layout.root),
  );
  useLayoutEffect(() => {
    if (browserSurfaceActive) return;
    // Commit the replacement workspace surface, then hide its native browser
    // siblings. Their pages stay loaded without participating in overlay
    // stacking until Browser becomes active again.
    const frame = window.requestAnimationFrame(() => void parkAllBrowserWebviews());
    return () => window.cancelAnimationFrame(frame);
  }, [browserSurfaceActive]);
}

/** Closes the native runtime of every browser tab removed from the workspace. */
export function useClosedBrowserTabCleanup(): void {
  useEffect(() => {
    let knownTabs = workspaceTabsById(useWorkspaceStore.getState());
    return useWorkspaceStore.subscribe((state) => {
      const nextTabs = workspaceTabsById(state);
      for (const [tabId, tab] of knownTabs) {
        if (!nextTabs.has(tabId) && tab.surfaceId === "browser") {
          void closeBrowserRuntime(
            tab,
            () => !workspaceTabsById(useWorkspaceStore.getState()).has(tabId),
          );
        }
      }
      knownTabs = nextTabs;
    });
  }, []);
}
