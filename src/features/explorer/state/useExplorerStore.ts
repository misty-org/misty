import { create } from "zustand";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../../app/useAppStore";
import {
  clipboardNativeFileRefs,
  clipboardSetLocal,
  clipboardSnapshot,
  clipboardWriteFileRefs,
  explorerListDirectory,
  explorerLibraryRecordLastOpened,
  explorerLibraryRecordRecent,
  explorerLibrarySetTags,
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
} from "../../../api/misty";
import type {
  ClipboardOperation,
  ClipboardPayload,
  CreateItemKind,
  DirectoryListing,
  ExplorerLibraryItem,
  ExplorerLibrarySnapshot,
  FileEntry,
  NativeWorkspace,
  NativeWorkspaceDocument,
  NativeWorkspaceExplorerSnapshot,
  PasteItem,
  TransferRecord,
} from "../../../api/types";
import { errorText } from "../../../shared/format";
import { useMultiPanelStore } from "../../../shared/multipanel/useMultiPanelStore";
import type { MultiPanelClosedPane, MultiPanelPane, MultiPanelTab } from "../../../shared/multipanel/types";
import {
  selectAdvancedPreferences,
  selectGeneralPreferences,
  selectNotificationPreferences,
  useSettingsStore,
} from "../../settings/useSettingsStore";
import { clipboardImagePng } from "../utils/clipboardImage";

export type ExplorerViewMode = "list" | "grid";
export type ExplorerSortColumn = "name" | "modified" | "size" | "type";
export type ExplorerSortDirection = "asc" | "desc";
export type ExplorerUploadSourceKind = "files" | "folders";
export type ExplorerDeleteMode = "trash" | "permanent";

export interface ExplorerWorkspaceEntry {
  id: string;
  title: string;
}

export type ExplorerNotificationType = "info" | "success" | "error";

export interface ExplorerNotification {
  id: number;
  message: string;
  type: ExplorerNotificationType;
  createdAtMs: number;
  read: boolean;
  showInActivity: boolean;
}

export interface ExplorerSortState {
  column: ExplorerSortColumn;
  direction: ExplorerSortDirection;
}

interface PaneExplorerState {
  listing: DirectoryListing | null;
  commandQuery: string;
  selectedIds: string[];
  selectedIdsByPath: Record<string, string[]>;
  lastSelectedIndexByPath: Record<string, number>;
  backHistory: string[];
  forwardHistory: string[];
  loading: boolean;
  needsLoad: boolean;
  error: string | null;
}

type NavigationMode = "push" | "back" | "forward" | "replace";
interface LoadPaneOptions {
  forceRemoteRefresh?: boolean;
}

export interface ExplorerContextMenuState {
  open: boolean;
  x: number;
  y: number;
  paneId: string;
  entryId: string | null;
}

export interface ExplorerClipboardState {
  items: PasteItem[];
  operation: ClipboardOperation;
}

export interface ExplorerInlineEditState {
  paneId: string;
  kind: "create" | "rename";
  itemKind: CreateItemKind;
  entryId: string | null;
  originalName: string;
  value: string;
  lockedExtension: string;
  batchItems?: ExplorerBatchRenameItem[];
  error: string | null;
}

export interface ExplorerBatchRenameItem {
  paneId: string;
  entryId: string;
  path: string;
  directoryPath: string;
  originalName: string;
  value: string;
  lockedExtension: string;
  isDirectory: boolean;
  siblingNames: string[];
  error: string | null;
}

export type ExplorerDialogState =
  | { kind: "delete"; paneId: string; paths: string[]; permanent: boolean }
  | { kind: "batchRename"; paneId: string; items: ExplorerBatchRenameItem[] }
  | null;

