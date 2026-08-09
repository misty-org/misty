import { explorerPathName, normalizeExplorerPath } from "@/shared/lib/pathNormalization";
import type {
  MultiPanelClosedPane,
  MultiPanelLayout,
  MultiPanelPane,
  MultiPanelTab,
} from "./model/interfaces";
const maxPanesPerTab = 4;
export function normalizedIdPrefix(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "multipanel"
  );
}

export function createTab(id: string, paneId: string, path: string, title: string): MultiPanelTab {
  const normalizedPath = normalizeExplorerPath(path);
  return {
    id,
    title,
    path: normalizedPath,
    panes: [createPane(paneId, normalizedPath, title)],
    activePaneId: paneId,
    layout: defaultLayout("vertical", [paneId]),
    mode: "browse",
    sidebarVisible: true,
    previewVisible: true,
  };
}

export function createPane(id: string, path: string, title: string): MultiPanelPane {
  return { id, path: normalizeExplorerPath(path), title };
}

export function normalizeSnapshot(snapshot: {
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

export function normalizeTab(tab: MultiPanelTab): MultiPanelTab | null {
  let panes = tab.panes
    .filter(validPane)
    .slice(0, maxPanesPerTab)
    .map((pane) => ({ ...pane, path: normalizeExplorerPath(pane.path) }));
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
    path: normalizeExplorerPath(tab.path || activePane.path),
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

export function defaultLayout(orientation: SplitOrientation, paneIds: string[]): MultiPanelLayout {
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

export function normalizedLanes(layout: MultiPanelLayout, panes: MultiPanelPane[]): string[][] {
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

export function lanesFromFlatLayout(layout: MultiPanelLayout): string[][] {
  const ids = layout.paneIds.slice(0, maxPanesPerTab);
  if (ids.length <= 1) return ids.length ? [[ids[0]]] : [];
  if (layout.orientation === "horizontal") return [ids.slice(0, 2)];
  if (ids.length === 2) return [[ids[0]], [ids[1]]];
  return [ids.slice(0, 2), ids.slice(2, 4)];
}

export function flattenLanes(lanes: string[][]): string[] {
  return lanes.flat().slice(0, maxPanesPerTab);
}

export function paneLocation(
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

export function chooseActivePaneAfterRemoval(
  lanes: string[][],
  removed: { laneIndex: number; rowIndex: number },
): string {
  const lane = lanes[Math.min(Math.max(removed.laneIndex, 0), Math.max(0, lanes.length - 1))];
  if (lane?.length) return lane[Math.min(removed.rowIndex, lane.length - 1)];
  return lanes.find((candidate) => candidate.length > 0)?.[0] ?? "";
}

export function lanesWithRestoredPane(
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

export function panesInLaneOrder(panes: MultiPanelPane[], lanes: string[][]): MultiPanelPane[] {
  const byId = new Map(panes.map((pane) => [pane.id, pane]));
  return flattenLanes(lanes).flatMap((paneId) => {
    const pane = byId.get(paneId);
    return pane ? [pane] : [];
  });
}

export function normalizeClosedPanes(
  values: Array<MultiPanelClosedPane | MultiPanelPane>,
  fallbackTabId: string,
): MultiPanelClosedPane[] {
  const normalized: MultiPanelClosedPane[] = [];
  for (const value of values) {
    if (isClosedPane(value)) {
      if (!validPane(value.pane)) continue;
      normalized.push({
        pane: { ...value.pane, path: normalizeExplorerPath(value.pane.path) },
        tabId: value.tabId || fallbackTabId,
        restoreMode: value.restoreMode === "new_lane" ? "new_lane" : "same_lane",
        laneIndex: validIndex(value.laneIndex),
        rowIndex: validIndex(value.rowIndex),
      });
    } else if (validPane(value)) {
      normalized.push({
        pane: { ...value, path: normalizeExplorerPath(value.path) },
        tabId: fallbackTabId,
        restoreMode: "same_lane",
        laneIndex: -1,
        rowIndex: -1,
      });
    }
  }
  return capClosedPanesPerTab(normalized);
}

export function capClosedPanesPerTab(values: MultiPanelClosedPane[]): MultiPanelClosedPane[] {
  const counts = new Map<string, number>();
  return values.filter((value) => {
    const count = counts.get(value.tabId) ?? 0;
    if (count >= maxPanesPerTab) return false;
    counts.set(value.tabId, count + 1);
    return true;
  });
}

export function isClosedPane(
  value: MultiPanelClosedPane | MultiPanelPane,
): value is MultiPanelClosedPane {
  return "pane" in value;
}

export function validIndex(value: number): number {
  return Number.isInteger(value) ? value : -1;
}

export function clampIndex(value: number, length: number): number {
  if (!Number.isInteger(value)) return length;
  return Math.min(Math.max(value, 0), length);
}

export function laneRatiosWith(
  value: MultiPanelLayout["laneSplitRatios"],
  laneIndex: number,
  ratio: number,
): [number, number] {
  const ratios = normalizeLaneRatios(value);
  if (laneIndex === 0 || laneIndex === 1) ratios[laneIndex] = clampRatio(ratio);
  return ratios;
}

export function normalizeLaneRatios(value: MultiPanelLayout["laneSplitRatios"]): [number, number] {
  return [clampRatio(value?.[0] ?? 0.5), clampRatio(value?.[1] ?? 0.5)];
}

export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.9, Math.max(0.1, value));
}

export function layoutEqual(left: MultiPanelLayout, right: MultiPanelLayout): boolean {
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

export function lanesEqual(left: string[][], right: string[][]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (lane, laneIndex) =>
        lane.length === right[laneIndex]?.length &&
        lane.every((paneId, rowIndex) => paneId === right[laneIndex][rowIndex]),
    )
  );
}

export function validPane(pane: MultiPanelPane): boolean {
  return Boolean(pane.id && pane.path);
}

export function insertAfter(values: string[], after: string, value: string): string[] {
  const index = values.indexOf(after);
  if (index === -1) return [...values, value];
  return [...values.slice(0, index + 1), value, ...values.slice(index + 1)];
}

export function insertPaneAfter(
  panes: MultiPanelPane[],
  after: string,
  pane: MultiPanelPane,
): MultiPanelPane[] {
  const index = panes.findIndex((candidate) => candidate.id === after);
  if (index === -1) return [...panes, pane];
  return [...panes.slice(0, index + 1), pane, ...panes.slice(index + 1)];
}

export function titleFromPath(path: string): string {
  if (path === "misty://recent") return "Recent";
  if (path === "misty://starred") return "Starred";
  if (path === "misty://trash") return "Trash";
  return explorerPathName(path) || "Home";
}

export type SplitOrientation = "vertical" | "horizontal";

export type MultiPanelPaneRestoreMode = "same_lane" | "new_lane";
