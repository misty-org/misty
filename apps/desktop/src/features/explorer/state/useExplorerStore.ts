import { create } from "zustand";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  clipboardSetLocal,
  clipboardSnapshot,
  explorerListDirectory,
  explorerOpenAssociation,
  explorerSetOpenAssociation,
  explorerOpenWith,
  explorerPathExists,
  explorerPathIsDirectory,
  explorerPrepareOpenItem,
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
  FileEntry,
  NativeWorkspace,
  NativeWorkspaceDocument,
  NativeWorkspaceExplorerSnapshot,
  PasteItem,
  TransferRecord,
} from "../../../api/types";
import { errorText } from "../../../shared/format";
import { useMultiPanelStore } from "../../../shared/multipanel/useMultiPanelStore";
import type { MultiPanelPane, MultiPanelTab } from "../../../shared/multipanel/types";

export type ExplorerViewMode = "list" | "grid";
export type ExplorerSortColumn = "name" | "modified" | "size" | "type";
export type ExplorerSortDirection = "asc" | "desc";
export type ExplorerUploadSourceKind = "files" | "folders";

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
  error: string | null;
}

type NavigationMode = "push" | "back" | "forward" | "replace";

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
  | { kind: "delete"; paneId: string; paths: string[] }
  | { kind: "batchRename"; paneId: string; items: ExplorerBatchRenameItem[] }
  | null;

interface ExplorerStore {
  panes: Record<string, PaneExplorerState>;
  viewMode: ExplorerViewMode;
  sort: ExplorerSortState;
  showHidden: boolean;
  operationError: string | null;
  clipboard: ExplorerClipboardState | null;
  pinnedPaths: string[];
  contextMenu: ExplorerContextMenuState;
  inlineEdit: ExplorerInlineEditState | null;
  dialog: ExplorerDialogState;
  initialized: boolean;
  sidebarVisible: boolean;
  previewVisible: boolean;
  sidebarWidth: number;
  previewWidth: number;
  initialize: (homePath: string) => Promise<void>;
  loadPane: (paneId: string, path: string, mode?: NavigationMode) => Promise<void>;
  navigatePane: (paneId: string, path: string) => Promise<void>;
  navigateBack: (paneId: string) => Promise<void>;
  navigateForward: (paneId: string) => Promise<void>;
  navigateParent: (paneId: string) => Promise<void>;
  refreshPane: (paneId: string) => Promise<void>;
  setViewMode: (mode: ExplorerViewMode) => void;
  setSort: (column: ExplorerSortColumn) => void;
  setCommandQuery: (paneId: string, query: string) => void;
  toggleHidden: () => Promise<void>;
  selectEntry: (paneId: string, entryId: string, options?: { toggle?: boolean; range?: boolean }) => void;
  clearSelection: (paneId: string) => void;
  openEntry: (paneId: string, entry: FileEntry) => Promise<void>;
  openWithSelected: (paneId: string) => Promise<void>;
  createItem: (paneId: string, kind: CreateItemKind, name?: string) => Promise<void>;
  renameSelected: (paneId: string, name?: string) => Promise<void>;
  deleteSelected: (paneId: string) => Promise<void>;
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
}

let workspaceDocumentCache: NativeWorkspaceDocument | null = null;
let workspaceSaveTimer: number | null = null;
let initializationInFlight = false;
let transferRefreshObserverReady = false;
let transferRefreshWatermarkMs = 0;
let transferRefreshStatuses: Record<number, string> = {};

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
    error: null,
  };
}