interface ExplorerStore {
  panes: Record<string, PaneExplorerState>;
  viewMode: ExplorerViewMode;
  paneViewModes: Record<string, ExplorerViewMode>;
  sort: ExplorerSortState;
  paneSorts: Record<string, ExplorerSortState>;
  showHidden: boolean;
  paneShowHidden: Record<string, boolean>;
  operationError: string | null;
  notifications: ExplorerNotification[];
  notificationHistory: ExplorerNotification[];
  chatOverlayOpen: boolean;
  claudePanelOpen: boolean;
  claudePanelWidth: number;
  clipboard: ExplorerClipboardState | null;
  pinnedPaths: string[];
  contextMenu: ExplorerContextMenuState;
  inlineEdit: ExplorerInlineEditState | null;
  dialog: ExplorerDialogState;
  library: ExplorerLibrarySnapshot | null;
  workspaceEntries: ExplorerWorkspaceEntry[];
  activeWorkspaceId: string;
  activeWorkspaceTitle: string;
  initialized: boolean;
  sidebarVisible: boolean;
  previewVisible: boolean;
  sidebarWidth: number;
  previewWidth: number;
  loadLibrary: () => Promise<void>;
  recordLibraryRecent: (entry: FileEntry) => Promise<void>;
  recordLastOpenedPath: (path: string) => Promise<void>;
  setLibraryTags: (entry: FileEntry, tags: string[]) => Promise<void>;
  initialize: (homePath: string) => Promise<void>;
  selectWorkspace: (workspaceId: string, homePath: string) => Promise<void>;
  createWorkspace: (title: string, homePath: string) => Promise<void>;
  renameWorkspace: (workspaceId: string, title: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string, homePath: string) => Promise<void>;
  loadPane: (paneId: string, path: string, mode?: NavigationMode, options?: LoadPaneOptions) => Promise<void>;
  navigatePane: (paneId: string, path: string) => Promise<void>;
  navigateBack: (paneId: string) => Promise<void>;
  navigateForward: (paneId: string) => Promise<void>;
  navigateParent: (paneId: string) => Promise<void>;
  refreshPane: (paneId: string) => Promise<void>;
  setViewMode: (mode: ExplorerViewMode, paneId?: string) => void;
  setSort: (column: ExplorerSortColumn, paneId?: string) => void;
  setCommandQuery: (paneId: string, query: string) => void;
  toggleHidden: (paneId?: string) => Promise<void>;
  selectEntry: (paneId: string, entryId: string, options?: { toggle?: boolean; range?: boolean; visibleEntryIds?: string[] }) => void;
  clearSelection: (paneId: string) => void;
  openEntry: (paneId: string, entry: FileEntry) => Promise<void>;
  openWithSelected: (paneId: string) => Promise<void>;
  canCreateItem: (paneId: string, kind: CreateItemKind) => boolean;
  createItem: (paneId: string, kind: CreateItemKind, name?: string) => Promise<void>;
  renameSelected: (paneId: string, name?: string) => Promise<void>;
  deleteSelected: (paneId: string, mode?: ExplorerDeleteMode) => Promise<void>;
  downloadSelected: (paneId: string) => Promise<void>;
  copySelected: (paneId: string) => void;
  cutSelected: (paneId: string) => void;
  pasteIntoPane: (paneId: string) => Promise<void>;
  uploadIntoPane: (paneId: string, sourceKind?: ExplorerUploadSourceKind) => Promise<void>;
  dropItems: (paneId: string, items: PasteItem[], destination: string, operation: ClipboardOperation) => Promise<void>;
  dropExternalPaths: (paneId: string, paths: string[], destination: string) => Promise<void>;
  pollTransferRefreshes: (mountRoot: string) => Promise<void>;
  togglePinnedPath: (path: string) => void;
  copyPath: (path: string) => Promise<void>;
  openContextMenu: (paneId: string, x: number, y: number, entryId?: string | null) => void;
  closeContextMenu: () => void;
  setInlineEditValue: (value: string) => void;
  setBatchRenameValue: (paneId: string, entryId: string, value: string) => void;
  commitInlineEdit: () => Promise<void>;
  cancelInlineEdit: () => void;
  confirmDialog: () => Promise<void>;
  closeDialog: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setPreviewVisible: (visible: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setPreviewWidth: (width: number) => void;
  toggleChatOverlay: () => void;
  toggleClaudePanel: () => void;
  setClaudePanelOpen: (open: boolean) => void;
  setClaudePanelWidth: (width: number) => void;
  pushNotification: (message: string, type?: ExplorerNotificationType, durationMs?: number, showInActivity?: boolean) => number;
  dismissNotification: (id: number) => void;
  markNotificationsRead: () => void;
  clearNotificationHistory: () => void;
}

let workspaceDocumentCache: NativeWorkspaceDocument | null = null;
let workspaceSaveTimer: number | null = null;
let initializationInFlight = false;
const explorerWorkspaceResetKey = "misty.explorer.resetWorkspaceOnNextLoad.v1";
let transferRefreshObserverReady = false;
let transferRefreshWatermarkMs = 0;
let transferRefreshStatuses: Record<number, string> = {};
let nextExplorerNotificationId = 1;
const pendingPaneRefreshes = new Map<string, { firstTimer: number | null; followupTimer: number | null }>();
const paneLoadRequestsInFlight = new Map<string, Promise<void>>();

function emptyPaneState(): PaneExplorerState {
  return {
    listing: null,
    commandQuery: "",
    selectedIds: [],
    selectedIdsByPath: {},
    lastSelectedIndexByPath: {},
    backHistory: [],
    forwardHistory: [],
    loading: false,
    needsLoad: false,
    error: null,
  };
}

export const useExplorerStore = create<ExplorerStore>((set, get) => ({
  panes: {},
  viewMode: "list",
  paneViewModes: {},
  showHidden: false,
  paneShowHidden: {},
  operationError: null,
  notifications: [],
  notificationHistory: [],
  clipboard: null,
  pinnedPaths: loadPinnedPaths(),
  contextMenu: { open: false, x: 0, y: 0, paneId: "", entryId: null },
  inlineEdit: null,
  dialog: null,
  library: null,
  workspaceEntries: [],
  activeWorkspaceId: "",
  activeWorkspaceTitle: "Workspace 1",
  initialized: false,
  sidebarVisible: true,
  previewVisible: true,
  sidebarWidth: 260,
  previewWidth: 300,
  sort: { column: "name", direction: "asc" },
  paneSorts: {},
  chatOverlayOpen: false,
  claudePanelOpen: false,
  claudePanelWidth: 380,

  loadLibrary: async () => {
    try {
      set({ library: await explorerLibrarySnapshot() });
    } catch {
      // Library state is optional in browser/dev contexts and should not block Explorer startup.
    }
  },

  recordLibraryRecent: async (entry) => {
    try {
      set({ library: await explorerLibraryRecordRecent(libraryItemFromEntry(entry)) });
    } catch {
      // Best-effort parity with the native Recent library.
    }
  },

  recordLastOpenedPath: async (path) => {
    if (!path.trim()) return;
    if (get().library?.lastOpenedPath === path) return;
    try {
      set({ library: await explorerLibraryRecordLastOpened(path) });
    } catch {
      // Best-effort parity with the native last-opened path.
    }
  },

  setLibraryTags: async (entry, tags) => {
    try {
      set({ library: await explorerLibrarySetTags(libraryItemFromEntry(entry), tags) });
    } catch (error) {
      set({ operationError: `Tag update failed: ${errorText(error)}` });
    }
  },

  initialize: async (homePath) => {
    const multi = useMultiPanelStore.getState();
    const shouldResetWorkspace = consumeExplorerWorkspaceResetFlag();
    if (initializationInFlight) return;
    if (!shouldResetWorkspace && (multi.tabs.length > 0 || get().initialized)) return;
    initializationInFlight = true;
    void get().loadLibrary();
    try {
      const [workspaceDocument, processClipboard] = await Promise.all([
        workspacesSnapshot(),
        clipboardSnapshot(),
      ]);
      const restoredClipboard = explorerClipboardFromPayload(processClipboard.local);
      if (shouldResetWorkspace) {
        const resetDocument = defaultWorkspaceDocument();
        const workspace = defaultNativeWorkspace("workspace_0", "Workspace 1", homePath, get());
        workspaceDocumentCache = await saveWorkspaceDocument({
          ...resetDocument,
          active_workspace_id: workspace.id,
          next_workspace_idx: 1,
          workspaces: [workspace],
        });
        set({
          ...workspaceMetadata(workspaceDocumentCache),
          clipboard: restoredClipboard,
          operationError: "Misty reset a damaged Explorer layout and opened a clean file pane.",
        });
      } else {
        workspaceDocumentCache = workspaceDocument;
      }
      const restored = restoreNativeWorkspace(workspaceDocumentCache, homePath);
      if (restored) {
        if (multi.hydrate(restored.multiPanel)) {
          const hydratedMulti = useMultiPanelStore.getState();
          set({
            ...workspaceMetadata(workspaceDocumentCache),
            panes: restored.panes,
            sidebarVisible: restored.workspace.sidebar_visible,
            previewVisible: restored.workspace.inspector_visible,
            sidebarWidth: clamp(restored.workspace.sidebar_width, 212, 380),
            previewWidth: clamp(restored.workspace.inspector_width, 240, 420),
            showHidden: restored.showHidden,
            paneShowHidden: restored.paneShowHidden,
            viewMode: restored.viewMode,
            paneViewModes: restored.paneViewModes,
            sort: restored.sort,
            paneSorts: restored.paneSorts,
            clipboard: restoredClipboard,
            initialized: true,
          });
          const activeTab = hydratedMulti.tabs.find((tab) => tab.id === hydratedMulti.activeTabId)
            ?? hydratedMulti.tabs[0];
          await Promise.all(
            (activeTab?.panes ?? []).map((pane) => {
              const restoredPane = restored.panes[pane.id];
              return restoredPane?.listing ? get().loadPane(pane.id, restoredPane.listing.path, "replace") : Promise.resolve();
            }),
          );
          initializationInFlight = false;
          return;
        }
      }
      set(workspaceMetadata(workspaceDocumentCache));
    } catch (error) {
      set({ operationError: `Workspace restore failed: ${errorText(error)}` });
    }
    multi.initialize(homePath, titleFromPath(homePath));
    const fallbackDocument = workspaceDocumentCache ?? defaultWorkspaceDocument();
    set({ ...workspaceMetadata(fallbackDocument), initialized: true });
    await get().loadPane(multi.activePaneId || "explorer-pane-0", homePath, "replace");
    initializationInFlight = false;
  },

  selectWorkspace: async (workspaceId, homePath) => {
    if (!workspaceId || workspaceId === get().activeWorkspaceId) return;
    try {
      await persistExplorerWorkspace();
      let document = workspaceDocumentCache ?? await workspacesSnapshot();
      if (!document.workspaces.some((workspace) => workspace.id === workspaceId)) return;
      document = await saveWorkspaceDocument({ ...document, active_workspace_id: workspaceId });
      await applyWorkspaceDocument(document, homePath);
    } catch (error) {
      set({ operationError: `Workspace switch failed: ${errorText(error)}` });
    }
  },

  createWorkspace: async (title, homePath) => {
    const name = uniqueWorkspaceTitle(title.trim() || "Workspace", workspaceDocumentCache?.workspaces ?? get().workspaceEntries);
    try {
      await persistExplorerWorkspace();
      const document = workspaceDocumentCache ?? await workspacesSnapshot();
      const nextIndex = nextWorkspaceIndex(document);
      const workspaceId = `workspace_${nextIndex}`;
      const workspace = defaultNativeWorkspace(workspaceId, name, homePath, get());
      const nextDocument = await saveWorkspaceDocument({
        ...document,
        schema_version: 1,
        active_workspace_id: workspaceId,
        next_workspace_idx: nextIndex + 1,
        workspaces: [...document.workspaces, workspace],
      });
      await applyWorkspaceDocument(nextDocument, homePath);
    } catch (error) {
      set({ operationError: `Workspace create failed: ${errorText(error)}` });
    }
  },

  renameWorkspace: async (workspaceId, title) => {
    const trimmed = title.trim();
    if (!workspaceId || !trimmed) return;
    try {
      await persistExplorerWorkspace();
      const document = workspaceDocumentCache ?? await workspacesSnapshot();
      const workspaces = document.workspaces.map((workspace) =>
        workspace.id === workspaceId ? { ...workspace, title: trimmed } : workspace,
      );
      const nextDocument = await saveWorkspaceDocument({ ...document, workspaces });
      set(workspaceMetadata(nextDocument));
    } catch (error) {
      set({ operationError: `Workspace rename failed: ${errorText(error)}` });
    }
  },

  deleteWorkspace: async (workspaceId, homePath) => {
    if (!workspaceId) return;
    try {
      await persistExplorerWorkspace();
      const document = workspaceDocumentCache ?? await workspacesSnapshot();
      if (document.workspaces.length <= 1) return;
      const deletedIndex = document.workspaces.findIndex((workspace) => workspace.id === workspaceId);
      if (deletedIndex < 0) return;
      const workspaces = document.workspaces.filter((workspace) => workspace.id !== workspaceId);
      const nextActive = document.active_workspace_id === workspaceId
        ? workspaces[Math.max(0, deletedIndex - 1)] ?? workspaces[0]
        : workspaces.find((workspace) => workspace.id === document.active_workspace_id) ?? workspaces[0];
      const nextDocument = await saveWorkspaceDocument({
        ...document,
        active_workspace_id: nextActive.id,
        workspaces,
      });
      if (document.active_workspace_id === workspaceId) {
        await applyWorkspaceDocument(nextDocument, homePath);
      } else {
        set(workspaceMetadata(nextDocument));
      }
    } catch (error) {
      set({ operationError: `Workspace delete failed: ${errorText(error)}` });
    }
  },

  loadPane: (paneId, path, mode = "push", options) => {
    const loadKey = [
      paneId,
      path,
      mode,
      showHiddenForPane(get(), paneId) ? "hidden" : "visible",
      options?.forceRemoteRefresh ? "force" : "cached",
    ].join("\0");
    const pendingLoad = paneLoadRequestsInFlight.get(loadKey);
    if (pendingLoad) return pendingLoad;

    const loadRequest = (async () => {
    set((state) => {
      const pane = state.panes[paneId] ?? emptyPaneState();
      const multi = useMultiPanelStore.getState();
      const tab = multi.tabs.find((candidate) => candidate.panes.some((candidatePane) => candidatePane.id === paneId));
      const sibling = tab?.panes.find((candidatePane) => candidatePane.id !== paneId && candidatePane.path === path)
        ?? tab?.panes.find((candidatePane) => candidatePane.id !== paneId);
      const paneViewModes = state.paneViewModes[paneId] === undefined
        ? {
            ...state.paneViewModes,
            [paneId]: sibling ? viewModeForPane(state, sibling.id) : state.viewMode,
          }
        : state.paneViewModes;
      const paneShowHidden = state.paneShowHidden[paneId] === undefined
        ? {
            ...state.paneShowHidden,
            [paneId]: sibling ? showHiddenForPane(state, sibling.id) : state.showHidden,
          }
        : state.paneShowHidden;
      const quietRefresh = !options?.forceRemoteRefresh && mode === "replace" && pane.listing?.path === path && !pane.needsLoad;
      const nextPane = quietRefresh
        ? (pane.error ? { ...pane, error: null } : pane)
        : { ...pane, loading: true, needsLoad: false, error: null };
      if (
        nextPane === pane
        && state.inlineEdit?.paneId !== paneId
        && paneViewModes === state.paneViewModes
        && paneShowHidden === state.paneShowHidden
      ) return state;
      return {
        inlineEdit: state.inlineEdit?.paneId === paneId ? null : state.inlineEdit,
        paneViewModes,
        paneShowHidden,
        panes: {
          ...state.panes,
          [paneId]: nextPane,
        },
      };
    });
    try {
      const listing = sortListing(
        await explorerListDirectory({
          path,
          showHidden: showHiddenForPane(get(), paneId),
          forceRemoteRefresh: options?.forceRemoteRefresh,
        }),
        sortForPane(get(), paneId),
      );
      if (mode !== "replace") void get().recordLastOpenedPath(listing.path);
      const multi = useMultiPanelStore.getState();
      const tab = multi.tabs.find((candidate) => candidate.panes.some((pane) => pane.id === paneId));
      const pane = tab?.panes.find((candidate) => candidate.id === paneId);
      if (pane?.path !== listing.path || pane?.title !== titleFromPath(listing.path)) {
        multi.updateActiveTabPath(paneId, listing.path, titleFromPath(listing.path));
      }
      set((state) => {
        const currentPane = state.panes[paneId] ?? emptyPaneState();
        if (
          mode === "replace"
          && currentPane.listing
          && directoryListingsEqual(currentPane.listing, listing)
          && !currentPane.loading
          && !currentPane.error
        ) {
          return state;
        }
        const nextPane = applyNavigationResult(currentPane, listing, mode);
        if (paneExplorerStatesEqual(currentPane, nextPane)) return state;
        return {
          panes: {
            ...state.panes,
            [paneId]: nextPane,
          },
        };
      });
    } catch (error) {
      set((state) => ({
        panes: {
          ...state.panes,
          [paneId]: { ...(state.panes[paneId] ?? emptyPaneState()), loading: false, needsLoad: false, error: errorText(error) },
        },
      }));
    }
    })();

    paneLoadRequestsInFlight.set(loadKey, loadRequest);
    void loadRequest.finally(() => {
      if (paneLoadRequestsInFlight.get(loadKey) === loadRequest) {
        paneLoadRequestsInFlight.delete(loadKey);
      }
    });
    return loadRequest;
  },

  navigatePane: async (paneId, path) => {
    await get().loadPane(paneId, path, "push");
  },

  navigateBack: async (paneId) => {
    const history = get().panes[paneId]?.backHistory ?? [];
    const target = history[history.length - 1];
    if (target) await get().loadPane(paneId, target, "back");
  },

  navigateForward: async (paneId) => {
    const history = get().panes[paneId]?.forwardHistory ?? [];
    const target = history[history.length - 1];
    if (target) await get().loadPane(paneId, target, "forward");
  },

  navigateParent: async (paneId) => {
    const parent = get().panes[paneId]?.listing?.parentPath;
    if (parent) {
      await get().loadPane(paneId, parent, "push");
    }
  },

  refreshPane: async (paneId) => {
    const path = get().panes[paneId]?.listing?.path;
    if (path) {
      await get().loadPane(paneId, path, "replace", { forceRemoteRefresh: true });
    }
  },

  setViewMode: (viewMode, paneId) => set((state) => {
    const targetPaneId = paneId ?? useMultiPanelStore.getState().activePaneId;
    if (!targetPaneId) return state.viewMode === viewMode ? state : { viewMode };
    if (state.viewMode === viewMode && state.paneViewModes[targetPaneId] === viewMode) return state;
    return {
      viewMode,
      paneViewModes: { ...state.paneViewModes, [targetPaneId]: viewMode },
    };
  }),
  setSort: (column, paneId) => {
    set((state) => {
      const targetPaneId = paneId ?? useMultiPanelStore.getState().activePaneId;
      const currentSort = targetPaneId ? sortForPane(state, targetPaneId) : state.sort;
      const direction: ExplorerSortDirection =
        currentSort.column === column && currentSort.direction === "asc" ? "desc" : "asc";
      const sort = { column, direction };
      if (!targetPaneId) return { sort };
      const pane = state.panes[targetPaneId];
      return {
        sort,
        paneSorts: { ...state.paneSorts, [targetPaneId]: sort },
        panes: pane?.listing
          ? {
              ...state.panes,
              [targetPaneId]: { ...pane, listing: sortListing(pane.listing, sort) },
            }
          : state.panes,
      };
    });
  },
  setCommandQuery: (paneId, commandQuery) => set((state) => {
    const pane = state.panes[paneId] ?? emptyPaneState();
    if (pane.commandQuery === commandQuery) return state;
    return {
      panes: {
        ...state.panes,
        [paneId]: { ...pane, commandQuery },
      },
    };
  }),

  toggleHidden: async (paneId) => {
    const targetPaneId = paneId ?? useMultiPanelStore.getState().activePaneId;
    if (!targetPaneId) return;
    const showHidden = !showHiddenForPane(get(), targetPaneId);
    set((state) => ({
      showHidden,
      paneShowHidden: { ...state.paneShowHidden, [targetPaneId]: showHidden },
    }));
    const pane = get().panes[targetPaneId];
    if (pane?.listing) await get().loadPane(targetPaneId, pane.listing.path, "replace");
  },

  selectEntry: (paneId, entryId, options = {}) => {
    set((state) => {
      const pane = state.panes[paneId] ?? emptyPaneState();
      const path = pane.listing?.path ?? "";
      const entryIndex = pane.listing?.entries.findIndex((entry) => entry.id === entryId) ?? -1;
      const visibleEntryIds = options.visibleEntryIds?.filter((id) => pane.listing?.entries.some((entry) => entry.id === id)) ?? [];
      let selectedIds: string[];
      if (options.range && pane.listing && entryIndex >= 0 && visibleEntryIds.length > 0) {
        const targetVisibleIndex = visibleEntryIds.indexOf(entryId);
        const previousAnchor = pane.lastSelectedIndexByPath[path];
        const anchorEntryId = previousAnchor === undefined ? entryId : pane.listing.entries[previousAnchor]?.id;
        const anchorVisibleIndex = anchorEntryId ? visibleEntryIds.indexOf(anchorEntryId) : -1;
        const anchor = anchorVisibleIndex >= 0 ? anchorVisibleIndex : targetVisibleIndex;
        const target = targetVisibleIndex >= 0 ? targetVisibleIndex : anchor;
        const start = Math.min(anchor, target);
        const end = Math.max(anchor, target);
        selectedIds = visibleEntryIds.slice(start, end + 1);
      } else if (options.range && pane.listing && entryIndex >= 0) {
        const anchor = pane.lastSelectedIndexByPath[path] ?? entryIndex;
        const start = Math.min(anchor, entryIndex);
        const end = Math.max(anchor, entryIndex);
        selectedIds = pane.listing.entries.slice(start, end + 1).map((entry) => entry.id);
      } else if (options.toggle) {
        selectedIds = pane.selectedIds.includes(entryId)
          ? pane.selectedIds.filter((id) => id !== entryId)
          : [...pane.selectedIds, entryId];
      } else {
        selectedIds = [entryId];
      }
      const previousAnchor = pane.lastSelectedIndexByPath[path];
      const nextLastSelectedIndexByPath = entryIndex >= 0 && previousAnchor !== entryIndex
        ? { ...pane.lastSelectedIndexByPath, [path]: entryIndex }
        : pane.lastSelectedIndexByPath;
      if (
        arraysEqual(pane.selectedIds, selectedIds)
        && arraysEqual(pane.selectedIdsByPath[path] ?? [], selectedIds)
        && nextLastSelectedIndexByPath === pane.lastSelectedIndexByPath
      ) {
        return state;
      }
      const panes = {
        ...state.panes,
        [paneId]: {
          ...pane,
          selectedIds,
          selectedIdsByPath: { ...pane.selectedIdsByPath, [path]: selectedIds },
          lastSelectedIndexByPath: nextLastSelectedIndexByPath,
        },
      };
      return {
        panes,
        inlineEdit: syncInlineRenameSelection(state.inlineEdit, panes, paneId, entryId),
      };
    });
  },

  clearSelection: (paneId) => {
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) return state;
      if (pane.selectedIds.length === 0) return state;
      const path = pane.listing?.path ?? "";
      const panes = {
        ...state.panes,
        [paneId]: {
          ...pane,
          selectedIds: [],
          selectedIdsByPath: { ...pane.selectedIdsByPath, [path]: [] },
        },
      };
      return {
        panes,
        inlineEdit: syncInlineRenameSelection(state.inlineEdit, panes),
      };
    });
  },

