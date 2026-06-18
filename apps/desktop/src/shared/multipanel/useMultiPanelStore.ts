import { create } from "zustand";
import type { MultiPanelLayout, MultiPanelPane, MultiPanelTab, SplitOrientation } from "./types";

const maxPanesPerTab = 4;

interface MultiPanelStore {
  tabs: MultiPanelTab[];
  activeTabId: string;
  closedPanes: MultiPanelPane[];
  activePaneId: string;
  nextPaneIndex: number;
  nextTabIndex: number;
  initialize: (path: string, title?: string) => void;
  addTab: (path: string, title?: string) => string;
  closeTab: (tabId: string) => void;
  selectTab: (tabId: string) => void;
  updateActiveTabPath: (paneId: string, path: string, title?: string) => void;
  splitPane: (paneId: string, orientation: SplitOrientation) => void;
  closePane: (paneId: string) => void;
  restorePane: () => void;
  setActivePane: (paneId: string) => void;
}

export const useMultiPanelStore = create<MultiPanelStore>((set, get) => ({
  tabs: [],
  activeTabId: "",
  closedPanes: [],
  activePaneId: "",
  nextPaneIndex: 1,
  nextTabIndex: 1,

  initialize: (path, title = "Home") => {
    const state = get();
    if (state.tabs.length > 0) return;
    const paneId = "explorer-pane-0";
    const tab = createTab("explorer-tab-0", paneId, path, title);
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
    const tabId = `explorer-tab-${state.nextTabIndex}`;
    const paneId = `explorer-pane-${state.nextPaneIndex}`;
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

  closeTab: (tabId) => {
    set((state) => {
      if (state.tabs.length <= 1) return state;
      const closedIndex = state.tabs.findIndex((tab) => tab.id === tabId);
      if (closedIndex === -1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== tabId);
      const activeTab =
        state.activeTabId === tabId
          ? tabs[Math.max(0, closedIndex - 1)] ?? tabs[0]
          : tabs.find((tab) => tab.id === state.activeTabId) ?? tabs[0];
      return {
        tabs,
        activeTabId: activeTab.id,
        activePaneId: activeTab.activePaneId,
      };
    });
  },

  selectTab: (tabId) => {
    set((state) => {
      const tab = state.tabs.find((candidate) => candidate.id === tabId);
      if (!tab) return state;
      return {
        activeTabId: tab.id,
        activePaneId: tab.activePaneId,
      };
    });
  },

  updateActiveTabPath: (paneId, path, title) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        const pane = tab.panes.find((candidate) => candidate.id === paneId);
        if (!pane) return tab;
        const nextTitle = title ?? titleFromPath(path);
        return {
          ...tab,
          title: tab.activePaneId === paneId ? nextTitle : tab.title,
          path: tab.activePaneId === paneId ? path : tab.path,
          panes: tab.panes.map((candidate) =>
            candidate.id === paneId ? { ...candidate, path, title: nextTitle } : candidate,
          ),
        };
      }),
    }));
  },

  splitPane: (paneId, orientation) => {
    const state = get();
    const activeTab = activeMultiPanelTab(state);
    if (!activeTab || activeTab.panes.length >= maxPanesPerTab) return;
    const source = activeTab.panes.find((pane) => pane.id === paneId);
    if (!source) return;
    const newPaneId = `explorer-pane-${state.nextPaneIndex}`;
    const newPane = createPane(newPaneId, source.path, source.title);
    set((current) => ({
      tabs: current.tabs.map((tab) =>
        tab.id === activeTab.id
          ? {
              ...tab,
              activePaneId: newPaneId,
              layout: {
                orientation,
                paneIds: insertAfter(tab.layout.paneIds, paneId, newPaneId),
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
      const paneIds = activeTab.layout.paneIds.filter((id) => id !== paneId);
      const activePaneId = activeTab.activePaneId === paneId ? paneIds[0] : activeTab.activePaneId;
      const activePane = panes.find((candidate) => candidate.id === activePaneId);
      return {
        tabs: state.tabs.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                panes,
                activePaneId,
                title: activePane?.title ?? tab.title,
                path: activePane?.path ?? tab.path,
                layout: { ...tab.layout, paneIds },
              }
            : tab,
        ),
        closedPanes: [pane, ...state.closedPanes].slice(0, 4),
        activePaneId,
      };
    });
  },

  restorePane: () => {
    set((state) => {
      const activeTab = activeMultiPanelTab(state);
      const [pane, ...closedPanes] = state.closedPanes;
      if (!activeTab || !pane || activeTab.panes.length >= maxPanesPerTab) return state;
      return {
        tabs: state.tabs.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                title: pane.title,
                path: pane.path,
                panes: [...tab.panes, pane],
                activePaneId: pane.id,
                layout: { ...tab.layout, paneIds: [...tab.layout.paneIds, pane.id] },
              }
            : tab,
        ),
        closedPanes,
        activePaneId: pane.id,
      };
    });
  },

  setActivePane: (paneId) => {
    set((state) => {
      const activeTab = activeMultiPanelTab(state);
      if (!activeTab || !activeTab.panes.some((pane) => pane.id === paneId)) return state;
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
}));

export function activeMultiPanelTab(state: { tabs: MultiPanelTab[]; activeTabId: string }): MultiPanelTab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? null;
}

export function maxMultiPanelPanes(): number {
  return maxPanesPerTab;
}

function createTab(id: string, paneId: string, path: string, title: string): MultiPanelTab {
  return {
    id,
    title,
    path,
    panes: [createPane(paneId, path, title)],
    activePaneId: paneId,
    layout: { orientation: "vertical", paneIds: [paneId] },
  };
}

function createPane(id: string, path: string, title: string): MultiPanelPane {
  return { id, path, title };
}

function insertAfter(values: string[], after: string, value: string): string[] {
  const index = values.indexOf(after);
  if (index === -1) return [...values, value];
  return [...values.slice(0, index + 1), value, ...values.slice(index + 1)];
}

function insertPaneAfter(panes: MultiPanelPane[], after: string, pane: MultiPanelPane): MultiPanelPane[] {
  const index = panes.findIndex((candidate) => candidate.id === after);
  if (index === -1) return [...panes, pane];
  return [...panes.slice(0, index + 1), pane, ...panes.slice(index + 1)];
}

function titleFromPath(path: string): string {
  const clean = path.replace(/\/+$/, "");
  return clean.split("/").filter(Boolean).pop() || clean || "Home";
}