export const useExplorerStore = create<ExplorerStore>((set, get) => ({
  panes: {},
  viewMode: "list",
  showHidden: false,
  operationError: null,
  clipboard: null,
  pinnedPaths: loadPinnedPaths(),
  contextMenu: { open: false, x: 0, y: 0, paneId: "", entryId: null },
  inlineEdit: null,
  dialog: null,
  initialized: false,
  sidebarVisible: true,
  previewVisible: true,
  sidebarWidth: 260,
  previewWidth: 300,
  sort: { column: "name", direction: "asc" },

  initialize: async (homePath) => {
    const multi = useMultiPanelStore.getState();
    if (multi.tabs.length > 0 || get().initialized || initializationInFlight) return;
    initializationInFlight = true;
    try {
      const [workspaceDocument, processClipboard] = await Promise.all([
        workspacesSnapshot(),
        clipboardSnapshot(),
      ]);
      workspaceDocumentCache = workspaceDocument;
      const restoredClipboard = explorerClipboardFromPayload(processClipboard.local);
      const restored = restoreNativeWorkspace(workspaceDocumentCache, homePath);
      if (restored) {
        multi.hydrate(restored.multiPanel);
        set({
          panes: restored.panes,
          sidebarVisible: restored.workspace.sidebar_visible,
          previewVisible: restored.workspace.inspector_visible,
          sidebarWidth: clamp(restored.workspace.sidebar_width, 212, 380),
          previewWidth: clamp(restored.workspace.inspector_width, 240, 420),
          showHidden: restored.showHidden,
          viewMode: restored.viewMode,
          sort: restored.sort,
          clipboard: restoredClipboard,
          initialized: true,
        });
        await Promise.all(
          Object.entries(restored.panes).map(([paneId, pane]) =>
            pane.listing ? get().loadPane(paneId, pane.listing.path, "replace") : Promise.resolve(),
          ),
        );
        initializationInFlight = false;
        return;
      }
    } catch (error) {
      set({ operationError: `Workspace restore failed: ${errorText(error)}` });
    }
    multi.initialize(homePath, titleFromPath(homePath));
    set({ initialized: true });
    await get().loadPane(multi.activePaneId || "explorer-pane-0", homePath, "replace");
    initializationInFlight = false;
  },

  loadPane: async (paneId, path, mode = "push") => {
    set((state) => ({
      inlineEdit: state.inlineEdit?.paneId === paneId ? null : state.inlineEdit,
      panes: {
        ...state.panes,
        [paneId]: { ...(state.panes[paneId] ?? emptyPaneState()), loading: true, error: null },
      },
    }));
    try {
      const listing = sortListing(await explorerListDirectory({ path, showHidden: get().showHidden }), get().sort);
      useMultiPanelStore.getState().updateActiveTabPath(paneId, listing.path, titleFromPath(listing.path));
      set((state) => ({
        panes: {
          ...state.panes,
          [paneId]: applyNavigationResult(state.panes[paneId] ?? emptyPaneState(), listing, mode),
        },
      }));
    } catch (error) {
      set((state) => ({
        panes: {
          ...state.panes,
          [paneId]: { ...(state.panes[paneId] ?? emptyPaneState()), loading: false, error: errorText(error) },
        },
      }));
    }
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
      await get().loadPane(paneId, path, "replace");
    }
  },

  setViewMode: (viewMode) => set((state) => state.viewMode === viewMode ? state : { viewMode }),
  setSort: (column) => {
    set((state) => {
      const direction: ExplorerSortDirection =
        state.sort.column === column && state.sort.direction === "asc" ? "desc" : "asc";
      const sort = { column, direction };
      const panes = Object.fromEntries(
        Object.entries(state.panes).map(([paneId, pane]) => [
          paneId,
          pane.listing ? { ...pane, listing: sortListing(pane.listing, sort) } : pane,
        ]),
      );
      return { sort, panes };
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

  toggleHidden: async () => {
    const showHidden = !get().showHidden;
    set({ showHidden });
    const paneEntries = Object.entries(get().panes);
    await Promise.all(
      paneEntries.map(([paneId, pane]) => (pane.listing ? get().loadPane(paneId, pane.listing.path, "replace") : Promise.resolve())),
    );
  },

  selectEntry: (paneId, entryId, options = {}) => {
    set((state) => {
      const pane = state.panes[paneId] ?? emptyPaneState();
      const path = pane.listing?.path ?? "";
      const entryIndex = pane.listing?.entries.findIndex((entry) => entry.id === entryId) ?? -1;
      let selectedIds: string[];
      if (options.range && pane.listing && entryIndex >= 0) {
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
      return {
        panes: {
          ...state.panes,
          [paneId]: {
            ...pane,
            selectedIds,
            selectedIdsByPath: { ...pane.selectedIdsByPath, [path]: selectedIds },
            lastSelectedIndexByPath: entryIndex >= 0
              ? { ...pane.lastSelectedIndexByPath, [path]: entryIndex }
              : pane.lastSelectedIndexByPath,
          },
        },
      };
    });
  },

  clearSelection: (paneId) => {
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) return state;
      const path = pane.listing?.path ?? "";
      return {
        panes: {
          ...state.panes,
          [paneId]: {
            ...pane,
            selectedIds: [],
            selectedIdsByPath: { ...pane.selectedIdsByPath, [path]: [] },
          },
        },
      };
    });
  },

  openEntry: async (paneId, entry) => {
    if (entry.kind === "folder" || entry.kind === "symlink") {
      await get().loadPane(paneId, entry.path);
      return;
    }
    get().selectEntry(paneId, entry.id);
    try {
      set({ operationError: null });
      const localPath = await localPathForEntry(entry);
      const applicationPath = await associationForPath(entry.path);
      if (applicationPath) {
        await explorerOpenWith(applicationPath, localPath);
      } else {
        await openPath(localPath);
      }
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

  createItem: async (paneId, kind, name) => {
    const pane = get().panes[paneId];
    const directory = pane?.listing?.path;
    if (!directory) return;
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
      get().clearSelection(paneId);
      queuePaneRefresh(paneId, pane?.listing?.path ?? entry.path);
    } catch (error) {
      set({ operationError: errorText(error) });
    }
  },

  deleteSelected: async (paneId) => {
    const pane = get().panes[paneId];
    const paths = selectedPathsForPane(pane);
    if (paths.length === 0) return;
    set({ dialog: { kind: "delete", paneId, paths } });
  },

  confirmDialog: async () => {
    const dialog = get().dialog;
    if (!dialog) return;
    if (dialog.kind === "delete") {
      set({ dialog: null });
      try {
        set({ operationError: null });
        const directory = get().panes[dialog.paneId]?.listing?.path;
        await explorerQueueDeleteItems({ paths: dialog.paths });
        get().clearSelection(dialog.paneId);
        if (directory) queuePaneRefresh(dialog.paneId, directory);
      } catch (error) {
        set({ operationError: errorText(error) });
      }
      return;
    }

    const validatedItems = validateBatchRenameItems(dialog.items);
    if (validatedItems.some((item) => item.error)) {
      set({ dialog: { ...dialog, items: validatedItems } });
      return;
    }
    const items = validatedItems
      .map((item) => ({
        item,
        effectiveName: `${item.value.trim()}${item.lockedExtension}`,
      }))
      .filter(({ item, effectiveName }) => effectiveName !== item.originalName)
      .map(({ item, effectiveName }) => ({
        path: item.path,
        newName: effectiveName,
        sourceIsDirectory: item.isDirectory,
      }));
    if (items.length === 0) {
      set({ dialog: null });
      return;
    }
    set({ dialog: null });
    try {
      set({ operationError: null });
      await explorerQueueRenameItems({ items });
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

  closeDialog: () => set((state) => state.dialog ? { dialog: null } : state),

  copySelected: (paneId) => {
    const pane = get().panes[paneId];
    const items = selectedPasteItemsForPane(pane);
    if (items.length === 0) return;
    set({ clipboard: { items, operation: "copy" }, operationError: null });
    void clipboardSetLocal(clipboardPayloadForPane(pane)).catch((error) => {
      set({ operationError: `Clipboard update failed: ${errorText(error)}` });
    });
    void writeText(items.map((item) => item.path).join("\n")).catch(() => undefined);
  },

  cutSelected: (paneId) => {
    const pane = get().panes[paneId];
    const items = selectedPasteItemsForPane(pane);
    if (items.length === 0) return;
    set({ clipboard: { items, operation: "move" }, operationError: null });
    void clipboardSetLocal(clipboardPayloadForPane(pane)).catch((error) => {
      set({ operationError: `Clipboard update failed: ${errorText(error)}` });
    });
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
      const current = get().panes[paneId]?.listing?.path;
      if (current) queuePaneRefresh(paneId, current);
    } catch (error) {
      set({ operationError: `Drop failed: ${errorText(error)}` });
    }
  },

  pollTransferRefreshes: async (mountRoot) => {
    try {
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
    const normalized = path.replace(/\/+$/, "");
    const current = get().pinnedPaths;
    const pinnedPaths = current.some((candidate) => samePath(candidate, normalized))
      ? current.filter((candidate) => !samePath(candidate, normalized))
      : [...current, normalized];
    window.localStorage.setItem("misty.explorer.pinnedPaths", JSON.stringify(pinnedPaths));
    set({ pinnedPaths });
  },

  copyPath: async (path) => {
    try {
      await writeText(path);
      set({ operationError: null });
    } catch (error) {
      set({ operationError: errorText(error) });
    }
  },

  openContextMenu: (paneId, x, y, entryId = null) => {
    if (entryId) {
      get().selectEntry(paneId, entryId);
    }
    set({ contextMenu: { open: true, x, y, paneId, entryId } });
  },

  closeContextMenu: () => {
    set((state) => state.contextMenu.open ? { contextMenu: { ...state.contextMenu, open: false } } : state);
  },

  setSidebarVisible: (sidebarVisible) => set((state) => state.sidebarVisible === sidebarVisible ? state : { sidebarVisible }),
  setPreviewVisible: (previewVisible) => set((state) => state.previewVisible === previewVisible ? state : { previewVisible }),
  setSidebarWidth: (sidebarWidth) => set((state) => state.sidebarWidth === sidebarWidth ? state : { sidebarWidth }),
  setPreviewWidth: (previewWidth) => set((state) => state.previewWidth === previewWidth ? state : { previewWidth }),
}));

export function selectedEntryForPane(pane: PaneExplorerState | undefined): FileEntry | null {
  if (!pane?.listing || pane.selectedIds.length === 0) return null;
  return pane.listing.entries.find((entry) => entry.id === pane.selectedIds[0]) ?? null;
}

function selectedEntriesForPane(pane: PaneExplorerState | undefined): FileEntry[] {
  if (!pane?.listing || pane.selectedIds.length === 0) return [];
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter((entry) => selected.has(entry.id));
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
    for (const entry of selectedEntriesForPane(pane)) {
      const pathKey = normalizedPath(entry.path);
      if (seenPaths.has(pathKey)) continue;
      seenPaths.add(pathKey);
      items.push(makeBatchRenameItem(entry, paneId, pane));
    }
  }
  return items;
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

export function selectedPathsForPane(pane: PaneExplorerState | undefined): string[] {
  if (!pane?.listing) return [];
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter((entry) => selected.has(entry.id)).map((entry) => entry.path);
}

export function selectedPasteItemsForPane(pane: PaneExplorerState | undefined): PasteItem[] {
  if (!pane?.listing) return [];
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries
    .filter((entry) => selected.has(entry.id))
    .map((entry) => ({ path: entry.path, isDirectory: entry.kind === "folder" }));
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
  const text = await readText().catch(() => "");
  if (!text) return false;
  const pathItems = await pasteItemsFromClipboardText(text);
  if (pathItems.length > 0) {
    await explorerQueuePasteItems({
      sources: pathItems,
      destinationDirectory: directory,
      operation: "copy",
    });
  } else if (text.trim().length > 0) {
    await explorerQueuePasteText({
      destinationDirectory: directory,
      text,
      preferredName: "clipboard.txt",
    });
  } else {
    return false;
  }
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
      local_path: entry.path,
      remote_name: entry.location.remoteName ?? "",
      remote_path: entry.location.remotePath ?? "",
      is_dir: entry.kind === "folder",
    })),
    images: [],
  };
}