  openEntry: async (paneId, entry) => {
    if (entry.isDeleted) {
      set({ operationError: "Trash items are deleted cache entries and cannot be opened from here yet." });
      return;
    }
    if (entry.kind === "folder") {
      void get().recordLibraryRecent(entry);
      await get().loadPane(paneId, entry.path);
      return;
    }
    if (entry.kind === "symlink") {
      try {
        if (await explorerPathIsDirectory(entry.path)) {
          void get().recordLibraryRecent(entry);
          await get().loadPane(paneId, entry.path);
          return;
        }
      } catch (error) {
        set({ operationError: `Unable to inspect link: ${errorText(error)}` });
        return;
      }
    }
    get().selectEntry(paneId, entry.id);
    const defaultFileAction = selectGeneralPreferences(
      useSettingsStore.getState().settings?.document,
    ).defaultFileActionIndex;
    const isRemoteFile = entry.location.kind !== "local";
    if (!isRemoteFile && (defaultFileAction === 1 || defaultFileAction === 2)) {
      set({ previewVisible: true, operationError: null });
      if (defaultFileAction === 1) {
        get().pushNotification("Preview opened", "info", 1800, false);
      }
      return;
    }
    try {
      set({ operationError: null });
      if (isRemoteFile) {
        get().pushNotification(`Downloading ${entry.name}...`, "info", 2500, false);
      }
      const localPath = await localPathForEntry(entry);
      const applicationPath = await associationForPath(entry.path);
      if (applicationPath) {
        await explorerOpenWith(applicationPath, localPath);
      } else {
        await explorerOpenPath(localPath);
      }
      if (isRemoteFile) {
        get().pushNotification(`Downloaded ${entry.name}`, "success", 2200, false);
      }
      void get().recordLibraryRecent(entry);
    } catch (error) {
      set({ operationError: `Unable to open file: ${errorText(error)}` });
    }
  },

  openWithSelected: async (paneId) => {
    const entry = selectedEntryForPane(get().panes[paneId]);
    if (!entry || entry.kind === "folder" || entry.kind === "symlink") return;
    try {
      const selection = await open({
        title: "Choose Application",
        multiple: false,
        directory: false,
      });
      const applicationPath = Array.isArray(selection) ? selection[0] : selection;
      if (!applicationPath) return;
      set({ operationError: null });
      await setAssociationForPath(entry.path, applicationPath);
      await explorerOpenWith(applicationPath, await localPathForEntry(entry));
    } catch (error) {
      set({ operationError: `Open With failed: ${errorText(error)}` });
    }
  },

  canCreateItem: (paneId, kind) => canCreateItemInPane(get().panes[paneId], kind, get().inlineEdit),

  createItem: async (paneId, kind, name) => {
    const pane = get().panes[paneId];
    const directory = pane?.listing?.path;
    if (!directory) return;
    if (!canCreateItemInPane(pane, kind, get().inlineEdit)) return;
    const defaultName = kind === "folder" ? "Untitled Folder" : "Untitled File";
    if (name == null) {
      const inlineEdit: ExplorerInlineEditState = {
        paneId,
        kind: "create",
        itemKind: kind,
        entryId: null,
        originalName: "",
        value: defaultName,
        lockedExtension: "",
        error: null,
      };
      set({ inlineEdit: withInlineEditValidation(inlineEdit, pane) });
      return;
    }
    const requestedName = name;
    if (!requestedName) return;
    try {
      set({ operationError: null });
      await explorerQueueCreateItem({ directory, name: requestedName, kind });
      get().pushNotification(`Queued ${kind === "folder" ? "folder" : "file"} creation`, "success");
      queuePaneRefresh(paneId, directory);
    } catch (error) {
      set({ operationError: errorText(error) });
    }
  },

  renameSelected: async (paneId, name) => {
    const pane = get().panes[paneId];
    const entries = selectedEntriesForPane(pane);
    const entry = entries[0] ?? null;
    if (name == null) {
      const renameItems = selectedBatchRenameItemsAcrossPanes(get().panes, paneId);
      if (renameItems.length === 0) return;
      const targetItem = renameItems[0];
      const targetPaneId = targetItem?.paneId ?? paneId;
      const targetPane = get().panes[targetPaneId] ?? pane;
      const targetEntry = targetPane?.listing?.entries.find((candidate) => candidate.id === targetItem?.entryId) ?? entry;
      const [value, lockedExtension] = splitRenameParts(targetEntry);
      const inlineEdit: ExplorerInlineEditState = {
        paneId: targetPaneId,
        kind: "rename",
        itemKind: targetEntry.kind === "folder" ? "folder" : "file",
        entryId: targetEntry.id,
        originalName: targetEntry.name,
        value,
        lockedExtension,
        batchItems: renameItems.length > 1 ? renameItems.map((item) => ({ ...item, value })) : undefined,
        error: null,
      };
      set({ inlineEdit: withInlineEditValidation(inlineEdit, targetPane) });
      return;
    }
    if (!entry) return;
    const requestedName = name;
    if (!requestedName || requestedName === entry.name) return;
    try {
      set({ operationError: null });
      await explorerQueueRenameItem({
        path: entry.path,
        newName: requestedName,
        sourceIsDirectory: entry.kind === "folder",
      });
      get().pushNotification(`Queued rename to ${requestedName}`, "success");
      get().clearSelection(paneId);
      queuePaneRefresh(paneId, pane?.listing?.path ?? entry.path);
    } catch (error) {
      set({ operationError: errorText(error) });
    }
  },

  deleteSelected: async (paneId, mode) => {
    const pane = get().panes[paneId];
    const permanent = deleteModeForPaneSelection(pane, mode) === "permanent";
    const paths = selectedDeletePathsForPane(pane, permanent);
    if (paths.length === 0) return;
    const isTrashPane = pane?.listing?.path === "misty://trash";
    const shouldConfirm = permanent
      && !isTrashPane
      && selectGeneralPreferences(useSettingsStore.getState().settings?.document).confirmDestructiveActions;
    if (!shouldConfirm) {
      try {
        set({ operationError: null });
        const directory = pane?.listing?.path;
        await explorerQueueDeleteItems({ paths, permanent });
        get().pushNotification(deleteQueuedMessage(paths.length, permanent), "success");
        get().clearSelection(paneId);
        if (directory) queuePaneRefresh(paneId, directory);
      } catch (error) {
        set({ operationError: errorText(error) });
      }
      return;
    }
    set({ dialog: { kind: "delete", paneId, paths, permanent } });
  },

  downloadSelected: async (paneId) => {
    const pane = get().panes[paneId];
    const items = selectedRemotePasteItemsForPane(pane);
    if (items.length === 0) return;
    try {
      const downloadsDirectory = await downloadDestinationDirectory();
      if (!downloadsDirectory) return;
      set({ operationError: null });
      await explorerQueuePasteItems({
        sources: items,
        destinationDirectory: downloadsDirectory,
        operation: "copy",
      });
      get().pushNotification(`Queued download for ${itemCountLabel(items.length)}`, "success");
      if (pane?.listing && samePath(pane.listing.path, downloadsDirectory)) {
        queuePaneRefresh(paneId, downloadsDirectory);
      }
    } catch (error) {
      set({ operationError: `Download failed: ${errorText(error)}` });
    }
  },

  confirmDialog: async () => {
    const dialog = get().dialog;
    if (!dialog) return;
    if (dialog.kind === "delete") {
      set({ dialog: null });
      try {
        set({ operationError: null });
        const directory = get().panes[dialog.paneId]?.listing?.path;
        await explorerQueueDeleteItems({ paths: dialog.paths, permanent: dialog.permanent });
        get().pushNotification(deleteQueuedMessage(dialog.paths.length, dialog.permanent), "success");
        get().clearSelection(dialog.paneId);
        if (directory) queuePaneRefresh(dialog.paneId, directory);
      } catch (error) {
        set({ operationError: errorText(error) });
      }
      return;
    }

    const validatedItems = validateBatchRenameItems(dialog.items);
    const items = validatedItems
      .map((item) => ({
        item,
        effectiveName: `${item.value.trim()}${item.lockedExtension}`,
      }))
      .filter(({ item, effectiveName }) => !item.error && effectiveName !== item.originalName)
      .map(({ item, effectiveName }) => ({
        path: item.path,
        newName: effectiveName,
        sourceIsDirectory: item.isDirectory,
      }));
    if (items.length === 0) {
      const hasErrors = validatedItems.some((item) => item.error);
      set(hasErrors ? { dialog: { ...dialog, items: validatedItems } } : { dialog: null });
      return;
    }
    set({ dialog: null });
    try {
      set({ operationError: null });
      await explorerQueueRenameItems({ items });
      get().pushNotification(`Queued rename for ${itemCountLabel(items.length)}`, "success");
      refreshAndClearRenamePanes(validatedItems);
    } catch (error) {
      set({
        operationError: errorText(error),
        dialog: { ...dialog, items: validatedItems },
      });
    }
  },

  setInlineEditValue: (value) => set((state) => {
    if (!state.inlineEdit) return state;
    const draft = { ...state.inlineEdit, value };
    return {
      inlineEdit: withInlineEditValidation(draft, state.panes[draft.paneId]),
    };
  }),

  setBatchRenameValue: (paneId, entryId, value) => set((state) => {
    const dialog = state.dialog;
    if (dialog?.kind !== "batchRename") return state;
    const items = validateBatchRenameItems(
      dialog.items.map((item) => item.paneId === paneId && item.entryId === entryId ? { ...item, value } : item),
    );
    return { dialog: { ...dialog, items } };
  }),

