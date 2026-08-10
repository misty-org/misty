import type {
  DirectoryListing,
  DirectorySizeRecord,
  ExplorerLibrarySnapshot,
  FileEntry,
  PasteItem,
} from "@/services/misty/model/misty-api";
import type { ClipboardOperation, CreateItemKind } from "@/services/misty/model/types/misty-api";

import type {
  ExplorerCommandQueryMode,
  ExplorerDeleteMode,
  ExplorerDialogState,
  ExplorerNotificationType,
  ExplorerSortColumn,
  ExplorerSortDirection,
  ExplorerUploadSourceKind,
  ExplorerViewMode,
  NavigationMode,
} from "../../types/store/types";

export interface ExplorerWorkspaceEntry {
  id: string;
  title: string;
}

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

export interface PaneExplorerState {
  listing: DirectoryListing | null;
  hasFolderEntries: boolean;
  commandQuery: string;
  commandQueryMode: ExplorerCommandQueryMode;
  selectedIds: string[];
  selectedIdsByPath: Record<string, string[]>;
  lastSelectedIndexByPath: Record<string, number>;
  backHistory: string[];
  forwardHistory: string[];
  loading: boolean;
  showLoadingSkeleton: boolean;
  needsLoad: boolean;
  error: string | null;
}

export interface LoadPaneOptions {
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

export interface ExplorerStore {
  panes: Record<string, PaneExplorerState>;
  directorySizes: Record<string, DirectorySizeRecord>;
  viewMode: ExplorerViewMode;
  paneViewModes: Record<string, ExplorerViewMode>;
  fileItemScale: number;
  paneFileItemScales: Record<string, number>;
  sort: ExplorerSortState;
  paneSorts: Record<string, ExplorerSortState>;
  showHidden: boolean;
  paneShowHidden: Record<string, boolean>;
  operationError: string | null;
  notifications: ExplorerNotification[];
  notificationHistory: ExplorerNotification[];
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
  initialize: (homePath: string) => Promise<void>;
  ensureWorkspace: (workspaceId: string, title: string, homePath: string) => Promise<void>;
  selectWorkspace: (workspaceId: string, homePath: string) => Promise<void>;
  createWorkspace: (title: string, homePath: string) => Promise<void>;
  renameWorkspace: (workspaceId: string, title: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string, homePath: string) => Promise<void>;
  loadPane: (
    paneId: string,
    path: string,
    mode?: NavigationMode,
    options?: LoadPaneOptions,
  ) => Promise<void>;
  navigatePane: (paneId: string, path: string) => Promise<void>;
  navigateBack: (paneId: string) => Promise<void>;
  navigateForward: (paneId: string) => Promise<void>;
  navigateParent: (paneId: string) => Promise<void>;
  refreshPane: (paneId: string) => Promise<void>;
  loadDirectorySizeSnapshot: (
    paths: string[],
    options?: { calculateMissing?: boolean },
  ) => Promise<void>;
  calculateDirectorySizes: (
    paths: string[],
    options?: { force?: boolean; notify?: boolean },
  ) => Promise<void>;
  calculatePaneDirectorySizes: (
    paneId: string,
    options?: { force?: boolean; notify?: boolean },
  ) => Promise<void>;
  runScheduledDirectorySizeRefresh: () => Promise<void>;
  setViewMode: (mode: ExplorerViewMode, paneId?: string) => void;
  setFileItemScale: (scale: number, paneId?: string) => void;
  setSort: (column: ExplorerSortColumn, paneId?: string) => void;
  setCommandQuery: (paneId: string, query: string) => void;
  setCommandQueryMode: (paneId: string, mode: ExplorerCommandQueryMode) => void;
  toggleHidden: (paneId?: string) => Promise<void>;
  selectEntry: (
    paneId: string,
    entryId: string,
    options?: { toggle?: boolean; range?: boolean; visibleEntryIds?: string[] },
  ) => void;
  clearSelection: (paneId: string) => void;
  openEntry: (paneId: string, entry: FileEntry) => Promise<void>;
  openWithSelected: (paneId: string) => Promise<void>;
  canCreateItem: (paneId: string, kind: CreateItemKind) => boolean;
  createItem: (paneId: string, kind: CreateItemKind, name?: string) => Promise<void>;
  renameSelected: (paneId: string, name?: string) => Promise<void>;
  openBatchRenameDialog: (paneId: string) => void;
  deleteSelected: (paneId: string, mode?: ExplorerDeleteMode) => Promise<void>;
  downloadSelected: (paneId: string) => Promise<void>;
  copySelected: (paneId: string) => void;
  cutSelected: (paneId: string) => void;
  pasteIntoPane: (paneId: string) => Promise<void>;
  uploadIntoPane: (paneId: string, sourceKind?: ExplorerUploadSourceKind) => Promise<void>;
  dropItems: (
    paneId: string,
    items: PasteItem[],
    destination: string,
    operation: ClipboardOperation,
  ) => Promise<void>;
  dropExternalPaths: (paneId: string, paths: string[], destination: string) => Promise<void>;
  pollTransferRefreshes: (mountRoot: string) => Promise<void>;
  togglePinnedPath: (path: string) => void;
  copyPath: (path: string) => Promise<void>;
  openContextMenu: (paneId: string, x: number, y: number, entryId?: string | null) => void;
  closeContextMenu: () => void;
  setInlineEditValue: (value: string) => void;
  setBatchRenameValue: (paneId: string, entryId: string, value: string) => void;
  setBatchRenameItems: (paneId: string, items: ExplorerBatchRenameItem[]) => void;
  commitInlineEdit: () => Promise<void>;
  cancelInlineEdit: () => void;
  confirmDialog: () => Promise<void>;
  closeDialog: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setPreviewVisible: (visible: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setPreviewWidth: (width: number) => void;
  consumeOperationError: () => string | null;
  pushNotification: (
    message: string,
    type?: ExplorerNotificationType,
    durationMs?: number,
    showInActivity?: boolean,
  ) => number;
  recordActivity: (message: string, type?: ExplorerNotificationType) => number;
  dismissNotification: (id: number) => void;
  markNotificationsRead: () => void;
  clearNotificationHistory: () => void;
}
