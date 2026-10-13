import { useEffect, useLayoutEffect } from "react";
import {
  dockLeaves,
  useWorkspaceStore,
  workspaceTabsById,
  type WorkspaceDockNode,
} from "@/features/workspace";
import { closeBrowserRuntime, parkAllBrowserWebviews } from "./browserRuntime";

function activeBrowserSurfaceExists(root: WorkspaceDockNode): boolean {
  return dockLeaves(root).some((pane) => {
    const activeTab = pane.views.find((tab) => tab.id === pane.activeViewId);
    return activeTab?.surfaceId === "browser";
  });
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
