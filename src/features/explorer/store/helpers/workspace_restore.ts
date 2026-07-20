import { create } from "zustand";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { hasTauriInternals } from "@/shared/tauri";
import { isAndroidBuild, isNativeMobileBuild } from "@/platform/buildTarget";
import { useAppStore } from "@/stores/useAppStore";
import {
  clipboardNativeFileRefs,
  explorerCalculateDirectorySizes,
  explorerDirectorySizeSnapshot,
  clipboardSetLocal,
  clipboardSnapshot,
  clipboardWriteFileRefs,
  explorerListDirectory,
  explorerLibraryRecordLastOpened,
  explorerLibraryRecordRecent,
  explorerLibrarySnapshot,
  explorerOpenAssociation,
  explorerOpenPath,
  explorerSetOpenAssociation,
  explorerOpenWith,
  explorerPathExists,
  explorerPathIsDirectory,
  explorerPrepareDragItems,
  explorerPrepareOpenItem,
  explorerQueuePasteBlob,
  explorerQueueCreateItem,
  explorerQueueDeleteItems,
  explorerQueuePasteItems,
  explorerQueuePasteText,
  explorerQueueRenameItem,
  explorerQueueRenameItems,
  transfersSnapshot,
  workspacesSave,
  workspacesSnapshot,
} from "@/services/misty-api/misty";
import type {
  ClipboardOperation,
  ClipboardPayload,
  CreateItemKind,
  DirectorySizeRecord,
  DirectoryListing,
  ExplorerLibraryItem,
  ExplorerLibrarySnapshot,
  FileEntry,
  NativeWorkspace,
  NativeWorkspaceDocument,
  NativeWorkspaceExplorerSnapshot,
  PasteItem,
  PreparedOpenItem,
  TransferRecord,
} from "@/services/misty-api/types";
import { errorText, userFacingErrorText } from "@/shared/format";
import { useMultiPanelStore } from "@/shared/multipanel/useMultiPanelStore";
import type {
  MultiPanelClosedPane,
  MultiPanelPane,
  MultiPanelTab,
} from "@/shared/multipanel/types";
import {
  selectAdvancedPreferences,
  selectGeneralPreferences,
  selectNotificationPreferences,
  useSettingsStore,
} from "@/stores/useSettingsStore";
import { useOperationQueueStore } from "@/stores/useOperationQueueStore";
import { useTransfersStore } from "@/stores/useTransfersStore";
import { clipboardImagePng } from "../../utils/clipboardImage";
import { publishCloudFolderBotNotification } from "@/bots/cloudFolderBot";

import type * as T from "../types";
import type {
  ExplorerStore,
  ExplorerViewMode,
  PaneExplorerState,
  ExplorerBatchRenameItem,
  ExplorerDialogState,
  ExplorerInlineEditState,
  ExplorerNotificationType,
  ExplorerSortState,
} from "../types";
import { explorerRuntime, getExplorerStore } from "../runtime";
import * as H from "./index";