  commitInlineEdit: async () => {
    const edit = get().inlineEdit;
    if (!edit) return;
    const pane = get().panes[edit.paneId];
    const validated = withInlineEditValidation(edit, pane);
    const batchRename = validated.kind === "rename" && validated.batchItems && validated.batchItems.length > 1;
    if (validated.error && !batchRename) {
      set({ inlineEdit: validated });
      return;
    }
    const effectiveName = `${validated.value.trim()}${validated.lockedExtension}`;
    if (validated.kind === "rename" && !batchRename && effectiveName === validated.originalName) {
      set({ inlineEdit: null });
      return;
    }
    if (validated.kind === "create") {
      await get().createItem(validated.paneId, validated.itemKind, effectiveName);
    } else if (validated.batchItems && validated.batchItems.length > 1) {
      set({
        inlineEdit: null,
        dialog: {
          kind: "batchRename",
          paneId: validated.paneId,
          items: validateBatchRenameItems(validated.batchItems.map((item) => ({ ...item, value: validated.value }))),
        },
      });
      return;
    } else {
      await get().renameSelected(validated.paneId, effectiveName);
    }
    const operationError = get().operationError;
    if (operationError && get().inlineEdit === edit) {
      set({ inlineEdit: { ...validated, error: operationError } });
    } else if (get().inlineEdit === edit) {
      set({ inlineEdit: null });
    }
  },

  cancelInlineEdit: () => set((state) => state.inlineEdit ? { inlineEdit: null } : state),

  closeDialog: () => set((state) => {
    const dialog = state.dialog;
    if (!dialog) return state;
    if (dialog.kind !== "batchRename") return { dialog: null };
    return {
      dialog: null,
      inlineEdit: inlineEditFromBatchRenameDialog(dialog),
    };
  }),

  copySelected: (paneId) => {
    const pane = get().panes[paneId];
    const items = selectedPasteItemsForPane(pane);
    if (items.length === 0) return;
    set({ clipboard: { items, operation: "copy" }, operationError: null });
    void clipboardSetLocal(clipboardPayloadForPane(pane)).catch((error) => {
      set({ operationError: `Clipboard update failed: ${errorText(error)}` });
    });
    void writeNativeOrTextClipboardForSelection(pane).catch(() => undefined);
  },

  cutSelected: (paneId) => {
    const pane = get().panes[paneId];
    const items = selectedPasteItemsForPane(pane);
    if (items.length === 0) return;
    set({ clipboard: { items, operation: "move" }, operationError: null });
  },

  pasteIntoPane: async (paneId) => {
    const pane = get().panes[paneId];
    const directory = pane?.listing?.path;
    const clipboard = get().clipboard;
    if (!directory) return;

    try {
      set({ operationError: null });
      if (clipboard?.operation === "move" && clipboard.items.length > 0) {
        await explorerQueuePasteItems({
          sources: clipboard.items,
          destinationDirectory: directory,
          operation: clipboard.operation,
        });
        get().pushNotification(`Queued move for ${itemCountLabel(clipboard.items.length)}`, "success");
        set({ clipboard: null });
        queuePaneRefresh(paneId, directory);
        return;
      }

      if (await pasteSystemClipboardTextIntoPane(paneId, directory)) {
        return;
      }

      if (!clipboard?.items.length) return;
      await explorerQueuePasteItems({
        sources: clipboard.items,
        destinationDirectory: directory,
        operation: clipboard.operation,
      });
      get().pushNotification(`Queued copy for ${itemCountLabel(clipboard.items.length)}`, "success");
      queuePaneRefresh(paneId, directory);
    } catch (error) {
      set({ operationError: errorText(error) });
    }
  },

  uploadIntoPane: async (paneId, sourceKind = "files") => {
    const directory = get().panes[paneId]?.listing?.path;
    if (!directory) return;
    try {
      const selection = await open({ multiple: true, directory: sourceKind === "folders" });
      const paths = selection == null ? [] : Array.isArray(selection) ? selection : [selection];
      if (paths.length === 0) return;
      set({ operationError: null });
      await explorerQueuePasteItems({
        sources: paths.map((path) => ({ path, isDirectory: sourceKind === "folders" })),
        destinationDirectory: directory,
        operation: "copy",
      });
      get().pushNotification(`Queued upload for ${itemCountLabel(paths.length)}`, "success");
      queuePaneRefresh(paneId, directory);
    } catch (error) {
      set({ operationError: `Upload failed: ${errorText(error)}` });
    }
  },

  dropItems: async (paneId, items, destination, operation) => {
    if (items.length === 0 || !destination) return;
    try {
      set({ operationError: null });
      await explorerQueuePasteItems({
        sources: items,
        destinationDirectory: destination,
        operation,
      });
      get().pushNotification(`Queued ${operation === "move" ? "move" : "copy"} for ${itemCountLabel(items.length)}`, "success");
      const current = get().panes[paneId]?.listing?.path;
      if (current) queuePaneRefresh(paneId, current);
    } catch (error) {
      set({ operationError: `Drop failed: ${errorText(error)}` });
    }
  },

  dropExternalPaths: async (paneId, paths, destination) => {
    const cleanPaths = paths.filter(Boolean);
    if (cleanPaths.length === 0 || !destination) return;
    try {
      set({ operationError: null });
      const sources = await Promise.all(cleanPaths.map(async (path) => ({
        path,
        isDirectory: await explorerPathIsDirectory(path),
      })));
      await explorerQueuePasteItems({
        sources,
        destinationDirectory: destination,
        operation: "copy",
      });
      get().pushNotification(`Queued drop for ${itemCountLabel(sources.length)}`, "success");
      const current = get().panes[paneId]?.listing?.path;
      if (current) queuePaneRefresh(paneId, current);
    } catch (error) {
      set({ operationError: `Drop failed: ${errorText(error)}` });
    }
  },

  pollTransferRefreshes: async (mountRoot) => {
    try {
      if (Object.values(get().panes).every((pane) => !pane.listing)) return;
      const page = await transfersSnapshot({ limit: 50 });
      const completedRows = page.rows.filter((row) => row.status === "completed");
      if (!transferRefreshObserverReady) {
        transferRefreshObserverReady = true;
        transferRefreshWatermarkMs = Math.max(0, ...completedRows.map((row) => row.completedAtMs));
        transferRefreshStatuses = Object.fromEntries(page.rows.map((row) => [row.id, row.status]));
        return;
      }

      const previousStatuses = transferRefreshStatuses;
      transferRefreshStatuses = Object.fromEntries(page.rows.map((row) => [row.id, row.status]));
      const newlyCompleted = completedRows.filter((row) => {
        const previousStatus = previousStatuses[row.id];
        return previousStatus !== "completed" || row.completedAtMs > transferRefreshWatermarkMs;
      });
      if (newlyCompleted.length === 0) return;
      transferRefreshWatermarkMs = Math.max(transferRefreshWatermarkMs, ...newlyCompleted.map((row) => row.completedAtMs));

      const panes = get().panes;
      for (const [paneId, pane] of Object.entries(panes)) {
        const currentPath = pane.listing?.path;
        if (!currentPath) continue;
        if (newlyCompleted.some((row) => transferTouchesDirectory(row, currentPath, mountRoot))) {
          queuePaneRefresh(paneId, currentPath, { immediate: true });
        }
      }
    } catch {
      // Transfer refresh is opportunistic; the Transfers view still owns visible transfer errors.
    }
  },

  togglePinnedPath: (path) => {
    const normalized = normalizedPath(path);
    const current = normalizePinnedPaths(get().pinnedPaths);
    const pinnedPaths = current.some((candidate) => samePath(candidate, normalized))
      ? current.filter((candidate) => !samePath(candidate, normalized))
      : normalizePinnedPaths([...current, normalized]);
    if (arraysEqual(current, pinnedPaths)) return;
    window.localStorage.setItem("misty.explorer.pinnedPaths", JSON.stringify(pinnedPaths));
    set({ pinnedPaths });
  },

  copyPath: async (path) => {
    try {
      await writeText(path);
      set({ operationError: null });
      get().pushNotification("Copied path", "info");
    } catch (error) {
      set({ operationError: errorText(error) });
    }
  },

  openContextMenu: (paneId, x, y, entryId = null) => {
    const currentState = get();
    if (entryId && !currentState.panes[paneId]?.selectedIds.includes(entryId)) {
      currentState.selectEntry(paneId, entryId);
    }
    set((state) => {
      const current = state.contextMenu;
      if (current.open && current.x === x && current.y === y && current.paneId === paneId && current.entryId === entryId) {
        return state;
      }
      return { contextMenu: { open: true, x, y, paneId, entryId } };
    });
  },

  closeContextMenu: () => {
    set((state) => state.contextMenu.open ? { contextMenu: { open: false, x: 0, y: 0, paneId: "", entryId: null } } : state);
  },

  setSidebarVisible: (sidebarVisible) => set((state) => state.sidebarVisible === sidebarVisible ? state : { sidebarVisible }),
  setPreviewVisible: (previewVisible) => set((state) => state.previewVisible === previewVisible ? state : { previewVisible }),
  setSidebarWidth: (sidebarWidth) => set((state) => {
    const width = Math.round(sidebarWidth);
    return state.sidebarWidth === width ? state : { sidebarWidth: width };
  }),
  setPreviewWidth: (previewWidth) => set((state) => {
    const width = Math.round(previewWidth);
    return state.previewWidth === width ? state : { previewWidth: width };
  }),
  toggleChatOverlay: () => set((state) => ({ chatOverlayOpen: !state.chatOverlayOpen })),
  toggleClaudePanel: () => set((state) => ({ claudePanelOpen: !state.claudePanelOpen })),
  setClaudePanelOpen: (claudePanelOpen) => set((state) => state.claudePanelOpen === claudePanelOpen ? state : { claudePanelOpen }),
  setClaudePanelWidth: (claudePanelWidth) => set((state) => {
    const width = Math.round(claudePanelWidth);
    return state.claudePanelWidth === width ? state : { claudePanelWidth: width };
  }),
  pushNotification: (message, type = "info", durationMs = 3000, showInActivity = true) => {
    const trimmed = message.trim();
    if (!trimmed) return 0;
    const notificationPreferences = selectNotificationPreferences(useSettingsStore.getState().settings?.document);
    const quietSuppressed = notificationPreferences.quietHoursEnabled && type !== "error";
    const digestSuppressed = notificationPreferences.digestNotificationsEnabled && type !== "error";
    const alertSuppressed = quietSuppressed || digestSuppressed;
    const showToast = notificationPreferences.inAppNotificationsEnabled && !alertSuppressed;
    const showDesktop = notificationPreferences.desktopNotificationsEnabled && !alertSuppressed;
    const playSound = notificationPreferences.soundNotificationsEnabled && !alertSuppressed;
    const recordActivity = showInActivity;
    const id = nextExplorerNotificationId++;
    const notification = {
      id,
      message: trimmed,
      type,
      createdAtMs: Date.now(),
      read: alertSuppressed,
      showInActivity: recordActivity,
    };
    set((state) => ({
      notifications: showToast
        ? [...state.notifications, notification].slice(-3)
        : state.notifications,
      notificationHistory: recordActivity
        ? [...state.notificationHistory, notification].slice(-200)
        : state.notificationHistory,
    }));
    void publishDesktopNotification(notification, showDesktop);
    if (playSound) {
      playNotificationSound(type);
    }
    if (showToast && durationMs > 0) {
      window.setTimeout(() => {
        useExplorerStore.getState().dismissNotification(id);
      }, durationMs);
    }
    return id;
  },
  dismissNotification: (id) => set((state) => ({
    notifications: state.notifications.filter((notification) => notification.id !== id),
  })),
  markNotificationsRead: () => set((state) => ({
    notificationHistory: state.notificationHistory.map((notification) => (
      notification.read ? notification : { ...notification, read: true }
    )),
  })),
  clearNotificationHistory: () => set({ notificationHistory: [] }),
}));

export function selectedEntryForPane(pane: PaneExplorerState | undefined): FileEntry | null {
  if (!pane?.listing || pane.selectedIds.length === 0) return null;
  return pane.listing.entries.find((entry) => entry.id === pane.selectedIds[0]) ?? null;
}

function paneExplorerStatesEqual(left: PaneExplorerState, right: PaneExplorerState): boolean {
  return left === right || (
    left.listing === right.listing
    && left.commandQuery === right.commandQuery
    && arraysEqual(left.selectedIds, right.selectedIds)
    && left.selectedIdsByPath === right.selectedIdsByPath
    && left.lastSelectedIndexByPath === right.lastSelectedIndexByPath
    && arraysEqual(left.backHistory, right.backHistory)
    && arraysEqual(left.forwardHistory, right.forwardHistory)
    && left.loading === right.loading
    && left.needsLoad === right.needsLoad
    && left.error === right.error
  );
}

