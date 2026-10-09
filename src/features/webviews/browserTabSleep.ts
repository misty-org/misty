import { useBrowserDownloadsStore, useBrowserMediaStore } from "@/features/browser/library";
import { dockLeaves, useWorkspaceStore, workspaceTabsById } from "@/features/workspace";
import { parseBrowserViewState } from "@/features/workspace/model";
import { liveBrowserRuntimes, sleepBrowserRuntime, useBrowserRuntimeStore } from "./browserRuntime";

import { tabSleepMinutes } from "./tabSleepSettings";

function shownBrowserTabs(): string[] {
  const { layout } = useWorkspaceStore.getState();
  return dockLeaves(layout.root).flatMap((pane) => {
    const view = pane.views.find((item) => item.id === pane.activeViewId) ?? pane.views[0];
    return view?.surfaceId === "browser" ? [view.id] : [];
  });
}

/** Pages that must keep running: sound, private data, agents and their grants. */
function mustStayAwake(tabId: string): boolean {
  const tab = workspaceTabsById(useWorkspaceStore.getState()).get(tabId);
  if (!tab || tab.surfaceId !== "browser") return true;
  const state = parseBrowserViewState(tab.state);
  return (
    Boolean(state.private) ||
    Boolean(state.agentOwned) ||
    Boolean(useBrowserMediaStore.getState().audible[tabId]) ||
    Boolean(useBrowserRuntimeStore.getState().grants[tabId]?.length)
  );
}

/**
 * Background tabs hidden longer than the setting release their native page,
 * like Chrome's Memory Saver. Downloads in progress keep every page awake.
 */
export function startBrowserTabSleep(): () => void {
  const lastShown = new Map<string, number>();
  const markShown = () => {
    const now = Date.now();
    for (const tabId of shownBrowserTabs()) lastShown.set(tabId, now);
  };
  markShown();
  const stopWatching = useWorkspaceStore.subscribe((state, previous) => {
    // Mark both what was on screen until now and what is on screen next.
    if (state.layout !== previous.layout) {
      const now = Date.now();
      for (const pane of dockLeaves(previous.layout.root))
        if (pane.activeViewId) lastShown.set(pane.activeViewId, now);
      markShown();
    }
  });
  const check = () => {
    const sleepAfterMinutes = tabSleepMinutes();
    if (!sleepAfterMinutes) return;
    if (useBrowserDownloadsStore.getState().entries.some((entry) => entry.state === "in_progress"))
      return;
    markShown();
    const now = Date.now();
    const live = liveBrowserRuntimes();
    const liveTabs = new Set(live.map((runtime) => runtime.tabId));
    for (const tabId of lastShown.keys()) if (!liveTabs.has(tabId)) lastShown.delete(tabId);
    for (const runtime of live) {
      if (!runtime.tabId) continue;
      const shown = lastShown.get(runtime.tabId);
      if (runtime.visible || shown === undefined) {
        // Start counting from the first check that finds the page hidden.
        lastShown.set(runtime.tabId, now);
        continue;
      }
      if (now - shown < sleepAfterMinutes * 60_000 || mustStayAwake(runtime.tabId)) continue;
      void sleepBrowserRuntime(runtime.id).then((slept) => {
        if (slept) lastShown.delete(runtime.tabId);
      });
    }
  };
  const timer = window.setInterval(check, 60_000);
  return () => {
    window.clearInterval(timer);
    stopWatching();
  };
}
