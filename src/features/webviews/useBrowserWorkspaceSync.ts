import { invoke } from "@tauri-apps/api/core";
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
  isBrowserLayoutMoving,
  parkAllBrowserWebviews,
  switchBrowserPages,
} from "./browserRuntime";
import { useBrowserRuntimeStore } from "./browserRuntimeStore";
import { hasPendingHandoff, onBrowserSettled } from "./browserSwitchHandoff";

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

/** The browser page in the focused pane, split or not, if that pane shows one. */
function focusedBrowserPage(): { runtimeId: string; tabId: string } | null {
  const { layout } = useWorkspaceStore.getState();
  const panes = dockLeaves(layout.root);
  const pane = panes.find((candidate) => candidate.id === layout.focusedPaneId) ?? panes[0];
  const tab = pane?.views.find((view) => view.id === pane.activeViewId);
  return tab?.surfaceId === "browser" ? { runtimeId: browserRuntimeId(tab), tabId: tab.id } : null;
}

/** Whether the page is on screen and no switch or layout move is still going on. */
function switchSettled(tabId: string): boolean {
  return (
    Boolean(useBrowserRuntimeStore.getState().presented[tabId]) &&
    !hasPendingHandoff() &&
    !isBrowserLayoutMoving()
  );
}

/** Whether the app holds a text field or menu, which a page must not take focus from. */
function appHoldsKeyboard(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return false;
  if (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return true;
  return active.closest('[role="menu"],[role="dialog"]') !== null;
}

/**
 * Touching the app (a click in the tab sidebar, switching tabs or split panes) takes keyboard
 * focus from the page you were typing in, and showing the page again does not give it back.
 * Once things settle, the active pane's page gets it back with its caret where it was. The host
 * only acts for a page that had focus, and does it silently, so it never redraws the switch.
 */
export function useBrowserFocusReturn(): void {
  useEffect(() => {
    if (!hasTauriInternals() || !/win/i.test(navigator.platform)) return;
    // Set by a tab change or a click in the app; cleared once focus has been handed back.
    let armed = false;
    let frame = 0;
    // Runs on every event that can end a switch: the page being drawn, the handoff or layout
    // move finishing. Nothing here waits on a clock, so focus never moves mid-switch.
    const attempt = () => {
      if (!armed) return;
      const page = focusedBrowserPage();
      if (!page || !switchSettled(page.tabId)) return;
      armed = false;
      if (appHoldsKeyboard()) return;
      void invoke("browser_webview_restore_focus", { request: { id: page.runtimeId } }).catch(
        () => undefined,
      );
    };
    const arm = () => {
      armed = true;
      attempt();
    };
    const paneKey = () => {
      const { layout } = useWorkspaceStore.getState();
      const pane = dockLeaves(layout.root).find(
        (candidate) => candidate.id === layout.focusedPaneId,
      );
      return `${layout.activeTabId}|${layout.focusedPaneId}|${pane?.activeViewId}`;
    };
    let current = paneKey();
    const stops = [
      useWorkspaceStore.subscribe(() => {
        const key = paneKey();
        if (key === current) return;
        current = key;
        arm();
      }),
      useBrowserRuntimeStore.subscribe(attempt),
      onBrowserSettled(attempt),
    ];
    // A click in the app may be a tab switch that renders on the next frame, so it is looked
    // at once that frame has committed.
    const onClick = () => {
      armed = true;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(attempt);
    };
    window.addEventListener("click", onClick);
    return () => {
      stops.forEach((stop) => stop());
      window.removeEventListener("click", onClick);
      window.cancelAnimationFrame(frame);
    };
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