function selectedEntriesForPane(pane: PaneExplorerState | undefined): FileEntry[] {
  if (!pane?.listing || pane.selectedIds.length === 0) return [];
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter((entry) => selected.has(entry.id));
}

function selectedRemotePasteItemsForPane(pane: PaneExplorerState | undefined): PasteItem[] {
  return selectedEntriesForPane(pane)
    .filter((entry) => !entry.isDeleted && entry.location.kind === "remote")
    .map((entry) => ({ path: entry.path, isDirectory: entry.kind === "folder" }));
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function itemCountLabel(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}

function defaultDownloadsDirectory(): string {
  const homeDir = useAppStore.getState().app?.environment.homeDir;
  return homeDir ? joinExplorerPath(homeDir, "Downloads") : "Downloads";
}

async function downloadDestinationDirectory(): Promise<string | null> {
  const defaultDirectory = defaultDownloadsDirectory();
  const transferBehaviorIndex = selectGeneralPreferences(
    useSettingsStore.getState().settings?.document,
  ).defaultTransferBehaviorIndex;
  if (transferBehaviorIndex === 1) {
    return defaultDirectory;
  }
  const selection = await open({
    title: "Choose Download Folder",
    multiple: false,
    directory: true,
    defaultPath: defaultDirectory,
  });
  if (!selection) return null;
  return Array.isArray(selection) ? selection[0] ?? null : selection;
}

function joinExplorerPath(...parts: string[]): string {
  const clean = parts
    .filter(Boolean)
    .map((part, index) => (
      index === 0
        ? part.replace(/\/+$/g, "")
        : part.replace(/^\/+|\/+$/g, "")
    ))
    .filter(Boolean);
  if (clean.length === 0) return "/";
  return clean.join("/");
}

function splitRenameParts(entry: FileEntry): [string, string] {
  if (entry.kind === "folder") return [entry.name, ""];
  const dot = entry.name.lastIndexOf(".");
  if (dot <= 0) return [entry.name, ""];
  return [entry.name.slice(0, dot), entry.name.slice(dot)];
}

function makeBatchRenameItem(entry: FileEntry, paneId: string, pane: PaneExplorerState): ExplorerBatchRenameItem {
  const [value, lockedExtension] = splitRenameParts(entry);
  return {
    paneId,
    entryId: entry.id,
    path: entry.path,
    directoryPath: pane.listing?.path ?? parentDirectory(entry.path),
    originalName: entry.name,
    value,
    lockedExtension,
    isDirectory: entry.kind === "folder",
    siblingNames: (pane.listing?.entries ?? [])
      .filter((candidate) => candidate.id !== entry.id)
      .map((candidate) => candidate.name),
    error: null,
  };
}

function selectedBatchRenameItemsAcrossPanes(
  panes: Record<string, PaneExplorerState>,
  activePaneId: string,
): ExplorerBatchRenameItem[] {
  const paneEntries = Object.entries(panes);
  const orderedPaneEntries = [
    ...paneEntries.filter(([paneId]) => paneId === activePaneId),
    ...paneEntries.filter(([paneId]) => paneId !== activePaneId),
  ];
  const seenPaths = new Set<string>();
  const items: ExplorerBatchRenameItem[] = [];
  for (const [paneId, pane] of orderedPaneEntries) {
    if (pane.listing?.path === "misty://trash") continue;
    for (const entry of selectedEntriesForPane(pane)) {
      if (!isFileMasterEntry(entry)) continue;
      const pathKey = normalizedPath(entry.path);
      if (seenPaths.has(pathKey)) continue;
      seenPaths.add(pathKey);
      items.push(makeBatchRenameItem(entry, paneId, pane));
    }
  }
  return items;
}

function syncInlineRenameSelection(
  edit: ExplorerInlineEditState | null,
  panes: Record<string, PaneExplorerState>,
  preferredPaneId?: string,
  preferredEntryId?: string,
): ExplorerInlineEditState | null {
  if (edit?.kind !== "rename") return edit;

  const items = selectedBatchRenameItemsAcrossPanes(panes, preferredPaneId ?? edit.paneId);
  if (items.length === 0) return null;

  const focusItem = items.find((item) => item.paneId === preferredPaneId && item.entryId === preferredEntryId)
    ?? items.find((item) => item.paneId === edit.paneId && item.entryId === edit.entryId)
    ?? items[0];
  const batchItems = validateBatchRenameItems(items.map((item) => ({ ...item, value: edit.value })));
  const focused = batchItems.find((item) => item.paneId === focusItem.paneId && item.entryId === focusItem.entryId)
    ?? focusItem;
  const next: ExplorerInlineEditState = {
    ...edit,
    paneId: focusItem.paneId,
    itemKind: focusItem.isDirectory ? "folder" : "file",
    entryId: focusItem.entryId,
    originalName: focusItem.originalName,
    lockedExtension: focusItem.lockedExtension,
    batchItems: batchItems.length > 1 ? batchItems : undefined,
    error: focused.error,
  };
  return withInlineEditValidation(next, panes[next.paneId]);
}

function validateRenameValue(
  value: string,
  lockedExtension: string,
  originalName: string,
  entryId: string | null,
  pane: PaneExplorerState | undefined,
  reservedNames: Set<string> | null = null,
): string | null {
  const trimmedValue = value.trim();
  const effectiveName = `${trimmedValue}${lockedExtension}`;
  if (!trimmedValue) {
    return "Name cannot be empty.";
  }
  if (value !== trimmedValue) {
    return "Name cannot begin or end with spaces.";
  }
  if (value.includes("/") || value.includes("\\")) {
    return "Name cannot contain path separators.";
  }
  if (value.includes("\0")) {
    return "Name contains an invalid character.";
  }
  if (effectiveName !== originalName && pane?.listing?.entries.some(
    (entry) => entry.id !== entryId && !reservedNames?.has(entry.id) && entry.name === effectiveName,
  )) {
    return "Name already exists in this folder.";
  }
  return null;
}

function validateBatchRenameItems(items: ExplorerBatchRenameItem[]): ExplorerBatchRenameItem[] {
  const targetCounts = new Map<string, number>();
  for (const item of items) {
    const effectiveName = `${item.value.trim()}${item.lockedExtension}`;
    const targetPath = renameTargetPath(item.directoryPath, effectiveName);
    targetCounts.set(targetPath, (targetCounts.get(targetPath) ?? 0) + 1);
  }
  return items.map((item) => {
    const effectiveName = `${item.value.trim()}${item.lockedExtension}`;
    const baseError = validateRenameValue(
      item.value,
      item.lockedExtension,
      item.originalName,
      item.entryId,
      undefined,
    );
    const targetPath = renameTargetPath(item.directoryPath, effectiveName);
    const error = baseError
      ?? ((targetCounts.get(targetPath) ?? 0) > 1
        ? "Another selected item will use this name."
        : null)
      ?? (effectiveName !== item.originalName && item.siblingNames.includes(effectiveName)
        ? "Name already exists in this folder."
        : null);
    return { ...item, error };
  });
}

function inlineEditFromBatchRenameDialog(
  dialog: NonNullable<ExplorerDialogState> & { kind: "batchRename" },
): ExplorerInlineEditState | null {
  const focusItem = dialog.items.find((item) => item.paneId === dialog.paneId) ?? dialog.items[0];
  if (!focusItem) return null;
  const batchItems = validateBatchRenameItems(dialog.items);
  const focused = batchItems.find((item) => item.paneId === focusItem.paneId && item.entryId === focusItem.entryId);
  const invalidCount = batchItems.filter((item) => item.error).length;
  const restored: ExplorerInlineEditState = {
    paneId: focusItem.paneId,
    kind: "rename",
    itemKind: focusItem.isDirectory ? "folder" : "file",
    entryId: focusItem.entryId,
    originalName: focusItem.originalName,
    value: focusItem.value,
    lockedExtension: focusItem.lockedExtension,
    batchItems,
    error: focused?.error
      ?? (invalidCount > 0 ? `${invalidCount} selected ${invalidCount === 1 ? "item needs" : "items need"} review.` : null),
  };
  return restored;
}

function renameTargetPath(directoryPath: string, name: string): string {
  const directory = normalizedPath(directoryPath);
  return directory === "/" ? `/${name}` : `${directory}/${name}`;
}

function refreshAndClearRenamePanes(items: ExplorerBatchRenameItem[]): void {
  const paneDirectories = new Map<string, Set<string>>();
  for (const item of items) {
    const directories = paneDirectories.get(item.paneId) ?? new Set<string>();
    directories.add(item.directoryPath);
    paneDirectories.set(item.paneId, directories);
  }
  const store = useExplorerStore.getState();
  for (const [paneId, directories] of paneDirectories) {
    store.clearSelection(paneId);
    for (const directory of directories) {
      queuePaneRefresh(paneId, directory);
    }
  }
}

function withInlineEditValidation(
  edit: ExplorerInlineEditState,
  pane: PaneExplorerState | undefined,
): ExplorerInlineEditState {
  if (edit.kind === "rename" && edit.batchItems && edit.batchItems.length > 1) {
    const batchItems = validateBatchRenameItems(edit.batchItems.map((item) => ({ ...item, value: edit.value })));
    const focused = batchItems.find((item) => item.paneId === edit.paneId && item.entryId === edit.entryId);
    const invalidCount = batchItems.filter((item) => item.error).length;
    const error = focused?.error
      ?? (invalidCount > 0 ? `${invalidCount} selected ${invalidCount === 1 ? "item needs" : "items need"} review.` : null);
    return { ...edit, batchItems, error };
  }
  let error = validateRenameValue(edit.value, edit.lockedExtension, edit.originalName, edit.entryId, pane);
  if (!error && edit.kind === "create" && edit.itemKind === "file" && pane?.listing?.location.kind === "remote") {
    error = "Creating an empty remote file is not supported.";
  }
  return { ...edit, error };
}

function canCreateItemInPane(
  pane: PaneExplorerState | undefined,
  kind: CreateItemKind,
  inlineEdit: ExplorerInlineEditState | null,
): boolean {
  if (inlineEdit || !pane?.listing) return false;
  if (pane.listing.path.startsWith("misty://")) return false;
  if (kind === "file" && pane.listing.location.kind === "remote") return false;
  return true;
}

export function selectedPathsForPane(pane: PaneExplorerState | undefined): string[] {
  if (!pane?.listing) return [];
  if (pane.listing.path === "misty://trash") return [];
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries
    .filter((entry) => selected.has(entry.id) && isFileMasterEntry(entry))
    .map((entry) => entry.path);
}

export function selectedDeletePathsForPane(pane: PaneExplorerState | undefined, permanent: boolean): string[] {
  if (!pane?.listing) return [];
  const selected = new Set(pane.selectedIds);
  const inTrash = pane.listing.path === "misty://trash";
  return pane.listing.entries
    .filter((entry) => {
      if (!selected.has(entry.id)) return false;
      if (inTrash) return permanent && entry.isDeleted;
      return permanent ? !entry.isDeleted : !entry.isDeleted && entry.location.kind === "local";
    })
    .map((entry) => entry.path);
}

export function selectedPasteItemsForPane(pane: PaneExplorerState | undefined): PasteItem[] {
  if (!pane?.listing) return [];
  if (pane.listing.path === "misty://trash") return [];
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries
    .filter((entry) => selected.has(entry.id) && isFileMasterEntry(entry))
    .map((entry) => ({ path: entry.path, isDirectory: entry.kind === "folder" }));
}

function isFileMasterEntry(entry: FileEntry): boolean {
  return !entry.isDeleted;
}

function deleteModeForPaneSelection(
  pane: PaneExplorerState | undefined,
  requestedMode: ExplorerDeleteMode | undefined,
): ExplorerDeleteMode {
  if (requestedMode) return requestedMode;
  if (pane?.listing?.path === "misty://trash") return "permanent";
  const selected = new Set(pane?.selectedIds ?? []);
  const hasRemoteSelection = Boolean(pane?.listing?.entries.some((entry) =>
    selected.has(entry.id) && !entry.isDeleted && entry.location.kind === "remote"
  ));
  return hasRemoteSelection ? "permanent" : "trash";
}

function deleteQueuedMessage(count: number, permanent: boolean): string {
  return `Queued ${permanent ? "permanent delete" : "trash"} for ${itemCountLabel(count)}`;
}

async function localPathForEntry(entry: FileEntry): Promise<string> {
  if (entry.location.kind === "local") return entry.path;
  return (await explorerPrepareOpenItem({
    path: entry.path,
    sizeBytes: entry.sizeBytes,
    remoteModified: entry.remoteModified,
  })).localPath;
}

async function associationForPath(filePath: string): Promise<string | null> {
  return explorerOpenAssociation(filePath);
}

async function setAssociationForPath(filePath: string, applicationPath: string): Promise<void> {
  await explorerSetOpenAssociation(filePath, applicationPath);
}

async function pasteSystemClipboardTextIntoPane(paneId: string, directory: string): Promise<boolean> {
  const nativeFileRefs = await readNativeClipboardFileRefs();
  if (nativeFileRefs.length > 0) {
    await explorerQueuePasteItems({
      sources: nativeFileRefs,
      destinationDirectory: directory,
      operation: "copy",
    });
    queuePaneRefresh(paneId, directory);
    return true;
  }

  const uriListItems = await readClipboardUriListPasteItems();
  if (uriListItems.length > 0) {
    await explorerQueuePasteItems({
      sources: uriListItems,
      destinationDirectory: directory,
      operation: "copy",
    });
    queuePaneRefresh(paneId, directory);
    return true;
  }

  const html = await readClipboardHtml();
  if (html?.trim()) {
    await explorerQueuePasteText({
      destinationDirectory: directory,
      text: html,
      preferredName: "clipboard.html",
    });
    queuePaneRefresh(paneId, directory);
    return true;
  }

  const text = await readText().catch(() => "");
  if (text) {
    const pathItems = await pasteItemsFromClipboardText(text);
    if (pathItems.length > 0) {
      await explorerQueuePasteItems({
        sources: pathItems,
        destinationDirectory: directory,
        operation: "copy",
      });
      queuePaneRefresh(paneId, directory);
      return true;
    }
    if (text.trim().length > 0) {
      await explorerQueuePasteText({
        destinationDirectory: directory,
        text,
        preferredName: "clipboard.txt",
      });
      queuePaneRefresh(paneId, directory);
      return true;
    }
  }
  return pasteSystemClipboardImageIntoPane(paneId, directory);
}

async function readNativeClipboardFileRefs(): Promise<PasteItem[]> {
  try {
    return await clipboardNativeFileRefs();
  } catch {
    return [];
  }
}

async function readClipboardUriListPasteItems(): Promise<PasteItem[]> {
  if (!navigator.clipboard?.read) return [];
  try {
    const items = await navigator.clipboard.read();
    const paths: string[] = [];
    for (const item of items) {
      if (!item.types.includes("text/uri-list")) continue;
      const blob = await item.getType("text/uri-list");
      paths.push(...filePathsFromUriList(await blob.text()));
    }
    if (paths.length === 0) return [];
    return await pasteItemsFromClipboardPaths(paths);
  } catch {
    return [];
  }
}

function filePathsFromUriList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map(filePathFromFileUri)
    .filter((path): path is string => Boolean(path));
}