export function restoreNativeWorkspace(
  document: NativeWorkspaceDocument,
  homePath: string,
): {
  workspace: NativeWorkspace;
  panes: Record<string, PaneExplorerState>;
  multiPanel: {
    tabs: MultiPanelTab[];
    activeTabId: string;
    activePaneId: string;
    closedPanes: MultiPanelClosedPane[];
    nextPaneIndex: number;
    nextTabIndex: number;
  };
  showHidden: boolean;
  paneShowHidden: Record<string, boolean>;
  viewMode: ExplorerViewMode;
  paneViewModes: Record<string, ExplorerViewMode>;
  sort: ExplorerSortState;
  paneSorts: Record<string, ExplorerSortState>;
} | null {
  const workspace =
    document.workspaces.find((candidate) => candidate.id === document.active_workspace_id) ??
    document.workspaces[0];
  if (!workspace) return null;
  const nativeTabs =
    workspace.tabs.length > 0
      ? workspace.tabs
      : [
          {
            idx: 0,
            title: workspace.title || "Home",
            sidebar_visible: workspace.sidebar_visible,
            inspector_visible: workspace.inspector_visible,
            explorer: workspace.explorer,
          },
        ];
  const panes: Record<string, PaneExplorerState> = {};
  const paneSorts: Record<string, ExplorerSortState> = {};
  const paneShowHidden: Record<string, boolean> = {};
  const paneViewModes: Record<string, ExplorerViewMode> = {};
  let showHidden = false;
  let viewMode: ExplorerViewMode = "list";
  let sort: ExplorerSortState = { column: "name", direction: "asc" };
  const tabs = nativeTabs.map((nativeTab, tabPosition): MultiPanelTab => {
    const explorer = nativeTab.explorer;
    const paneSnapshots =
      explorer.panes.length > 0
        ? explorer.panes
        : [
            {
              pane_id: `explorer-pane-${tabPosition}`,
              tabs: [],
              closed_tabs: [],
              active_tab_idx: -1,
            },
          ];
    const restoredPanes = paneSnapshots.map((paneSnapshot, panePosition): MultiPanelPane => {
      const tabSnapshot =
        paneSnapshot.tabs.find((tab) => tab.idx === paneSnapshot.active_tab_idx) ??
        paneSnapshot.tabs[0];
      const restored = H.parsePaneRestoreState(tabSnapshot?.restore_state, homePath);
      const paneId = paneSnapshot.pane_id || `explorer-pane-${tabPosition}-${panePosition}`;
      panes[paneId] = {
        ...H.emptyPaneState(),
        listing: H.placeholderListing(restored.path),
        backHistory: restored.backHistory,
        forwardHistory: restored.forwardHistory,
        needsLoad: true,
      };
      if (tabPosition === 0 && panePosition === 0) {
        showHidden = restored.showHidden;
        viewMode = restored.gridView ? "grid" : "list";
        sort = restored.sort;
      }
      paneSorts[paneId] = restored.sort;
      paneShowHidden[paneId] = restored.showHidden;
      paneViewModes[paneId] = restored.gridView ? "grid" : "list";
      return {
        id: paneId,
        path: restored.path,
        title: tabSnapshot?.title || H.titleFromPath(restored.path),
      };
    });
    const lanes = H.normalizeWorkspaceLanes(
      explorer.grid_pane_ids,
      restoredPanes.map((pane) => pane.id),
    );
    const activePaneId = restoredPanes.some((pane) => pane.id === explorer.active_pane_id)
      ? explorer.active_pane_id
      : restoredPanes[0].id;
    const activePane = restoredPanes.find((pane) => pane.id === activePaneId) ?? restoredPanes[0];
    return {
      id: `explorer-tab-${nativeTab.idx >= 0 ? nativeTab.idx : tabPosition}`,
      title: nativeTab.title || activePane.title,
      path: activePane.path,
      panes: restoredPanes,
      activePaneId,
      sidebarVisible: nativeTab.sidebar_visible ?? workspace.sidebar_visible,
      previewVisible: nativeTab.inspector_visible ?? workspace.inspector_visible,
      layout: {
        orientation: lanes.length > 1 ? "vertical" : "horizontal",
        lanes,
        paneIds: H.flattenWorkspaceLanes(lanes),
        gridSplitRatio: H.clampRatio(explorer.grid_split_ratio),
        laneSplitRatios: [
          H.clampRatio(explorer.lane_split_ratios[0] ?? 0.5),
          H.clampRatio(explorer.lane_split_ratios[1] ?? 0.5),
        ],
      },
    };
  });
  const activeTabId = `explorer-tab-${workspace.active_tab_idx >= 0 ? workspace.active_tab_idx : nativeTabs[0].idx}`;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const closedPanes = nativeTabs
    .flatMap((tab, tabPosition) =>
      tab.explorer.closed_panes.map((snapshot) => ({
        snapshot,
        tabId: `explorer-tab-${tab.idx >= 0 ? tab.idx : tabPosition}`,
      })),
    )
    .map(({ snapshot, tabId }, index): MultiPanelClosedPane => {
      const tabSnapshot =
        snapshot.tabs.find((tab) => tab.idx === snapshot.active_tab_idx) ?? snapshot.tabs[0];
      const restored = H.parsePaneRestoreState(tabSnapshot?.restore_state, homePath);
      const paneId = snapshot.pane_id || `closed-pane-${index}`;
      if (!panes[paneId]) {
        panes[paneId] = {
          ...H.emptyPaneState(),
          listing: H.placeholderListing(restored.path),
          backHistory: restored.backHistory,
          forwardHistory: restored.forwardHistory,
          needsLoad: true,
        };
      }
      paneSorts[paneId] = restored.sort;
      paneShowHidden[paneId] = restored.showHidden;
      paneViewModes[paneId] = restored.gridView ? "grid" : "list";
      return {
        pane: {
          id: paneId,
          path: restored.path,
          title: tabSnapshot?.title || H.titleFromPath(restored.path),
        },
        tabId,
        restoreMode: snapshot.restore_mode === "new_lane" ? "new_lane" : "same_lane",
        laneIndex: snapshot.lane_index,
        rowIndex: snapshot.row_index,
      };
    });
  return {
    workspace,
    panes,
    multiPanel: {
      tabs,
      activeTabId: activeTab.id,
      activePaneId: activeTab.activePaneId,
      closedPanes,
      nextPaneIndex: Math.max(...nativeTabs.map((tab) => tab.explorer.next_pane_idx), 1),
      nextTabIndex: Math.max(workspace.next_tab_idx, ...nativeTabs.map((tab) => tab.idx + 1), 1),
    },
    showHidden,
    paneShowHidden,
    viewMode,
    paneViewModes,
    sort,
    paneSorts,
  };
}

