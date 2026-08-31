import { normalizeExplorerPath } from "@/shared/lib/pathNormalization";
import { create } from "zustand";
import type {
  MultiPanelClosedPane,
  MultiPanelLayout,
  MultiPanelStore,
  MultiPanelStoreOptions,
  MultiPanelTab,
} from "./model/interfaces";
import type { MultiPanelStoreHook } from "./model/types/useMultiPanelStore";
import {
  capClosedPanesPerTab,
  chooseActivePaneAfterRemoval,
  clampRatio,
  createPane,
  createTab,
  defaultLayout,
  flattenLanes,
  insertPaneAfter,
  laneRatiosWith,
  lanesWithRestoredPane,
  layoutEqual,
  normalizedIdPrefix,
  normalizedLanes,
  normalizeSnapshot,
  paneLocation,
  panesInLaneOrder,
  titleFromPath,
} from "./multiPanelHelpers";
export type { MultiPanelStore, MultiPanelStoreOptions } from "./model/interfaces";
export type { MultiPanelStoreHook } from "./model/types/useMultiPanelStore";

const maxPanesPerTab = 4;
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
    closedPanes: [],
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
        closedPanes: normalized.closedPanes,
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

    splitPane: (paneId, orientation) => {
      const state = get();
      const activeTab = activeMultiPanelTab(state);
      if (!activeTab || activeTab.panes.length >= maxPanesPerTab) return;
      const source = activeTab.panes.find((pane) => pane.id === paneId);
      if (!source) return;
      const currentLanes = normalizedLanes(activeTab.layout, activeTab.panes);
      const laneIndex = currentLanes.findIndex((lane) => lane.includes(paneId));
      if (laneIndex < 0) return;
      if (orientation === "vertical" && currentLanes.length !== 1) return;
      if (orientation === "horizontal" && currentLanes[laneIndex].length !== 1) return;

      const newPaneId = paneIdFor(state.nextPaneIndex);
      const newPane = createPane(newPaneId, source.path, source.title);
      const lanes =
        orientation === "vertical"
          ? [currentLanes[0], [newPaneId]]
          : currentLanes.map((lane, index) => (index === laneIndex ? [...lane, newPaneId] : lane));
      set((current) => ({
        tabs: current.tabs.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                activePaneId: newPaneId,
                layout: {
                  ...tab.layout,
                  orientation: lanes.length > 1 ? "vertical" : "horizontal",
                  lanes,
                  paneIds: flattenLanes(lanes),
                  gridSplitRatio: orientation === "vertical" ? 0.5 : tab.layout.gridSplitRatio,
                  laneSplitRatios:
                    orientation === "horizontal"
                      ? laneRatiosWith(tab.layout.laneSplitRatios, laneIndex, 0.5)
                      : tab.layout.laneSplitRatios,
                },
                panes: insertPaneAfter(tab.panes, paneId, newPane),
              }
            : tab,
        ),
        activePaneId: newPaneId,
        nextPaneIndex: current.nextPaneIndex + 1,
      }));
    },

    closePane: (paneId) => {
      set((state) => {
        const activeTab = activeMultiPanelTab(state);
        if (!activeTab || activeTab.panes.length <= 1) return state;
        const pane = activeTab.panes.find((candidate) => candidate.id === paneId);
        if (!pane) return state;
        const panes = activeTab.panes.filter((candidate) => candidate.id !== paneId);
        const removedLocation = paneLocation(activeTab.layout, activeTab.panes, paneId);
        const removedLane = normalizedLanes(activeTab.layout, activeTab.panes)[
          removedLocation.laneIndex
        ];
        const closedPane: MultiPanelClosedPane = {
          pane,
          tabId: activeTab.id,
          restoreMode: removedLane?.length === 1 ? "new_lane" : "same_lane",
          laneIndex: removedLocation.laneIndex,
          rowIndex: removedLocation.rowIndex,
        };
        const lanes = normalizedLanes(activeTab.layout, activeTab.panes)
          .map((lane) => lane.filter((id) => id !== paneId))
          .filter((lane) => lane.length > 0);
        const paneIds = flattenLanes(lanes);
        const activePaneId =
          activeTab.activePaneId === paneId ? paneIds[0] : activeTab.activePaneId;
        const fallbackActivePaneId =
          activeTab.activePaneId === paneId
            ? chooseActivePaneAfterRemoval(lanes, removedLocation)
            : activePaneId;
        const activePane = panes.find((candidate) => candidate.id === fallbackActivePaneId);
        return {
          tabs: state.tabs.map((tab) =>
            tab.id === activeTab.id
              ? {
                  ...tab,
                  panes,
                  activePaneId: fallbackActivePaneId,
                  title: activePane?.title ?? tab.title,
                  path: activePane?.path ?? tab.path,
                  layout: {
                    ...tab.layout,
                    orientation: lanes.length > 1 ? "vertical" : "horizontal",
                    lanes,
                    paneIds,
                  },
                }
              : tab,
          ),
          closedPanes: capClosedPanesPerTab([closedPane, ...state.closedPanes]),
          activePaneId: fallbackActivePaneId,
        };
      });
    },

    restorePane: () => {
      set((state) => {
        const activeTab = activeMultiPanelTab(state);
        if (!activeTab || activeTab.panes.length >= maxPanesPerTab) return state;
        const closedIndex = state.closedPanes.findIndex(
          (candidate) => candidate.tabId === activeTab.id,
        );
        if (closedIndex < 0) return state;
        const closedPane = state.closedPanes[closedIndex];
        const pane = closedPane.pane;
        const closedPanes = state.closedPanes.filter((_, index) => index !== closedIndex);
        const lanes = lanesWithRestoredPane(activeTab.layout, activeTab.panes, closedPane);
        const panes = panesInLaneOrder([...activeTab.panes, pane], lanes);
        return {
          tabs: state.tabs.map((tab) =>
            tab.id === activeTab.id
              ? {
                  ...tab,
                  title: pane.title,
                  path: pane.path,
                  panes,
                  activePaneId: pane.id,
                  layout: {
                    ...tab.layout,
                    orientation: lanes.length > 1 ? "vertical" : "horizontal",
                    lanes,
                    paneIds: flattenLanes(lanes),
                  },
                }
              : tab,
          ),
          closedPanes,
          activePaneId: pane.id,
        };
      });
    },

    collapseDuplicateBrowsePanes: () => {
      set((state) => {
        const activeTab = activeMultiPanelTab(state);
        if (!activeTab || activeTab.panes.length <= 1) return state;
        const pane =
          activeTab.panes.find((candidate) => candidate.id === activeTab.activePaneId) ??
          activeTab.panes[0];
        const nextTab: MultiPanelTab = {
          ...activeTab,
          title: pane.title,
          path: pane.path,
          panes: [pane],
          activePaneId: pane.id,
          layout: defaultLayout("vertical", [pane.id]),
        };
        return {
          tabs: state.tabs.map((tab) => (tab.id === activeTab.id ? nextTab : tab)),
          activePaneId: pane.id,
        };
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

    setSplitRatio: (tabId, ratioKind, ratio) => {
      const nextRatio = clampRatio(ratio);
      set((state) => ({
        tabs: state.tabs.map((tab) => {
          if (tab.id !== tabId) return tab;
          const currentLaneRatios = tab.layout.laneSplitRatios ?? [0.5, 0.5];
          const laneSplitRatios: [number, number] = [...currentLaneRatios];
          if (ratioKind === "lane0") laneSplitRatios[0] = nextRatio;
          if (ratioKind === "lane1") laneSplitRatios[1] = nextRatio;
          const nextLayout: MultiPanelLayout =
            ratioKind === "grid"
              ? { ...tab.layout, gridSplitRatio: nextRatio }
              : { ...tab.layout, laneSplitRatios };
          return layoutEqual(tab.layout, nextLayout) ? tab : { ...tab, layout: nextLayout };
        }),
      }));
    },
  }));
  registeredMultiPanelStores.add(store);
  return store;
}

export const useMultiPanelStore = createMultiPanelStore({
  idPrefix: "explorer",
  defaultTitle: "Home",
});

/** Remove a scoped store from pane ownership lookup once its outer tab closes. */
export function destroyMultiPanelStore(store: MultiPanelStoreHook): void {
  if (store === useMultiPanelStore) return;
  registeredMultiPanelStores.delete(store);
}

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

export function maxMultiPanelPanes(): number {
  return maxPanesPerTab;
}

export type { MultiPanelPaneRestoreMode, SplitOrientation } from "./multiPanelHelpers";