function filePathFromFileUri(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return null;
    const path = decodeURIComponent(url.pathname);
    if (url.hostname && url.hostname !== "localhost") {
      return `//${url.hostname}${path}`;
    }
    return path.replace(/^\/([a-zA-Z]:[\\/])/, "$1");
  } catch {
    return null;
  }
}

async function readClipboardHtml(): Promise<string | null> {
  if (!navigator.clipboard?.read) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!item.types.includes("text/html")) continue;
      const blob = await item.getType("text/html");
      return await blob.text();
    }
  } catch {
    return null;
  }
  return null;
}

async function pasteSystemClipboardImageIntoPane(paneId: string, directory: string): Promise<boolean> {
  const image = await clipboardImagePng();
  if (!image) return false;
  await explorerQueuePasteBlob({
    destinationDirectory: directory,
    bytes: [...image.bytes],
    preferredName: "clipboard.png",
  });
  queuePaneRefresh(paneId, directory);
  return true;
}

async function pasteItemsFromClipboardText(text: string): Promise<PasteItem[]> {
  const paths = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (paths.length === 0 || paths.some((path) => !looksLikeClipboardPath(path))) {
    return [];
  }
  return pasteItemsFromClipboardPaths(paths);
}

async function pasteItemsFromClipboardPaths(paths: string[]): Promise<PasteItem[]> {
  try {
    const items = await Promise.all(paths.map(async (path) => {
      if (!await explorerPathExists(path)) return null;
      return {
        path,
        isDirectory: await explorerPathIsDirectory(path),
      };
    }));
    return items.every((item): item is PasteItem => item !== null) ? items : [];
  } catch {
    return [];
  }
}

function looksLikeClipboardPath(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}

function clipboardPayloadForPane(pane: PaneExplorerState | undefined): ClipboardPayload {
  const selected = new Set(pane?.selectedIds ?? []);
  const entries = pane?.listing?.entries.filter((entry) => selected.has(entry.id)) ?? [];
  return {
    kind: entries.length > 0 ? "file_refs" : "empty",
    origin: "local_misty",
    payload_id: "",
    source_device_id: "",
    source_device_name: "",
    revision: 0,
    created_unix_ms: 0,
    text: "",
    html: "",
    file_refs: entries.map((entry) => ({
      display_name: entry.name,
      local_path: entry.location.kind === "local" ? entry.path : "",
      provider_type: entry.location.providerType ?? "",
      remote_name: entry.location.remoteName ?? "",
      remote_path: entry.location.remotePath ?? "",
      is_dir: entry.kind === "folder",
    })),
    images: [],
  };
}

async function writeNativeOrTextClipboardForSelection(
  pane: PaneExplorerState | undefined,
): Promise<void> {
  const entries = selectedFileEntriesForPane(pane);
  if (entries.length === 0) return;

  const localItems = entries
    .filter((entry) => entry.location.kind === "local")
    .map((entry) => ({ path: entry.path, isDirectory: entry.kind === "folder" }));
  if (localItems.length === entries.length && await clipboardWriteFileRefs(localItems)) {
    return;
  }

  const remoteEntries = entries.filter((entry) => entry.location.kind !== "local");
  if (remoteEntries.length > 0) {
    useExplorerStore.getState().pushNotification(
      `Preparing ${remoteEntries.length} remote ${remoteEntries.length === 1 ? "item" : "items"} for clipboard...`,
      "info",
      3500,
      false,
    );
  }

  const preparedRemoteResult = remoteEntries.length === 0
    ? null
    : await explorerPrepareDragItems({
      items: remoteEntries.map((entry) => ({
        path: entry.path,
        isDirectory: entry.kind === "folder",
        sizeBytes: entry.sizeBytes,
        remoteModified: entry.remoteModified,
      })),
    });
  if (preparedRemoteResult?.skipped.length) {
    useExplorerStore.getState().pushNotification(
      `Skipped ${preparedRemoteResult.skipped.length} remote ${preparedRemoteResult.skipped.length === 1 ? "item" : "items"} while preparing clipboard.`,
      "error",
      4500,
      false,
    );
  }
  const preparedRemoteItems = preparedRemoteResult?.items.map((item) => ({
    path: item.localPath,
    isDirectory: item.isDirectory,
  })) ?? [];
  const nativeItems = [...localItems, ...preparedRemoteItems];
  if (nativeItems.length > 0 && await clipboardWriteFileRefs(nativeItems)) {
    if (preparedRemoteItems.length > 0) {
      useExplorerStore.getState().pushNotification(
        `Prepared ${preparedRemoteItems.length} remote ${preparedRemoteItems.length === 1 ? "item" : "items"} for clipboard.`,
        "success",
        3500,
        false,
      );
    }
    return;
  }

  await writeText(entries.map((entry) => clipboardTextForEntry(entry)).join("\n"));
}

function explorerClipboardFromPayload(payload: ClipboardPayload): ExplorerClipboardState | null {
  if (payload.kind !== "file_refs" || payload.file_refs.length === 0) return null;
  const items = payload.file_refs
    .map(pasteItemFromClipboardRef)
    .filter((item): item is PasteItem => item !== null);
  return items.length > 0 ? { items, operation: "copy" } : null;
}

function selectedFileEntriesForPane(pane: PaneExplorerState | undefined): FileEntry[] {
  if (!pane?.listing) return [];
  if (pane.listing.path === "misty://trash") return [];
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter((entry) => selected.has(entry.id) && isFileMasterEntry(entry));
}

function clipboardTextForEntry(entry: FileEntry): string {
  if (entry.location.kind === "local") return entry.path;
  const provider = entry.location.providerType ? `${entry.location.providerType}/` : "";
  const remoteName = entry.location.remoteName ?? "";
  const remotePath = entry.location.remotePath ?? entry.path;
  return `${provider}${remoteName}:${remotePath}`;
}

function pasteItemFromClipboardRef(fileRef: ClipboardPayload["file_refs"][number]): PasteItem | null {
  if (fileRef.local_path.trim()) {
    return { path: fileRef.local_path, isDirectory: fileRef.is_dir };
  }
  if (!fileRef.provider_type.trim() || !fileRef.remote_name.trim() || !fileRef.remote_path.trim()) {
    return null;
  }
  const environment = useAppStore.getState().app?.environment;
  if (!environment?.mountPath) return null;
  const settingsMountPath = selectAdvancedPreferences(useSettingsStore.getState().settings?.document).mountPath;
  const mountPath = resolveMountRoot(environment.homeDir, settingsMountPath || environment.mountPath);
  return {
    path: remoteClipboardVirtualPath(mountPath, fileRef.provider_type, fileRef.remote_name, fileRef.remote_path),
    isDirectory: fileRef.is_dir,
  };
}

function remoteClipboardVirtualPath(
  mountPath: string,
  _providerType: string,
  remoteName: string,
  remotePath: string,
): string {
  const base = [mountPath, remoteName]
    .map((part, index) => index === 0 ? part.replace(/\/+$/, "") : part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  const child = remotePath.trim().replace(/^\/+/, "");
  return child ? `${base}/${child}` : base;
}

function resolveMountRoot(homePath: string, configuredPath: string): string {
  if (configuredPath.startsWith("/")) return configuredPath.replace(/\/+$/, "");
  return `${homePath.replace(/\/+$/, "")}/${configuredPath.replace(/^\/+|\/+$/g, "")}`;
}

async function publishDesktopNotification(
  notification: ExplorerNotification,
  enabled: boolean,
): Promise<void> {
  if (!enabled || typeof Notification === "undefined") return;
  try {
    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== "granted") return;
    const title = notification.type === "error"
      ? "Misty needs attention"
      : notification.type === "success"
        ? "Misty completed an action"
        : "Misty";
    new Notification(title, {
      body: notification.message,
      tag: `misty-${notification.id}`,
    });
  } catch {
    // Some webviews disable the Web Notification API; in-app Activity still records the event.
  }
}

function playNotificationSound(type: ExplorerNotificationType): void {
  try {
    const AudioContextConstructor = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = type === "error" ? 220 : type === "success" ? 660 : 440;
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
    window.setTimeout(() => void context.close(), 260);
  } catch {
    // Audio output can be unavailable or blocked until user interaction.
  }
}

function applyNavigationResult(
  pane: PaneExplorerState,
  listing: DirectoryListing,
  mode: NavigationMode,
): PaneExplorerState {
  const previousPath = pane.listing?.path ?? "";
  const selectedIdsByPath = previousPath
    ? { ...pane.selectedIdsByPath, [previousPath]: pane.selectedIds }
    : { ...pane.selectedIdsByPath };
  let backHistory = [...pane.backHistory];
  let forwardHistory = [...pane.forwardHistory];

  if (mode === "push" && previousPath && !samePath(previousPath, listing.path)) {
    if (!samePath(backHistory[backHistory.length - 1] ?? "", previousPath)) backHistory.push(previousPath);
    forwardHistory = [];
  } else if (mode === "back" && previousPath) {
    backHistory = backHistory.slice(0, -1);
    if (!samePath(forwardHistory[forwardHistory.length - 1] ?? "", previousPath)) forwardHistory.push(previousPath);
  } else if (mode === "forward" && previousPath) {
    forwardHistory = forwardHistory.slice(0, -1);
    if (!samePath(backHistory[backHistory.length - 1] ?? "", previousPath)) backHistory.push(previousPath);
  }

  const visibleIds = new Set(listing.entries.map((entry) => entry.id));
  const selectedIds = (selectedIdsByPath[listing.path] ?? []).filter((id) => visibleIds.has(id));
  return {
    ...pane,
    listing,
    selectedIds,
    selectedIdsByPath,
    backHistory,
    forwardHistory,
    loading: false,
    error: null,
  };
}