export function nativeExplorerSnapshot(
  tab: MultiPanelTab,
  paneStates: Record<string, PaneExplorerState>,
  closedPanes: MultiPanelClosedPane[],
  nextPaneIndex: number,
): NativeWorkspaceExplorerSnapshot {
  const explorerState = getExplorerStore().getState();
  const panes = tab.panes.map((pane, index) => {
    const state = paneStates[pane.id] ?? H.emptyPaneState();
    const paneSort = H.sortForPane(explorerState, pane.id);
    return {
      pane_id: pane.id,
      tabs: [
        {
          context_key: "FileExplorer",
          state_key: pane.id,
          title: pane.title,
          restore_state: JSON.stringify({
            current_path: state.listing?.path ?? pane.path,
            show_hidden: H.showHiddenForPane(explorerState, pane.id),
            grid_view: H.viewModeForPane(explorerState, pane.id) === "grid",
            sort_column: paneSort.column,
            sort_direction: paneSort.direction,
            back_history: state.backHistory,
            forward_history: state.forwardHistory,
          }),
          idx: index,
        },
      ],
      closed_tabs: [],
      active_tab_idx: index,
    };
  });
  const closed = closedPanes
    .filter((closedPane) => closedPane.tabId === tab.id)
    .map((closedPane, index) => {
      const state = paneStates[closedPane.pane.id] ?? H.emptyPaneState();
      const paneSort = H.sortForPane(explorerState, closedPane.pane.id);
      return {
        pane_id: closedPane.pane.id,
        tabs: [
          {
            context_key: "FileExplorer",
            state_key: closedPane.pane.id,
            title: closedPane.pane.title,
            restore_state: JSON.stringify({
              current_path: closedPane.pane.path,
              show_hidden: H.showHiddenForPane(explorerState, closedPane.pane.id),
              grid_view: H.viewModeForPane(explorerState, closedPane.pane.id) === "grid",
              sort_column: paneSort.column,
              sort_direction: paneSort.direction,
              back_history: state.backHistory,
              forward_history: state.forwardHistory,
            }),
            idx: index,
          },
        ],
        closed_tabs: [],
        active_tab_idx: index,
        restore_mode: closedPane.restoreMode,
        lane_index: closedPane.laneIndex,
        row_index: closedPane.rowIndex,
      };
    });
  return {
    active_pane_id: tab.activePaneId,
    next_tab_idx: 1,
    next_pane_idx: nextPaneIndex,
    grid_pane_ids: H.workspaceLanesForTab(tab),
    grid_split_ratio: H.clampRatio(tab.layout.gridSplitRatio ?? 0.5),
    lane_split_ratios: [
      H.clampRatio(tab.layout.laneSplitRatios?.[0] ?? 0.5),
      H.clampRatio(tab.layout.laneSplitRatios?.[1] ?? 0.5),
    ],
    panes,
    closed_panes: closed,
  };
}

