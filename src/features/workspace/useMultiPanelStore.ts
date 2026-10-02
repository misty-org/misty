import { normalizeExplorerPath } from "@/shared/lib/pathNormalization";
import { create } from "zustand";
import type { MultiPanelStore, MultiPanelStoreOptions, MultiPanelTab } from "./model/interfaces";
import type { MultiPanelStoreHook } from "./model/types/useMultiPanelStore";
import {
  createTab,
  normalizedIdPrefix,
  normalizeSnapshot,
  titleFromPath,
} from "./multiPanelHelpers";
export type { MultiPanelStore, MultiPanelStoreOptions } from "./model/interfaces";
export type { MultiPanelStoreHook } from "./model/types/useMultiPanelStore";

const registeredMultiPanelStores = new Set<MultiPanelStoreHook>();

export function createMultiPanelStore(options: MultiPanelStoreOptions = {}) {
  const idPrefix = normalizedIdPrefix(options.idPrefix ?? "explorer");
  const defaultTitle = options.defaultTitle ?? "Home";
  const tabIdFor = (index: number) => `${idPrefix}-tab-${index}`;
  const paneIdFor = (index: number) => `${idPrefix}-pane-${index}`;

  const store = create<MultiPanelStore>((set, get) => ({
    tabs: [],
    activeTabId: "",
    closedTabs: [],
    activePaneId: "",
    nextPaneIndex: 1,
    nextTabIndex: 1,

    hydrate: (snapshot) => {
      if (snapshot.tabs.length === 0) return false;
      const normalized = normalizeSnapshot(snapshot);
      if (normalized.tabs.length === 0) return false;
      set({
        tabs: normalized.tabs,
        activeTabId: normalized.activeTabId,
        activePaneId: normalized.activePaneId,
        nextPaneIndex: normalized.nextPaneIndex,
        nextTabIndex: normalized.nextTabIndex,
      });
      return true;
    },

    initialize: (path, title = defaultTitle) => {
      const state = get();
      if (state.tabs.length > 0) return;
      const paneId = paneIdFor(0);
      const tab = createTab(tabIdFor(0), paneId, path, title);
      set({
        tabs: [tab],
        activeTabId: tab.id,
        activePaneId: paneId,
        nextPaneIndex: 1,
        nextTabIndex: 1,
      });
    },

    addTab: (path, title) => {
      const state = get();
      const tabId = tabIdFor(state.nextTabIndex);
      const paneId = paneIdFor(state.nextPaneIndex);
      const tab = createTab(tabId, paneId, path, title ?? titleFromPath(path));
      set({
        tabs: [...state.tabs, tab],
        activeTabId: tabId,
        activePaneId: paneId,
        nextPaneIndex: state.nextPaneIndex + 1,
        nextTabIndex: state.nextTabIndex + 1,
      });
      return tabId;
    },

    reorderTabs: (tabId, fromIndex, toIndex) => {
      set((state) => {
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return state;
        const sourceIndex = state.tabs.findIndex((tab) => tab.id === tabId);
        if (sourceIndex < 0) return state;
        const boundedToIndex = Math.min(Math.max(toIndex, 0), state.tabs.length - 1);
        const tabs = state.tabs.filter((tab) => tab.id !== tabId);
        tabs.splice(boundedToIndex, 0, state.tabs[sourceIndex]);
        if (tabs.every((tab, index) => tab.id === state.tabs[index]?.id)) return state;
        return { tabs };
      });
    },

    closeTab: (tabId) => {
      set((state) => {
        if (state.tabs.length <= 1) return state;
        const closedIndex = state.tabs.findIndex((tab) => tab.id === tabId);
        if (closedIndex === -1) return state;
        const tabs = state.tabs.filter((tab) => tab.id !== tabId);
        const activeTab =
          state.activeTabId === tabId
            ? (tabs[Math.max(0, closedIndex - 1)] ?? tabs[0])
            : (tabs.find((tab) => tab.id === state.activeTabId) ?? tabs[0]);
        return {
          tabs,
          closedTabs: [state.tabs[closedIndex], ...state.closedTabs].slice(0, 10),
          activeTabId: activeTab.id,
          activePaneId: activeTab.activePaneId,
        };
      });
    },

    restoreTab: () => {
      set((state) => {
        const [tab, ...closedTabs] = state.closedTabs;
        if (!tab) return state;
        return {
          tabs: [...state.tabs, tab],
          closedTabs,
          activeTabId: tab.id,
          activePaneId: tab.activePaneId,
        };
      });
    },

    selectTab: (tabId) => {
      set((state) => {
        const tab = state.tabs.find((candidate) => candidate.id === tabId);
        if (!tab) return state;
        if (state.activeTabId === tab.id && state.activePaneId === tab.activePaneId) return state;
        return {
          activeTabId: tab.id,
          activePaneId: tab.activePaneId,
        };
      });
    },

    updateActiveTabPath: (paneId, path, title) => {
      const normalizedPath = normalizeExplorerPath(path);
      set((state) => {
        let changed = false;
        const tabs = state.tabs.map((tab) => {
          const pane = tab.panes.find((candidate) => candidate.id === paneId);
          if (!pane) return tab;
          const nextTitle = title ?? titleFromPath(normalizedPath);
          const nextTabTitle = tab.activePaneId === paneId ? nextTitle : tab.title;
          const nextTabPath = tab.activePaneId === paneId ? normalizedPath : tab.path;
          if (
            pane.path === normalizedPath &&
            pane.title === nextTitle &&
            tab.title === nextTabTitle &&
            tab.path === nextTabPath
          ) {
            return tab;
          }
          changed = true;
          return {
            ...tab,
            title: nextTabTitle,
            path: nextTabPath,
            panes: tab.panes.map((candidate) =>
              candidate.id === paneId
                ? { ...candidate, path: normalizedPath, title: nextTitle }
                : candidate,
            ),
          };
        });
        return changed ? { tabs } : state;
      });
    },

    setActivePane: (paneId) => {
      set((state) => {
        const activeTab = activeMultiPanelTab(state);
        if (!activeTab || !activeTab.panes.some((pane) => pane.id === paneId)) return state;
        if (state.activePaneId === paneId && activeTab.activePaneId === paneId) return state;
        const pane = activeTab.panes.find((candidate) => candidate.id === paneId);
        return {
          activePaneId: paneId,
          tabs: state.tabs.map((tab) =>
            tab.id === activeTab.id
              ? {
                  ...tab,
                  activePaneId: paneId,
                  title: pane?.title ?? tab.title,
                  path: pane?.path ?? tab.path,
                }
              : tab,
          ),
        };
      });
    },

    setTabPanelVisibility: (tabId, visibility) => {
      set((state) => {
        let changed = false;
        const tabs = state.tabs.map((tab) => {
          if (tab.id !== tabId) return tab;
          const sidebarVisible = visibility.sidebarVisible ?? tab.sidebarVisible ?? true;
          const previewVisible = visibility.previewVisible ?? tab.previewVisible ?? true;
          if (
            (tab.sidebarVisible ?? true) === sidebarVisible &&
            (tab.previewVisible ?? true) === previewVisible
          ) {
            return tab;
          }
          changed = true;
          return { ...tab, sidebarVisible, previewVisible };
        });
        return changed ? { tabs } : state;
      });
    },
  }));
  registeredMultiPanelStores.add(store);
  return store;
}

export const useMultiPanelStore = createMultiPanelStore({
  idPrefix: "explorer",
  defaultTitle: "Home",
});

/** Resolve the inner workspace that owns a concrete pane. */
export function multiPanelStoreForPane(paneId: string): MultiPanelStoreHook {
  for (const store of registeredMultiPanelStores) {
    if (store.getState().tabs.some((tab) => tab.panes.some((pane) => pane.id === paneId))) {
      return store;
    }
  }
  return useMultiPanelStore;
}

export function activeMultiPanelTab(state: {
  tabs: MultiPanelTab[];
  activeTabId: string;
}): MultiPanelTab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? null;
}