function directoryListingsEqual(left: DirectoryListing, right: DirectoryListing): boolean {
  if (left === right) return true;
  if (
    left.path !== right.path
    || left.parentPath !== right.parentPath
    || left.totalCount !== right.totalCount
    || left.hiddenCount !== right.hiddenCount
    || left.entries.length !== right.entries.length
    || left.location.kind !== right.location.kind
  ) {
    return false;
  }
  if (left.location.kind === "remote" && right.location.kind === "remote") {
    if (
      left.location.remoteName !== right.location.remoteName
      || left.location.remotePath !== right.location.remotePath
      || left.location.providerType !== right.location.providerType
    ) {
      return false;
    }
  }
  return left.entries.every((entry, index) => fileEntriesEqual(entry, right.entries[index]));
}

function fileEntriesEqual(left: FileEntry, right: FileEntry): boolean {
  return left === right || (
    left.id === right.id
    && left.name === right.name
    && left.path === right.path
    && left.kind === right.kind
    && left.sizeBytes === right.sizeBytes
    && left.modifiedMs === right.modifiedMs
    && left.extension === right.extension
    && left.mimeType === right.mimeType
    && left.remoteModified === right.remoteModified
    && left.location.kind === right.location.kind
    && left.location.remoteName === right.location.remoteName
    && left.location.remotePath === right.location.remotePath
    && left.location.providerType === right.location.providerType
  );
}

function samePath(left: string, right: string): boolean {
  return left.replace(/\/+$/, "") === right.replace(/\/+$/, "");
}

function normalizedPath(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  return normalized || "/";
}

function libraryItemFromEntry(entry: FileEntry): ExplorerLibraryItem {
  return {
    path: entry.path,
    name: entry.name,
    id: entry.id || entry.path,
    isDir: entry.kind === "folder",
    size: entry.sizeBytes ?? 0,
    lastModified: entry.remoteModified ?? (entry.modifiedMs ? new Date(entry.modifiedMs).toISOString() : ""),
    mimeType: entry.mimeType ?? "",
    type: entry.location.kind === "remote" ? 1 : 0,
    tags: [],
  };
}

function loadPinnedPaths(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem("misty.explorer.pinnedPaths") ?? "[]");
    const pinnedPaths = Array.isArray(parsed)
      ? normalizePinnedPaths(parsed.filter((value): value is string => typeof value === "string"))
      : [];
    window.localStorage.setItem("misty.explorer.pinnedPaths", JSON.stringify(pinnedPaths));
    return pinnedPaths;
  } catch {
    return [];
  }
}

function normalizePinnedPaths(paths: string[]): string[] {
  const normalized: string[] = [];
  for (const path of paths) {
    const candidate = normalizedPath(path.trim());
    if (!candidate || normalized.some((existing) => samePath(existing, candidate))) continue;
    normalized.push(candidate);
  }
  return normalized;
}

export function scheduleExplorerWorkspaceSave(): void {
  if (!useExplorerStore.getState().initialized) return;
  if (workspaceSaveTimer !== null) window.clearTimeout(workspaceSaveTimer);
  workspaceSaveTimer = window.setTimeout(() => {
    workspaceSaveTimer = null;
    void persistExplorerWorkspace();
  }, 500);
}

function queuePaneRefresh(paneId: string, path: string, options: { immediate?: boolean } = {}): void {
  const key = `${paneId}\n${normalizedPath(path)}`;
  const pending = pendingPaneRefreshes.get(key) ?? { firstTimer: null, followupTimer: null };
  pendingPaneRefreshes.set(key, pending);

  const refresh = () => {
    const pane = useExplorerStore.getState().panes[paneId];
    if (pane?.listing?.path === path && !pane.loading) {
      void useExplorerStore.getState().loadPane(paneId, path, "replace");
    }
  };

  const clearIfIdle = () => {
    const current = pendingPaneRefreshes.get(key);
    if (current && current.firstTimer === null && current.followupTimer === null) {
      pendingPaneRefreshes.delete(key);
    }
  };

  if (options.immediate) {
    if (pending.firstTimer !== null) {
      window.clearTimeout(pending.firstTimer);
      pending.firstTimer = null;
    }
    refresh();
  } else if (pending.firstTimer === null) {
    pending.firstTimer = window.setTimeout(() => {
      pending.firstTimer = null;
      refresh();
      clearIfIdle();
    }, 650);
  }

  if (pending.followupTimer === null) {
    pending.followupTimer = window.setTimeout(() => {
      pending.followupTimer = null;
      refresh();
      clearIfIdle();
    }, 2200);
  }
}

function transferTouchesDirectory(row: TransferRecord, directoryPath: string, mountRoot: string): boolean {
  const remote = remoteBrowseTargetForPath(directoryPath, mountRoot);
  if (remote) {
    return remoteTransferMatchesDirectory(remote, row.remoteSourceName, row.remoteSourcePath)
      || remoteTransferMatchesDirectory(remote, row.remoteDestName, row.remoteDestPath);
  }
  return localTransferMatchesDirectory(directoryPath, row.localSourcePath)
    || localTransferMatchesDirectory(directoryPath, row.localDestPath);
}

function localTransferMatchesDirectory(directoryPath: string, candidatePath: string): boolean {
  if (!directoryPath || !candidatePath) return false;
  return normalizedPath(directoryPath) === parentDirectory(candidatePath);
}

function remoteTransferMatchesDirectory(
  current: { remoteName: string; remotePath: string },
  remoteName: string,
  remotePath: string,
): boolean {
  if (!remoteName || current.remoteName !== remoteName || !remotePath) return false;
  return normalizedPath(current.remotePath) === remoteParentDirectory(remotePath);
}

function remoteBrowseTargetForPath(path: string, mountRoot: string): { remoteName: string; remotePath: string } | null {
  const cleanPath = normalizedPath(path);
  const cleanMount = normalizedPath(mountRoot);
  if (cleanPath !== cleanMount && !cleanPath.startsWith(`${cleanMount}/`)) return null;
  const parts = cleanPath.slice(cleanMount.length).split("/").filter(Boolean);
  if (parts.length < 1) return null;
  return {
    remoteName: parts[0],
    remotePath: parts.length > 1 ? `/${parts.slice(1).join("/")}` : "/",
  };
}