export function workspaceLanesForTab(tab: MultiPanelTab): string[][] {
  const paneIds = new Set(tab.panes.map((pane) => pane.id));
  return H.normalizeWorkspaceLanes(
    tab.layout.lanes ?? H.lanesFromFlatWorkspaceLayout(tab),
    tab.panes.map((pane) => pane.id),
  ).map((lane) => lane.filter((paneId) => paneIds.has(paneId)));
}

export function lanesFromFlatWorkspaceLayout(tab: MultiPanelTab): string[][] {
  const ids = tab.layout.paneIds.slice(0, 4);
  if (ids.length <= 1) return ids.length ? [[ids[0]]] : [];
  if (tab.layout.orientation === "horizontal") return [ids.slice(0, 2)];
  if (ids.length === 2) return [[ids[0]], [ids[1]]];
  return [ids.slice(0, 2), ids.slice(2, 4)];
}

export function normalizeWorkspaceLanes(
  sourceLanes: string[][],
  fallbackPaneIds: string[],
): string[][] {
  const validPaneIds = new Set(fallbackPaneIds);
  const seen = new Set<string>();
  const lanes: string[][] = [];
  for (const sourceLane of sourceLanes) {
    const lane: string[] = [];
    for (const paneId of sourceLane) {
      if (!validPaneIds.has(paneId) || seen.has(paneId) || lane.length >= 2) continue;
      seen.add(paneId);
      lane.push(paneId);
    }
    if (lane.length > 0) lanes.push(lane);
    if (lanes.length >= 2) break;
  }
  for (const paneId of fallbackPaneIds) {
    if (seen.has(paneId)) continue;
    const targetLane = lanes.find((lane) => lane.length < 2);
    if (targetLane) targetLane.push(paneId);
    else if (lanes.length < 2) lanes.push([paneId]);
    seen.add(paneId);
  }
  return lanes.length > 0 ? lanes : [[]];
}

export function flattenWorkspaceLanes(lanes: string[][]): string[] {
  return lanes.flat().slice(0, 4);
}

export function parsePaneRestoreState(
  value: string | undefined,
  fallbackPath: string,
): {
  path: string;
  showHidden: boolean;
  gridView: boolean;
  sort: ExplorerSortState;
  backHistory: string[];
  forwardHistory: string[];
} {
  try {
    const parsed = JSON.parse(value || "{}") as Record<string, unknown>;
    const restoredPath =
      typeof parsed.current_path === "string" && parsed.current_path
        ? parsed.current_path
        : fallbackPath;
    return {
      path: isAndroidBuild && !restoredPath.startsWith("misty://") ? fallbackPath : restoredPath,
      showHidden: parsed.show_hidden === true,
      gridView: parsed.grid_view === true,
      sort: H.parseSortState(parsed.sort_column, parsed.sort_direction),
      backHistory: H.stringArray(parsed.back_history),
      forwardHistory: H.stringArray(parsed.forward_history),
    };
  } catch {
    return {
      path: fallbackPath,
      showHidden: false,
      gridView: false,
      sort: { column: "name", direction: "asc" },
      backHistory: [],
      forwardHistory: [],
    };
  }
}

export function placeholderListing(path: string): DirectoryListing {
  return {
    path,
    parentPath: null,
    location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
    entries: [],
    totalCount: 0,
    hiddenCount: 0,
  };
}
