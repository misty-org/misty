import { dockTreeViews } from "./dockTree";
import { activateTab, layoutTabs } from "./layoutTabs";
import { parseBrowserViewState, type WorkspaceTab } from "./model";
import { contiguousTabs } from "./tabGroups";
import type { WorkspaceStore } from "./useWorkspaceStore";
import { withActiveWindowLayout } from "./windows";

export interface PinnedTabActions {
  /** Pins a single-page web tab at its current page. False when it can't be pinned. */
  pinTab(id: string): boolean;
  unpinTab(id: string): void;
  /** Closing a pinned tab returns it to its pinned page instead. True when the tab is pinned. */
  resetPinnedTab(id: string): boolean;
}

/** The page a tab would pin to: one ordinary web page, not private and not an agent's. */
export function pinnableTabUrl(tab: WorkspaceTab): string | null {
  const views = dockTreeViews(tab.root);
  if (views.length !== 1 || views[0].surfaceId !== "browser") return null;
  const state = parseBrowserViewState(views[0].state);
  if (state.private || state.agentOwned) return null;
  try {
    const url = new URL(state.url);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function pinnedTabActions(
  set: (patch: Partial<WorkspaceStore>) => void,
  get: () => WorkspaceStore,
): PinnedTabActions {
  const applyTabs = (tabs: WorkspaceTab[]) => {
    const state = get();
    const active = state.layout.activeTabId ?? tabs[0]?.id;
    set(
      withActiveWindowLayout(
        state,
        activateTab({ ...state.layout, tabs: contiguousTabs(tabs) }, active!),
      ),
    );
  };
  return {
    pinTab(id) {
      const state = get(),
        tabs = layoutTabs(state.layout),
        tab = tabs.find((item) => item.id === id);
      const url = tab && !tab.pinnedUrl ? pinnableTabUrl(tab) : null;
      if (!tab || !url) return false;
      const rest = tabs.filter((item) => item.id !== id);
      const pinnedCount = rest.filter((item) => item.pinnedUrl).length;
      // Pinned tabs leave their group; they sit before every group.
      applyTabs([
        ...rest.slice(0, pinnedCount),
        { ...tab, pinnedUrl: url, tabGroupId: undefined },
        ...rest.slice(pinnedCount),
      ]);
      if (tab.tabGroupId && !rest.some((item) => item.tabGroupId === tab.tabGroupId)) {
        const group = get().tabGroups.find((item) => item.id === tab.tabGroupId);
        if (group && !group.savedTabs)
          set({ tabGroups: get().tabGroups.filter((item) => item.id !== group.id) });
      }
      return true;
    },
    unpinTab(id) {
      const tabs = layoutTabs(get().layout),
        tab = tabs.find((item) => item.id === id);
      if (!tab?.pinnedUrl) return;
      const rest = tabs.filter((item) => item.id !== id);
      const pinnedCount = rest.filter((item) => item.pinnedUrl).length;
      // The tab becomes the first ordinary tab, next to where it was.
      applyTabs([
        ...rest.slice(0, pinnedCount),
        { ...tab, pinnedUrl: undefined },
        ...rest.slice(pinnedCount),
      ]);
    },
    resetPinnedTab(id) {
      const state = get(),
        tab = layoutTabs(state.layout).find((item) => item.id === id);
      if (!tab?.pinnedUrl) return false;
      const views = dockTreeViews(tab.root);
      const view = views.length === 1 && views[0].surfaceId === "browser" ? views[0] : null;
      if (view && parseBrowserViewState(view.state).url !== tab.pinnedUrl)
        state.updateBrowserView(view.id, { url: tab.pinnedUrl });
      return true;
    },
  };
}
