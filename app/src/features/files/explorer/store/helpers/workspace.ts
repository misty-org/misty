import { useMultiPanelStore } from "@/features/workspace";
import { workspacesSave } from "@/features/files/native";
import type {
  NativeWorkspace,
  NativeWorkspaceDocument,
  NativeWorkspaceExplorerSnapshot,
} from "@/native/contracts";
import { errorText } from "@/shared/lib/format";

import type { ExplorerStore } from "../../model/interfaces/store/types";
import { explorerRuntime, getExplorerStore } from "../runtime";
import * as H from "./index";

export function explorerWorkspaceNeedsSave(state: ExplorerStore, previous: ExplorerStore): boolean {
  if (
    state.viewMode !== previous.viewMode ||
    state.paneViewModes !== previous.paneViewModes ||
    state.sort !== previous.sort ||
    state.paneSorts !== previous.paneSorts ||
    state.showHidden !== previous.showHidden ||
    state.paneShowHidden !== previous.paneShowHidden ||
    state.sidebarVisible !== previous.sidebarVisible ||
    state.previewVisible !== previous.previewVisible ||
    state.sidebarWidth !== previous.sidebarWidth ||
    state.previewWidth !== previous.previewWidth
  ) {
    return true;
  }
  if (state.panes === previous.panes) return false;

  const paneIds = new Set([...Object.keys(state.panes), ...Object.keys(previous.panes)]);
  for (const paneId of paneIds) {
    const currentPane = state.panes[paneId];
    const previousPane = previous.panes[paneId];
    if (!currentPane || !previousPane) return true;
    if (currentPane.listing?.path !== previousPane.listing?.path) return true;
    if (currentPane.backHistory !== previousPane.backHistory) return true;
    if (currentPane.forwardHistory !== previousPane.forwardHistory) return true;
  }
  return false;
}

export async function persistExplorerWorkspace(): Promise<void> {
  const explorer = getExplorerStore().getState();
  const multi = useMultiPanelStore.getState();
  if (!explorer.initialized || multi.tabs.length === 0) return;

  const document = explorerRuntime.workspaceDocumentCache ?? H.defaultWorkspaceDocument();
  const workspaceId = document.active_workspace_id || document.workspaces[0]?.id || "workspace_0";
  const existing = document.workspaces.find((workspace) => workspace.id === workspaceId);
  const tabs = multi.tabs.map((tab, index) => ({
    idx: H.tabIndex(tab.id, index),
    title: tab.title,
    sidebar_visible: tab.sidebarVisible ?? true,
    inspector_visible: tab.previewVisible ?? true,
    explorer: H.nativeExplorerSnapshot(tab, explorer.panes, multi.closedPanes, multi.nextPaneIndex),
  }));
  const activeTab = multi.tabs.find((tab) => tab.id === multi.activeTabId) ?? multi.tabs[0];
  const workspace: NativeWorkspace = {
    id: workspaceId,
    title: existing?.title || "File layout 1",
    sidebar_width: explorer.sidebarWidth,
    sidebar_visible: activeTab?.sidebarVisible ?? explorer.sidebarVisible,
    inspector_width: explorer.previewWidth,
    inspector_visible: activeTab?.previewVisible ?? explorer.previewVisible,
    active_tab_idx: H.tabIndex(activeTab.id, 0),
    next_tab_idx: multi.nextTabIndex,
    tabs,
    explorer:
      tabs.find((tab) => tab.idx === H.tabIndex(activeTab.id, 0))?.explorer ?? tabs[0].explorer,
  };
  const workspaces = document.workspaces.some((candidate) => candidate.id === workspaceId)
    ? document.workspaces.map((candidate) => (candidate.id === workspaceId ? workspace : candidate))
    : [...document.workspaces, workspace];
  const nextDocument: NativeWorkspaceDocument = {
    ...document,
    schema_version: 1,
    active_workspace_id: workspaceId,
    next_workspace_idx: Math.max(document.next_workspace_idx, H.workspaceIndex(workspaceId) + 1),
    workspaces,
  };
  try {
    const savedDocument = await H.saveWorkspaceDocument(nextDocument);
    getExplorerStore().setState(H.workspaceMetadata(savedDocument));
  } catch (error) {
    getExplorerStore().setState({ operationError: `Workspace save failed: ${errorText(error)}` });
  }
}

export async function applyWorkspaceDocument(
  document: NativeWorkspaceDocument,
  homePath: string,
): Promise<void> {
  explorerRuntime.workspaceDocumentCache = document;
  const restored = H.restoreNativeWorkspace(document, homePath);
  if (!restored) {
    getExplorerStore().setState(H.workspaceMetadata(document));
    return;
  }

  const multi = useMultiPanelStore.getState();
  if (!multi.hydrate(restored.multiPanel)) {
    multi.initialize(homePath, H.titleFromPath(homePath));
    getExplorerStore().setState({
      ...H.workspaceMetadata(document),
      initialized: true,
      inlineEdit: null,
      dialog: null,
      contextMenu: { open: false, x: 0, y: 0, paneId: "", entryId: null },
      operationError: "Workspace layout could not be restored, so Misty opened a clean file pane.",
    });
    await getExplorerStore()
      .getState()
      .loadPane(
        useMultiPanelStore.getState().activePaneId || "explorer-pane-0",
        homePath,
        "replace",
      );
    return;
  }
  const hydratedMulti = useMultiPanelStore.getState();
  getExplorerStore().setState({
    ...H.workspaceMetadata(document),
    panes: restored.panes,
    sidebarVisible: restored.workspace.sidebar_visible,
    previewVisible: restored.workspace.inspector_visible,
    sidebarWidth: H.clamp(restored.workspace.sidebar_width, 212, 380),
    previewWidth: H.clamp(restored.workspace.inspector_width, 240, 420),
    showHidden: restored.showHidden,
    paneShowHidden: restored.paneShowHidden,
    viewMode: restored.viewMode,
    paneViewModes: restored.paneViewModes,
    sort: restored.sort,
    paneSorts: restored.paneSorts,
    inlineEdit: null,
    dialog: null,
    contextMenu: { open: false, x: 0, y: 0, paneId: "", entryId: null },
    operationError: null,
    initialized: true,
  });

  const activeTab =
    hydratedMulti.tabs.find((tab) => tab.id === hydratedMulti.activeTabId) ?? hydratedMulti.tabs[0];
  await Promise.all(
    (activeTab?.panes ?? []).map((pane) => {
      const restoredPane = restored.panes[pane.id];
      return restoredPane?.listing && !H.isExplorerInternalTabPath(restoredPane.listing.path)
        ? getExplorerStore().getState().loadPane(pane.id, restoredPane.listing.path, "replace")
        : Promise.resolve();
    }),
  );
}