function parentDirectory(path: string): string {
  const normalized = normalizedPath(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return "/";
  return normalized.slice(0, slash);
}

function remoteParentDirectory(path: string): string {
  const parent = parentDirectory(path);
  return parent === "/" ? "" : parent;
}

export function explorerWorkspaceNeedsSave(
  state: ReturnType<typeof useExplorerStore.getState>,
  previous: ReturnType<typeof useExplorerStore.getState>,
): boolean {
  if (
    state.viewMode !== previous.viewMode
    || state.paneViewModes !== previous.paneViewModes
    || state.sort !== previous.sort
    || state.paneSorts !== previous.paneSorts
    || state.showHidden !== previous.showHidden
    || state.paneShowHidden !== previous.paneShowHidden
    || state.sidebarVisible !== previous.sidebarVisible
    || state.previewVisible !== previous.previewVisible
    || state.sidebarWidth !== previous.sidebarWidth
    || state.previewWidth !== previous.previewWidth
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

async function persistExplorerWorkspace(): Promise<void> {
  const explorer = useExplorerStore.getState();
  const multi = useMultiPanelStore.getState();
  if (!explorer.initialized || multi.tabs.length === 0) return;

  const document = workspaceDocumentCache ?? defaultWorkspaceDocument();
  const workspaceId = document.active_workspace_id || document.workspaces[0]?.id || "workspace_0";
  const existing = document.workspaces.find((workspace) => workspace.id === workspaceId);
  const tabs = multi.tabs.map((tab, index) => ({
    idx: tabIndex(tab.id, index),
    title: tab.title,
    explorer: nativeExplorerSnapshot(tab, explorer.panes, multi.closedPanes, multi.nextPaneIndex),
  }));
  const activeTab = multi.tabs.find((tab) => tab.id === multi.activeTabId) ?? multi.tabs[0];
  const workspace: NativeWorkspace = {
    id: workspaceId,
    title: existing?.title || "Workspace 1",
    sidebar_width: explorer.sidebarWidth,
    sidebar_visible: explorer.sidebarVisible,
    inspector_width: explorer.previewWidth,
    inspector_visible: explorer.previewVisible,
    active_tab_idx: tabIndex(activeTab.id, 0),
    next_tab_idx: multi.nextTabIndex,
    tabs,
    explorer: tabs.find((tab) => tab.idx === tabIndex(activeTab.id, 0))?.explorer ?? tabs[0].explorer,
  };
  const workspaces = document.workspaces.some((candidate) => candidate.id === workspaceId)
    ? document.workspaces.map((candidate) => candidate.id === workspaceId ? workspace : candidate)
    : [...document.workspaces, workspace];
  const nextDocument: NativeWorkspaceDocument = {
    ...document,
    schema_version: 1,
    active_workspace_id: workspaceId,
    next_workspace_idx: Math.max(document.next_workspace_idx, workspaceIndex(workspaceId) + 1),
    workspaces,
  };
  try {
    const savedDocument = await saveWorkspaceDocument(nextDocument);
    useExplorerStore.setState(workspaceMetadata(savedDocument));
  } catch (error) {
    useExplorerStore.setState({ operationError: `Workspace save failed: ${errorText(error)}` });
  }
}

async function applyWorkspaceDocument(document: NativeWorkspaceDocument, homePath: string): Promise<void> {
  workspaceDocumentCache = document;
  const restored = restoreNativeWorkspace(document, homePath);
  if (!restored) {
    useExplorerStore.setState(workspaceMetadata(document));
    return;
  }

  const multi = useMultiPanelStore.getState();
  if (!multi.hydrate(restored.multiPanel)) {
    multi.initialize(homePath, titleFromPath(homePath));
    useExplorerStore.setState({
      ...workspaceMetadata(document),
      initialized: true,
      inlineEdit: null,
      dialog: null,
      contextMenu: { open: false, x: 0, y: 0, paneId: "", entryId: null },
      operationError: "Workspace layout could not be restored, so Misty opened a clean file pane.",
    });
    await useExplorerStore.getState().loadPane(useMultiPanelStore.getState().activePaneId || "explorer-pane-0", homePath, "replace");
    return;
  }
  const hydratedMulti = useMultiPanelStore.getState();
  useExplorerStore.setState({
    ...workspaceMetadata(document),
    panes: restored.panes,
    sidebarVisible: restored.workspace.sidebar_visible,
    previewVisible: restored.workspace.inspector_visible,
    sidebarWidth: clamp(restored.workspace.sidebar_width, 212, 380),
    previewWidth: clamp(restored.workspace.inspector_width, 240, 420),
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

  const activeTab = hydratedMulti.tabs.find((tab) => tab.id === hydratedMulti.activeTabId)
    ?? hydratedMulti.tabs[0];
  await Promise.all(
    (activeTab?.panes ?? []).map((pane) => {
      const restoredPane = restored.panes[pane.id];
      return restoredPane?.listing ? useExplorerStore.getState().loadPane(pane.id, restoredPane.listing.path, "replace") : Promise.resolve();
    }),
  );
}

async function saveWorkspaceDocument(document: NativeWorkspaceDocument): Promise<NativeWorkspaceDocument> {
  if (workspaceSaveTimer !== null) {
    window.clearTimeout(workspaceSaveTimer);
    workspaceSaveTimer = null;
  }
  const saved = await workspacesSave(document);
  workspaceDocumentCache = saved;
  return saved;
}

function defaultWorkspaceDocument(): NativeWorkspaceDocument {
  return {
    schema_version: 1,
    active_workspace_id: "workspace_0",
    next_workspace_idx: 1,
    workspaces: [],
  };
}

function consumeExplorerWorkspaceResetFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const shouldReset = window.localStorage.getItem(explorerWorkspaceResetKey) === "1";
    if (shouldReset) window.localStorage.removeItem(explorerWorkspaceResetKey);
    return shouldReset;
  } catch {
    return false;
  }
}

function workspaceMetadata(document: NativeWorkspaceDocument): Pick<ExplorerStore, "workspaceEntries" | "activeWorkspaceId" | "activeWorkspaceTitle"> {
  const workspaceEntries = document.workspaces.map((workspace, index) => ({
    id: workspace.id || `workspace_${index}`,
    title: workspace.title || `Workspace ${index + 1}`,
  }));
  const activeWorkspace = workspaceEntries.find((workspace) => workspace.id === document.active_workspace_id)
    ?? workspaceEntries[0];
  return {
    workspaceEntries,
    activeWorkspaceId: activeWorkspace?.id ?? document.active_workspace_id,
    activeWorkspaceTitle: activeWorkspace?.title ?? "Workspace 1",
  };
}

function nextWorkspaceIndex(document: NativeWorkspaceDocument): number {
  const fromDocument = Number.isFinite(document.next_workspace_idx) ? document.next_workspace_idx : 0;
  const fromIds = document.workspaces
    .map((workspace) => workspaceIndex(workspace.id) + 1)
    .reduce((max, index) => Math.max(max, index), 0);
  return Math.max(0, fromDocument, fromIds);
}

function uniqueWorkspaceTitle(title: string, workspaces: Array<{ title: string }>): string {
  const base = title.trim() || "Workspace";
  const names = new Set(workspaces.map((workspace) => workspace.title.trim()).filter(Boolean));
  if (!names.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!names.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

function defaultNativeWorkspace(
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
    panes: [{
      pane_id: paneId,
      tabs: [{
        context_key: "FileExplorer",
        state_key: paneId,
        title: titleFromPath(homePath),
        restore_state: restoreState,
        idx: 0,
      }],
      closed_tabs: [],
      active_tab_idx: 0,
    }],
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
    tabs: [{
      idx: 0,
      title: titleFromPath(homePath),
      explorer: explorerSnapshot,
    }],
    explorer: explorerSnapshot,
  };
}

function restoreNativeWorkspace(document: NativeWorkspaceDocument, homePath: string): {
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
  const workspace = document.workspaces.find((candidate) => candidate.id === document.active_workspace_id)
    ?? document.workspaces[0];
  if (!workspace) return null;
  const nativeTabs = workspace.tabs.length > 0
    ? workspace.tabs
    : [{ idx: 0, title: workspace.title || "Home", explorer: workspace.explorer }];
  const panes: Record<string, PaneExplorerState> = {};
  const paneSorts: Record<string, ExplorerSortState> = {};
  const paneShowHidden: Record<string, boolean> = {};
  const paneViewModes: Record<string, ExplorerViewMode> = {};
  let showHidden = false;
  let viewMode: ExplorerViewMode = "list";
  let sort: ExplorerSortState = { column: "name", direction: "asc" };
  const tabs = nativeTabs.map((nativeTab, tabPosition): MultiPanelTab => {
    const explorer = nativeTab.explorer;
    const paneSnapshots = explorer.panes.length > 0
      ? explorer.panes
      : [{ pane_id: `explorer-pane-${tabPosition}`, tabs: [], closed_tabs: [], active_tab_idx: -1 }];
    const restoredPanes = paneSnapshots.map((paneSnapshot, panePosition): MultiPanelPane => {
      const tabSnapshot = paneSnapshot.tabs.find((tab) => tab.idx === paneSnapshot.active_tab_idx)
        ?? paneSnapshot.tabs[0];
      const restored = parsePaneRestoreState(tabSnapshot?.restore_state, homePath);
      const paneId = paneSnapshot.pane_id || `explorer-pane-${tabPosition}-${panePosition}`;
      panes[paneId] = {
        ...emptyPaneState(),
        listing: placeholderListing(restored.path),
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
      return { id: paneId, path: restored.path, title: tabSnapshot?.title || titleFromPath(restored.path) };
    });
    const lanes = normalizeWorkspaceLanes(explorer.grid_pane_ids, restoredPanes.map((pane) => pane.id));
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
      layout: {
        orientation: lanes.length > 1 ? "vertical" : "horizontal",
        lanes,
        paneIds: flattenWorkspaceLanes(lanes),
        gridSplitRatio: clampRatio(explorer.grid_split_ratio),
        laneSplitRatios: [
          clampRatio(explorer.lane_split_ratios[0] ?? 0.5),
          clampRatio(explorer.lane_split_ratios[1] ?? 0.5),
        ],
      },
    };
  });
  const activeTabId = `explorer-tab-${workspace.active_tab_idx >= 0 ? workspace.active_tab_idx : nativeTabs[0].idx}`;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const closedPanes = nativeTabs
    .flatMap((tab, tabPosition) => tab.explorer.closed_panes.map((snapshot) => ({
      snapshot,
      tabId: `explorer-tab-${tab.idx >= 0 ? tab.idx : tabPosition}`,
    })))
    .map(({ snapshot, tabId }, index): MultiPanelClosedPane => {
      const tabSnapshot = snapshot.tabs.find((tab) => tab.idx === snapshot.active_tab_idx) ?? snapshot.tabs[0];
      const restored = parsePaneRestoreState(tabSnapshot?.restore_state, homePath);
      const paneId = snapshot.pane_id || `closed-pane-${index}`;
      if (!panes[paneId]) {
        panes[paneId] = {
          ...emptyPaneState(),
          listing: placeholderListing(restored.path),
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
          title: tabSnapshot?.title || titleFromPath(restored.path),
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

function nativeExplorerSnapshot(
  tab: MultiPanelTab,
  paneStates: Record<string, PaneExplorerState>,
  closedPanes: MultiPanelClosedPane[],
  nextPaneIndex: number,
): NativeWorkspaceExplorerSnapshot {
  const explorerState = useExplorerStore.getState();
  const panes = tab.panes.map((pane, index) => {
    const state = paneStates[pane.id] ?? emptyPaneState();
    const paneSort = sortForPane(explorerState, pane.id);
    return {
      pane_id: pane.id,
      tabs: [{
        context_key: "FileExplorer",
        state_key: pane.id,
        title: pane.title,
        restore_state: JSON.stringify({
          current_path: state.listing?.path ?? pane.path,
          show_hidden: showHiddenForPane(explorerState, pane.id),
          grid_view: viewModeForPane(explorerState, pane.id) === "grid",
          sort_column: paneSort.column,
          sort_direction: paneSort.direction,
          back_history: state.backHistory,
          forward_history: state.forwardHistory,
        }),
        idx: index,
      }],
      closed_tabs: [],
      active_tab_idx: index,
    };
  });
  const closed = closedPanes.filter((closedPane) => closedPane.tabId === tab.id).map((closedPane, index) => {
    const state = paneStates[closedPane.pane.id] ?? emptyPaneState();
    const paneSort = sortForPane(explorerState, closedPane.pane.id);
    return {
      pane_id: closedPane.pane.id,
      tabs: [{
        context_key: "FileExplorer",
        state_key: closedPane.pane.id,
        title: closedPane.pane.title,
        restore_state: JSON.stringify({
          current_path: closedPane.pane.path,
          show_hidden: showHiddenForPane(explorerState, closedPane.pane.id),
          grid_view: viewModeForPane(explorerState, closedPane.pane.id) === "grid",
          sort_column: paneSort.column,
          sort_direction: paneSort.direction,
          back_history: state.backHistory,
          forward_history: state.forwardHistory,
        }),
        idx: index,
      }],
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
    grid_pane_ids: workspaceLanesForTab(tab),
    grid_split_ratio: clampRatio(tab.layout.gridSplitRatio ?? 0.5),
    lane_split_ratios: [
      clampRatio(tab.layout.laneSplitRatios?.[0] ?? 0.5),
      clampRatio(tab.layout.laneSplitRatios?.[1] ?? 0.5),
    ],
    panes,
    closed_panes: closed,
  };
}

function workspaceLanesForTab(tab: MultiPanelTab): string[][] {
  const paneIds = new Set(tab.panes.map((pane) => pane.id));
  return normalizeWorkspaceLanes(tab.layout.lanes ?? lanesFromFlatWorkspaceLayout(tab), tab.panes.map((pane) => pane.id))
    .map((lane) => lane.filter((paneId) => paneIds.has(paneId)));
}

function lanesFromFlatWorkspaceLayout(tab: MultiPanelTab): string[][] {
  const ids = tab.layout.paneIds.slice(0, 4);
  if (ids.length <= 1) return ids.length ? [[ids[0]]] : [];
  if (tab.layout.orientation === "horizontal") return [ids.slice(0, 2)];
  if (ids.length === 2) return [[ids[0]], [ids[1]]];
  return [ids.slice(0, 2), ids.slice(2, 4)];
}

function normalizeWorkspaceLanes(sourceLanes: string[][], fallbackPaneIds: string[]): string[][] {
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

function flattenWorkspaceLanes(lanes: string[][]): string[] {
  return lanes.flat().slice(0, 4);
}

function parsePaneRestoreState(value: string | undefined, fallbackPath: string): {
  path: string;
  showHidden: boolean;
  gridView: boolean;
  sort: ExplorerSortState;
  backHistory: string[];
  forwardHistory: string[];
} {
  try {
    const parsed = JSON.parse(value || "{}") as Record<string, unknown>;
    return {
      path: typeof parsed.current_path === "string" && parsed.current_path ? parsed.current_path : fallbackPath,
      showHidden: parsed.show_hidden === true,
      gridView: parsed.grid_view === true,
      sort: parseSortState(parsed.sort_column, parsed.sort_direction),
      backHistory: stringArray(parsed.back_history),
      forwardHistory: stringArray(parsed.forward_history),
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

function placeholderListing(path: string): DirectoryListing {
  return {
    path,
    parentPath: null,
    location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
    entries: [],
    totalCount: 0,
    hiddenCount: 0,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseSortState(column: unknown, direction: unknown): ExplorerSortState {
  const parsedColumn: ExplorerSortColumn =
    column === "modified" || column === "size" || column === "type" || column === "name" ? column : "name";
  const parsedDirection: ExplorerSortDirection = direction === "desc" ? "desc" : "asc";
  return { column: parsedColumn, direction: parsedDirection };
}

function sortForPane(
  state: Pick<ExplorerStore, "paneSorts" | "sort">,
  paneId: string,
): ExplorerSortState {
  return state.paneSorts[paneId] ?? state.sort;
}

function viewModeForPane(
  state: Pick<ExplorerStore, "paneViewModes" | "viewMode">,
  paneId: string,
): ExplorerViewMode {
  return state.paneViewModes[paneId] ?? state.viewMode;
}

function showHiddenForPane(
  state: Pick<ExplorerStore, "paneShowHidden" | "showHidden">,
  paneId: string,
): boolean {
  return state.paneShowHidden[paneId] ?? state.showHidden;
}

function tabIndex(id: string, fallback: number): number {
  const parsed = Number(id.match(/(\d+)$/)?.[1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function workspaceIndex(id: string): number {
  const parsed = Number(id.match(/(\d+)$/)?.[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.9, Math.max(0.1, value));
}

function titleFromPath(path: string): string {
  if (path === "misty://recent") return "Recent";
  if (path === "misty://starred") return "Starred";
  if (path === "misty://trash") return "Trash";
  const clean = path.replace(/\/+$/, "");
  return clean.split("/").filter(Boolean).pop() || clean || "Home";
}

function sortListing(listing: DirectoryListing, sort: ExplorerSortState): DirectoryListing {
  const entries = [...listing.entries].sort((left, right) => {
    const folderBias = Number(right.kind === "folder") - Number(left.kind === "folder");
    if (folderBias !== 0) return folderBias;
    const direction = sort.direction === "asc" ? 1 : -1;
    return compareEntries(left, right, sort.column) * direction;
  });
  return { ...listing, entries };
}

function compareEntries(left: FileEntry, right: FileEntry, column: ExplorerSortColumn): number {
  if (column === "modified") {
    return compareNullableNumber(left.modifiedMs, right.modifiedMs)
      || compareText(left.remoteModified, right.remoteModified)
      || compareText(left.name, right.name);
  }
  if (column === "size") {
    return compareNullableNumber(left.sizeBytes, right.sizeBytes) || compareText(left.name, right.name);
  }
  if (column === "type") {
    return compareText(typeLabel(left), typeLabel(right)) || compareText(left.name, right.name);
  }
  return compareText(left.name, right.name);
}

function compareNullableNumber(left: number | null, right: number | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareText(left: string | null, right: string | null): number {
  return (left ?? "").localeCompare(right ?? "", undefined, { numeric: true, sensitivity: "base" });
}

function typeLabel(entry: FileEntry): string {
  return entry.kind === "folder" ? "Folder" : entry.mimeType || entry.extension || entry.kind;
}