function explorerClipboardFromPayload(payload: ClipboardPayload): ExplorerClipboardState | null {
  if (payload.kind !== "file_refs" || payload.file_refs.length === 0) return null;
  const items = payload.file_refs
    .filter((fileRef) => fileRef.local_path.length > 0)
    .map((fileRef) => ({ path: fileRef.local_path, isDirectory: fileRef.is_dir }));
  return items.length > 0 ? { items, operation: "copy" } : null;
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

function samePath(left: string, right: string): boolean {
  return left.replace(/\/+$/, "") === right.replace(/\/+$/, "");
}

function normalizedPath(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  return normalized || "/";
}

function loadPinnedPaths(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem("misty.explorer.pinnedPaths") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
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
  const refresh = () => {
    const pane = useExplorerStore.getState().panes[paneId];
    if (pane?.listing?.path === path && !pane.loading) {
      void useExplorerStore.getState().loadPane(paneId, path, "replace");
    }
  };
  if (options.immediate) {
    refresh();
  } else {
    window.setTimeout(refresh, 650);
  }
  window.setTimeout(() => {
    const pane = useExplorerStore.getState().panes[paneId];
    if (pane?.listing?.path === path && !pane.loading) {
      void useExplorerStore.getState().loadPane(paneId, path, "replace");
    }
  }, 2200);
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
  if (parts.length < 2) return null;
  return {
    remoteName: parts[1],
    remotePath: parts.length > 2 ? `/${parts.slice(2).join("/")}` : "/",
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
    || state.sort !== previous.sort
    || state.showHidden !== previous.showHidden
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

  const document = workspaceDocumentCache ?? {
    schema_version: 1,
    active_workspace_id: "workspace_0",
    next_workspace_idx: 1,
    workspaces: [],
  };
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
    workspaceDocumentCache = await workspacesSave(nextDocument);
  } catch (error) {
    useExplorerStore.setState({ operationError: `Workspace save failed: ${errorText(error)}` });
  }
}

function restoreNativeWorkspace(document: NativeWorkspaceDocument, homePath: string): {
  workspace: NativeWorkspace;
  panes: Record<string, PaneExplorerState>;
  multiPanel: {
    tabs: MultiPanelTab[];
    activeTabId: string;
    activePaneId: string;
    closedPanes: MultiPanelPane[];
    nextPaneIndex: number;
    nextTabIndex: number;
  };
  showHidden: boolean;
  viewMode: ExplorerViewMode;
  sort: ExplorerSortState;
} | null {
  const workspace = document.workspaces.find((candidate) => candidate.id === document.active_workspace_id)
    ?? document.workspaces[0];
  if (!workspace) return null;
  const nativeTabs = workspace.tabs.length > 0
    ? workspace.tabs
    : [{ idx: 0, title: workspace.title || "Home", explorer: workspace.explorer }];
  const panes: Record<string, PaneExplorerState> = {};
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
      };
      if (tabPosition === 0 && panePosition === 0) {
        showHidden = restored.showHidden;
        viewMode = restored.gridView ? "grid" : "list";
        sort = restored.sort;
      }
      return { id: paneId, path: restored.path, title: tabSnapshot?.title || titleFromPath(restored.path) };
    });
    const orderedIds = explorer.grid_pane_ids.flat().filter((id) => restoredPanes.some((pane) => pane.id === id));
    const paneIds = orderedIds.length === restoredPanes.length ? orderedIds : restoredPanes.map((pane) => pane.id);
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
        orientation: explorer.grid_pane_ids.length === 1 && paneIds.length > 1 ? "horizontal" : "vertical",
        paneIds,
      },
    };
  });
  const activeTabId = `explorer-tab-${workspace.active_tab_idx >= 0 ? workspace.active_tab_idx : nativeTabs[0].idx}`;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const closedPanes = nativeTabs
    .flatMap((tab) => tab.explorer.closed_panes)
    .map((snapshot, index) => {
      const tabSnapshot = snapshot.tabs.find((tab) => tab.idx === snapshot.active_tab_idx) ?? snapshot.tabs[0];
      const restored = parsePaneRestoreState(tabSnapshot?.restore_state, homePath);
      return {
        id: snapshot.pane_id || `closed-pane-${index}`,
        path: restored.path,
        title: tabSnapshot?.title || titleFromPath(restored.path),
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
    viewMode,
    sort,
  };
}

function nativeExplorerSnapshot(
  tab: MultiPanelTab,
  paneStates: Record<string, PaneExplorerState>,
  closedPanes: MultiPanelPane[],
  nextPaneIndex: number,
): NativeWorkspaceExplorerSnapshot {
  const panes = tab.panes.map((pane, index) => {
    const state = paneStates[pane.id] ?? emptyPaneState();
    return {
      pane_id: pane.id,
      tabs: [{
        context_key: "FileExplorer",
        state_key: pane.id,
        title: pane.title,
        restore_state: JSON.stringify({
          current_path: state.listing?.path ?? pane.path,
          show_hidden: useExplorerStore.getState().showHidden,
          grid_view: useExplorerStore.getState().viewMode === "grid",
          sort_column: useExplorerStore.getState().sort.column,
          sort_direction: useExplorerStore.getState().sort.direction,
          back_history: state.backHistory,
          forward_history: state.forwardHistory,
        }),
        idx: index,
      }],
      closed_tabs: [],
      active_tab_idx: index,
    };
  });
  const closed = closedPanes.map((pane, index) => ({
    pane_id: pane.id,
    tabs: [{
      context_key: "FileExplorer",
      state_key: pane.id,
      title: pane.title,
      restore_state: JSON.stringify({ current_path: pane.path }),
      idx: index,
    }],
    closed_tabs: [],
    active_tab_idx: index,
    restore_mode: "same_lane",
    lane_index: -1,
    row_index: -1,
  }));
  return {
    active_pane_id: tab.activePaneId,
    next_tab_idx: 1,
    next_pane_idx: nextPaneIndex,
    grid_pane_ids: tab.layout.orientation === "horizontal"
      ? [tab.layout.paneIds]
      : tab.layout.paneIds.map((paneId) => [paneId]),
    grid_split_ratio: 0.5,
    lane_split_ratios: [0.5, 0.5],
    panes,
    closed_panes: closed,
  };
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

function titleFromPath(path: string): string {
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