export function isExplorerInternalTabPath(path: string): boolean {
  return (
    path.startsWith("misty-transfers://") ||
    path.startsWith("misty-remotes://") ||
    path.startsWith("misty-plugin://")
  );
}

export async function saveWorkspaceDocument(
  document: NativeWorkspaceDocument,
): Promise<NativeWorkspaceDocument> {
  if (explorerRuntime.workspaceSaveTimer !== null) {
    window.clearTimeout(explorerRuntime.workspaceSaveTimer);
    explorerRuntime.workspaceSaveTimer = null;
  }
  const saved = await workspacesSave(document);
  explorerRuntime.workspaceDocumentCache = saved;
  return saved;
}

export function defaultWorkspaceDocument(): NativeWorkspaceDocument {
  return {
    schema_version: 1,
    active_workspace_id: "workspace_0",
    next_workspace_idx: 1,
    workspaces: [],
  };
}

export function consumeExplorerWorkspaceResetFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const shouldReset =
      window.localStorage.getItem(explorerRuntime.explorerWorkspaceResetKey) === "1";
    if (shouldReset) window.localStorage.removeItem(explorerRuntime.explorerWorkspaceResetKey);
    return shouldReset;
  } catch {
    return false;
  }
}

export function workspaceMetadata(
  document: NativeWorkspaceDocument,
): Pick<ExplorerStore, "workspaceEntries" | "activeWorkspaceId" | "activeWorkspaceTitle"> {
  const workspaceEntries = document.workspaces.map((workspace, index) => ({
    id: workspace.id || `workspace_${index}`,
    title: workspace.title || `File layout ${index + 1}`,
  }));
  const activeWorkspace =
    workspaceEntries.find((workspace) => workspace.id === document.active_workspace_id) ??
    workspaceEntries[0];
  return {
    workspaceEntries,
    activeWorkspaceId: activeWorkspace?.id ?? document.active_workspace_id,
    activeWorkspaceTitle: activeWorkspace?.title ?? "File layout 1",
  };
}

export function nextWorkspaceIndex(document: NativeWorkspaceDocument): number {
  const fromDocument = Number.isFinite(document.next_workspace_idx)
    ? document.next_workspace_idx
    : 0;
  const fromIds = document.workspaces
    .map((workspace) => H.workspaceIndex(workspace.id) + 1)
    .reduce((max, index) => Math.max(max, index), 0);
  return Math.max(0, fromDocument, fromIds);
}

export function uniqueWorkspaceTitle(title: string, workspaces: Array<{ title: string }>): string {
  const base = title.trim() || "File layout";
  const names = new Set(workspaces.map((workspace) => workspace.title.trim()).filter(Boolean));
  if (!names.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!names.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

export function defaultNativeWorkspace(
  workspaceId: string,
  title: string,
  homePath: string,
  explorer: ExplorerStore,
): NativeWorkspace {
  const paneId = `${workspaceId}-pane-0`;
  const restoreState = JSON.stringify({
    current_path: homePath,
    show_hidden: explorer.showHidden,
    grid_view: explorer.viewMode === "grid",
    sort_column: explorer.sort.column,
    sort_direction: explorer.sort.direction,
    back_history: [],
    forward_history: [],
  });
  const explorerSnapshot: NativeWorkspaceExplorerSnapshot = {
    active_pane_id: paneId,
    next_tab_idx: 1,
    next_pane_idx: 1,
    grid_pane_ids: [[paneId]],
    grid_split_ratio: 0.5,
    lane_split_ratios: [0.5, 0.5],
    panes: [
      {
        pane_id: paneId,
        tabs: [
          {
            context_key: "FileExplorer",
            state_key: paneId,
            title: H.titleFromPath(homePath),
            restore_state: restoreState,
            idx: 0,
          },
        ],
        closed_tabs: [],
        active_tab_idx: 0,
      },
    ],
    closed_panes: [],
  };
  return {
    id: workspaceId,
    title,
    sidebar_width: explorer.sidebarWidth,
    sidebar_visible: explorer.sidebarVisible,
    inspector_width: explorer.previewWidth,
    inspector_visible: explorer.previewVisible,
    active_tab_idx: 0,
    next_tab_idx: 1,
    tabs: [
      {
        idx: 0,
        title: H.titleFromPath(homePath),
        sidebar_visible: explorer.sidebarVisible,
        inspector_visible: explorer.previewVisible,
        explorer: explorerSnapshot,
      },
    ],
    explorer: explorerSnapshot,
  };
}
