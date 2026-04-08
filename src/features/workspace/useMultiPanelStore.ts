import type { MultiPanelStoreHook } from "@/models/types/workspace/useMultiPanelStore";
export type { MultiPanelStoreHook } from "@/models/types/workspace/useMultiPanelStore";
import type { MultiPanelStoreOptions, MultiPanelStore } from "@/models/interfaces/workspace";
export type { MultiPanelStoreOptions, MultiPanelStore } from "@/models/interfaces/workspace";
import { create } from "zustand";
import type { SplitOrientation } from "@/models/types/workspace/types";
import type {
  MultiPanelClosedPane,
  MultiPanelLayout,
  MultiPanelPane,
  MultiPanelTab,
} from "@/models/interfaces/workspace";

const maxPanesPerTab = 4;

export function createMultiPanelStore(options: MultiPanelStoreOptions = {}) {
  const idPrefix = normalizedIdPrefix(options.idPrefix ?? "explorer");
  const defaultTitle = options.defaultTitle ?? "Home";
  const tabIdFor = (index: number) => `${idPrefix}-tab-${index}`;
  const paneIdFor = (index: number) => `${idPrefix}-pane-${index}`;

  return create<MultiPanelStore>((set, get) => ({
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
      set((state) => {
        let changed = false;
        const tabs = state.tabs.map((tab) => {
          const pane = tab.panes.find((candidate) => candidate.id === paneId);
          if (!pane) return tab;
          const nextTitle = title ?? titleFromPath(path);
          const nextTabTitle = tab.activePaneId === paneId ? nextTitle : tab.title;
          const nextTabPath = tab.activePaneId === paneId ? path : tab.path;
          if (
            pane.path === path &&
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
              candidate.id === paneId ? { ...candidate, path, title: nextTitle } : candidate,
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
}

export const useMultiPanelStore = createMultiPanelStore({
  idPrefix: "explorer",
  defaultTitle: "Home",
});

export function activeMultiPanelTab(state: {
  tabs: MultiPanelTab[];
  activeTabId: string;
}): MultiPanelTab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? null;
}

export function maxMultiPanelPanes(): number {
  return maxPanesPerTab;
}

function normalizedIdPrefix(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "multipanel"
  );
}

function createTab(id: string, paneId: string, path: string, title: string): MultiPanelTab {
  return {
    id,
    title,
    path,
    panes: [createPane(paneId, path, title)],
    activePaneId: paneId,
    layout: defaultLayout("vertical", [paneId]),
    mode: "browse",
    sidebarVisible: true,
    previewVisible: true,
  };
}

function createPane(id: string, path: string, title: string): MultiPanelPane {
  return { id, path, title };
}

function normalizeSnapshot(snapshot: {
  tabs: MultiPanelTab[];
  activeTabId: string;
  activePaneId: string;
  closedPanes?: Array<MultiPanelClosedPane | MultiPanelPane>;
  nextPaneIndex: number;
  nextTabIndex: number;
}): {
  tabs: MultiPanelTab[];
  activeTabId: string;
  activePaneId: string;
  closedPanes: MultiPanelClosedPane[];
  nextPaneIndex: number;
  nextTabIndex: number;
} {
  const tabs = snapshot.tabs.map(normalizeTab).filter((tab): tab is MultiPanelTab => Boolean(tab));
  const fallback = tabs[0];
  if (!fallback) {
    return {
      tabs: [],
      activeTabId: "",
      activePaneId: "",
      closedPanes: [],
      nextPaneIndex: Math.max(1, snapshot.nextPaneIndex),
      nextTabIndex: Math.max(1, snapshot.nextTabIndex),
    };
  }
  const activeTab = tabs.find((tab) => tab.id === snapshot.activeTabId) ?? fallback;
  return {
    tabs,
    activeTabId: activeTab.id,
    activePaneId: activeTab.activePaneId,
    closedPanes: normalizeClosedPanes(snapshot.closedPanes ?? [], activeTab.id),
    nextPaneIndex: Math.max(1, snapshot.nextPaneIndex),
    nextTabIndex: Math.max(1, snapshot.nextTabIndex),
  };
}

function normalizeTab(tab: MultiPanelTab): MultiPanelTab | null {
  let panes = tab.panes.filter(validPane).slice(0, maxPanesPerTab);
  if (panes.length === 0) return null;
  if (panes.length > 1) {
    const preferredPane = panes.find((pane) => pane.id === tab.activePaneId) ?? panes[0];
    panes = [preferredPane];
  }

  const paneIdSet = new Set(panes.map((pane) => pane.id));
  const lanes = normalizedLanes(tab.layout, panes);
  const orderedPaneIds = flattenLanes(lanes);
  const activePaneId = paneIdSet.has(tab.activePaneId) ? tab.activePaneId : orderedPaneIds[0];
  const activePane = panes.find((pane) => pane.id === activePaneId) ?? panes[0];
  const orientation: SplitOrientation = lanes.length > 1 ? "vertical" : "horizontal";
  return {
    ...tab,
    mode: "browse",
    title: tab.title || activePane.title,
    path: tab.path || activePane.path,
    panes,
    activePaneId,
    sidebarVisible: tab.sidebarVisible ?? true,
    previewVisible: tab.previewVisible ?? true,
    layout: {
      orientation,
      lanes,
      paneIds: orderedPaneIds,
      gridSplitRatio: clampRatio(tab.layout.gridSplitRatio ?? 0.5),
      laneSplitRatios: normalizeLaneRatios(tab.layout.laneSplitRatios),
    },
  };
}

function defaultLayout(orientation: SplitOrientation, paneIds: string[]): MultiPanelLayout {
  const lanes =
    orientation === "horizontal"
      ? [paneIds.slice(0, 2)]
      : paneIds.slice(0, 2).map((paneId) => [paneId]);
  return {
    orientation: lanes.length > 1 ? "vertical" : "horizontal",
    paneIds: flattenLanes(lanes),
    lanes,
    gridSplitRatio: 0.5,
    laneSplitRatios: [0.5, 0.5],
  };
}

function normalizedLanes(layout: MultiPanelLayout, panes: MultiPanelPane[]): string[][] {
  const paneIdSet = new Set(panes.map((pane) => pane.id));
  const seen = new Set<string>();
  const sourceLanes =
    layout.lanes && layout.lanes.length > 0 ? layout.lanes : lanesFromFlatLayout(layout);
  const lanes: string[][] = [];
  for (const lane of sourceLanes) {
    const ids: string[] = [];
    for (const paneId of lane) {
      if (!paneIdSet.has(paneId) || seen.has(paneId) || ids.length >= 2) continue;
      seen.add(paneId);
      ids.push(paneId);
    }
    if (ids.length > 0) lanes.push(ids);
    if (lanes.length >= 2) break;
  }
  for (const pane of panes) {
    if (seen.has(pane.id)) continue;
    const targetLane = lanes.find((lane) => lane.length < 2);
    if (targetLane) targetLane.push(pane.id);
    else if (lanes.length < 2) lanes.push([pane.id]);
    seen.add(pane.id);
  }
  return lanes.length > 0 ? lanes : [[panes[0].id]];
}

function lanesFromFlatLayout(layout: MultiPanelLayout): string[][] {
  const ids = layout.paneIds.slice(0, maxPanesPerTab);
  if (ids.length <= 1) return ids.length ? [[ids[0]]] : [];
  if (layout.orientation === "horizontal") return [ids.slice(0, 2)];
  if (ids.length === 2) return [[ids[0]], [ids[1]]];
  return [ids.slice(0, 2), ids.slice(2, 4)];
}

function flattenLanes(lanes: string[][]): string[] {
  return lanes.flat().slice(0, maxPanesPerTab);
}

function paneLocation(
  layout: MultiPanelLayout,
  panes: MultiPanelPane[],
  paneId: string,
): { laneIndex: number; rowIndex: number } {
  const lanes = normalizedLanes(layout, panes);
  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
    const rowIndex = lanes[laneIndex].indexOf(paneId);
    if (rowIndex >= 0) return { laneIndex, rowIndex };
  }
  return { laneIndex: 0, rowIndex: 0 };
}

function chooseActivePaneAfterRemoval(
  lanes: string[][],
  removed: { laneIndex: number; rowIndex: number },
): string {
  const lane = lanes[Math.min(Math.max(removed.laneIndex, 0), Math.max(0, lanes.length - 1))];
  if (lane?.length) return lane[Math.min(removed.rowIndex, lane.length - 1)];
  return lanes.find((candidate) => candidate.length > 0)?.[0] ?? "";
}

function lanesWithRestoredPane(
  layout: MultiPanelLayout,
  panes: MultiPanelPane[],
  closedPane: MultiPanelClosedPane,
): string[][] {
  const lanes = normalizedLanes(layout, panes).map((lane) => [...lane]);
  const { pane, restoreMode, laneIndex, rowIndex } = closedPane;
  let placed = false;
  if (restoreMode === "new_lane" && lanes.length < 2) {
    const insertionIndex = clampIndex(laneIndex, lanes.length);
    lanes.splice(insertionIndex, 0, [pane.id]);
    placed = true;
  }
  if (!placed && laneIndex >= 0 && laneIndex < lanes.length && lanes[laneIndex].length < 2) {
    const insertionIndex = clampIndex(rowIndex, lanes[laneIndex].length);
    lanes[laneIndex].splice(insertionIndex, 0, pane.id);
    placed = true;
  }
  if (!placed && lanes.length < 2) {
    lanes.push([pane.id]);
    placed = true;
  }
  if (!placed) {
    const targetLane = lanes.find((lane) => lane.length < 2);
    if (targetLane) targetLane.push(pane.id);
  }
  return lanes;
}

function panesInLaneOrder(panes: MultiPanelPane[], lanes: string[][]): MultiPanelPane[] {
  const byId = new Map(panes.map((pane) => [pane.id, pane]));
  return flattenLanes(lanes).flatMap((paneId) => {
    const pane = byId.get(paneId);
    return pane ? [pane] : [];
  });
}

function normalizeClosedPanes(
  values: Array<MultiPanelClosedPane | MultiPanelPane>,
  fallbackTabId: string,
): MultiPanelClosedPane[] {
  const normalized: MultiPanelClosedPane[] = [];
  for (const value of values) {
    if (isClosedPane(value)) {
      if (!validPane(value.pane)) continue;
      normalized.push({
        pane: value.pane,
        tabId: value.tabId || fallbackTabId,
        restoreMode: value.restoreMode === "new_lane" ? "new_lane" : "same_lane",
        laneIndex: validIndex(value.laneIndex),
        rowIndex: validIndex(value.rowIndex),
      });
    } else if (validPane(value)) {
      normalized.push({
        pane: value,
        tabId: fallbackTabId,
        restoreMode: "same_lane",
        laneIndex: -1,
        rowIndex: -1,
      });
    }
  }
  return capClosedPanesPerTab(normalized);
}

function capClosedPanesPerTab(values: MultiPanelClosedPane[]): MultiPanelClosedPane[] {
  const counts = new Map<string, number>();
  return values.filter((value) => {
    const count = counts.get(value.tabId) ?? 0;
    if (count >= maxPanesPerTab) return false;
    counts.set(value.tabId, count + 1);
    return true;
  });
}

function isClosedPane(value: MultiPanelClosedPane | MultiPanelPane): value is MultiPanelClosedPane {
  return "pane" in value;
}

function validIndex(value: number): number {
  return Number.isInteger(value) ? value : -1;
}

function clampIndex(value: number, length: number): number {
  if (!Number.isInteger(value)) return length;
  return Math.min(Math.max(value, 0), length);
}

function laneRatiosWith(
  value: MultiPanelLayout["laneSplitRatios"],
  laneIndex: number,
  ratio: number,
): [number, number] {
  const ratios = normalizeLaneRatios(value);
  if (laneIndex === 0 || laneIndex === 1) ratios[laneIndex] = clampRatio(ratio);
  return ratios;
}

function normalizeLaneRatios(value: MultiPanelLayout["laneSplitRatios"]): [number, number] {
  return [clampRatio(value?.[0] ?? 0.5), clampRatio(value?.[1] ?? 0.5)];
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.9, Math.max(0.1, value));
}

function layoutEqual(left: MultiPanelLayout, right: MultiPanelLayout): boolean {
  const leftLanes = left.lanes ?? lanesFromFlatLayout(left);
  const rightLanes = right.lanes ?? lanesFromFlatLayout(right);
  return (
    left.orientation === right.orientation &&
    left.paneIds.length === right.paneIds.length &&
    left.paneIds.every((paneId, index) => paneId === right.paneIds[index]) &&
    lanesEqual(leftLanes, rightLanes) &&
    clampRatio(left.gridSplitRatio ?? 0.5) === clampRatio(right.gridSplitRatio ?? 0.5) &&
    normalizeLaneRatios(left.laneSplitRatios)[0] ===
      normalizeLaneRatios(right.laneSplitRatios)[0] &&
    normalizeLaneRatios(left.laneSplitRatios)[1] === normalizeLaneRatios(right.laneSplitRatios)[1]
  );
}

function lanesEqual(left: string[][], right: string[][]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (lane, laneIndex) =>
        lane.length === right[laneIndex]?.length &&
        lane.every((paneId, rowIndex) => paneId === right[laneIndex][rowIndex]),
    )
  );
}

function validPane(pane: MultiPanelPane): boolean {
  return Boolean(pane.id && pane.path);
}

function insertAfter(values: string[], after: string, value: string): string[] {
  const index = values.indexOf(after);
  if (index === -1) return [...values, value];
  return [...values.slice(0, index + 1), value, ...values.slice(index + 1)];
}

function insertPaneAfter(
  panes: MultiPanelPane[],
  after: string,
  pane: MultiPanelPane,
): MultiPanelPane[] {
  const index = panes.findIndex((candidate) => candidate.id === after);
  if (index === -1) return [...panes, pane];
  return [...panes.slice(0, index + 1), pane, ...panes.slice(index + 1)];
}

function titleFromPath(path: string): string {
  if (path === "misty://recent") return "Recent";
  if (path === "misty://starred") return "Starred";
  if (path === "misty://trash") return "Trash";
  const clean = path.replace(/\/+$/, "");
  return clean.split("/").filter(Boolean).pop() || clean || "Home";
}
