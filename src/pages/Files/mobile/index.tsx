import { open } from "@tauri-apps/plugin-dialog";
import { readText, writeHtml, writeImage, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  AppWindow,
  ArrowLeft,
  ArrowUp,
  Check,
  CheckSquare,
  ChevronRight,
  Clock3,
  Clipboard,
  Copy,
  Download,
  Eye,
  EyeOff,
  File,
  Image,
  FilePlus,
  FileText,
  FolderOpen,
  Folder,
  FolderPlus,
  FolderUp,
  GitCompareArrows,
  Grid2X2,
  HardDrive,
  Home,
  Info,
  List,
  MessageSquare,
  Menu,
  MoreVertical,
  Pencil,
  Pin,
  Plus,
  RefreshCcw,
  Scissors,
  Square,
  Star,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction, type UIEvent } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import {
  clipboardApplyShared,
  clipboardPublishImageBytes,
  clipboardPublishShared,
  clipboardSetLocal,
  clipboardSharedImageBytes,
  clipboardWriteFileRefs,
  explorerPrepareDragItems,
  explorerQueueCreateItem,
  explorerQueueDeleteItems,
  explorerQueuePasteItems,
  explorerQueueRenameItem,
  explorerQueueRenameItems,
  explorerLibraryRecordLastOpened,
  explorerLibraryRecordRecent,
  explorerListDirectory,
  explorerOpenAssociation,
  explorerOpenPath,
  explorerSetOpenAssociation,
  explorerOpenWith,
  explorerPrepareOpenItem,
  explorerPreviewItem,
  transfersSnapshot,
} from "../../../api/misty";
import type {
  ClipboardPayload,
  CreateItemKind,
  DirectoryListing,
  ExplorerLibraryItem,
  ExplorerLibrarySnapshot,
  FileEntry,
  FileSyncCompareSide,
  FileSyncEndpoint,
  FileSyncPair,
  FileSyncPlannedAction,
  OperationQueueSnapshot,
  PasteItem,
  PreparedOpenItem,
  ProviderRemote,
  TransferRecord,
  TransferType,
} from "../../../api/types";
import { useAppStore } from "../../../stores/useAppStore";
import {
  mobileEmptyIconClass,
  mobileEmptyStateClass,
  mobileErrorClass,
  mobileSuccessClass,
} from "../../../shared/mobileStyles";
import { errorText } from "../../../shared/format";
import { selectAdvancedPreferences, selectGeneralPreferences, useSettingsStore } from "../../../stores/useSettingsStore";
import { useProvidersStore } from "../../../stores/useProvidersStore";
import { useExplorerStore } from "../../../stores/useExplorerStore";
import { useMikaSessionStore, type AiPlanReview, type AiStatus, type AiToolApproval } from "../../../stores/useMikaSessionStore";
import { useFileSyncStore } from "../../../stores/useFileSyncStore";
import type { FileSyncSession } from "../../../stores/useFileSyncStore";
import { clipboardImagePng } from "../utils/clipboardImage";
import { formatBytes, formatDate } from "../utils/fileFormat";
import { hasTauriInternals, safeTauriAssetUrl } from "../../../shared/tauri";

const mobileFilesLastPathStorageKey = "misty.mobile.files.lastPath";
const mobileFilesTabsStorageKey = "misty.mobile.files.tabs";
const mobileFilesWorkspacesStorageKey = "misty.mobile.files.workspaces";
const mobileFilesViewModeStorageKey = "misty.mobile.files.viewMode";
const mobileFilesSortStorageKey = "misty.mobile.files.sort";
const mobileFilesShowHiddenStorageKey = "misty.mobile.files.showHidden";
const mobileRecentPath = "misty://recent";
const mobileStarredPath = "misty://starred";
const mobileTrashPath = "misty://trash";
const smokeHome = "/Users/misty";
const EMPTY_PROVIDER_REMOTES: ProviderRemote[] = [];
const maxMobilePreviewBytes = 32 * 1024 * 1024;
const mobileImagePreviewLoadAttempts = 5;
const mobileImagePreviewRetryDelayMs = 80;
const mobileBrowserImageMimeTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
};
const mobileSortColumns: MobileFilesSortColumn[] = ["name", "modified", "size", "type"];
const maxMobileFileTabs = 9;
const maxMobileClosedFileTabs = 8;
const maxMobileFileWorkspaces = 12;
const maxMobileFilePanes = 4;
const maxMobileClosedFilePanes = 8;
const mobileFileSyncSessionId = "mobile-files-sync";
const mobileFileSyncActions: Array<{ value: FileSyncPlannedAction; label: string }> = [
  { value: "skip", label: "Skip" },
  { value: "copy_left_to_right", label: "Copy Left to Right" },
  { value: "copy_right_to_left", label: "Copy Right to Left" },
  { value: "delete_left", label: "Delete Left" },
  { value: "delete_right", label: "Delete Right" },
];
const filesPageClass = "h-full min-h-0 min-w-0 overflow-auto overscroll-contain bg-[#202020] px-[max(16px,var(--misty-safe-right))] pb-[14px] pl-[max(16px,var(--misty-safe-left))] pr-[max(16px,var(--misty-safe-right))] pt-[calc(16px+var(--misty-safe-top))] [-webkit-overflow-scrolling:touch]";
const filesSearchClass = "mb-3.5 grid h-[54px] grid-cols-[38px_minmax(0,1fr)] items-center gap-2.5 rounded-full bg-[#2e2e2e] px-4 text-[#dbdbdb]";
const filesIconButtonClass = "grid place-items-center border-0 bg-transparent text-[#cccccc]";
const filesTabClass = "relative min-h-[46px] min-w-0 border-0 bg-transparent text-center text-[17px] font-bold text-[#c8c8c8]";
const filesActiveTabClass = "text-[#c5c5c5] after:absolute after:bottom-[-1px] after:left-[19%] after:right-[19%] after:h-1 after:rounded-t-full after:bg-[#c5c5c5] after:content-['']";
const filesSortButtonClass = "grid h-9 w-9 place-items-center rounded-xl border-0 bg-transparent text-[#dadada] disabled:opacity-35";
const filesMoreButtonClass = "grid h-11 w-11 flex-none place-items-center rounded-[14px] border-0 bg-transparent text-[#aeaeae] aria-expanded:bg-[#b2b2b229] aria-expanded:text-[#e5e5e5]";
const fileListBaseClass = "grid gap-0";
const fileListGridClass = "grid grid-cols-2 gap-2.5 pt-1.5";
const fileRowListClass = "grid min-h-[90px] w-full min-w-0 grid-cols-[minmax(0,1fr)_44px] items-center gap-1 border-0 bg-transparent py-3 text-left text-[#f3f3f3]";
const fileRowGridClass = "grid min-h-[132px] w-full min-w-0 grid-cols-[minmax(0,1fr)_34px] items-start gap-1 rounded-[18px] border border-white/10 bg-[#222222] p-[13px] text-left text-[#f3f3f3]";
const fileRowSelectedClass = "rounded-2xl bg-[#b2b2b21a] px-2";
const fileRowGridSelectedClass = "border-[#b2b2b259] bg-[#b2b2b21f]";
const fileRowMainListClass = "grid min-w-0 grid-cols-[52px_minmax(0,1fr)] items-center gap-4 border-0 bg-transparent p-0 text-left text-inherit";
const fileRowMainGridClass = "grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 border-0 bg-transparent p-0 text-left text-inherit";
const fileSelectButtonClass = "grid h-[34px] w-[34px] place-items-center rounded-full border border-white/10 bg-white/[0.04] text-[#aeaeae] disabled:opacity-35";
const fileSelectButtonSelectedClass = "border-[#b2b2b273] bg-[#e5e5e5] text-[#161616]";
const mobileSheetBackdropClass = "fixed inset-0 z-[1000] flex items-end bg-black/60";
const mobileSheetClass = "w-full max-h-[min(calc(100dvh-var(--misty-safe-top)-18px),680px)] overflow-auto rounded-t-[18px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] pb-[calc(14px+var(--misty-safe-bottom))] pl-[max(var(--misty-mobile-edge),var(--misty-safe-left))] pr-[max(var(--misty-mobile-edge),var(--misty-safe-right))] pt-4 shadow-[0_-24px_70px_rgba(0,0,0,0.52)]";
const mobileActionSheetClass = `${mobileSheetClass} grid gap-3`;
const mobileSheetHeaderClass = "mb-3.5 flex items-center justify-between gap-3";
const mobileSheetKickerClass = "text-[11px] font-bold uppercase tracking-normal text-[var(--misty-text-subtle)]";
const mobileSheetTitleClass = "m-0 text-xl font-bold leading-[1.15] text-[var(--misty-text)]";
const mobileIconButtonClass = "grid h-11 w-11 place-items-center rounded-[14px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] text-[var(--misty-primary)] disabled:opacity-45";
const mobileActionStackClass = "mt-2.5 grid gap-2";
const mobilePrimaryActionClass = "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--misty-radius-sm)] border border-[var(--misty-primary)] bg-[var(--misty-primary)] px-4 font-bold text-[var(--misty-primary-contrast)] transition-colors hover:bg-[var(--misty-primary-hover)] disabled:opacity-50";
const mobileSecondaryActionClass = "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--misty-radius-sm)] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-4 font-bold text-[var(--misty-text)] transition-colors hover:bg-[var(--misty-surface-hover)] disabled:opacity-50";
const mobileDangerActionClass = `${mobileSecondaryActionClass} text-[#b7b7b7]`;
const mobileInputGroupClass = "grid min-w-0 gap-1.5";
const mobileInputLabelClass = "text-xs font-bold text-[var(--misty-text-muted)]";
const mobileInputClass = "h-[46px] w-full min-w-0 rounded-[14px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-[13px] text-base text-[var(--misty-text)] outline-none focus:border-[var(--misty-border-strong)] focus:shadow-[0_0_0_3px_var(--misty-focus-ring)] read-only:text-[#acacac]";
const mobileActionListClass = "grid gap-0";
const mobileSeparatorClass = "my-1 h-px bg-white/10";
const mobileNoteClass = "m-0 text-[13px] leading-[1.4] text-[#acacac]";

type EmptyReason = "none" | "missing-path" | "no-remotes";
type MobileSidebarSection = "workspaces" | "tabs" | "locations" | "quick" | "providers";
type MobileClipboardOperation = "copy" | "move";
type MobileFilesViewMode = "list" | "grid";
type MobileFilesSortColumn = "name" | "modified" | "size" | "type";
type MobileFilesSortDirection = "asc" | "desc";
type MobileFilesNavigationMode = "push" | "replace" | "back" | "forward";

interface MobileFilesSortState {
  column: MobileFilesSortColumn;
  direction: MobileFilesSortDirection;
}

interface MobileFileTab {
  id: string;
  title: string;
  path: string;
  panes?: MobileFilePane[];
  activePaneId?: string;
  closedPanes?: MobileFilePane[];
}

interface MobileFilePane {
  id: string;
  title: string;
  path: string;
  backHistory?: string[];
  forwardHistory?: string[];
}

interface MobileFileTabsState {
  tabs: MobileFileTab[];
  activeTabId: string;
  closedTabs: MobileFileTab[];
}

interface MobileFileWorkspace extends MobileFileTabsState {
  id: string;
  title: string;
}

interface MobileFileWorkspaceState {
  workspaces: MobileFileWorkspace[];
  activeWorkspaceId: string;
  nextWorkspaceIndex: number;
}

interface MobileWorkspaceDialogState {
  kind: "create" | "rename" | "delete";
  workspaceId: string;
  title: string;
}

interface MobilePreviewState {
  entry: FileEntry;
  loading: boolean;
  error: string | null;
  text: string | null;
  url: string;
  mimeType: string;
}

interface MobileMediaState {
  entry: FileEntry;
  loading: boolean;
  error: string | null;
  url: string;
  mimeType: string;
  kind: "image" | "video";
}

interface MobileClipboardState {
  entries: FileEntry[];
  operation: MobileClipboardOperation;
}

interface MobileBatchRenameItem {
  entry: FileEntry;
  value: string;
  lockedExtension: string;
  error: string | null;
}

interface MobileSidebarItem {
  id: string;
  label: string;
  detail: string;
  path: string;
  icon: LucideIcon;
  kind?: "pinned";
}

interface MobileActionDebugState {
  id: string;
  action: string;
  stage: string;
  request: unknown;
  queue: unknown;
  transfer: MobileActionDebugTransfer | null;
  error: string | null;
  createdAt: string;
}

interface MobileActionDebugTransfer {
  id: number;
  type: TransferType;
  status: string;
  fileName: string;
  detail: string;
  error: string;
  localSourcePath: string;
  localDestPath: string;
  remoteSourceName: string;
  remoteSourcePath: string;
  remoteDestName: string;
  remoteDestPath: string;
}

interface MobileActionDebugMatch {
  types: TransferType[];
  fileName?: string;
  pathHints?: string[];
}

export function MobileFilesPage() {
  const app = useAppStore((state) => state.app);
  const homeDir = app?.environment.homeDir ?? smokeHome;
  const { preferredWorkspaceRoot, mountPath } = useSettingsStore(useShallow((state) => ({
    preferredWorkspaceRoot: selectGeneralPreferences(state.settings?.document).preferredWorkspaceRoot,
    mountPath: selectAdvancedPreferences(state.settings?.document).mountPath,
  })));
  const { remotes, remoteLoading, loadProviders } = useProvidersStore(useShallow((state) => ({
    remotes: state.providers?.remotes ?? EMPTY_PROVIDER_REMOTES,
    remoteLoading: state.loading,
    loadProviders: state.load,
  })));
  const { pinnedPaths, explorerLibrary, loadExplorerLibrary, setExplorerLibraryTags, togglePinnedPath } = useExplorerStore(useShallow((state) => ({
    pinnedPaths: state.pinnedPaths,
    explorerLibrary: state.library,
    loadExplorerLibrary: state.loadLibrary,
    setExplorerLibraryTags: state.setLibraryTags,
    togglePinnedPath: state.togglePinnedPath,
  })));
  const {
    syncPairs,
    syncLoadingPairs,
    syncPairError,
    syncSession,
    loadSyncPairs,
    ensureSyncSession,
    selectSyncPair,
    compareSync,
    applySync,
    setSyncRowAction,
    swapSyncRoots,
  } = useFileSyncStore(useShallow((state) => ({
    syncPairs: state.pairs,
    syncLoadingPairs: state.loadingPairs,
    syncPairError: state.pairError,
    syncSession: state.sessions[mobileFileSyncSessionId],
    loadSyncPairs: state.loadPairs,
    ensureSyncSession: state.ensureSession,
    selectSyncPair: state.selectPair,
    compareSync: state.compare,
    applySync: state.apply,
    setSyncRowAction: state.setRowAction,
    swapSyncRoots: state.swapRoots,
  })));
  const rootPath = resolvePreferredMobileRoot(preferredWorkspaceRoot, homeDir);
  const mountRoot = resolveMobileMountRoot(rootPath, mountPath || app?.environment.mountPath || ".misty/mnt");
  const initialPath = initialMobilePath(rootPath);
  const [path, setPath] = useState(initialPath);
  const [mobileWorkspaces, setMobileWorkspaces] = useState<MobileFileWorkspaceState>(() => loadMobileFileWorkspaces(initialPath));
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [emptyReason, setEmptyReason] = useState<EmptyReason>("none");
  const [detailEntry, setDetailEntry] = useState<FileEntry | null>(null);
  const [contextEntry, setContextEntry] = useState<FileEntry | null>(null);
  const [renameEntry, setRenameEntry] = useState<FileEntry | null>(null);
  const [renameName, setRenameName] = useState("");
  const [batchRenameItems, setBatchRenameItems] = useState<MobileBatchRenameItem[]>([]);
  const [deleteEntries, setDeleteEntries] = useState<FileEntry[]>([]);
  const [preview, setPreview] = useState<MobilePreviewState | null>(null);
  const [media, setMedia] = useState<MobileMediaState | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);
  const [syncSheetOpen, setSyncSheetOpen] = useState(false);
  const [sharedClipboardSheetOpen, setSharedClipboardSheetOpen] = useState(false);
  const [mikaSheetOpen, setMikaSheetOpen] = useState(false);
  const [createKind, setCreateKind] = useState<CreateItemKind | null>(null);
  const [createName, setCreateName] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [clipboard, setClipboard] = useState<MobileClipboardState | null>(null);
  const [viewMode, setViewMode] = useState<MobileFilesViewMode>(() => loadMobileFilesViewMode());
  const [sort, setSort] = useState<MobileFilesSortState>(() => loadMobileFilesSort());
  const [showHidden, setShowHidden] = useState(() => loadMobileFilesShowHidden());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionDebug, setActionDebug] = useState<MobileActionDebugState | null>(null);
  const lastFileListScrollTopRef = useRef(0);
  const [floatingAddVisible, setFloatingAddVisible] = useState(true);

  useEffect(() => {
    void loadExplorerLibrary();
  }, [loadExplorerLibrary]);

  useEffect(() => {
    if (!syncSheetOpen) return;
    void loadSyncPairs();
  }, [loadSyncPairs, syncSheetOpen]);

  useEffect(() => {
    if (!syncSheetOpen || syncSession || syncPairs.length === 0) return;
    const firstPair = syncPairs[0];
    ensureSyncSession(mobileFileSyncSessionId, firstPair.left, firstPair.right);
    selectSyncPair(mobileFileSyncSessionId, firstPair.id);
  }, [ensureSyncSession, selectSyncPair, syncPairs, syncSession, syncSheetOpen]);

  useEffect(() => {
    return () => {
      revokeMobileObjectUrl(preview?.url);
    };
  }, [preview?.url]);

  useEffect(() => {
    return () => {
      revokeMobileObjectUrl(media?.url);
    };
  }, [media?.url]);

  const loadDirectory = useCallback(async (nextPath: string, options: { refresh?: boolean } = {}) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setEmptyReason("none");
    try {
      const next = await explorerListDirectory({
        path: nextPath,
        showHidden,
        forceRemoteRefresh: options.refresh,
      });
      setListing(sortMobileListing(next, sort));
      setPath(next.path);
      try {
        window.localStorage.setItem(mobileFilesLastPathStorageKey, next.path);
      } catch {
        // Mobile path memory is best-effort.
      }
    } catch (loadError) {
      const message = errorText(loadError);
      if (isMissingDirectoryError(message)) {
        setListing(emptyListing(nextPath));
        setPath(nextPath);
        setEmptyReason("missing-path");
        try {
          window.localStorage.removeItem(mobileFilesLastPathStorageKey);
        } catch {
          // Mobile path memory is best-effort.
        }
      } else {
        setError(sanitizeMobilePathText(message, homeDir));
      }
    } finally {
      setLoading(false);
    }
  }, [homeDir, showHidden, sort]);

  useEffect(() => {
    saveMobileFilesViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    saveMobileFilesSort(sort);
    setListing((current) => current ? sortMobileListing(current, sort) : current);
  }, [sort]);

  useEffect(() => {
    saveMobileFilesShowHidden(showHidden);
  }, [showHidden]);

  useEffect(() => {
    if (isRemoteRootPath(path, mountRoot)) {
      setListing(sortMobileListing(remoteRootListing(mountRoot, remotes), sort));
      setLoading(false);
      setError(null);
      setEmptyReason(remotes.length === 0 ? "no-remotes" : "none");
      try {
        window.localStorage.setItem(mobileFilesLastPathStorageKey, mountRoot);
      } catch {
        // Mobile path memory is best-effort.
      }
      return;
    }
    void loadDirectory(path);
  }, [loadDirectory, mountRoot, path, remotes, sort]);

  useEffect(() => {
    if (rootPath === smokeHome || path !== smokeHome || hasStoredMobilePath()) return;
    setPath(rootPath);
  }, [rootPath, path]);

  const entries = useMemo(() => {
    const source = listing?.entries ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source.filter((entry) =>
      entry.name.toLowerCase().includes(needle) ||
      entry.extension.toLowerCase().includes(needle),
    );
  }, [listing?.entries, query]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedIdSet.has(entry.id)),
    [entries, selectedIdSet],
  );
  const selectableEntries = useMemo(
    () => entries.filter(isMobileSelectableEntry),
    [entries],
  );
  const selectedActionableEntries = useMemo(
    () => selectedEntries.filter((entry) => !isVirtualRemoteEntry(entry) && !entry.isDeleted),
    [selectedEntries],
  );
  const selectedDownloadableEntries = useMemo(
    () => selectedEntries.filter(isDownloadableRemoteEntry),
    [selectedEntries],
  );
  const mikaSelectedEntry = useMemo(
    () => detailEntry ?? contextEntry ?? (selectedEntries.length === 1 ? selectedEntries[0] : null),
    [contextEntry, detailEntry, selectedEntries],
  );
  const detailTags = useMemo(
    () => detailEntry ? mobileLibraryTagsForEntry(detailEntry, explorerLibrary) : [],
    [detailEntry, explorerLibrary],
  );
  const currentPath = listing?.path && normalizePath(listing.path) === normalizePath(path) ? listing.path : path;
  const currentTitle = emptyReason === "missing-path"
    ? "Folder unavailable"
    : mobileFolderTitle(currentPath, rootPath, mountRoot, remotes);
  const activeFilesTab = mobileRemotePathInfo(currentPath, mountRoot, remotes) ? "remote" : "device";
  const remoteRoot = isRemoteRootPath(currentPath, mountRoot);
  const virtualLibrary = isVirtualLibraryPath(currentPath);
  const activeMobileWorkspace = activeMobileFileWorkspace(mobileWorkspaces);
  const mobileTabs: MobileFileTabsState = activeMobileWorkspace;
  const activeMobileTab = activeMobileFileTab(mobileTabs);
  const activeMobilePaneSet = activeMobileFilePaneSet(activeMobileTab);
  const mobileUpPath = mobileParentNavigationTarget(currentPath, rootPath, mountRoot);
  const canAddInCurrentFolder = Boolean(listing) && !remoteRoot && !virtualLibrary && emptyReason === "none";
  const canPasteInCurrentFolder = canAddInCurrentFolder && Boolean(clipboard);
  const allVisibleSelected = selectableEntries.length > 0 && selectableEntries.every((entry) => selectedIdSet.has(entry.id));

  const beginActionDebug = (action: string, request: unknown): string => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setActionDebug({
      id,
      action,
      stage: "Request sent",
      request,
      queue: null,
      transfer: null,
      error: null,
      createdAt: new Date().toLocaleTimeString(),
    });
    return id;
  };

  const finishActionDebug = (id: string, queue: OperationQueueSnapshot, match: MobileActionDebugMatch) => {
    setActionDebug((current) => current?.id === id
      ? {
        ...current,
        stage: "Queued. Waiting for transfer result...",
        queue: mobileActionQueueDebug(queue),
      }
      : current);
    void pollMobileActionTransfer(id, match, setActionDebug);
  };

  const failActionDebug = (id: string, error: unknown) => {
    setActionDebug((current) => current?.id === id
      ? { ...current, stage: "Request failed", error: errorText(error) }
      : current);
  };

  useEffect(() => {
    saveMobileFileWorkspaces(mobileWorkspaces);
  }, [mobileWorkspaces]);

  useEffect(() => {
    if (addSheetOpen) setFloatingAddVisible(true);
  }, [addSheetOpen]);

  useEffect(() => {
    lastFileListScrollTopRef.current = 0;
    setFloatingAddVisible(true);
  }, [currentPath, activeFilesTab]);

  useEffect(() => {
    setMobileWorkspaces((current) => syncActiveMobileWorkspaceTab(current, currentPath, currentTitle));
  }, [currentPath, currentTitle]);

  useEffect(() => {
    setSelectedIds((current) => {
      if (current.length === 0) return current;
      const visibleIds = new Set(entries.map((entry) => entry.id));
      const next = current.filter((id) => visibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [entries]);

  const refreshCurrent = async () => {
    if (remoteRoot) {
      await loadProviders(true);
      return;
    }
    await loadDirectory(path, { refresh: true });
  };

  const handleMobileFilePageScroll = (event: UIEvent<HTMLElement>) => {
    const nextTop = event.currentTarget.scrollTop;
    const previousTop = lastFileListScrollTopRef.current;
    const delta = nextTop - previousTop;
    lastFileListScrollTopRef.current = nextTop;
    if (Math.abs(delta) < 6) return;
    if (delta > 0 && nextTop > 24 && !addSheetOpen) {
      setFloatingAddVisible(false);
    } else if (delta < 0) {
      setFloatingAddVisible(true);
    }
  };

  const openEntry = (entry: FileEntry) => {
    if (entry.isDeleted) {
      setError("Trash items are deleted cache entries and cannot be opened from here yet.");
      return;
    }
    if (entry.kind === "folder") {
      setDetailEntry(null);
      setContextEntry(null);
      setQuery("");
      void recordMobileLibraryRecent(entry);
      navigateToPath(entry.path);
      return;
    }
    if (isMobileMediaEntry(entry)) {
      void openMediaEntry(entry);
      return;
    }
    void openFile(entry);
  };

  const openFile = async (entry: FileEntry) => {
    if (entry.kind === "folder") {
      openEntry(entry);
      return;
    }
    if (isMobileMediaEntry(entry)) {
      await openMediaEntry(entry);
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const localPath = entry.location.kind === "local"
        ? entry.path
        : (await explorerPrepareOpenItem({
          path: entry.path,
          sizeBytes: entry.sizeBytes,
          remoteModified: entry.remoteModified,
      })).localPath;
      const association = await explorerOpenAssociation(entry.path);
      if (association) await explorerOpenWith(association, localPath);
      else await explorerOpenPath(localPath);
      void recordMobileLibraryRecent(entry);
      setDetailEntry(null);
      setContextEntry(null);
    } catch (openError) {
      setError(sanitizeMobilePathText(`Unable to open file: ${errorText(openError)}`, homeDir));
    } finally {
      setOpening(false);
    }
  };

  const openMediaEntry = async (entry: FileEntry) => {
    const mediaInfo = mobileMediaInfo(entry);
    if (!mediaInfo) return;
    setContextEntry(null);
    setDetailEntry(null);
    setMedia({
      entry,
      loading: true,
      error: null,
      url: "",
      mimeType: mediaInfo.mimeType,
      kind: mediaInfo.kind,
    });
    setOpening(true);
    setError(null);
    try {
      if (mediaInfo.kind === "image") {
        const sizeLimitError = mobilePreviewSizeLimitError(entry);
        if (sizeLimitError) throw new Error(sizeLimitError);
        const localPath = await preparedPreviewPathForMobileEntry(entry);
        const url = await loadMobileImageAssetUrl(localPath);
        setMedia((current) => {
          revokeMobileObjectUrl(current?.url);
          return {
            entry,
            loading: false,
            error: null,
            url,
            mimeType: mediaInfo.mimeType,
            kind: mediaInfo.kind,
          };
        });
        void recordMobileLibraryRecent(entry);
        return;
      }
      const localPath = entry.location.kind === "local"
        ? entry.path
        : (await explorerPrepareOpenItem({
          path: entry.path,
          sizeBytes: entry.sizeBytes,
          remoteModified: entry.remoteModified,
        })).localPath;
      setMedia({
        entry,
        loading: false,
        error: null,
        url: safeTauriAssetUrl(localPath),
        mimeType: mediaInfo.mimeType,
        kind: mediaInfo.kind,
      });
      void recordMobileLibraryRecent(entry);
    } catch (mediaError) {
      setMedia({
        entry,
        loading: false,
        error: sanitizeMobilePathText(`Unable to open media: ${errorText(mediaError)}`, homeDir),
        url: "",
        mimeType: mediaInfo.mimeType,
        kind: mediaInfo.kind,
      });
    } finally {
      setOpening(false);
    }
  };

  const openFileWith = async (entry: FileEntry) => {
    if (!isMobileOpenWithEntry(entry)) return;
    if (!hasTauriInternals()) {
      setError("Choosing a local application is only available in the Tauri app.");
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const selection = await open({
        title: "Choose Application",
        multiple: false,
        directory: false,
      });
      const applicationPath = Array.isArray(selection) ? selection[0] : selection;
      if (!applicationPath) return;
      const localPath = entry.location.kind === "local"
        ? entry.path
        : (await explorerPrepareOpenItem({
          path: entry.path,
          sizeBytes: entry.sizeBytes,
          remoteModified: entry.remoteModified,
        })).localPath;
      await explorerSetOpenAssociation(entry.path, applicationPath);
      await explorerOpenWith(applicationPath, localPath);
      void recordMobileLibraryRecent(entry);
      setDetailEntry(null);
      setContextEntry(null);
    } catch (openError) {
      setError(sanitizeMobilePathText(`Open With failed: ${errorText(openError)}`, homeDir));
    } finally {
      setOpening(false);
    }
  };

  const navigateToPath = (nextPath: string, mode: MobileFilesNavigationMode = "push") => {
    const normalizedNext = normalizePath(nextPath);
    const normalizedPrevious = normalizePath(currentPath);
    setDetailEntry(null);
    setContextEntry(null);
    setRenameEntry(null);
    setBatchRenameItems([]);
    setDeleteEntries([]);
    setPreview(null);
    setMedia((current) => {
      revokeMobileObjectUrl(current?.url);
      return null;
    });
    setAddSheetOpen(false);
    setSortSheetOpen(false);
    setActionsSheetOpen(false);
    setSyncSheetOpen(false);
    setSharedClipboardSheetOpen(false);
    setMikaSheetOpen(false);
    setSelectionMode(false);
    setSelectedIds([]);
    setQuery("");
    setSidebarOpen(false);
    if (normalizedNext !== normalizedPrevious && !isVirtualLibraryPath(nextPath)) {
      setMobileWorkspaces((current) => updateActiveMobileFileTab(current, (tab) => {
        const paneSet = activeMobileFilePaneSet(tab);
        return updateMobileFileTabPanes(tab, {
          panes: paneSet.panes.map((pane) =>
            pane.id === paneSet.activePaneId
              ? updateMobilePaneHistory(pane, currentPath, nextPath, mode)
              : pane,
          ),
          activePaneId: paneSet.activePaneId,
          closedPanes: paneSet.closedPanes,
        });
      }));
    }
    setPath(nextPath);
    if (!isVirtualLibraryPath(nextPath)) void recordMobileLastOpenedPath(nextPath);
  };

  const goMobileUp = () => {
    if (mobileUpPath) navigateToPath(mobileUpPath, "replace");
  };

  const updateSortColumn = (column: MobileFilesSortColumn) => {
    setSort((current) => ({
      column,
      direction: current.column === column && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const openRemoteTab = () => {
    navigateToPath(mountRoot);
  };

  const createMobileTab = () => {
    if (mobileTabs.tabs.length >= maxMobileFileTabs) {
      setNotice(`Mobile Files can keep up to ${maxMobileFileTabs} tabs open.`);
      return;
    }
    const tab = createMobileFileTab(currentPath, currentTitle);
    setMobileWorkspaces((current) => updateActiveMobileFileWorkspace(current, (workspace) => ({
      ...workspace,
      tabs: [...workspace.tabs, tab],
      activeTabId: tab.id,
    })));
    setSidebarOpen(false);
  };

  const selectMobileTab = (tabId: string) => {
    const tab = mobileTabs.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    setMobileWorkspaces((current) => updateActiveMobileFileWorkspace(current, (workspace) => ({
      ...workspace,
      activeTabId: tab.id,
    })));
    navigateToPath(tab.path, "replace");
  };

  const closeMobileTab = (tabId: string) => {
    if (mobileTabs.tabs.length <= 1) return;
    const tabIndex = mobileTabs.tabs.findIndex((candidate) => candidate.id === tabId);
    if (tabIndex < 0) return;
    const closedTab = mobileTabs.tabs[tabIndex];
    const tabs = mobileTabs.tabs.filter((candidate) => candidate.id !== tabId);
    const fallbackTab = tabs[Math.min(tabIndex, tabs.length - 1)] ?? tabs[0];
    const activeTabId = mobileTabs.activeTabId === tabId ? fallbackTab.id : mobileTabs.activeTabId;
    setMobileWorkspaces((current) => updateActiveMobileFileWorkspace(current, (workspace) => ({
      ...workspace,
      tabs,
      activeTabId,
      closedTabs: [closedTab, ...workspace.closedTabs].slice(0, maxMobileClosedFileTabs),
    })));
    if (mobileTabs.activeTabId === tabId) navigateToPath(fallbackTab.path, "replace");
  };

  const restoreMobileTab = () => {
    if (mobileTabs.closedTabs.length === 0) return;
    if (mobileTabs.tabs.length >= maxMobileFileTabs) {
      setNotice(`Close a tab before restoring another one.`);
      return;
    }
    const [closedTab, ...closedTabs] = mobileTabs.closedTabs;
    const restoredTab = createMobileFileTab(closedTab.path, closedTab.title);
    setMobileWorkspaces((current) => updateActiveMobileFileWorkspace(current, (workspace) => ({
      ...workspace,
      tabs: [...workspace.tabs, restoredTab],
      activeTabId: restoredTab.id,
      closedTabs,
    })));
    navigateToPath(restoredTab.path, "replace");
  };

  const selectMobileWorkspace = (workspaceId: string) => {
    const workspace = mobileWorkspaces.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) return;
    setMobileWorkspaces((current) => ({
      ...current,
      activeWorkspaceId: workspace.id,
    }));
    const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? workspace.tabs[0];
    if (activeTab) navigateToPath(activeTab.path, "replace");
  };

  const createMobileWorkspace = (title: string) => {
    if (mobileWorkspaces.workspaces.length >= maxMobileFileWorkspaces) {
      setNotice(`Mobile Files can keep up to ${maxMobileFileWorkspaces} workspaces.`);
      return;
    }
    const workspace = createMobileFileWorkspace(
      uniqueMobileFileWorkspaceTitle(title.trim() || "Workspace", mobileWorkspaces.workspaces),
      currentPath,
      currentTitle,
      mobileWorkspaces.nextWorkspaceIndex,
    );
    setMobileWorkspaces((current) => ({
      workspaces: [...current.workspaces, workspace],
      activeWorkspaceId: workspace.id,
      nextWorkspaceIndex: Math.max(current.nextWorkspaceIndex + 1, mobileWorkspaceIndex(workspace.id) + 1),
    }));
    navigateToPath(currentPath, "replace");
  };

  const renameMobileWorkspace = (workspaceId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setMobileWorkspaces((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? { ...workspace, title: uniqueMobileFileWorkspaceTitle(trimmed, current.workspaces.filter((candidate) => candidate.id !== workspaceId)) }
          : workspace,
      ),
    }));
  };

  const deleteMobileWorkspace = (workspaceId: string) => {
    if (mobileWorkspaces.workspaces.length <= 1) return;
    const deletedIndex = mobileWorkspaces.workspaces.findIndex((workspace) => workspace.id === workspaceId);
    if (deletedIndex < 0) return;
    const workspaces = mobileWorkspaces.workspaces.filter((workspace) => workspace.id !== workspaceId);
    const fallbackWorkspace = workspaces[Math.max(0, deletedIndex - 1)] ?? workspaces[0];
    const activeWorkspaceId = mobileWorkspaces.activeWorkspaceId === workspaceId ? fallbackWorkspace.id : mobileWorkspaces.activeWorkspaceId;
    setMobileWorkspaces((current) => ({
      ...current,
      workspaces,
      activeWorkspaceId,
    }));
    if (mobileWorkspaces.activeWorkspaceId === workspaceId) {
      const activeTab = fallbackWorkspace.tabs.find((tab) => tab.id === fallbackWorkspace.activeTabId) ?? fallbackWorkspace.tabs[0];
      if (activeTab) navigateToPath(activeTab.path, "replace");
    }
  };

  const startCreate = (kind: CreateItemKind) => {
    if (!canAddInCurrentFolder) return;
    setContextEntry(null);
    setAddSheetOpen(false);
    setCreateKind(kind);
    setCreateName(kind === "folder" ? "Untitled Folder" : "Untitled File");
  };

  const submitCreate = async () => {
    if (!createKind) return;
    const name = createName.trim();
    if (!name) {
      setError("Enter a name.");
      return;
    }
    setActionBusy(true);
    setError(null);
    const debugId = beginActionDebug("create", {
      directory: currentPath,
      name,
      kind: createKind,
      location: mobileLocationLabel(currentPath, rootPath, mountRoot, remotes),
    });
    try {
      const queue = await explorerQueueCreateItem({ directory: currentPath, name, kind: createKind });
      finishActionDebug(debugId, queue, {
        types: ["create"],
        fileName: name,
        pathHints: [currentPath, name],
      });
      setCreateKind(null);
      setCreateName("");
      window.setTimeout(() => void refreshCurrent(), 500);
    } catch (createError) {
      failActionDebug(debugId, createError);
      setError(sanitizeMobilePathText(`Create failed: ${errorText(createError)}`, homeDir));
    } finally {
      setActionBusy(false);
    }
  };

  const uploadIntoCurrentFolder = async (sourceKind: "files" | "folders") => {
    if (!canAddInCurrentFolder) return;
    if (!hasTauriInternals()) {
      setError("Uploading local files is only available in the Tauri app.");
      return;
    }
    setActionBusy(true);
    setError(null);
    let debugId: string | null = null;
    try {
      const selection = await open({ multiple: true, directory: sourceKind === "folders" });
      const paths = selection == null ? [] : Array.isArray(selection) ? selection : [selection];
      if (paths.length === 0) return;
      const request = {
        sources: paths.map((path) => ({ path, isDirectory: sourceKind === "folders" })),
        destinationDirectory: currentPath,
        operation: "copy",
      } as const;
      debugId = beginActionDebug("upload", {
        ...request,
        sourceKind,
        location: mobileLocationLabel(currentPath, rootPath, mountRoot, remotes),
      });
      const queue = await explorerQueuePasteItems(request);
      finishActionDebug(debugId, queue, {
        types: ["upload"],
        fileName: paths.length === 1 ? basenameForMobilePath(paths[0]) : undefined,
        pathHints: [currentPath, ...paths],
      });
      setContextEntry(null);
      setAddSheetOpen(false);
      window.setTimeout(() => void refreshCurrent(), 700);
    } catch (uploadError) {
      failActionDebug(debugId ?? beginActionDebug("upload", { sourceKind, destinationDirectory: currentPath }), uploadError);
      setError(sanitizeMobilePathText(`Upload failed: ${errorText(uploadError)}`, homeDir));
    } finally {
      setActionBusy(false);
    }
  };

  const toggleEntrySelection = (entry: FileEntry) => {
    if (!isMobileSelectableEntry(entry)) return;
    setSelectionMode(true);
    setSelectedIds((current) =>
      current.includes(entry.id)
        ? current.filter((id) => id !== entry.id)
        : [...current, entry.id],
    );
  };

  const selectAllVisible = () => {
    setSelectionMode(true);
    setSelectedIds(entries.filter(isMobileSelectableEntry).map((entry) => entry.id));
  };

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedIds([]);
  };

  const copyEntries = (nextEntries: FileEntry[], operation: MobileClipboardOperation) => {
    const actionable = nextEntries.filter((entry) => !isVirtualRemoteEntry(entry) && !entry.isDeleted);
    if (actionable.length === 0) return;
    setClipboard({ entries: actionable, operation });
    setContextEntry(null);
    if (actionable.length > 1) clearSelection();
  };

  const copyEntry = (entry: FileEntry, operation: MobileClipboardOperation) => {
    copyEntries([entry], operation);
  };

  const pasteIntoCurrentFolder = async () => {
    if (!clipboard || !canPasteInCurrentFolder) return;
    setActionBusy(true);
    setError(null);
    try {
      await explorerQueuePasteItems({
        sources: clipboard.entries.map((entry) => ({ path: entry.path, isDirectory: entry.kind === "folder" })),
        destinationDirectory: currentPath,
        operation: clipboard.operation,
      });
      if (clipboard.operation === "move") setClipboard(null);
      setAddSheetOpen(false);
      window.setTimeout(() => void refreshCurrent(), 700);
    } catch (pasteError) {
      setError(sanitizeMobilePathText(`Paste failed: ${errorText(pasteError)}`, homeDir));
    } finally {
      setActionBusy(false);
    }
  };

  const startRename = (entry: FileEntry) => {
    if (isVirtualRemoteEntry(entry)) return;
    setContextEntry(null);
    setRenameEntry(entry);
    setRenameName(entry.name);
  };

  const startBatchRename = (nextEntries: FileEntry[]) => {
    const actionable = nextEntries.filter(isMobileRenameableEntry);
    if (actionable.length === 0) return;
    setSelectionMode(false);
    setSelectedIds([]);
    setContextEntry(null);
    setBatchRenameItems(validateMobileBatchRenameItems(
      actionable.map((entry) => {
        const [value, lockedExtension] = splitMobileRenameParts(entry);
        return { entry, value, lockedExtension, error: null };
      }),
      entries,
    ));
  };

  const submitRename = async () => {
    if (!renameEntry) return;
    const newName = renameName.trim();
    if (!newName) {
      setError("Enter a name.");
      return;
    }
    if (newName === renameEntry.name) {
      setRenameEntry(null);
      return;
    }
    setActionBusy(true);
    setError(null);
    const request = {
      path: renameEntry.path,
      newName,
      sourceIsDirectory: renameEntry.kind === "folder",
    };
    const debugId = beginActionDebug("rename", {
      ...request,
      oldName: renameEntry.name,
      location: mobileLocationLabel(renameEntry.path, rootPath, mountRoot, remotes),
    });
    try {
      const queue = await explorerQueueRenameItem(request);
      finishActionDebug(debugId, queue, {
        types: ["rename"],
        fileName: newName,
        pathHints: [renameEntry.path, newName],
      });
      setRenameEntry(null);
      setRenameName("");
      window.setTimeout(() => void refreshCurrent(), 700);
    } catch (renameError) {
      failActionDebug(debugId, renameError);
      setError(sanitizeMobilePathText(`Rename failed: ${errorText(renameError)}`, homeDir));
    } finally {
      setActionBusy(false);
    }
  };

  const updateBatchRenameValue = (entryId: string, value: string) => {
    setBatchRenameItems((current) =>
      validateMobileBatchRenameItems(
        current.map((item) => item.entry.id === entryId ? { ...item, value } : item),
        entries,
      ),
    );
  };

  const submitBatchRename = async () => {
    if (batchRenameItems.length === 0) return;
    const validated = validateMobileBatchRenameItems(batchRenameItems, entries);
    setBatchRenameItems(validated);
    if (validated.some((item) => item.error)) return;
    const items = validated
      .map((item) => ({
        item,
        newName: `${item.value.trim()}${item.lockedExtension}`,
      }))
      .filter(({ item, newName }) => newName !== item.entry.name)
      .map(({ item, newName }) => ({
        path: item.entry.path,
        newName,
        sourceIsDirectory: item.entry.kind === "folder",
      }));
    if (items.length === 0) {
      setBatchRenameItems([]);
      return;
    }
    setActionBusy(true);
    setError(null);
    try {
      await explorerQueueRenameItems({ items });
      setBatchRenameItems([]);
      setSelectedIds([]);
      window.setTimeout(() => void refreshCurrent(), 700);
    } catch (renameError) {
      setError(sanitizeMobilePathText(`Batch rename failed: ${errorText(renameError)}`, homeDir));
    } finally {
      setActionBusy(false);
    }
  };

  const requestDeleteEntries = (nextEntries: FileEntry[]) => {
    const actionable = nextEntries.filter((entry) => !isVirtualRemoteEntry(entry) && !entry.isDeleted);
    if (actionable.length === 0) return;
    setContextEntry(null);
    setDeleteEntries(actionable);
    if (actionable.length > 1) setSelectionMode(false);
  };

  const requestDelete = (entry: FileEntry) => {
    requestDeleteEntries([entry]);
  };

  const downloadEntries = async (nextEntries: FileEntry[]) => {
    const downloadable = nextEntries.filter(isDownloadableRemoteEntry);
    if (downloadable.length === 0) return;
    setActionBusy(true);
    setError(null);
    let debugId: string | null = null;
    try {
      const destinationDirectory = chooseMobileDownloadDirectory(rootPath);
      const request = {
        sources: downloadable.map((entry) => ({ path: entry.path, isDirectory: entry.kind === "folder" })),
        destinationDirectory,
        operation: "copy",
      } as const;
      debugId = beginActionDebug("download", {
        ...request,
        names: downloadable.map((entry) => entry.name),
      });
      const queue = await explorerQueuePasteItems(request);
      finishActionDebug(debugId, queue, {
        types: ["download"],
        fileName: downloadable.length === 1 ? downloadable[0].name : undefined,
        pathHints: [destinationDirectory, ...downloadable.map((entry) => entry.path)],
      });
      setContextEntry(null);
      if (downloadable.length > 1) clearSelection();
      if (normalizePath(currentPath) === normalizePath(destinationDirectory)) {
        window.setTimeout(() => void refreshCurrent(), 700);
      }
    } catch (downloadError) {
      failActionDebug(debugId ?? beginActionDebug("download", { sources: downloadable.map((entry) => entry.path) }), downloadError);
      setError(sanitizeMobilePathText(`Download failed: ${errorText(downloadError)}`, homeDir));
    } finally {
      setActionBusy(false);
    }
  };

  const downloadEntry = async (entry: FileEntry) => {
    await downloadEntries([entry]);
  };

  const copyEntryPath = async (entry: FileEntry) => {
    setActionBusy(true);
    setError(null);
    setNotice(null);
    try {
      try {
        await writeText(entry.path);
      } catch {
        await navigator.clipboard.writeText(entry.path);
      }
      setContextEntry(null);
      setNotice("Path copied.");
    } catch (copyError) {
      setError(sanitizeMobilePathText(`Copy path failed: ${errorText(copyError)}`, homeDir));
    } finally {
      setActionBusy(false);
    }
  };

  const publishMobileSharedClipboard = async () => {
    setActionBusy(true);
    setError(null);
    setNotice(null);
    try {
      let published = await clipboardPublishShared();
      if (!published) {
        const systemText = await readText().catch(() => "");
        if (systemText.trim()) {
          await clipboardSetLocal(mobileTextClipboardPayload(systemText));
          published = await clipboardPublishShared();
        }
      }
      if (!published) {
        const image = await clipboardImagePng();
        if (image) {
          published = await clipboardPublishImageBytes({
            bytes: [...image.bytes],
            width: image.width,
            height: image.height,
            mimeType: "image/png",
          });
        }
      }
      if (!published) {
        setError("Shared clipboard publish failed. Copy text, an image, or files first, then try again.");
        return;
      }
      setSharedClipboardSheetOpen(false);
      setNotice("Shared clipboard published.");
    } catch (clipboardError) {
      setError(`Shared clipboard publish failed: ${errorText(clipboardError)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const applyMobileSharedClipboard = async () => {
    setActionBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await clipboardApplyShared();
      const message = await writeMobileSharedClipboardPayload(payload, mountRoot);
      setSharedClipboardSheetOpen(false);
      setNotice(message);
    } catch (clipboardError) {
      setError(`Shared clipboard apply failed: ${errorText(clipboardError)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const addDetailTag = async () => {
    if (!detailEntry) return;
    const nextTag = tagDraft.trim();
    if (!nextTag || detailTags.includes(nextTag)) {
      setTagDraft("");
      return;
    }
    setActionBusy(true);
    setError(null);
    try {
      await setExplorerLibraryTags(detailEntry, [...detailTags, nextTag]);
      setTagDraft("");
    } catch (tagError) {
      setError(sanitizeMobilePathText(`Tag update failed: ${errorText(tagError)}`, homeDir));
    } finally {
      setActionBusy(false);
    }
  };

  const removeDetailTag = async (tag: string) => {
    if (!detailEntry) return;
    setActionBusy(true);
    setError(null);
    try {
      await setExplorerLibraryTags(detailEntry, detailTags.filter((candidate) => candidate !== tag));
    } catch (tagError) {
      setError(sanitizeMobilePathText(`Tag update failed: ${errorText(tagError)}`, homeDir));
    } finally {
      setActionBusy(false);
    }
  };

  const previewEntry = async (entry: FileEntry) => {
    if (!isPreviewableEntry(entry)) return;
    setContextEntry(null);
    setPreview((current) => {
      revokeMobileObjectUrl(current?.url);
      return {
        entry,
        loading: true,
        error: null,
        text: null,
        url: "",
        mimeType: "",
      };
    });
    try {
      const imageMimeType = mobilePreviewImageMimeType(entry);
      if (imageMimeType) {
        const localPath = await preparedPreviewPathForMobileEntry(entry);
        const url = await loadMobileImageAssetUrl(localPath);
        setPreview({
          entry,
          loading: false,
          error: null,
          text: null,
          url,
          mimeType: imageMimeType,
        });
        return;
      }
      const payload = await explorerPreviewItem(entry.path);
      const bytes = new Uint8Array(payload.bytes);
      if (previewPayloadIsText(payload.mimeType)) {
        setPreview({
          entry,
          loading: false,
          error: null,
          text: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
          url: "",
          mimeType: payload.mimeType,
        });
        return;
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: payload.mimeType }));
      setPreview((current) => {
        revokeMobileObjectUrl(current?.url);
        return {
          entry,
          loading: false,
          error: null,
          text: null,
          url,
          mimeType: payload.mimeType,
        };
      });
    } catch (previewError) {
      setPreview({
        entry,
        loading: false,
        error: errorText(previewError),
        text: null,
        url: "",
        mimeType: "",
      });
    }
  };

  const confirmDelete = async () => {
    if (deleteEntries.length === 0) return;
    setActionBusy(true);
    setError(null);
    try {
      await explorerQueueDeleteItems({ paths: deleteEntries.map((entry) => entry.path) });
      setDeleteEntries([]);
      setSelectedIds([]);
      window.setTimeout(() => void refreshCurrent(), 700);
    } catch (deleteError) {
      setError(sanitizeMobilePathText(`Delete failed: ${errorText(deleteError)}`, homeDir));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <section className={filesPageClass} onScroll={handleMobileFilePageScroll}>
      <div className={filesSearchClass}>
        <button
          type="button"
          className={`${filesIconButtonClass} h-[38px] w-[38px]`}
          aria-label="Files sidebar"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(true)}
        >
          <Menu size={27} strokeWidth={1.85} />
        </button>
        <input
          className="w-full min-w-0 border-0 bg-transparent text-xl font-semibold text-[#f5f5f5] outline-none placeholder:text-[#cbcbcb] placeholder:opacity-85"
          value={query}
          placeholder={`Search in ${mobileSearchScopeLabel(currentTitle)}`}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="mx-[calc(-1*max(16px,var(--misty-safe-right)))] grid grid-cols-2 items-end border-b border-[#e0e0e033] px-[max(16px,var(--misty-safe-right))]" role="tablist" aria-label="Files sections">
        <button
          type="button"
          className={`${filesTabClass} ${activeFilesTab === "device" ? filesActiveTabClass : ""}`}
          role="tab"
          aria-selected={activeFilesTab === "device"}
          onClick={() => navigateToPath(rootPath)}
        >
          On Device
        </button>
        <button
          type="button"
          className={`${filesTabClass} ${activeFilesTab === "remote" ? filesActiveTabClass : ""}`}
          role="tab"
          aria-selected={activeFilesTab === "remote"}
          onClick={openRemoteTab}
        >
          Remote
        </button>
      </div>

      <div className="mb-1 flex min-h-[54px] items-center justify-between gap-2">
        <div className="inline-flex flex-none items-center gap-1" aria-label="Folder navigation">
          <button
            type="button"
            className={filesSortButtonClass}
            aria-label="Up one folder"
            disabled={!mobileUpPath}
            onClick={goMobileUp}
          >
            <ArrowLeft size={21} strokeWidth={2.1} />
          </button>
        </div>
        <button
          type="button"
          className="flex min-w-0 flex-auto items-center gap-2.5 border-0 bg-transparent p-0 text-inherit"
          aria-label="Sort files"
          aria-haspopup="dialog"
          onClick={() => setSortSheetOpen(true)}
        >
          <span className="min-w-0 overflow-hidden truncate text-xl font-extrabold text-[#f6f6f6]">{mobileSortColumnLabel(sort.column)}</span>
          <span className="grid h-[43px] w-[43px] place-items-center rounded-full bg-[#535353] text-[#e5e5e5]">
            <ArrowUp className={`transition-transform duration-[160ms] ease-out ${sort.direction === "desc" ? "rotate-180" : ""}`} size={28} strokeWidth={2.4} />
          </span>
        </button>
        <button
          type="button"
          className={filesMoreButtonClass}
          aria-label="More file actions"
          aria-haspopup="dialog"
          aria-expanded={actionsSheetOpen}
          onClick={() => setActionsSheetOpen(true)}
        >
          <MoreVertical size={25} strokeWidth={2.2} />
        </button>
      </div>

      {selectionMode ? (
        <MobileFilesSelectionBar
          selectedCount={selectedEntries.length}
          actionableCount={selectedActionableEntries.length}
          canSelectAll={selectableEntries.length > 0}
          allSelected={allVisibleSelected}
          canDownload={selectedDownloadableEntries.length > 0}
          busy={actionBusy}
          onDone={clearSelection}
          onSelectAll={allVisibleSelected ? () => setSelectedIds([]) : selectAllVisible}
          onCopy={() => copyEntries(selectedActionableEntries, "copy")}
          onCut={() => copyEntries(selectedActionableEntries, "move")}
          onRename={() => startBatchRename(selectedActionableEntries)}
          onDownload={() => void downloadEntries(selectedDownloadableEntries)}
          onDelete={() => requestDeleteEntries(selectedActionableEntries)}
        />
      ) : null}

      {error ? <div className={mobileErrorClass}>{error}</div> : null}
      {notice ? <div className={mobileSuccessClass}>{notice}</div> : null}
      {actionDebug ? (
        <MobileFilesActionDebug
          debug={actionDebug}
          onClose={() => setActionDebug(null)}
        />
      ) : null}

      <div
        className={viewMode === "grid" ? fileListGridClass : fileListBaseClass}
        aria-busy={loading}
      >
        {loading && !listing ? <MobileFileSkeleton /> : null}
        {!loading && listing && entries.length === 0 ? (
          <MobileFilesEmptyState
            reason={emptyReason}
            searching={Boolean(query.trim())}
          />
        ) : null}
        {entries.map((entry) => {
          const selected = selectedIdSet.has(entry.id);
          const selectable = isMobileSelectableEntry(entry);
          return (
          <div
            key={entry.id}
            className={[
              viewMode === "grid" ? fileRowGridClass : fileRowListClass,
              selectionMode ? viewMode === "grid" ? "grid-cols-[34px_minmax(0,1fr)]" : "grid-cols-[40px_minmax(0,1fr)]" : "",
              selected ? viewMode === "grid" ? fileRowGridSelectedClass : fileRowSelectedClass : "",
            ].filter(Boolean).join(" ")}
          >
            {selectionMode ? (
              <button
                type="button"
                className={`${fileSelectButtonClass} ${selected ? fileSelectButtonSelectedClass : ""}`}
                aria-label={selected ? `Deselect ${entry.name}` : `Select ${entry.name}`}
                disabled={!selectable}
                onClick={() => toggleEntrySelection(entry)}
              >
                {selected ? <Check size={18} strokeWidth={2.3} /> : <Square size={20} strokeWidth={1.9} />}
              </button>
            ) : null}
            <button
              type="button"
              className={viewMode === "grid" ? fileRowMainGridClass : fileRowMainListClass}
              onClick={() => selectionMode ? toggleEntrySelection(entry) : openEntry(entry)}
            >
              <span className={mobileFileIconStyleClass(entry, viewMode)}>
                {entry.kind === "folder" ? <Folder size={25} strokeWidth={1.8} /> : <MobileFileGlyph entry={entry} />}
              </span>
              <span className={`grid min-w-0 ${viewMode === "grid" ? "gap-1.5" : "gap-[5px]"}`}>
                <strong className={viewMode === "grid" ? "line-clamp-2 overflow-hidden text-base font-extrabold leading-[1.15] text-[#f5f5f5]" : "truncate text-[21px] font-extrabold leading-[1.12] text-[#f5f5f5]"}>
                  {entry.name}
                </strong>
                <small className={viewMode === "grid" ? "text-xs font-semibold text-[#b3b3b3]" : "text-base font-bold text-[#b3b3b3]"}>
                  {mobileFileMeta(entry)}
                </small>
              </span>
            </button>
            {!selectionMode ? (
              <button
                type="button"
                className={viewMode === "grid" ? `${filesMoreButtonClass} h-[34px] w-[34px]` : filesMoreButtonClass}
                aria-label={`Actions for ${entry.name}`}
                aria-haspopup="dialog"
                onClick={() => setContextEntry(entry)}
              >
                <MoreVertical size={24} strokeWidth={2.4} />
              </button>
            ) : null}
          </div>
          );
        })}
      </div>

      <button
        type="button"
        className={[
          "fixed z-[80] grid h-16 w-16 place-items-center rounded-full border-0 bg-[#f7f7f7] text-[#171717]",
          "right-[max(22px,calc(var(--misty-safe-right)+18px))] bottom-[calc(102px+var(--misty-safe-bottom))]",
          "shadow-[0_16px_32px_rgba(0,0,0,0.28)] transition-[opacity,transform] duration-[160ms] ease-out active:translate-y-px active:scale-[0.98]",
          floatingAddVisible || addSheetOpen ? "pointer-events-auto opacity-100" : "pointer-events-none translate-y-[18px] scale-[0.92] opacity-0",
        ].join(" ")}
        aria-label="Add files"
        aria-haspopup="dialog"
        onClick={() => setAddSheetOpen(true)}
      >
        <Plus size={25} strokeWidth={2.3} />
      </button>

      {addSheetOpen ? (
        <MobileFileAddSheet
          canAdd={canAddInCurrentFolder}
          busy={actionBusy}
          currentTitle={currentTitle}
          clipboardLabel={clipboard ? mobileClipboardLabel(clipboard) : null}
          canPaste={canPasteInCurrentFolder}
          onClose={() => setAddSheetOpen(false)}
          onCreate={startCreate}
          onUpload={(sourceKind) => void uploadIntoCurrentFolder(sourceKind)}
          onPaste={() => void pasteIntoCurrentFolder()}
        />
      ) : null}

      {sortSheetOpen ? (
        <MobileFilesSortSheet
          sort={sort}
          viewMode={viewMode}
          showHidden={showHidden}
          hiddenCount={listing?.hiddenCount ?? 0}
          onClose={() => setSortSheetOpen(false)}
          onSort={updateSortColumn}
          onDirection={(direction) => setSort((current) => ({ ...current, direction }))}
          onViewMode={setViewMode}
          onShowHidden={setShowHidden}
        />
      ) : null}

      {actionsSheetOpen ? (
        <MobileFilesActionsSheet
          viewMode={viewMode}
          showHidden={showHidden}
          selectionMode={selectionMode}
          syncOpen={syncSheetOpen}
          sharedClipboardOpen={sharedClipboardSheetOpen}
          mikaOpen={mikaSheetOpen}
          refreshBusy={loading || (remoteRoot && remoteLoading)}
          onClose={() => setActionsSheetOpen(false)}
          onViewMode={(mode) => {
            setViewMode(mode);
            setActionsSheetOpen(false);
          }}
          onShowHidden={() => {
            setShowHidden((current) => !current);
            setActionsSheetOpen(false);
          }}
          onSelection={() => {
            if (selectionMode) clearSelection();
            else setSelectionMode(true);
            setActionsSheetOpen(false);
          }}
          onSync={() => {
            setSyncSheetOpen(true);
            setActionsSheetOpen(false);
          }}
          onSharedClipboard={() => {
            setSharedClipboardSheetOpen(true);
            setActionsSheetOpen(false);
          }}
          onMika={() => {
            setMikaSheetOpen(true);
            setActionsSheetOpen(false);
          }}
          onRefresh={() => {
            setActionsSheetOpen(false);
            void refreshCurrent();
          }}
        />
      ) : null}

      {syncSheetOpen ? (
        <MobileFileSyncSheet
          pairs={syncPairs}
          loadingPairs={syncLoadingPairs}
          pairError={syncPairError}
          session={syncSession ?? null}
          onClose={() => setSyncSheetOpen(false)}
          onSelectPair={(pair) => {
            ensureSyncSession(mobileFileSyncSessionId, pair.left, pair.right);
            selectSyncPair(mobileFileSyncSessionId, pair.id);
          }}
          onSwap={() => swapSyncRoots(mobileFileSyncSessionId)}
          onCompare={() => void compareSync(mobileFileSyncSessionId)}
          onApply={() => void applySync(mobileFileSyncSessionId).then(() => refreshCurrent())}
          onAction={(relativePath, action) => setSyncRowAction(mobileFileSyncSessionId, relativePath, action)}
        />
      ) : null}

      {sharedClipboardSheetOpen ? (
        <MobileSharedClipboardSheet
          busy={actionBusy}
          onClose={() => setSharedClipboardSheetOpen(false)}
          onPublish={() => void publishMobileSharedClipboard()}
          onApply={() => void applyMobileSharedClipboard()}
        />
      ) : null}

      {mikaSheetOpen ? (
        <MobileMikaSheet
          workingDirectory={currentPath}
          selectedPath={mikaSelectedEntry?.path ?? null}
          onClose={() => setMikaSheetOpen(false)}
        />
      ) : null}

      {createKind ? (
        <MobileCreateItemSheet
          kind={createKind}
          name={createName}
          busy={actionBusy}
          onName={setCreateName}
          onClose={() => {
            setCreateKind(null);
            setCreateName("");
          }}
          onSubmit={() => void submitCreate()}
        />
      ) : null}

      {contextEntry ? (
        <MobileFileContextSheet
          entry={contextEntry}
          opening={opening}
          busy={actionBusy}
          canCreate={canAddInCurrentFolder}
          canPaste={canPasteInCurrentFolder}
          canPin={contextEntry.kind === "folder" && !contextEntry.isDeleted}
          pinned={mobilePathIsPinned(contextEntry.path, pinnedPaths)}
          clipboardLabel={clipboard ? mobileClipboardLabel(clipboard) : null}
          onClose={() => setContextEntry(null)}
          onCreate={startCreate}
          onUpload={(sourceKind) => void uploadIntoCurrentFolder(sourceKind)}
          onOpen={() => void openFile(contextEntry)}
          onOpenWith={() => void openFileWith(contextEntry)}
          onPreview={() => void previewEntry(contextEntry)}
          onDetails={() => {
            setDetailEntry(contextEntry);
            setTagDraft("");
            setContextEntry(null);
          }}
          onCopy={() => copyEntry(contextEntry, "copy")}
          onCut={() => copyEntry(contextEntry, "move")}
          onPaste={() => void pasteIntoCurrentFolder()}
          onDownload={() => void downloadEntry(contextEntry)}
          onRename={() => startRename(contextEntry)}
          onDelete={() => requestDelete(contextEntry)}
          onTogglePin={() => {
            togglePinnedPath(contextEntry.path);
            setContextEntry(null);
          }}
          onCopyPath={() => void copyEntryPath(contextEntry)}
          onRefresh={() => {
            setContextEntry(null);
            void refreshCurrent();
          }}
        />
      ) : null}

      {renameEntry ? (
        <MobileRenameItemSheet
          entry={renameEntry}
          name={renameName}
          busy={actionBusy}
          onName={setRenameName}
          onClose={() => {
            setRenameEntry(null);
            setRenameName("");
          }}
          onSubmit={() => void submitRename()}
        />
      ) : null}

      {batchRenameItems.length > 0 ? (
        <MobileBatchRenameSheet
          items={batchRenameItems}
          busy={actionBusy}
          onValue={updateBatchRenameValue}
          onClose={() => setBatchRenameItems([])}
          onSubmit={() => void submitBatchRename()}
        />
      ) : null}

      {deleteEntries.length > 0 ? (
        <MobileDeleteItemSheet
          entries={deleteEntries}
          busy={actionBusy}
          onClose={() => setDeleteEntries([])}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}

      {preview ? (
        <MobilePreviewSheet
          preview={preview}
          onClose={() => setPreview((current) => {
            if (current?.url) URL.revokeObjectURL(current.url);
            return null;
          })}
        />
      ) : null}

      {media ? (
        <MobileMediaViewer
          media={media}
          onClose={() => setMedia((current) => {
            revokeMobileObjectUrl(current?.url);
            return null;
          })}
        />
      ) : null}

      {detailEntry ? (
        <div
          className={mobileSheetBackdropClass}
          role="presentation"
          onClick={() => {
            setDetailEntry(null);
            setTagDraft("");
          }}
        >
          <section
            className={mobileSheetClass}
            role="dialog"
            aria-modal="true"
            aria-label="File details"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={mobileSheetHeaderClass}>
              <div>
                <span className={mobileSheetKickerClass}>{detailEntry.kind}</span>
                <h2 className={mobileSheetTitleClass}>{detailEntry.name}</h2>
              </div>
              <button
                type="button"
                className={mobileIconButtonClass}
                aria-label="Close"
                onClick={() => {
                  setDetailEntry(null);
                  setTagDraft("");
                }}
              >
                <X size={20} />
              </button>
            </header>
            <dl className="mb-4 grid gap-2.5">
              <div className="grid gap-1">
                <dt className="text-[11px] font-bold uppercase text-[#919191]">Location</dt>
                <dd className="m-0 min-w-0 break-words text-[13px] text-[#ededed]">{mobileLocationLabel(detailEntry.path, rootPath, mountRoot, remotes)}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-[11px] font-bold uppercase text-[#919191]">Size</dt>
                <dd className="m-0 min-w-0 break-words text-[13px] text-[#ededed]">{formatBytes(detailEntry.sizeBytes)}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-[11px] font-bold uppercase text-[#919191]">Modified</dt>
                <dd className="m-0 min-w-0 break-words text-[13px] text-[#ededed]">{formatDate(detailEntry.remoteModified ?? detailEntry.modifiedMs)}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-[11px] font-bold uppercase text-[#919191]">Type</dt>
                <dd className="m-0 min-w-0 break-words text-[13px] text-[#ededed]">{detailEntry.mimeType || detailEntry.extension || detailEntry.kind}</dd>
              </div>
            </dl>
            <section className="mb-3.5 grid gap-[9px] border-0 bg-transparent p-0" aria-label="File tags">
              <span className="text-[11px] font-extrabold uppercase tracking-normal text-[#919191]">Tags</span>
              {detailTags.length > 0 ? (
                <div className="flex flex-wrap gap-[7px]">
                  {detailTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="inline-flex min-h-[30px] min-w-0 items-center gap-1.5 rounded-full border border-[#b2b2b238] bg-[#b2b2b21f] px-[9px] text-xs font-bold text-[#e5e5e5] disabled:opacity-50"
                      disabled={actionBusy}
                      aria-label={`Remove ${tag}`}
                      onClick={() => void removeDetailTag(tag)}
                    >
                      {tag}
                      <span className="text-[#b9b9b9]" aria-hidden="true">x</span>
                    </button>
                  ))}
                </div>
              ) : <small className="text-xs text-[#acacac]">No tags</small>}
              <form
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addDetailTag();
                }}
              >
                <input
                  className="h-[38px] min-w-0 rounded-xl border border-white/10 bg-[#080808] px-[11px] text-[#f3f3f3] outline-none"
                  value={tagDraft}
                  disabled={actionBusy}
                  placeholder="Add tag"
                  onChange={(event) => setTagDraft(event.target.value)}
                />
                <button type="submit" className="min-h-[38px] rounded-xl border border-white/10 bg-[#f3f3f3] px-[13px] text-xs font-extrabold text-[#161616] disabled:opacity-50" disabled={actionBusy || !tagDraft.trim()}>
                  Add
                </button>
              </form>
            </section>
            {detailEntry.kind !== "folder" ? (
              <button type="button" className={mobilePrimaryActionClass} disabled={opening} onClick={() => void openFile(detailEntry)}>
                {opening ? "Opening..." : "Open"}
              </button>
            ) : null}
          </section>
        </div>
      ) : null}

      <MobileFilesSidebar
        open={sidebarOpen}
        activePath={currentPath}
        workspaces={mobileWorkspaces.workspaces}
        activeWorkspaceId={mobileWorkspaces.activeWorkspaceId}
        tabs={mobileTabs.tabs}
        activeTabId={mobileTabs.activeTabId}
        closedTabs={mobileTabs.closedTabs}
        rootPath={rootPath}
        mountRoot={mountRoot}
        pinnedPaths={pinnedPaths}
        remotes={remotes}
        remoteLoading={remoteLoading}
        onClose={() => setSidebarOpen(false)}
        onNavigate={navigateToPath}
        onSelectWorkspace={selectMobileWorkspace}
        onCreateWorkspace={createMobileWorkspace}
        onRenameWorkspace={renameMobileWorkspace}
        onDeleteWorkspace={deleteMobileWorkspace}
        onNewTab={createMobileTab}
        onSelectTab={selectMobileTab}
        onCloseTab={closeMobileTab}
        onRestoreTab={restoreMobileTab}
      />
    </section>
  );
}

const mobileSidebarActionClass =
  "inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-transparent px-2 text-xs font-semibold text-white/80 disabled:opacity-35";

function mobileSidebarRowClass(selected: boolean, extra = ""): string {
  return [
    "w-full min-w-0 border-b border-white/10 bg-transparent py-2 text-left text-white transition-colors",
    selected ? "text-white" : "text-white/80",
    extra,
  ].filter(Boolean).join(" ");
}

function mobileSidebarIconClass(selected: boolean): string {
  return [
    "grid size-8 place-items-center rounded-lg",
    selected ? "text-white" : "text-white/60",
  ].join(" ");
}

function MobileSheetHeader(props: {
  eyebrow: string;
  title: ReactNode;
  closeLabel?: string;
  onClose: () => void;
}) {
  return (
    <header className={mobileSheetHeaderClass}>
      <div className="min-w-0">
        <span className={mobileSheetKickerClass}>{props.eyebrow}</span>
        <h2 className={mobileSheetTitleClass}>{props.title}</h2>
      </div>
      <button type="button" className={mobileIconButtonClass} aria-label={props.closeLabel ?? "Close"} onClick={props.onClose}>
        <X size={20} />
      </button>
    </header>
  );
}

function MobileFilesSidebar(props: {
  open: boolean;
  activePath: string;
  workspaces: MobileFileWorkspace[];
  activeWorkspaceId: string;
  tabs: MobileFileTab[];
  activeTabId: string;
  closedTabs: MobileFileTab[];
  rootPath: string;
  mountRoot: string;
  pinnedPaths: string[];
  remotes: ProviderRemote[];
  remoteLoading: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (title: string) => void;
  onRenameWorkspace: (workspaceId: string, title: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onNewTab: () => void;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRestoreTab: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<MobileSidebarSection, boolean>>(() => loadMobileFilesSidebarCollapsed());
  const [workspaceDialog, setWorkspaceDialog] = useState<MobileWorkspaceDialogState | null>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const locationItems = useMemo(() => mobileLocationItems(props.rootPath), [props.rootPath]);
  const pinnedItems = useMemo(() => mobilePinnedSidebarItems(props.pinnedPaths), [props.pinnedPaths]);

  useEffect(() => {
    saveMobileFilesSidebarCollapsed(collapsed);
  }, [collapsed]);

  if (!props.open) return null;

  const toggle = (section: MobileSidebarSection) => {
    setCollapsed((current) => ({ ...current, [section]: !current[section] }));
  };
  const activeWorkspace = props.workspaces.find((workspace) => workspace.id === props.activeWorkspaceId) ?? props.workspaces[0];
  const openWorkspaceDialog = (kind: "create" | "rename" | "delete") => {
    setWorkspaceDialog({ kind, workspaceId: activeWorkspace?.id ?? "", title: activeWorkspace?.title ?? "Workspace" });
    setWorkspaceDraft(kind === "create" ? "Workspace" : activeWorkspace?.title ?? "Workspace");
  };
  const confirmWorkspaceDialog = () => {
    if (!workspaceDialog) return;
    if (workspaceDialog.kind === "create") {
      props.onCreateWorkspace(workspaceDraft);
    } else if (workspaceDialog.kind === "rename") {
      props.onRenameWorkspace(workspaceDialog.workspaceId, workspaceDraft);
    } else {
      props.onDeleteWorkspace(workspaceDialog.workspaceId);
    }
    setWorkspaceDialog(null);
    setWorkspaceDraft("");
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex justify-start bg-black/60"
      role="presentation"
      onClick={props.onClose}
    >
      <aside
        className="grid h-full w-[min(82vw,340px)] min-w-0 content-start gap-4 overflow-auto border-r border-white/10 bg-[#090909] px-4 pb-[calc(18px+var(--misty-safe-bottom))] pl-[max(16px,var(--misty-safe-left))] pr-4 pt-[calc(18px+var(--misty-safe-top))] text-white shadow-[24px_0_60px_rgba(0,0,0,0.45)] [-webkit-overflow-scrolling:touch]"
        aria-label="Files sidebar"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mb-1 flex items-center justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <span className="text-[11px] font-bold uppercase text-white/45">Misty</span>
            <h2 className="m-0 truncate text-2xl font-semibold leading-none text-white">Browse</h2>
          </div>
          <button type="button" className={mobileIconButtonClass} aria-label="Close sidebar" onClick={props.onClose}>
            <X size={19} strokeWidth={1.9} />
          </button>
        </header>

        <MobileSidebarSectionHeader
          title="Workspaces"
          collapsed={collapsed.workspaces}
          onToggle={() => toggle("workspaces")}
        />
        {!collapsed.workspaces ? (
          <div className="grid gap-0">
            {props.workspaces.map((workspace) => (
              <MobileSidebarWorkspaceButton
                key={workspace.id}
                workspace={workspace}
                selected={workspace.id === props.activeWorkspaceId}
                onSelect={props.onSelectWorkspace}
              />
            ))}
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button type="button" className={mobileSidebarActionClass} onClick={() => openWorkspaceDialog("create")} disabled={props.workspaces.length >= maxMobileFileWorkspaces}>
                <Plus size={15} strokeWidth={2} />
                New
              </button>
              <button type="button" className={mobileSidebarActionClass} onClick={() => openWorkspaceDialog("rename")} disabled={!activeWorkspace}>
                <Pencil size={15} strokeWidth={2} />
                Rename
              </button>
              <button type="button" className={mobileSidebarActionClass} onClick={() => openWorkspaceDialog("delete")} disabled={!activeWorkspace || props.workspaces.length <= 1}>
                <Trash2 size={15} strokeWidth={2} />
                Delete
              </button>
            </div>
          </div>
        ) : null}

        <MobileSidebarSectionHeader
          title="Tabs"
          collapsed={collapsed.tabs}
          onToggle={() => toggle("tabs")}
        />
        {!collapsed.tabs ? (
          <div className="grid gap-0">
            {props.tabs.map((tab) => (
              <MobileSidebarTabButton
                key={tab.id}
                tab={tab}
                selected={tab.id === props.activeTabId}
                canClose={props.tabs.length > 1}
                onSelect={props.onSelectTab}
                onClose={props.onCloseTab}
              />
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" className={mobileSidebarActionClass} onClick={props.onNewTab} disabled={props.tabs.length >= maxMobileFileTabs}>
                <Plus size={15} strokeWidth={2} />
                New Tab
              </button>
              <button type="button" className={mobileSidebarActionClass} onClick={props.onRestoreTab} disabled={props.closedTabs.length === 0}>
                <RefreshCcw size={15} strokeWidth={2} />
                Restore
              </button>
            </div>
          </div>
        ) : null}

        <MobileSidebarSectionHeader
          title="Locations"
          collapsed={collapsed.locations}
          onToggle={() => toggle("locations")}
        />
        {!collapsed.locations ? (
          <div className="grid gap-0">
            {locationItems.map((item) => (
              <MobileSidebarButton
                key={item.id}
                item={item}
                selected={pathIsInsideMobile(props.activePath, item.path)}
                onNavigate={props.onNavigate}
              />
            ))}
          </div>
        ) : null}

        <MobileSidebarSectionHeader
          title="Quick Access"
          collapsed={collapsed.quick}
          onToggle={() => toggle("quick")}
        />
        {!collapsed.quick ? (
          pinnedItems.length === 0 ? (
            <p className="m-0 px-0 py-2 text-xs text-white/45">Pin folders from the file actions menu.</p>
          ) : (
            <div className="grid gap-0">
              {pinnedItems.map((item) => (
                <MobileSidebarButton
                  key={item.id}
                  item={item}
                  selected={pathIsInsideMobile(props.activePath, item.path)}
                  onNavigate={props.onNavigate}
                />
              ))}
            </div>
          )
        ) : null}

        <MobileSidebarSectionHeader
          title="Remote"
          collapsed={collapsed.providers}
          onToggle={() => toggle("providers")}
        />
        {!collapsed.providers ? (
          props.remoteLoading && props.remotes.length === 0 ? (
            <p className="m-0 px-0 py-2 text-xs text-white/45">Loading remote...</p>
          ) : props.remotes.length === 0 ? (
            <p className="m-0 px-0 py-2 text-xs text-white/45">No remote folders</p>
          ) : (
            <div className="grid gap-0">
              {props.remotes.map((remote) => {
                const path = joinMobilePath(props.mountRoot, remote.name);
                return (
                  <MobileSidebarButton
                    key={`${remote.type}:${remote.name}`}
                    item={{
                      id: `${remote.type}:${remote.name}`,
                      label: `${remoteProviderLabel(remote.type)} · ${remote.name}`,
                      detail: "Remote folder",
                      path,
                      icon: Folder,
                    }}
                    selected={pathIsInsideMobile(props.activePath, path)}
                    onNavigate={props.onNavigate}
                  />
                );
              })}
            </div>
          )
        ) : null}
        {workspaceDialog ? (
          <MobileWorkspaceDialog
            state={workspaceDialog}
            value={workspaceDraft}
            workspaceCount={props.workspaces.length}
            onChange={setWorkspaceDraft}
            onCancel={() => {
              setWorkspaceDialog(null);
              setWorkspaceDraft("");
            }}
            onConfirm={confirmWorkspaceDialog}
          />
        ) : null}
      </aside>
    </div>
  );
}

function MobileSidebarWorkspaceButton(props: {
  workspace: MobileFileWorkspace;
  selected: boolean;
  onSelect: (workspaceId: string) => void;
}) {
  const activeTab = props.workspace.tabs.find((tab) => tab.id === props.workspace.activeTabId) ?? props.workspace.tabs[0];
  return (
    <button
      type="button"
      className={mobileSidebarRowClass(props.selected, "grid min-h-12 grid-cols-[34px_minmax(0,1fr)] items-center gap-3")}
      onClick={() => props.onSelect(props.workspace.id)}
    >
      <span className={mobileSidebarIconClass(props.selected)}>
        <AppWindow size={20} strokeWidth={1.8} />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <strong className="truncate text-sm font-semibold">{props.workspace.title}</strong>
        <small className="truncate text-xs text-white/45">{props.workspace.tabs.length} tab{props.workspace.tabs.length === 1 ? "" : "s"} · {activeTab?.title ?? "Files"}</small>
      </span>
    </button>
  );
}

function MobileWorkspaceDialog(props: {
  state: MobileWorkspaceDialogState;
  value: string;
  workspaceCount: number;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const deleting = props.state.kind === "delete";
  const title = props.state.kind === "create"
    ? "New Workspace"
    : props.state.kind === "rename"
      ? "Rename Workspace"
      : "Delete Workspace";
  return (
    <div className={mobileSheetBackdropClass} role="presentation" onClick={props.onCancel}>
      <section
        className={mobileActionSheetClass}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <MobileSheetHeader eyebrow="Workspace" title={title} onClose={props.onCancel} />
        {deleting ? (
          <p className={mobileNoteClass}>
            Delete {props.state.title}? Its mobile tabs will be removed from this device.
          </p>
        ) : (
          <label className={mobileInputGroupClass}>
            <span className={mobileInputLabelClass}>Name</span>
            <input
              className={mobileInputClass}
              value={props.value}
              autoFocus
              onChange={(event) => props.onChange(event.target.value)}
            />
          </label>
        )}
        <div className={mobileActionStackClass}>
          <button
            type="button"
            className={deleting ? mobileDangerActionClass : mobilePrimaryActionClass}
            disabled={deleting ? props.workspaceCount <= 1 : !props.value.trim()}
            onClick={props.onConfirm}
          >
            {deleting ? "Delete" : "Save"}
          </button>
          <button type="button" className={mobileSecondaryActionClass} onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function MobileSidebarTabButton(props: {
  tab: MobileFileTab;
  selected: boolean;
  canClose: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
}) {
  return (
    <div className={mobileSidebarRowClass(props.selected, "grid min-h-12 grid-cols-[minmax(0,1fr)_32px] items-center gap-2")}>
      <button type="button" className="grid min-h-11 min-w-0 grid-cols-[34px_minmax(0,1fr)] items-center gap-3 bg-transparent p-0 text-left text-inherit" onClick={() => props.onSelect(props.tab.id)}>
        <span className={mobileSidebarIconClass(props.selected)}>
          <AppWindow size={20} strokeWidth={1.8} />
        </span>
        <span className="grid min-w-0 gap-0.5">
          <strong className="truncate text-sm font-semibold">{props.tab.title}</strong>
          <small className="truncate text-xs text-white/45">{mobileTabPathLabel(props.tab.path)}</small>
        </span>
      </button>
      <button
        type="button"
        aria-label={`Close ${props.tab.title} tab`}
        className="grid size-8 place-items-center rounded-md border-0 bg-transparent text-white/45 disabled:opacity-30"
        disabled={!props.canClose}
        onClick={() => props.onClose(props.tab.id)}
      >
        <X size={15} strokeWidth={2} />
      </button>
    </div>
  );
}

function MobileSidebarSectionHeader(props: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="mt-1 flex min-h-7 items-center justify-between border-0 bg-transparent px-0 py-0 text-[11px] font-bold uppercase text-white/45"
      aria-expanded={!props.collapsed}
      onClick={props.onToggle}
    >
      <span>{props.title}</span>
      <ChevronRight className={props.collapsed ? "" : "rotate-90"} size={16} strokeWidth={1.9} />
    </button>
  );
}

function MobileSidebarButton(props: {
  item: MobileSidebarItem;
  selected: boolean;
  onNavigate: (path: string) => void;
}) {
  const Icon = props.item.icon;
  return (
    <button
      type="button"
      className={mobileSidebarRowClass(props.selected, "grid min-h-12 grid-cols-[34px_minmax(0,1fr)] items-center gap-3")}
      onClick={() => props.onNavigate(props.item.path)}
    >
      <span className={mobileSidebarIconClass(props.selected || props.item.kind === "pinned")}>
        <Icon size={20} strokeWidth={1.8} />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <strong className="truncate text-sm font-semibold">{props.item.label}</strong>
        <small className="truncate text-xs text-white/45">{props.item.detail}</small>
      </span>
    </button>
  );
}

function MobileFileAddSheet(props: {
  canAdd: boolean;
  busy: boolean;
  currentTitle: string;
  clipboardLabel: string | null;
  canPaste: boolean;
  onClose: () => void;
  onCreate: (kind: CreateItemKind) => void;
  onUpload: (sourceKind: "files" | "folders") => void;
  onPaste: () => void;
}) {
  return (
    <div className={mobileSheetBackdropClass} role="presentation" onClick={props.onClose}>
      <section
        className={mobileActionSheetClass}
        role="dialog"
        aria-modal="true"
        aria-label="Add files"
        onClick={(event) => event.stopPropagation()}
      >
        <MobileSheetHeader eyebrow="Add" title={props.currentTitle} onClose={props.onClose} />
        <div className={mobileActionListClass} role="menu">
          <MobileFileActionButton
            icon={FolderPlus}
            label="New Folder"
            disabled={!props.canAdd || props.busy}
            note={!props.canAdd ? "Open a writable folder first." : undefined}
            onClick={() => props.onCreate("folder")}
          />
          <MobileFileActionButton
            icon={FilePlus}
            label="New File"
            disabled={!props.canAdd || props.busy}
            note={!props.canAdd ? "Open a writable folder first." : undefined}
            onClick={() => props.onCreate("file")}
          />
          <MobileFileActionButton
            icon={Upload}
            label="Upload Files"
            disabled={!props.canAdd || props.busy}
            note={!props.canAdd ? "Open a folder before uploading." : undefined}
            onClick={() => props.onUpload("files")}
          />
          <MobileFileActionButton
            icon={FolderUp}
            label="Upload Folder"
            disabled={!props.canAdd || props.busy}
            note={!props.canAdd ? "Open a folder before uploading." : undefined}
            onClick={() => props.onUpload("folders")}
          />
          <MobileFileActionButton
            icon={Clipboard}
            label="Paste"
            disabled={!props.canPaste || props.busy}
            note={props.clipboardLabel ?? "Copy or cut an item first."}
            onClick={props.onPaste}
          />
        </div>
      </section>
    </div>
  );
}

function MobileSharedClipboardSheet(props: {
  busy: boolean;
  onClose: () => void;
  onPublish: () => void;
  onApply: () => void;
}) {
  return (
    <div className={mobileSheetBackdropClass} role="presentation" onClick={props.onClose}>
      <section
        className={mobileActionSheetClass}
        role="dialog"
        aria-modal="true"
        aria-label="Shared clipboard"
        onClick={(event) => event.stopPropagation()}
      >
        <MobileSheetHeader eyebrow="Clipboard" title="Shared clipboard" onClose={props.onClose} />
        <div className={mobileActionListClass} role="menu">
          <MobileFileActionButton
            icon={Upload}
            label="Publish Local Clipboard"
            note="Send this device clipboard to Misty."
            disabled={props.busy}
            onClick={props.onPublish}
          />
          <MobileFileActionButton
            icon={Download}
            label="Apply Shared Clipboard"
            note="Copy Misty's shared clipboard onto this device."
            disabled={props.busy}
            onClick={props.onApply}
          />
        </div>
      </section>
    </div>
  );
}

function mobileAssistantStatusText(status: AiStatus | null): string {
  if (mikaComingSoon) return "Coming soon...";
  if (!status) return "Checking Mika...";
  if (status.configured) return `Ready (${status.provider}/${status.model})`;
  return "Coming soon...";
}

const mikaComingSoon = true;

function MobileMikaSheet(props: {
  workingDirectory: string;
  selectedPath: string | null;
  onClose: () => void;
}) {
  const { status, mode, messages, plans, toolApprovals, error, refreshStatus, setMode, sendPrompt, abortPrompt, clearConversation, approvePlan, approveToolRequest } = useMikaSessionStore(useShallow((state) => ({
    status: state.status,
    mode: state.mode,
    messages: state.messages,
    plans: state.plans,
    toolApprovals: state.toolApprovals,
    error: state.error,
    refreshStatus: state.refreshStatus,
    setMode: state.setMode,
    sendPrompt: state.sendPrompt,
    abortPrompt: state.abortPrompt,
    clearConversation: state.clearConversation,
    approvePlan: state.approvePlan,
    approveToolRequest: state.approveToolRequest,
  })));
  const [prompt, setPrompt] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const running = status?.running ?? false;
  const configured = !mikaComingSoon && (status?.configured ?? false);

  useEffect(() => {
    if (mikaComingSoon) return;
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const submitPrompt = () => {
    const trimmed = prompt.trim();
    if (mikaComingSoon || !trimmed || running) return;
    setPrompt("");
    void sendPrompt({
      displayPrompt: trimmed,
      prompt: buildMobileMikaPrompt(trimmed, props.workingDirectory, props.selectedPath),
      cwd: props.workingDirectory || null,
      selectedPaths: props.selectedPath ? [mobileBasename(props.selectedPath)] : [],
    });
  };

  return (
    <div className={mobileSheetBackdropClass} role="presentation" onClick={props.onClose}>
      <section
        className={`${mobileSheetClass} grid max-h-[min(calc(100dvh-var(--misty-safe-top)-18px),760px)] grid-rows-[auto_auto_minmax(160px,1fr)_auto] gap-3`}
        role="dialog"
        aria-modal="true"
        aria-label="Mika AI coming soon"
        onClick={(event) => event.stopPropagation()}
      >
        <MobileSheetHeader eyebrow="Assistant" title="Mika" closeLabel="Close Mika" onClose={props.onClose} />
        <div className="grid gap-2 rounded-[14px] border border-white/10 bg-[#0f0f0f] p-[11px]">
          <p className="m-0 rounded-[10px] border border-[#4a4030] bg-[#1b1710] px-2.5 py-2 text-xs font-bold leading-normal text-[#e8d5aa]">
            Mika AI is coming soon. We are polishing assistant workflows before turning it on.
          </p>
          <dl className="m-0 grid gap-2">
            <div className="grid min-w-0 gap-[3px]">
              <dt className="text-[11px] font-extrabold uppercase tracking-normal text-[#919191]">Status</dt>
              <dd className="m-0 min-w-0 break-words text-[13px] leading-[1.35] text-[#f3f3f3]">{mobileAssistantStatusText(status)}</dd>
            </div>
            <div className="grid min-w-0 gap-[3px]">
              <dt className="text-[11px] font-extrabold uppercase tracking-normal text-[#919191]">Folder</dt>
              <dd className="m-0 min-w-0 break-words text-[13px] leading-[1.35] text-[#f3f3f3]">{props.workingDirectory || "No active folder"}</dd>
            </div>
            <div className="grid min-w-0 gap-[3px]">
              <dt className="text-[11px] font-extrabold uppercase tracking-normal text-[#919191]">Selection</dt>
              <dd className="m-0 min-w-0 break-words text-[13px] leading-[1.35] text-[#f3f3f3]">{props.selectedPath ?? "None"}</dd>
            </div>
          </dl>
          {!mikaComingSoon && error ? <p className="m-0 rounded-[10px] bg-[#a8a8a81a] px-2.5 py-2 text-xs text-[#c8c8c8]">{error}</p> : null}
        </div>
        <div ref={logRef} className="grid min-h-40 content-start gap-[9px] overflow-auto rounded-[14px] border border-white/10 bg-[#080808] p-2.5 [-webkit-overflow-scrolling:touch]" aria-live="polite">
          {messages.length === 0 ? (
            <p className="m-0 text-[13px] leading-[1.4] text-[#919191]">Mika AI is coming soon...</p>
          ) : messages.map((message) => (
            <article
              key={message.id}
              className={[
                "grid gap-[5px] rounded-xl border p-[9px]",
                message.role === "user" ? "border-[#b2b2b23d] bg-[#b2b2b21a]" : "",
                message.role === "error" ? "border-[#c8c8c842] bg-[#a8a8a814]" : "",
                message.role !== "user" && message.role !== "error" ? "border-white/10 bg-[#0f0f0f]" : "",
              ].filter(Boolean).join(" ")}
            >
              <strong className="text-xs font-extrabold text-[#f0f0f0]">{message.role === "user" ? "You" : message.role === "tool" ? "Tool" : message.role === "error" ? "Error" : "Mika"}</strong>
              <pre className="m-0 break-words font-sans text-xs leading-[1.45] text-[#cfcfcf] [white-space:pre-wrap]">{message.text || (message.role === "assistant" && running ? "Thinking..." : "")}</pre>
              {message.toolRequestId ? <MobileAiToolActions requestId={message.toolRequestId} approvals={toolApprovals} onApprove={approveToolRequest} /> : null}
              {message.planId ? <MobileAiPlanActions planId={message.planId} plans={plans} onApply={approvePlan} /> : null}
            </article>
          ))}
        </div>
        <form
          className="grid gap-[9px]"
          onSubmit={(event) => {
            event.preventDefault();
            submitPrompt();
          }}
        >
          <textarea
            className="min-w-0 resize-none rounded-[14px] border border-white/10 bg-[#080808] p-3 font-inherit leading-[1.4] text-[#f0f0f0] outline-none focus:border-[#b2b2b26b] focus:shadow-[0_0_0_3px_rgba(183,183,183,0.12)] disabled:opacity-60"
            value={prompt}
            rows={3}
            placeholder={mikaComingSoon ? "Mika is coming soon..." : configured ? "Ask Mika to organize this folder..." : "Configure Mika backend to continue"}
            disabled={!configured || running}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
            <select
              className="min-h-10 rounded-[12px] border border-white/10 bg-[#080808] px-2 text-sm text-[#f0f0f0]"
              value={mode}
              aria-label="Mika mode"
              disabled={mikaComingSoon}
              onChange={(event) => setMode(event.target.value as Parameters<typeof setMode>[0])}
            >
              <option value="ask">Ask</option>
              <option value="auto">Auto</option>
            </select>
            <button type="button" className={mobileSecondaryActionClass} disabled={messages.length === 0 || running} onClick={clearConversation}>
              Clear
            </button>
            {running ? (
              <button type="button" className={mobileDangerActionClass} onClick={abortPrompt}>Stop</button>
            ) : (
              <button type="submit" className={mobilePrimaryActionClass} disabled={!configured || !prompt.trim()}>Send</button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function MobileFilesSelectionBar(props: {
  selectedCount: number;
  actionableCount: number;
  canSelectAll: boolean;
  allSelected: boolean;
  canDownload: boolean;
  busy: boolean;
  onDone: () => void;
  onSelectAll: () => void;
  onCopy: () => void;
  onCut: () => void;
  onRename: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const hasActionableSelection = props.actionableCount > 0;
  const selectionActionClass = "inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-full border border-white/10 bg-[#0f0f0f] px-[11px] text-xs font-bold text-[#f3f3f3] disabled:opacity-45";
  return (
    <section className="mb-3 grid gap-2.5 p-0" aria-label="Selected file actions">
      <header className="flex items-center justify-between gap-2.5">
        <strong className="min-w-0 truncate text-sm font-bold text-[#f0f0f0]">{props.selectedCount === 1 ? "1 selected" : `${props.selectedCount} selected`}</strong>
        <div className="flex flex-nowrap items-center gap-[7px]">
          <button type="button" className={selectionActionClass} disabled={!props.canSelectAll || props.busy} onClick={props.onSelectAll}>
            {props.allSelected ? "Clear" : "All"}
          </button>
          <button type="button" className={selectionActionClass} disabled={props.busy} onClick={props.onDone}>
            Done
          </button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-[7px]">
        <button type="button" className={selectionActionClass} disabled={!hasActionableSelection || props.busy} onClick={props.onCopy}>
          <Copy size={17} strokeWidth={2} /> Copy
        </button>
        <button type="button" className={selectionActionClass} disabled={!hasActionableSelection || props.busy} onClick={props.onCut}>
          <Scissors size={17} strokeWidth={2} /> Cut
        </button>
        <button type="button" className={selectionActionClass} disabled={!hasActionableSelection || props.busy} onClick={props.onRename}>
          <Pencil size={17} strokeWidth={2} /> Rename
        </button>
        <button type="button" className={selectionActionClass} disabled={!props.canDownload || props.busy} onClick={props.onDownload}>
          <Download size={17} strokeWidth={2} /> Download
        </button>
        <button type="button" className={`${selectionActionClass} border-[#c8c8c838] text-[#c8c8c8]`} disabled={!hasActionableSelection || props.busy} onClick={props.onDelete}>
          <Trash2 size={17} strokeWidth={2} /> Delete
        </button>
      </div>
    </section>
  );
}

function MobileAiPlanActions(props: {
  planId: string;
  plans: AiPlanReview[];
  onApply: (planId: string) => Promise<void>;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const plan = props.plans.find((candidate) => candidate.id === props.planId);
  if (!plan) return null;
  const blocked = plan.blockedReasons.length > 0;
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-normal text-[#919191]">
          {plan.plan.operations.length} operations{blocked ? " blocked" : plan.applied ? " queued" : ""}
        </span>
        <button
          type="button"
          className={mobileSecondaryActionClass}
          aria-haspopup="dialog"
          onClick={() => setReviewOpen(true)}
        >
          {plan.applied ? "View" : "Review & Apply"}
        </button>
      </div>
      {reviewOpen ? (
        <MobileAiPlanReviewSheet
          plan={plan}
          onApply={props.onApply}
          onClose={() => setReviewOpen(false)}
        />
      ) : null}
    </div>
  );
}

type MobilePlanOperation = AiPlanReview["plan"]["operations"][number];

function mobilePlanOperationDetail(operation: MobilePlanOperation): string {
  if (operation.type === "mkdir") return operation.path;
  return `${operation.from} -> ${operation.to}`;
}

function MobileAiPlanReviewSheet(props: {
  plan: AiPlanReview;
  onApply: (planId: string) => Promise<void>;
  onClose: () => void;
}) {
  const blocked = props.plan.blockedReasons.length > 0;
  const warnings = [
    ...props.plan.plan.warnings.map((warning) => `Warning: ${warning}`),
    ...props.plan.blockedReasons.map((reason) => `Blocked: ${reason}`),
  ];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);

  const applyPlan = async () => {
    await props.onApply(props.plan.id);
    props.onClose();
  };

  return createPortal(
    <div
      className={mobileSheetBackdropClass}
      role="presentation"
      style={{ zIndex: 2147483100 }}
      onClick={props.onClose}
    >
      <section
        className={`${mobileSheetClass} grid max-h-[min(calc(100dvh-var(--misty-safe-top)-18px),760px)] grid-rows-[auto_minmax(0,1fr)_auto] gap-3`}
        role="dialog"
        aria-modal="true"
        aria-label="Review file operations"
        onClick={(event) => event.stopPropagation()}
      >
        <MobileSheetHeader eyebrow="Mika" title="Review File Operations" onClose={props.onClose} />
        <div className="grid min-h-0 gap-3 overflow-hidden">
          <div className="grid gap-2">
            <div className="grid gap-1">
              <span className="text-[11px] font-bold uppercase tracking-normal text-[#919191]">Will do</span>
              <p className="m-0 break-words text-sm leading-normal text-[var(--misty-text-muted)]">{props.plan.plan.summary}</p>
            </div>
            {props.plan.appliedSummary ? (
              <div className="grid gap-1">
                <span className="text-[11px] font-bold uppercase tracking-normal text-[#919191]">Queued</span>
                <p className="m-0 break-words text-sm leading-normal text-[#d4d4d4]">{props.plan.appliedSummary}</p>
              </div>
            ) : null}
          </div>
          {warnings.length > 0 ? (
            <p className="m-0 text-xs leading-normal text-[#f0b3b3]">{warnings.join(" ")}</p>
          ) : null}
          <ol className="m-0 grid min-h-0 gap-1 overflow-auto rounded-xl border border-[#3a3a3a] bg-[#171717] p-2 [-webkit-overflow-scrolling:touch]">
            {props.plan.plan.operations.map((operation, index) => (
              <li key={`${operation.type}-${index}-${mobilePlanOperationDetail(operation)}`} className="grid min-w-0 gap-1 rounded-lg px-2 py-2 text-xs">
                <span className="font-bold uppercase text-[#f0f0f0]">{operation.type}</span>
                <span className="min-w-0 break-words leading-normal text-[#cfcfcf]">{mobilePlanOperationDetail(operation)}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="grid gap-2">
          <span className="text-[11px] font-bold uppercase tracking-normal text-[#919191]">
            {props.plan.plan.operations.length} operations{blocked ? " blocked" : props.plan.applied ? " queued" : ""}
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={mobileSecondaryActionClass} onClick={props.onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={mobilePrimaryActionClass}
              disabled={blocked || props.plan.applied || props.plan.applying}
              onClick={() => void applyPlan()}
            >
              {props.plan.applying ? "Queueing..." : props.plan.applied ? "Queued" : "Apply"}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function MobileAiToolActions(props: {
  requestId: string;
  approvals: AiToolApproval[];
  onApprove: (requestId: string) => Promise<void>;
}) {
  const approval = props.approvals.find((candidate) => candidate.id === props.requestId);
  if (!approval) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-bold uppercase tracking-normal text-[#919191]">
        {approval.completed ? "Completed" : approval.error ? "Blocked" : "Needs approval"}
      </span>
      <button
        type="button"
        className={mobileSecondaryActionClass}
        disabled={approval.running || approval.completed}
        onClick={() => void props.onApprove(props.requestId)}
      >
        {approval.running ? "Running..." : approval.completed ? "Ran" : "Run"}
      </button>
    </div>
  );
}

function mobileBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function MobileFilesActionsSheet(props: {
  viewMode: MobileFilesViewMode;
  showHidden: boolean;
  selectionMode: boolean;
  syncOpen: boolean;
  sharedClipboardOpen: boolean;
  mikaOpen: boolean;
  refreshBusy: boolean;
  onClose: () => void;
  onViewMode: (mode: MobileFilesViewMode) => void;
  onShowHidden: () => void;
  onSelection: () => void;
  onSync: () => void;
  onSharedClipboard: () => void;
  onMika: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className={mobileSheetBackdropClass} role="presentation" onClick={props.onClose}>
      <section
        className={mobileActionSheetClass}
        role="dialog"
        aria-modal="true"
        aria-label="File actions"
        onClick={(event) => event.stopPropagation()}
      >
        <MobileSheetHeader eyebrow="Files" title="Actions" onClose={props.onClose} />
        <div className={mobileActionListClass} role="menu">
          <MobileFileActionButton
            icon={List}
            label="List View"
            disabled={props.viewMode === "list"}
            note={props.viewMode === "list" ? "Current view" : undefined}
            onClick={() => props.onViewMode("list")}
          />
          <MobileFileActionButton
            icon={Grid2X2}
            label="Grid View"
            disabled={props.viewMode === "grid"}
            note={props.viewMode === "grid" ? "Current view" : undefined}
            onClick={() => props.onViewMode("grid")}
          />
          <MobileFileActionButton
            icon={props.showHidden ? Eye : EyeOff}
            label={props.showHidden ? "Hide Hidden Files" : "Show Hidden Files"}
            onClick={props.onShowHidden}
          />
          <MobileFileActionButton
            icon={CheckSquare}
            label={props.selectionMode ? "Stop Selecting" : "Select Files"}
            onClick={props.onSelection}
          />
          <div className={mobileSeparatorClass} role="separator" />
          <MobileFileActionButton
            icon={GitCompareArrows}
            label="Sync Pairs"
            note={props.syncOpen ? "Already open" : undefined}
            onClick={props.onSync}
          />
          <MobileFileActionButton
            icon={Clipboard}
            label="Shared Clipboard"
            note={props.sharedClipboardOpen ? "Already open" : undefined}
            onClick={props.onSharedClipboard}
          />
          <MobileFileActionButton
            icon={MessageSquare}
            label="Mika"
            note={props.mikaOpen ? "Already open" : "Coming soon"}
            onClick={props.onMika}
          />
          <MobileFileActionButton
            icon={RefreshCcw}
            label={props.refreshBusy ? "Refreshing..." : "Refresh"}
            disabled={props.refreshBusy}
            onClick={props.onRefresh}
          />
        </div>
      </section>
    </div>
  );
}

function MobileFilesSortSheet(props: {
  sort: MobileFilesSortState;
  viewMode: MobileFilesViewMode;
  showHidden: boolean;
  hiddenCount: number;
  onClose: () => void;
  onSort: (column: MobileFilesSortColumn) => void;
  onDirection: (direction: MobileFilesSortDirection) => void;
  onViewMode: (mode: MobileFilesViewMode) => void;
  onShowHidden: (show: boolean) => void;
}) {
  return (
    <div className={mobileSheetBackdropClass} role="presentation" onClick={props.onClose}>
      <section
        className={`${mobileActionSheetClass} gap-3.5`}
        role="dialog"
        aria-modal="true"
        aria-label="Sort and view files"
        onClick={(event) => event.stopPropagation()}
      >
        <MobileSheetHeader eyebrow="View" title="Sort files" onClose={props.onClose} />

        <div className="grid gap-0" role="listbox" aria-label="Sort column">
          {mobileSortColumns.map((column) => (
            <button
              key={column}
              type="button"
              className={`flex min-h-11 min-w-0 items-center justify-between gap-2.5 border border-white/10 border-x-0 border-t-0 bg-transparent px-0 py-2.5 text-left font-bold ${props.sort.column === column ? "text-[#e7e7e7]" : "text-[#f3f3f3]"}`}
              aria-selected={props.sort.column === column}
              onClick={() => props.onSort(column)}
            >
              <span>{mobileSortColumnLabel(column)}</span>
              {props.sort.column === column ? (
                <small className="text-xs font-semibold text-[#acacac]">{props.sort.direction === "asc" ? "Ascending" : "Descending"}</small>
              ) : null}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2" aria-label="Sort direction">
          <button
            type="button"
            className={`min-h-11 rounded-[14px] border border-white/10 px-3 font-bold ${props.sort.direction === "asc" ? "bg-[#b2b2b229] text-[#e7e7e7]" : "bg-[#161616] text-[#f3f3f3]"}`}
            onClick={() => props.onDirection("asc")}
          >
            Ascending
          </button>
          <button
            type="button"
            className={`min-h-11 rounded-[14px] border border-white/10 px-3 font-bold ${props.sort.direction === "desc" ? "bg-[#b2b2b229] text-[#e7e7e7]" : "bg-[#161616] text-[#f3f3f3]"}`}
            onClick={() => props.onDirection("desc")}
          >
            Descending
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2" aria-label="View mode">
          <button
            type="button"
            className={`min-h-11 rounded-[14px] border border-white/10 px-3 font-bold ${props.viewMode === "list" ? "bg-[#b2b2b229] text-[#e7e7e7]" : "bg-[#161616] text-[#f3f3f3]"}`}
            onClick={() => props.onViewMode("list")}
          >
            List
          </button>
          <button
            type="button"
            className={`min-h-11 rounded-[14px] border border-white/10 px-3 font-bold ${props.viewMode === "grid" ? "bg-[#b2b2b229] text-[#e7e7e7]" : "bg-[#161616] text-[#f3f3f3]"}`}
            onClick={() => props.onViewMode("grid")}
          >
            Grid
          </button>
        </div>

        <label className="grid min-h-14 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border border-white/10 bg-transparent p-0 text-[#f3f3f3]">
          <span className="grid min-w-0 gap-[3px]">
            <strong className="truncate text-sm">Show hidden files</strong>
            <small className="truncate text-xs text-[#919191]">{props.hiddenCount > 0 ? `${props.hiddenCount} hidden in this folder` : "Match desktop hidden file browsing"}</small>
          </span>
          <input
            className="h-[22px] w-[22px] accent-[#b2b2b2]"
            type="checkbox"
            checked={props.showHidden}
            onChange={(event) => props.onShowHidden(event.target.checked)}
          />
        </label>
      </section>
    </div>
  );
}

function MobileFileSyncSheet(props: {
  pairs: FileSyncPair[];
  loadingPairs: boolean;
  pairError: string | null;
  session: FileSyncSession | null;
  onClose: () => void;
  onSelectPair: (pair: FileSyncPair) => void;
  onSwap: () => void;
  onCompare: () => void;
  onApply: () => void;
  onAction: (relativePath: string, action: FileSyncPlannedAction) => void;
}) {
  const counts = mobileCompareCounts(props.session?.rows ?? []);
  const plannedCount = props.session?.rows.filter((row) => row.action !== "skip").length ?? 0;
  const selectedPairId = props.session?.activePairId ?? "";
  return (
    <div className={mobileSheetBackdropClass} role="presentation" onClick={props.onClose}>
      <section
        className={`${mobileSheetClass} grid gap-3`}
        role="dialog"
        aria-modal="true"
        aria-label="File sync"
        onClick={(event) => event.stopPropagation()}
      >
        <MobileSheetHeader eyebrow="Sync" title="Saved pairs" onClose={props.onClose} />

        {props.pairError ? <div className={mobileErrorClass}>{props.pairError}</div> : null}
        {props.session?.error ? <div className={mobileErrorClass}>{props.session.error}</div> : null}
        {props.session?.message ? <div className={mobileSuccessClass}>{props.session.message}</div> : null}

        <label className="grid min-w-0 gap-1.5">
          <span className="text-[11px] font-extrabold uppercase tracking-normal text-[#919191]">Pair</span>
          <select
            className="min-h-10 w-full min-w-0 rounded-xl border border-white/10 bg-[#080808] px-[11px] text-[#f3f3f3] outline-none disabled:opacity-50"
            value={selectedPairId}
            disabled={props.loadingPairs || props.pairs.length === 0}
            onChange={(event) => {
              const pair = props.pairs.find((candidate) => candidate.id === Number(event.target.value));
              if (pair) props.onSelectPair(pair);
            }}
          >
            <option value="">{props.loadingPairs ? "Loading pairs..." : "Choose saved pair"}</option>
            {props.pairs.map((pair) => <option key={pair.id} value={pair.id}>{pair.name}</option>)}
          </select>
        </label>

        {props.pairs.length === 0 && !props.loadingPairs ? (
          <p className="m-0 text-[13px] leading-[1.45] text-[#acacac]">No saved sync pairs yet. Create a pair from desktop compare, then run it here.</p>
        ) : null}

        {props.session ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <MobileFileSyncEndpoint label="Left" endpoint={props.session.left} />
              <MobileFileSyncEndpoint label="Right" endpoint={props.session.right} />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button type="button" className="min-h-10 rounded-xl border border-white/10 bg-[#161616] px-2.5 text-xs font-bold text-[#f3f3f3] disabled:opacity-50" disabled={props.session.comparing || props.session.applying} onClick={props.onSwap}>
                Swap
              </button>
              <button type="button" className="min-h-10 rounded-xl border border-white/10 bg-[#161616] px-2.5 text-xs font-bold text-[#f3f3f3] disabled:opacity-50" disabled={props.session.comparing || props.session.applying} onClick={props.onCompare}>
                {props.session.comparing ? "Comparing..." : "Compare"}
              </button>
              <button type="button" className="min-h-10 rounded-xl border border-white/10 bg-[#f3f3f3] px-2.5 text-xs font-bold text-[#161616] disabled:opacity-50" disabled={props.session.applying || plannedCount === 0} onClick={props.onApply}>
                {props.session.applying ? "Applying..." : `Apply${plannedCount ? ` ${plannedCount}` : ""}`}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2" aria-label="Compare summary">
              <span className="flex min-w-0 items-center justify-between gap-2 bg-transparent px-0 py-[9px] text-xs font-bold text-[#acacac]">Left only <strong className="text-sm text-[#f0f0f0]">{counts.left_only}</strong></span>
              <span className="flex min-w-0 items-center justify-between gap-2 bg-transparent px-0 py-[9px] text-xs font-bold text-[#acacac]">Right only <strong className="text-sm text-[#f0f0f0]">{counts.right_only}</strong></span>
              <span className="flex min-w-0 items-center justify-between gap-2 bg-transparent px-0 py-[9px] text-xs font-bold text-[#acacac]">Different <strong className="text-sm text-[#f0f0f0]">{counts.different}</strong></span>
              <span className="flex min-w-0 items-center justify-between gap-2 bg-transparent px-0 py-[9px] text-xs font-bold text-[#acacac]">Conflict <strong className="text-sm text-[#f0f0f0]">{counts.conflict}</strong></span>
            </div>

            {props.session.rows.length > 0 ? (
              <div className="grid gap-2">
                {props.session.rows.map((row) => (
                  <article
                    key={row.relativePath}
                    className={`grid min-w-0 gap-2 rounded-none border bg-transparent px-0 py-[9px] ${row.disposition === "conflict" ? "border-[#c8c8c83d]" : "border-white/10"}`}
                  >
                    <div className="grid min-w-0 gap-[3px]">
                      <strong className="min-w-0 break-words text-[13px] font-bold text-[#f3f3f3]">{row.relativePath || "/"}</strong>
                      <small className="text-[11px] font-extrabold uppercase tracking-normal text-[#919191]">{row.kind} · {row.disposition.replace(/_/g, " ")}</small>
                    </div>
                    <span className="grid min-w-0 gap-[3px]">
                      <small className="text-[11px] font-extrabold uppercase tracking-normal text-[#919191]">Left</small>
                      <em className="min-w-0 break-words text-[13px] not-italic text-[#f3f3f3]" title={mobileCompareSideTitle(row.left)}>{mobileCompareSideSummary(row.left)}</em>
                    </span>
                    <span className="grid min-w-0 gap-[3px]">
                      <small className="text-[11px] font-extrabold uppercase tracking-normal text-[#919191]">Right</small>
                      <em className="min-w-0 break-words text-[13px] not-italic text-[#f3f3f3]" title={mobileCompareSideTitle(row.right)}>{mobileCompareSideSummary(row.right)}</em>
                    </span>
                    <label className="grid min-w-0 gap-1.5">
                      <small className="text-[11px] font-extrabold uppercase tracking-normal text-[#919191]">Action</small>
                      <select
                        className="min-h-10 w-full min-w-0 rounded-xl border border-white/10 bg-[#080808] px-[11px] text-[#f3f3f3] outline-none"
                        value={row.action}
                        onChange={(event) => props.onAction(row.relativePath, event.target.value as FileSyncPlannedAction)}
                      >
                        {mobileFileSyncActions.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}
                      </select>
                    </label>
                  </article>
                ))}
              </div>
            ) : (
              <p className="m-0 text-[13px] leading-[1.45] text-[#acacac]">Run compare to review planned sync actions.</p>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}

function MobileFileSyncEndpoint(props: { label: string; endpoint: FileSyncEndpoint }) {
  return (
    <div className="grid min-w-0 gap-1 bg-transparent p-0">
      <span className="text-[11px] font-extrabold uppercase tracking-normal text-[#919191]">{props.label}</span>
      <strong className="min-w-0 break-words text-[13px] font-bold text-[#f3f3f3]">{mobileFileSyncEndpointLabel(props.endpoint)}</strong>
    </div>
  );
}

function MobileCreateItemSheet(props: {
  kind: CreateItemKind;
  name: string;
  busy: boolean;
  onName: (name: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const title = props.kind === "folder" ? "New Folder" : "New File";
  return (
    <div className={mobileSheetBackdropClass} role="presentation" onClick={props.onClose}>
      <section
        className={mobileActionSheetClass}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <MobileSheetHeader eyebrow="Create" title={title} onClose={props.onClose} />
        <label className={mobileInputGroupClass}>
          <span className={mobileInputLabelClass}>Name</span>
          <input
            className={mobileInputClass}
            autoFocus
            value={props.name}
            onChange={(event) => props.onName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onSubmit();
            }}
          />
        </label>
        <div className={mobileActionStackClass}>
          <button type="button" className={mobilePrimaryActionClass} disabled={props.busy} onClick={props.onSubmit}>
            {props.busy ? "Creating..." : "Create"}
          </button>
          <button type="button" className={mobileSecondaryActionClass} disabled={props.busy} onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function MobileFilesActionDebug(props: {
  debug: MobileActionDebugState;
  onClose: () => void;
}) {
  return (
    <section className="mx-0 my-3 rounded-[18px] border border-white/10 bg-black/35 p-4 text-left text-xs text-white/70">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <span className="block text-[0.68rem] font-black uppercase tracking-[0.16em] text-white/40">Action debug</span>
          <strong className="mt-1 block text-sm text-white">{props.debug.action} · {props.debug.stage}</strong>
          <small className="text-white/40">{props.debug.createdAt}</small>
        </div>
        <button type="button" className={mobileIconButtonClass} aria-label="Hide action debug" onClick={props.onClose}>
          <X size={18} />
        </button>
      </div>
      {props.debug.error ? <div className={mobileErrorClass}>{props.debug.error}</div> : null}
      {props.debug.transfer ? (
        <dl className="mb-3 grid grid-cols-1 gap-2">
          <MobileActionDebugRow label="Transfer" value={`#${props.debug.transfer.id} ${props.debug.transfer.type} · ${props.debug.transfer.status}`} />
          <MobileActionDebugRow label="File" value={props.debug.transfer.fileName || "unknown"} />
          <MobileActionDebugRow label="Detail" value={props.debug.transfer.detail || "none"} />
          {props.debug.transfer.error ? <MobileActionDebugRow label="Error" value={props.debug.transfer.error} /> : null}
          <MobileActionDebugRow label="Local" value={props.debug.transfer.localSourcePath || props.debug.transfer.localDestPath || "none"} />
          <MobileActionDebugRow label="Remote" value={remoteDebugPath(props.debug.transfer)} />
        </dl>
      ) : null}
      <details className="mt-2">
        <summary className="cursor-pointer text-white/55">Request</summary>
        <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-xl bg-white/[0.04] p-3 text-[0.68rem] leading-relaxed text-white/55">{formatMobileDebugValue(props.debug.request)}</pre>
      </details>
      {props.debug.queue ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-white/55">Queue</summary>
          <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-xl bg-white/[0.04] p-3 text-[0.68rem] leading-relaxed text-white/55">{formatMobileDebugValue(props.debug.queue)}</pre>
        </details>
      ) : null}
    </section>
  );
}

function MobileActionDebugRow(props: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 border-b border-white/5 pb-2 last:border-b-0">
      <dt className="font-bold uppercase tracking-[0.12em] text-white/35">{props.label}</dt>
      <dd className="m-0 break-words text-white/70">{props.value}</dd>
    </div>
  );
}

function MobileFileContextSheet(props: {
  entry: FileEntry;
  opening: boolean;
  busy: boolean;
  canCreate: boolean;
  canPaste: boolean;
  canPin: boolean;
  pinned: boolean;
  clipboardLabel: string | null;
  onClose: () => void;
  onCreate: (kind: CreateItemKind) => void;
  onUpload: (sourceKind: "files" | "folders") => void;
  onOpen: () => void;
  onOpenWith: () => void;
  onPreview: () => void;
  onDetails: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDownload: () => void;
  onRename: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onCopyPath: () => void;
  onRefresh: () => void;
}) {
  const virtualRemote = isVirtualRemoteEntry(props.entry);
  const deletedEntry = Boolean(props.entry.isDeleted);
  const canDownload = isDownloadableRemoteEntry(props.entry);
  const canPreview = isPreviewableEntry(props.entry);
  const canOpenWith = isMobileOpenWithEntry(props.entry);
  const canMutate = !virtualRemote && !deletedEntry;
  return (
    <div className={mobileSheetBackdropClass} role="presentation" onClick={props.onClose}>
      <section
        className={mobileActionSheetClass}
        role="dialog"
        aria-modal="true"
        aria-label={`Actions for ${props.entry.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{props.entry.kind}</span>
            <h2>{props.entry.name}</h2>
          </div>
          <button type="button" className={mobileIconButtonClass} aria-label="Close" onClick={props.onClose}>
            <X size={20} />
          </button>
        </header>
        <div className={mobileActionListClass} role="menu">
          <MobileFileActionButton
            icon={FolderPlus}
            label="New Folder"
            disabled={!props.canCreate || props.busy}
            note={!props.canCreate ? "Open a writable folder first." : undefined}
            onClick={() => props.onCreate("folder")}
          />
          <MobileFileActionButton
            icon={FilePlus}
            label="New File"
            disabled={!props.canCreate || props.busy}
            note={!props.canCreate ? "Open a writable folder first." : undefined}
            onClick={() => props.onCreate("file")}
          />
          <MobileFileActionButton
            icon={Upload}
            label="Upload Files"
            disabled={!props.canCreate || props.busy}
            note={!props.canCreate ? "Open a folder before uploading." : undefined}
            onClick={() => props.onUpload("files")}
          />
          <MobileFileActionButton
            icon={FolderUp}
            label="Upload Folder"
            disabled={!props.canCreate || props.busy}
            note={!props.canCreate ? "Open a folder before uploading." : undefined}
            onClick={() => props.onUpload("folders")}
          />
          <div className={mobileSeparatorClass} role="separator" />
          <MobileFileActionButton
            icon={props.entry.kind === "folder" ? FolderOpen : File}
            label={props.entry.kind === "folder" ? "Open Folder" : "Open"}
            disabled={props.opening || deletedEntry}
            note={deletedEntry ? "Trash items cannot be opened yet." : undefined}
            onClick={props.onOpen}
          />
          <MobileFileActionButton
            icon={AppWindow}
            label="Open With..."
            disabled={!canOpenWith || props.opening}
            note={canOpenWith ? undefined : "Open With is available for files."}
            onClick={props.onOpenWith}
          />
          <MobileFileActionButton
            icon={FileText}
            label="Preview"
            disabled={!canPreview}
            note={canPreview ? undefined : "Preview is available for supported files."}
            onClick={props.onPreview}
          />
          <MobileFileActionButton icon={Info} label="Details" onClick={props.onDetails} />
          <MobileFileActionButton
            icon={Pin}
            label={props.pinned ? "Unpin from Quick Access" : "Pin to Quick Access"}
            disabled={!props.canPin}
            note={mobilePinDisabledNote(props.entry)}
            onClick={props.onTogglePin}
          />
          <div className={mobileSeparatorClass} role="separator" />
          <MobileFileActionButton
            icon={Copy}
            label="Copy"
            disabled={!canMutate}
            note={mobileMutationDisabledNote(props.entry)}
            onClick={props.onCopy}
          />
          <MobileFileActionButton
            icon={Scissors}
            label="Cut"
            disabled={!canMutate}
            note={mobileMutationDisabledNote(props.entry)}
            onClick={props.onCut}
          />
          <MobileFileActionButton
            icon={Clipboard}
            label="Paste"
            disabled={!props.canPaste || props.busy}
            note={props.clipboardLabel ?? "Copy or cut an item first."}
            onClick={props.onPaste}
          />
          <div className={mobileSeparatorClass} role="separator" />
          <MobileFileActionButton
            icon={Download}
            label="Download"
            disabled={!canDownload || props.opening}
            note={canDownload ? undefined : "Available for remote files and folders."}
            onClick={props.onDownload}
          />
          <MobileFileActionButton
            icon={Pencil}
            label="Rename"
            disabled={!canMutate}
            note={mobileMutationDisabledNote(props.entry)}
            onClick={props.onRename}
          />
          <MobileFileActionButton
            icon={Trash2}
            label="Delete"
            disabled={!canMutate}
            danger
            note={mobileMutationDisabledNote(props.entry)}
            onClick={props.onDelete}
          />
          <MobileFileActionButton
            icon={Copy}
            label="Copy Path"
            disabled={props.busy}
            onClick={props.onCopyPath}
          />
          <div className={mobileSeparatorClass} role="separator" />
          <MobileFileActionButton
            icon={RefreshCcw}
            label="Refresh"
            disabled={props.busy}
            onClick={props.onRefresh}
          />
        </div>
      </section>
    </div>
  );
}

function MobileRenameItemSheet(props: {
  entry: FileEntry;
  name: string;
  busy: boolean;
  onName: (name: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className={mobileSheetBackdropClass} role="presentation" onClick={props.onClose}>
      <section
        className={mobileActionSheetClass}
        role="dialog"
        aria-modal="true"
        aria-label={`Rename ${props.entry.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <MobileSheetHeader eyebrow="Rename" title={props.entry.name} onClose={props.onClose} />
        <label className={mobileInputGroupClass}>
          <span className={mobileInputLabelClass}>Name</span>
          <input
            className={mobileInputClass}
            autoFocus
            value={props.name}
            onChange={(event) => props.onName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onSubmit();
            }}
          />
        </label>
        <div className={mobileActionStackClass}>
          <button type="button" className={mobilePrimaryActionClass} disabled={props.busy} onClick={props.onSubmit}>
            {props.busy ? "Renaming..." : "Rename"}
          </button>
          <button type="button" className={mobileSecondaryActionClass} disabled={props.busy} onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function MobileBatchRenameSheet(props: {
  items: MobileBatchRenameItem[];
  busy: boolean;
  onValue: (entryId: string, value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const invalidCount = props.items.filter((item) => item.error).length;
  const changedCount = props.items.filter((item) => `${item.value.trim()}${item.lockedExtension}` !== item.entry.name).length;
  return (
    <div className={mobileSheetBackdropClass} role="presentation" onClick={props.onClose}>
      <section
        className={`${mobileActionSheetClass} gap-3.5`}
        role="dialog"
        aria-modal="true"
        aria-label="Batch rename files"
        onClick={(event) => event.stopPropagation()}
      >
        <MobileSheetHeader eyebrow="Rename" title={`${props.items.length} selected`} onClose={props.onClose} />
        <div className="grid max-h-[42dvh] gap-[9px] overflow-auto pr-0.5 [-webkit-overflow-scrolling:touch]">
          {props.items.map((item) => (
            <label
              key={item.entry.id}
              className={`grid min-w-0 gap-2 rounded-[14px] border p-2.5 ${item.error ? "border-[#c8c8c852] bg-[#a8a8a814]" : "border-white/10 bg-[#161616]"}`}
            >
              <span className="grid min-w-0 gap-[3px]">
                <strong className="truncate text-[13px] text-[#f3f3f3]">{item.entry.name}</strong>
                {item.error ? (
                  <small className="truncate text-xs text-[#c8c8c8]">{item.error}</small>
                ) : (
                  <small className="truncate text-xs text-[#919191]">{mobileLocationShortLabel(item.entry.path)}</small>
                )}
              </span>
              <span className="grid min-h-[42px] min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center overflow-hidden rounded-xl border border-white/10 bg-[#080808]">
                <input
                  className="h-10 min-w-0 border-0 bg-transparent px-[11px] text-[#f0f0f0] outline-none"
                  value={item.value}
                  disabled={props.busy}
                  onChange={(event) => props.onValue(item.entry.id, event.target.value)}
                />
                {item.lockedExtension ? <em className="max-w-24 overflow-hidden truncate pr-[11px] text-[13px] not-italic text-[#919191]">{item.lockedExtension}</em> : null}
              </span>
            </label>
          ))}
        </div>
        <div className={mobileActionStackClass}>
          <button
            type="button"
            className={mobilePrimaryActionClass}
            disabled={props.busy || invalidCount > 0 || changedCount === 0}
            onClick={props.onSubmit}
          >
            {props.busy ? "Queueing..." : `Queue ${changedCount || props.items.length} rename${(changedCount || props.items.length) === 1 ? "" : "s"}`}
          </button>
          <button type="button" className={mobileSecondaryActionClass} disabled={props.busy} onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function MobileDeleteItemSheet(props: {
  entries: FileEntry[];
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const firstEntry = props.entries[0];
  const multiple = props.entries.length > 1;
  const title = multiple ? `${props.entries.length} items` : firstEntry?.name ?? "item";
  const kind = multiple ? "items" : firstEntry?.kind ?? "item";
  return (
    <div className={mobileSheetBackdropClass} role="presentation" onClick={props.onClose}>
      <section
        className={mobileActionSheetClass}
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <MobileSheetHeader eyebrow="Delete" title={title} onClose={props.onClose} />
        <p className={mobileNoteClass}>
          This will queue deletion for {multiple ? "these" : "this"} {kind}. You can monitor it from Transfers.
        </p>
        <div className={mobileActionStackClass}>
          <button type="button" className={mobileDangerActionClass} disabled={props.busy} onClick={props.onConfirm}>
            <Trash2 size={17} /> {props.busy ? "Deleting..." : "Delete"}
          </button>
          <button type="button" className={mobileSecondaryActionClass} disabled={props.busy} onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function MobilePreviewSheet(props: {
  preview: MobilePreviewState;
  onClose: () => void;
}) {
  return createPortal(
    <div className={mobileSheetBackdropClass} role="presentation" style={{ zIndex: 2147483100 }}>
      <section
        className={`${mobileSheetClass} grid max-h-[min(calc(100dvh-var(--misty-safe-top)-18px),760px)] grid-rows-[auto_minmax(160px,1fr)] gap-3`}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${props.preview.entry.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <MobileSheetHeader eyebrow="Preview" title={props.preview.entry.name} onClose={props.onClose} />
        <div className="grid min-h-0 place-items-center overflow-auto rounded-2xl border border-white/10 bg-[#080808] p-3 [-webkit-overflow-scrolling:touch]">
          {props.preview.loading ? <p className="m-0 text-sm font-bold text-[#acacac]">Loading preview...</p> : null}
          {props.preview.error ? <p className="m-0 max-w-[18rem] text-center text-sm font-bold leading-relaxed text-[#c8c8c8]">{props.preview.error}</p> : null}
          {!props.preview.loading && !props.preview.error && props.preview.text != null ? (
            <pre className="m-0 h-full w-full overflow-auto break-words rounded-xl bg-black/30 p-3 font-mono text-xs leading-relaxed text-[#e0e0e0] [white-space:pre-wrap]">{props.preview.text}</pre>
          ) : null}
          {!props.preview.loading && !props.preview.error && props.preview.url && props.preview.mimeType === "application/pdf" ? (
            <object className="h-full min-h-[320px] w-full rounded-xl bg-white" data={props.preview.url} type={props.preview.mimeType} aria-label={`Preview of ${props.preview.entry.name}`} />
          ) : null}
          {!props.preview.loading
            && !props.preview.error
            && props.preview.url
            && props.preview.mimeType !== "application/pdf" ? (
              <img className="max-h-full max-w-full object-contain" src={props.preview.url} alt={`Preview of ${props.preview.entry.name}`} />
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function MobileMediaViewer(props: {
  media: MobileMediaState;
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 flex flex-col bg-black text-white pt-[calc(var(--misty-safe-top)+10px)] pr-[max(14px,var(--misty-safe-right))] pb-[calc(var(--misty-safe-bottom)+14px)] pl-[max(14px,var(--misty-safe-left))]"
      style={{ zIndex: 2147483200 }}
      role="dialog"
      aria-modal="true"
      aria-label={`Open ${props.media.entry.name}`}
    >
      <header className="mb-3 flex min-h-11 items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-[0.68rem] font-black uppercase tracking-[0.16em] text-white/45">
            {props.media.kind}
          </span>
          <h2 className="m-0 truncate text-lg font-black leading-tight text-white">{props.media.entry.name}</h2>
        </div>
        <button
          type="button"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white"
          aria-label="Close"
          onClick={props.onClose}
        >
          <X size={22} />
        </button>
      </header>
      <div className="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-2xl bg-white/[0.04]">
        {props.media.loading ? <p className="text-sm font-bold text-white/65">Opening...</p> : null}
        {props.media.error ? (
          <p className="max-w-[18rem] px-4 text-center text-sm font-bold leading-relaxed text-red-200">{props.media.error}</p>
        ) : null}
        {!props.media.loading && !props.media.error && props.media.url && props.media.kind === "image" ? (
          <img
            src={props.media.url}
            alt={props.media.entry.name}
            className="max-h-full max-w-full object-contain"
          />
        ) : null}
        {!props.media.loading && !props.media.error && props.media.url && props.media.kind === "video" ? (
          <video
            src={props.media.url}
            controls
            playsInline
            className="max-h-full max-w-full"
          />
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function MobileFileActionButton(props: {
  icon: LucideIcon;
  label: string;
  note?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      role="menuitem"
      className={`grid min-h-14 w-full min-w-0 grid-cols-[42px_minmax(0,1fr)] items-center gap-[11px] rounded-[14px] border border-white/10 bg-[#161616] px-[11px] py-[9px] text-left ${props.danger ? "text-[#c8c8c8]" : "text-[#f3f3f3]"} disabled:opacity-50`}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span className="grid h-[42px] w-[42px] place-items-center rounded-[13px] bg-white/[0.06]">
        <Icon size={21} strokeWidth={1.9} />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <strong className="truncate text-sm font-bold">{props.label}</strong>
        {props.note ? <small className="truncate text-xs text-[#919191]">{props.note}</small> : null}
      </span>
    </button>
  );
}

function MobileFilesEmptyState(props: { reason: EmptyReason; searching: boolean }) {
  const title = props.reason === "missing-path"
    ? "Folder unavailable"
    : props.reason === "no-remotes"
      ? "No remote folders"
    : "No files found";
  const message = props.reason === "missing-path"
    ? "This folder is no longer available on this device."
    : props.reason === "no-remotes"
      ? "Connect a remote from the Remotes tab."
    : props.searching
      ? "Try a different search."
      : "This folder is empty.";

  return (
    <div className={mobileEmptyStateClass}>
      <span className={mobileEmptyIconClass} aria-hidden="true">
        <FolderOpen size={34} strokeWidth={1.7} />
      </span>
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}

function MobileFileGlyph(props: { entry: FileEntry }) {
  const iconClass = mobileFileIconClass(props.entry);
  const Icon = iconClass === "image" ? Image : iconClass === "document" ? FileText : File;
  const size = iconClass === "image" ? 26 : 28;
  return <Icon size={size} strokeWidth={1.8} />;
}

function mobileFileIconClass(entry: FileEntry): string {
  if (entry.kind === "folder") return "folder";
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "svg"].includes(extension)) return "image";
  if (["doc", "docx", "rtf", "txt", "md", "pdf"].includes(extension)) return "document";
  if (["ts", "tsx", "js", "jsx", "go", "rs", "py", "java", "c", "cc", "cpp", "h", "hpp", "json"].includes(extension)) return "code";
  return "file";
}

function mobileFileIconStyleClass(entry: FileEntry, viewMode: MobileFilesViewMode): string {
  const sizeClass = viewMode === "grid" ? "h-11 w-11 rounded-xl" : "h-[34px] w-[34px] rounded-[7px]";
  const baseClass = `grid place-items-center border-0 ${sizeClass}`;
  const iconClass = mobileFileIconClass(entry);
  if (iconClass === "folder") return `${baseClass} bg-transparent text-[#86b7ff]`;
  if (iconClass === "image") return `${baseClass} bg-[#183625] text-[#79d99a]`;
  if (iconClass === "document") return `${baseClass} bg-[#1f2f47] text-[#d8e6ff]`;
  if (iconClass === "code") return `${baseClass} bg-[#123041] text-[#7dd3fc]`;
  return `${baseClass} bg-[#253349] text-[#a7c8ff]`;
}

function mobileFileMeta(entry: FileEntry): string {
  const modified = formatDate(entry.remoteModified ?? entry.modifiedMs);
  if (entry.kind === "folder") return modified ? `Modified ${modified}` : "Folder";
  return modified ? `Modified ${modified}` : formatBytes(entry.sizeBytes);
}

function mobileClipboardLabel(clipboard: MobileClipboardState): string {
  const verb = clipboard.operation === "move" ? "Move" : "Copy";
  if (clipboard.entries.length === 1) return `${verb} ${clipboard.entries[0]?.name ?? "item"}`;
  return `${verb} ${clipboard.entries.length} items`;
}

function mobileSortColumnLabel(column: MobileFilesSortColumn): string {
  if (column === "modified") return "Modified";
  if (column === "size") return "Size";
  if (column === "type") return "Type";
  return "Name";
}

function mobileSearchScopeLabel(title: string): string {
  if (title === "Folder unavailable") return "Files";
  return title || "Files";
}

function initialMobilePath(homeDir: string): string {
  try {
    return window.localStorage.getItem(mobileFilesLastPathStorageKey) || homeDir || smokeHome;
  } catch {
    return homeDir || smokeHome;
  }
}

function hasStoredMobilePath(): boolean {
  try {
    return Boolean(window.localStorage.getItem(mobileFilesLastPathStorageKey));
  } catch {
    return false;
  }
}

function loadMobileFileWorkspaces(fallbackPath: string): MobileFileWorkspaceState {
  try {
    const stored = window.localStorage.getItem(mobileFilesWorkspacesStorageKey);
    const parsed = JSON.parse(stored ?? "{}") as Partial<MobileFileWorkspaceState>;
    if (!stored || !Array.isArray(parsed.workspaces)) {
      const legacyTabs = loadMobileFileTabs(fallbackPath);
      const workspace = createMobileFileWorkspaceFromTabs("workspace_0", "Workspace 1", legacyTabs);
      return { workspaces: [workspace], activeWorkspaceId: workspace.id, nextWorkspaceIndex: 1 };
    }
    const workspaces = normalizeMobileFileWorkspaces(parsed.workspaces, fallbackPath);
    const activeWorkspaceId = typeof parsed.activeWorkspaceId === "string" && workspaces.some((workspace) => workspace.id === parsed.activeWorkspaceId)
      ? parsed.activeWorkspaceId
      : workspaces[0].id;
    return {
      workspaces,
      activeWorkspaceId,
      nextWorkspaceIndex: Math.max(Number(parsed.nextWorkspaceIndex) || 0, nextMobileWorkspaceIndex(workspaces)),
    };
  } catch {
    const legacyTabs = loadMobileFileTabs(fallbackPath);
    const workspace = createMobileFileWorkspaceFromTabs("workspace_0", "Workspace 1", legacyTabs);
    return { workspaces: [workspace], activeWorkspaceId: workspace.id, nextWorkspaceIndex: 1 };
  }
}

function saveMobileFileWorkspaces(state: MobileFileWorkspaceState): void {
  try {
    window.localStorage.setItem(mobileFilesWorkspacesStorageKey, JSON.stringify(state));
  } catch {
    // Mobile workspace memory is best-effort.
  }
}

function activeMobileFileWorkspace(state: MobileFileWorkspaceState): MobileFileWorkspace {
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? state.workspaces[0];
}

function updateActiveMobileFileWorkspace(
  state: MobileFileWorkspaceState,
  updater: (workspace: MobileFileWorkspace) => MobileFileWorkspace,
): MobileFileWorkspaceState {
  const active = activeMobileFileWorkspace(state);
  return {
    ...state,
    activeWorkspaceId: active.id,
    workspaces: state.workspaces.map((workspace) => workspace.id === active.id ? updater(workspace) : workspace),
  };
}

function updateActiveMobileFileTab(
  state: MobileFileWorkspaceState,
  updater: (tab: MobileFileTab) => MobileFileTab,
): MobileFileWorkspaceState {
  return updateActiveMobileFileWorkspace(state, (workspace) => {
    const activeTab = activeMobileFileTab(workspace);
    return {
      ...workspace,
      tabs: workspace.tabs.map((tab) => tab.id === activeTab.id ? updater(tab) : tab),
      activeTabId: activeTab.id,
    };
  });
}

function syncActiveMobileWorkspaceTab(state: MobileFileWorkspaceState, path: string, title: string): MobileFileWorkspaceState {
  return updateActiveMobileFileWorkspace(state, (workspace) => ({
    ...workspace,
    ...syncActiveMobileFileTab(workspace, path, title),
  }));
}

function normalizeMobileFileWorkspaces(value: unknown, fallbackPath: string): MobileFileWorkspace[] {
  const source = Array.isArray(value) ? value : [];
  const workspaces = source
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Partial<MobileFileWorkspace>;
      const tabs = normalizeMobileFileTabs(candidate.tabs, fallbackPath);
      const activeTabId = typeof candidate.activeTabId === "string" && tabs.some((tab) => tab.id === candidate.activeTabId)
        ? candidate.activeTabId
        : tabs[0].id;
      return {
        id: typeof candidate.id === "string" && candidate.id ? candidate.id : `workspace_${index}`,
        title: typeof candidate.title === "string" && candidate.title ? candidate.title : `Workspace ${index + 1}`,
        tabs,
        activeTabId,
        closedTabs: normalizeMobileFileTabs(candidate.closedTabs, fallbackPath).slice(0, maxMobileClosedFileTabs),
      };
    })
    .filter((workspace): workspace is MobileFileWorkspace => Boolean(workspace))
    .slice(0, maxMobileFileWorkspaces);
  if (workspaces.length > 0) return workspaces;
  return [createMobileFileWorkspace("Workspace 1", fallbackPath, mobileFallbackTabTitle(fallbackPath), 0)];
}

function createMobileFileWorkspace(title: string, path: string, tabTitle: string, index: number): MobileFileWorkspace {
  const tab = createMobileFileTab(path, tabTitle);
  return {
    id: `workspace_${Math.max(0, index)}`,
    title,
    tabs: [tab],
    activeTabId: tab.id,
    closedTabs: [],
  };
}

function createMobileFileWorkspaceFromTabs(id: string, title: string, tabsState: MobileFileTabsState): MobileFileWorkspace {
  return {
    id,
    title,
    tabs: tabsState.tabs.map(normalizeMobileFileTabPanes),
    activeTabId: tabsState.activeTabId,
    closedTabs: tabsState.closedTabs.map(normalizeMobileFileTabPanes),
  };
}

function nextMobileWorkspaceIndex(workspaces: MobileFileWorkspace[]): number {
  return Math.max(0, ...workspaces.map((workspace) => mobileWorkspaceIndex(workspace.id) + 1));
}

function mobileWorkspaceIndex(id: string): number {
  const match = /^workspace_(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

function uniqueMobileFileWorkspaceTitle(title: string, workspaces: MobileFileWorkspace[]): string {
  const clean = title.trim() || "Workspace";
  const names = new Set(workspaces.map((workspace) => workspace.title.trim()).filter(Boolean));
  if (!names.has(clean)) return clean;
  let index = 2;
  while (names.has(`${clean} ${index}`)) index += 1;
  return `${clean} ${index}`;
}

function loadMobileFileTabs(fallbackPath: string): MobileFileTabsState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(mobileFilesTabsStorageKey) ?? "{}") as Partial<MobileFileTabsState>;
    const tabs = normalizeMobileFileTabs(parsed.tabs, fallbackPath);
    const activeTabId = typeof parsed.activeTabId === "string" && tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : tabs[0].id;
    return {
      tabs,
      activeTabId,
      closedTabs: normalizeMobileFileTabs(parsed.closedTabs, fallbackPath).slice(0, maxMobileClosedFileTabs),
    };
  } catch {
    const tab = createMobileFileTab(fallbackPath);
    return { tabs: [tab], activeTabId: tab.id, closedTabs: [] };
  }
}

function saveMobileFileTabs(state: MobileFileTabsState): void {
  try {
    window.localStorage.setItem(mobileFilesTabsStorageKey, JSON.stringify(state));
  } catch {
    // Mobile tab memory is best-effort.
  }
}

function syncActiveMobileFileTab(state: MobileFileTabsState, path: string, title: string): MobileFileTabsState {
  const tabs = (state.tabs.length > 0 ? state.tabs : [createMobileFileTab(path, title)]).map(normalizeMobileFileTabPanes);
  const activeTabId = tabs.some((tab) => tab.id === state.activeTabId) ? state.activeTabId : tabs[0].id;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const paneSet = activeMobileFilePaneSet(activeTab);
  const activePane = paneSet.panes.find((pane) => pane.id === paneSet.activePaneId);
  const normalized = tabs.some((tab, index) => tab !== state.tabs[index]);
  if (
    !normalized &&
    activeTab?.path === path &&
    activeTab.title === title &&
    activePane?.path === path &&
    activePane.title === title &&
    activeTabId === state.activeTabId &&
    tabs.length === state.tabs.length
  ) {
    return state;
  }
  return {
    ...state,
    activeTabId,
    tabs: tabs.map((tab) => {
      if (tab.id !== activeTabId) return tab;
      return updateMobileFileTabPanes({ ...tab, path, title }, {
        panes: paneSet.panes.map((pane) => pane.id === paneSet.activePaneId ? { ...pane, path, title } : pane),
        activePaneId: paneSet.activePaneId,
        closedPanes: paneSet.closedPanes,
      });
    }),
  };
}

function normalizeMobileFileTabs(value: unknown, fallbackPath: string): MobileFileTab[] {
  const source = Array.isArray(value) ? value : [];
  const tabs = source
    .map((item): MobileFileTab | null => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Partial<MobileFileTab>;
      const path = typeof candidate.path === "string" && candidate.path ? candidate.path : "";
      if (!path) return null;
      return {
        id: typeof candidate.id === "string" && candidate.id ? candidate.id : mobileFileTabId(),
        title: typeof candidate.title === "string" && candidate.title ? candidate.title : mobileFallbackTabTitle(path),
        path,
        panes: normalizeMobileFilePanes(candidate.panes, path, typeof candidate.title === "string" ? candidate.title : mobileFallbackTabTitle(path)),
        activePaneId: typeof candidate.activePaneId === "string" ? candidate.activePaneId : undefined,
        closedPanes: normalizeMobileFilePanes(candidate.closedPanes, path, typeof candidate.title === "string" ? candidate.title : mobileFallbackTabTitle(path), maxMobileClosedFilePanes),
      };
    })
    .filter((tab): tab is MobileFileTab => Boolean(tab))
    .map(normalizeMobileFileTabPanes)
    .slice(0, maxMobileFileTabs);
  if (tabs.length > 0) return tabs;
  return [createMobileFileTab(fallbackPath)];
}

function createMobileFileTab(path: string, title = mobileFallbackTabTitle(path)): MobileFileTab {
  const pane = createMobileFilePane(path, title);
  return {
    id: mobileFileTabId(),
    title: title || mobileFallbackTabTitle(path),
    path,
    panes: [pane],
    activePaneId: pane.id,
    closedPanes: [],
  };
}

function activeMobileFileTab(state: MobileFileTabsState): MobileFileTab {
  const tabs = state.tabs.length > 0 ? state.tabs : [createMobileFileTab(smokeHome)];
  return normalizeMobileFileTabPanes(tabs.find((tab) => tab.id === state.activeTabId) ?? tabs[0]);
}

function activeMobileFilePaneSet(tab: MobileFileTab): { panes: MobileFilePane[]; activePaneId: string; closedPanes: MobileFilePane[] } {
  const normalized = normalizeMobileFileTabPanes(tab);
  return {
    panes: normalized.panes ?? [],
    activePaneId: normalized.activePaneId ?? normalized.panes?.[0]?.id ?? "",
    closedPanes: normalized.closedPanes ?? [],
  };
}

function updateMobileFileTabPanes(
  tab: MobileFileTab,
  paneSet: { panes: MobileFilePane[]; activePaneId: string; closedPanes: MobileFilePane[] },
): MobileFileTab {
  const activePane = paneSet.panes.find((pane) => pane.id === paneSet.activePaneId) ?? paneSet.panes[0];
  return {
    ...tab,
    title: activePane?.title ?? tab.title,
    path: activePane?.path ?? tab.path,
    panes: paneSet.panes,
    activePaneId: activePane?.id ?? paneSet.activePaneId,
    closedPanes: paneSet.closedPanes.slice(0, maxMobileClosedFilePanes),
  };
}

function updateMobilePaneHistory(
  pane: MobileFilePane,
  previousPath: string,
  nextPath: string,
  mode: MobileFilesNavigationMode,
): MobileFilePane {
  const normalizedPrevious = normalizePath(previousPath);
  const normalizedNext = normalizePath(nextPath);
  if (!normalizedNext || normalizedNext === normalizedPrevious || mode === "replace") {
    return { ...pane, path: nextPath };
  }
  const backHistory = pane.backHistory ?? [];
  const forwardHistory = pane.forwardHistory ?? [];
  if (mode === "back") {
    return {
      ...pane,
      path: nextPath,
      backHistory: backHistory.slice(0, -1),
      forwardHistory: pushMobileHistory(forwardHistory, previousPath),
    };
  }
  if (mode === "forward") {
    return {
      ...pane,
      path: nextPath,
      backHistory: pushMobileHistory(backHistory, previousPath),
      forwardHistory: forwardHistory.slice(0, -1),
    };
  }
  return {
    ...pane,
    path: nextPath,
    backHistory: pushMobileHistory(backHistory, previousPath),
    forwardHistory: [],
  };
}

function pushMobileHistory(history: string[], path: string): string[] {
  const normalized = normalizePath(path);
  if (!normalized) return history;
  const last = history[history.length - 1];
  if (normalizePath(last ?? "") === normalized) return history;
  return [...history, path].slice(-40);
}

function normalizeMobileFileTabPanes(tab: MobileFileTab): MobileFileTab {
  const panes = normalizeMobileFilePanes(tab.panes, tab.path, tab.title);
  const activePaneId = typeof tab.activePaneId === "string" && panes.some((pane) => pane.id === tab.activePaneId)
    ? tab.activePaneId
    : panes[0].id;
  const closedPanes = normalizeMobileFilePanes(tab.closedPanes, tab.path, tab.title, maxMobileClosedFilePanes);
  if (tab.panes === panes && tab.activePaneId === activePaneId && tab.closedPanes === closedPanes) return tab;
  return { ...tab, panes, activePaneId, closedPanes };
}

function normalizeMobileFilePanes(value: unknown, fallbackPath: string, fallbackTitle: string, limit = maxMobileFilePanes): MobileFilePane[] {
  const source = Array.isArray(value) ? value : [];
  const panes = source
    .map((item): MobileFilePane | null => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Partial<MobileFilePane>;
      const path = typeof candidate.path === "string" && candidate.path ? candidate.path : "";
      if (!path) return null;
      return {
        id: typeof candidate.id === "string" && candidate.id ? candidate.id : mobileFilePaneId(),
        title: typeof candidate.title === "string" && candidate.title ? candidate.title : mobileFallbackTabTitle(path),
        path,
        backHistory: normalizeMobileHistory(candidate.backHistory),
        forwardHistory: normalizeMobileHistory(candidate.forwardHistory),
      };
    })
    .filter((pane): pane is MobileFilePane => Boolean(pane))
    .slice(0, limit);
  if (panes.length > 0) return panes;
  return [createMobileFilePane(fallbackPath, fallbackTitle || mobileFallbackTabTitle(fallbackPath))];
}

function normalizeMobileHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(-40);
}

function createMobileFilePane(path: string, title = mobileFallbackTabTitle(path)): MobileFilePane {
  return {
    id: mobileFilePaneId(),
    title: title || mobileFallbackTabTitle(path),
    path,
  };
}

function mobileFileTabId(): string {
  return `mobile-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mobileFilePaneId(): string {
  return `mobile-pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mobileFallbackTabTitle(path: string): string {
  const virtual = mobileVirtualLibraryLabel(path);
  if (virtual) return virtual;
  const name = normalizePath(path).split("/").filter(Boolean).pop();
  return name ? displayPathPart(name) : "Files";
}

function mobileTabPathLabel(path: string): string {
  const virtual = mobileVirtualLibraryLabel(path);
  if (virtual) return `Library / ${virtual}`;
  const parts = normalizePath(path).split("/").filter(Boolean).slice(-2).map(displayPathPart);
  if (parts.length === 0) return path || "Files";
  return parts.join(" / ");
}

function loadMobileFilesViewMode(): MobileFilesViewMode {
  try {
    const value = window.localStorage.getItem(mobileFilesViewModeStorageKey);
    return value === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

function saveMobileFilesViewMode(viewMode: MobileFilesViewMode): void {
  try {
    window.localStorage.setItem(mobileFilesViewModeStorageKey, viewMode);
  } catch {
    // Mobile view preference is best-effort.
  }
}

function loadMobileFilesSort(): MobileFilesSortState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(mobileFilesSortStorageKey) ?? "{}") as Partial<MobileFilesSortState>;
    const column = mobileSortColumns.includes(parsed.column as MobileFilesSortColumn)
      ? parsed.column as MobileFilesSortColumn
      : "name";
    const direction = parsed.direction === "desc" ? "desc" : "asc";
    return { column, direction };
  } catch {
    return { column: "name", direction: "asc" };
  }
}

function saveMobileFilesSort(sort: MobileFilesSortState): void {
  try {
    window.localStorage.setItem(mobileFilesSortStorageKey, JSON.stringify(sort));
  } catch {
    // Mobile sort preference is best-effort.
  }
}

function loadMobileFilesShowHidden(): boolean {
  try {
    return window.localStorage.getItem(mobileFilesShowHiddenStorageKey) === "true";
  } catch {
    return false;
  }
}

function saveMobileFilesShowHidden(showHidden: boolean): void {
  try {
    window.localStorage.setItem(mobileFilesShowHiddenStorageKey, showHidden ? "true" : "false");
  } catch {
    // Mobile hidden-file preference is best-effort.
  }
}

function mobileLocationItems(rootPath: string): MobileSidebarItem[] {
  const candidates: MobileSidebarItem[] = [
    { id: "home", label: "On My iPhone", detail: "Local files", path: rootPath, icon: Home },
    { id: "recent", label: "Recent", detail: "Recently opened", path: mobileRecentPath, icon: Clock3 },
    { id: "starred", label: "Starred", detail: "Saved items", path: mobileStarredPath, icon: Star },
    { id: "misty", label: "Misty", detail: "App data", path: joinMobilePath(rootPath, ".misty"), icon: HardDrive },
    { id: "documents", label: "Documents", detail: "Local folder", path: joinMobilePath(rootPath, "Documents"), icon: FileText },
    { id: "downloads", label: "Downloads", detail: "Local folder", path: joinMobilePath(rootPath, "Downloads"), icon: Download },
    { id: "trash", label: "Trash", detail: "Deleted cache", path: mobileTrashPath, icon: Trash2 },
  ];
  return candidates;
}

function mobilePinnedSidebarItems(paths: string[]): MobileSidebarItem[] {
  const seen = new Set<string>();
  const items: MobileSidebarItem[] = [];
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push({
      id: `pinned:${normalized}`,
      label: mobilePinnedPathLabel(normalized),
      detail: "Pinned folder",
      path: normalized,
      icon: Pin,
      kind: "pinned",
    });
  }
  return items;
}

function mobilePinnedPathLabel(path: string): string {
  if (path === "/") return "/";
  const name = path.split("/").filter(Boolean).pop();
  return name || path;
}

function sortMobileListing(listing: DirectoryListing, sort: MobileFilesSortState): DirectoryListing {
  const entries = [...listing.entries].sort((left, right) => {
    const folderBias = Number(right.kind === "folder") - Number(left.kind === "folder");
    if (folderBias !== 0) return folderBias;
    const direction = sort.direction === "asc" ? 1 : -1;
    return compareMobileEntries(left, right, sort.column) * direction;
  });
  return { ...listing, entries };
}

function compareMobileEntries(left: FileEntry, right: FileEntry, column: MobileFilesSortColumn): number {
  if (column === "modified") {
    return compareMobileNullableNumber(left.modifiedMs, right.modifiedMs)
      || compareMobileText(left.remoteModified, right.remoteModified)
      || compareMobileText(left.name, right.name);
  }
  if (column === "size") {
    return compareMobileNullableNumber(left.sizeBytes, right.sizeBytes) || compareMobileText(left.name, right.name);
  }
  if (column === "type") {
    return compareMobileText(mobileTypeLabel(left), mobileTypeLabel(right)) || compareMobileText(left.name, right.name);
  }
  return compareMobileText(left.name, right.name);
}

function compareMobileNullableNumber(left: number | null, right: number | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareMobileText(left: string | null, right: string | null): number {
  return (left ?? "").localeCompare(right ?? "", undefined, { numeric: true, sensitivity: "base" });
}

function mobileTextClipboardPayload(text: string): ClipboardPayload {
  return {
    kind: text ? "text" : "empty",
    origin: "local_system",
    payload_id: "",
    source_device_id: "",
    source_device_name: "",
    revision: 0,
    created_unix_ms: 0,
    text,
    html: "",
    file_refs: [],
    images: [],
  };
}

function buildMobileMikaPrompt(userPrompt: string, workingDirectory: string, selectedPath: string | null): string {
  const context = [
    "You are helping inside Misty, a file manager.",
    "Mika is beta and experimental.",
    "Your main goal is to help reorganize files. You may chat freely, but tool-assisted work should stay focused on listing, searching, validating, and proposing safe file organization plans.",
    "Do not inspect file contents or ask for preview tools. For changes, propose a file plan with folders, moves, and renames for the user to review.",
    workingDirectory ? `Current folder: ${workingDirectory}` : "Current folder: none",
    selectedPath ? `Selected item: ${selectedPath}` : "Selected item: none",
  ].join("\n");
  return `${context}\n\nUser request:\n${userPrompt}`;
}

async function writeMobileSharedClipboardPayload(payload: ClipboardPayload, mountRoot: string): Promise<string> {
  switch (payload.kind) {
    case "text":
      if (!payload.text) break;
      await writeMobileSystemText(payload.text);
      return "Shared text copied.";
    case "html":
      if (!payload.html && !payload.text) break;
      if (payload.html) {
        try {
          await writeHtml(payload.html, payload.text || undefined);
          return "Shared rich text copied.";
        } catch {
          if (!payload.text) throw new Error("This device could not write rich text to the clipboard.");
        }
      }
      await writeMobileSystemText(payload.text);
      return "Shared text copied.";
    case "file_refs": {
      const localItems = mobileSharedClipboardLocalPasteItems(payload);
      const remoteItems = await mobileSharedClipboardRemotePasteItems(payload, mountRoot);
      const nativeItems = [...localItems, ...remoteItems];
      if (nativeItems.length > 0 && await clipboardWriteFileRefs(nativeItems)) {
        return nativeItems.length === 1 ? "Shared file copied." : `${nativeItems.length} shared files copied.`;
      }
      const text = mobileSharedClipboardText(payload);
      if (!text) break;
      await writeMobileSystemText(text);
      return "Shared file references copied as text.";
    }
    case "image": {
      const image = payload.images.find((candidate) => candidate.blob_id);
      if (!image) break;
      const bytes = await clipboardSharedImageBytes(image.blob_id);
      await writeImage(new Uint8Array(bytes));
      return "Shared image copied.";
    }
    case "empty":
      break;
  }
  throw new Error("This shared clipboard payload cannot be applied to this device yet.");
}

async function writeMobileSystemText(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

function mobileSharedClipboardText(payload: ClipboardPayload): string {
  switch (payload.kind) {
    case "text":
      return payload.text;
    case "html":
      return payload.html || payload.text;
    case "file_refs":
      return payload.file_refs
        .map((ref) => ref.local_path.trim() || mobileSharedClipboardRemoteLabel(ref))
        .filter(Boolean)
        .join("\n");
    default:
      return "";
  }
}

function mobileSharedClipboardRemoteLabel(ref: ClipboardPayload["file_refs"][number]): string {
  const providerType = ref.provider_type.trim();
  const remoteName = ref.remote_name.trim();
  const remotePath = ref.remote_path.trim();
  if (!remoteName && !remotePath) return "";
  const provider = providerType ? `${providerType}/` : "";
  return `${provider}${remoteName}:${remotePath}`;
}

function mobileSharedClipboardLocalPasteItems(payload: ClipboardPayload): PasteItem[] {
  return payload.file_refs
    .map((ref) => ({
      path: ref.local_path.trim(),
      remoteName: ref.remote_name.trim(),
      remotePath: ref.remote_path.trim(),
      isDirectory: ref.is_dir,
    }))
    .filter((ref) => ref.path && !ref.remoteName && !ref.remotePath)
    .map((ref) => ({ path: ref.path, isDirectory: ref.isDirectory }));
}

async function mobileSharedClipboardRemotePasteItems(payload: ClipboardPayload, mountRoot: string): Promise<PasteItem[]> {
  const remoteRefs = payload.file_refs
    .map((ref) => ({
      providerType: ref.provider_type.trim(),
      remoteName: ref.remote_name.trim(),
      remotePath: ref.remote_path.trim(),
      localPath: ref.local_path.trim(),
      isDirectory: ref.is_dir,
    }))
    .filter((ref) => !ref.localPath && ref.providerType && ref.remoteName && ref.remotePath);
  if (remoteRefs.length === 0) return [];
  try {
    const prepared = await explorerPrepareDragItems({
      items: remoteRefs.map((ref) => ({
        path: joinMobilePath(mountRoot, ref.remoteName, ref.remotePath),
        isDirectory: ref.isDirectory,
      })),
    });
    return prepared.items.map((item) => ({ path: item.localPath, isDirectory: item.isDirectory }));
  } catch {
    return [];
  }
}

function mobileTypeLabel(entry: FileEntry): string {
  return entry.kind === "folder" ? "Folder" : entry.mimeType || entry.extension || entry.kind;
}

function mobileCompareCounts(rows: Array<{ disposition: string }>): Record<string, number> {
  const counts: Record<string, number> = {
    left_only: 0,
    right_only: 0,
    different: 0,
    same: 0,
    conflict: 0,
  };
  for (const row of rows) counts[row.disposition] = (counts[row.disposition] ?? 0) + 1;
  return counts;
}

function mobileCompareSideSummary(side: FileSyncCompareSide): string {
  if (!side.present) return "Missing";
  const type = side.isDir ? "Folder" : "File";
  const size = side.isDir ? "" : ` · ${formatBytes(side.size)}`;
  return `${type}${size}`;
}

function mobileCompareSideTitle(side: FileSyncCompareSide): string | undefined {
  if (!side.present) return undefined;
  return side.isRemote ? `${side.remoteName}:${side.remotePath}` : side.absolutePath;
}

function mobileFileSyncEndpointLabel(endpoint: FileSyncEndpoint): string {
  if (endpoint.kind === "local") return endpoint.localPath || "Local";
  return `${endpoint.remoteName}:${endpoint.remotePath || "/"}`;
}

function isMissingDirectoryError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("no such file or directory") ||
    normalized.includes("os error 2");
}

function emptyListing(path: string): DirectoryListing {
  return {
    path,
    parentPath: parentPathFor(path),
    location: {
      kind: "local",
      providerType: null,
      remoteName: null,
      remotePath: null,
    },
    entries: [],
    totalCount: 0,
    hiddenCount: 0,
  };
}

function remoteRootListing(mountRoot: string, remotes: ProviderRemote[]): DirectoryListing {
  const sortedRemotes = [...remotes].sort((left, right) => left.name.localeCompare(right.name));
  return {
    path: mountRoot,
    parentPath: null,
    location: {
      kind: "remote",
      providerType: null,
      remoteName: null,
      remotePath: null,
    },
    entries: sortedRemotes.map((remote): FileEntry => {
      const path = joinMobilePath(mountRoot, remote.name);
      return {
        id: `remote:${remote.name}`,
        name: remote.name,
        path,
        extension: "",
        mimeType: null,
        remoteModified: null,
        kind: "folder",
        sizeBytes: null,
        modifiedMs: null,
        createdMs: null,
        readonly: true,
        hidden: false,
        location: {
          kind: "remote",
          providerType: remote.type,
          remoteName: remote.name,
          remotePath: "/",
        },
      };
    }),
    totalCount: sortedRemotes.length,
    hiddenCount: 0,
  };
}

function isVirtualRemoteEntry(entry: FileEntry): boolean {
  return entry.id.startsWith("remote:")
    || entry.id.startsWith("remote-provider:")
    || entry.location.kind === "remote_provider"
    || (entry.location.kind === "remote" && entry.location.remotePath === "/");
}

function isVirtualLibraryPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === mobileRecentPath || normalized === mobileStarredPath || normalized === mobileTrashPath;
}

function isMobileSelectableEntry(entry: FileEntry): boolean {
  return !isVirtualRemoteEntry(entry) && !entry.isDeleted;
}

function isMobileRenameableEntry(entry: FileEntry): boolean {
  return isMobileSelectableEntry(entry) && !entry.readonly;
}

function isDownloadableRemoteEntry(entry: FileEntry): boolean {
  return entry.location.kind === "remote" && !isVirtualRemoteEntry(entry) && !entry.isDeleted;
}

function isMobileOpenWithEntry(entry: FileEntry): boolean {
  return entry.kind !== "folder" && entry.kind !== "symlink" && !entry.isDeleted && !isVirtualRemoteEntry(entry);
}

function isMobileMediaEntry(entry: FileEntry): boolean {
  return mobileMediaInfo(entry) != null;
}

function mobileMediaInfo(entry: FileEntry): { kind: "image" | "video"; mimeType: string } | null {
  if (entry.kind === "folder" || entry.kind === "symlink" || entry.isDeleted || isVirtualRemoteEntry(entry)) return null;
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  const videoMimeTypes: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/x-m4v",
    mov: "video/quicktime",
    webm: "video/webm",
  };
  if (mobileBrowserImageMimeTypes[extension]) return { kind: "image", mimeType: mobileBrowserImageMimeTypes[extension] };
  if (videoMimeTypes[extension]) return { kind: "video", mimeType: videoMimeTypes[extension] };
  return null;
}

function isPreviewableEntry(entry: FileEntry): boolean {
  if (entry.kind === "folder" || entry.isDeleted || isVirtualRemoteEntry(entry)) return false;
  if (mobilePreviewSizeLimitError(entry)) return false;
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  return Boolean(mobilePreviewImageMimeType(entry)) || [
    "pdf",
    "txt", "text", "log", "md", "markdown", "toml", "yaml", "yml", "ini", "conf", "cfg",
    "csv", "tsv", "rs", "go", "js", "jsx", "ts", "tsx", "css", "html", "xml", "sh",
    "zsh", "bash", "fish", "py", "rb", "java", "c", "h", "cpp", "hpp", "swift", "kt",
    "sql", "json", "jsonc",
  ].includes(extension);
}

function mobilePreviewImageMimeType(entry: FileEntry): string | null {
  if (entry.kind === "folder" || entry.kind === "symlink") return null;
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  return mobileBrowserImageMimeTypes[extension] ?? null;
}

function previewPayloadIsText(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType.startsWith("application/json");
}

interface MobilePreparedPreviewPath {
  path: string;
  prepared: PreparedOpenItem | null;
}

async function localPathForMobileEntry(entry: FileEntry): Promise<string> {
  if (entry.location.kind === "local") return entry.path;
  return (await explorerPrepareOpenItem({
    path: entry.path,
    sizeBytes: entry.sizeBytes,
    remoteModified: entry.remoteModified,
  })).localPath;
}

async function preparedPreviewPathForMobileEntry(entry: FileEntry): Promise<MobilePreparedPreviewPath> {
  if (entry.location.kind === "local") return { path: entry.path, prepared: null };
  const prepared = await explorerPrepareOpenItem({
    path: entry.path,
    sizeBytes: entry.sizeBytes,
    remoteModified: entry.remoteModified,
  });
  return { path: prepared.localPath, prepared };
}

async function loadMobileImageAssetUrl(preparedPath: MobilePreparedPreviewPath): Promise<string> {
  const baseUrl = safeTauriAssetUrl(preparedPath.path);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < mobileImagePreviewLoadAttempts; attempt += 1) {
    const url = attempt === 0 ? baseUrl : mobileCacheBustedUrl(baseUrl, attempt);
    try {
      await waitForMobileImage(url);
      return url;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < mobileImagePreviewLoadAttempts) {
        await mobileSleep(mobileImagePreviewRetryDelayMs * (attempt + 1));
      }
    }
  }
  const baseMessage = lastError instanceof Error ? lastError.message : "Unable to load image preview.";
  throw new Error(`${baseMessage}${mobilePreviewDiagnosticSuffix(preparedPath)}`);
}

function mobilePreviewDiagnosticSuffix(preparedPath: MobilePreparedPreviewPath): string {
  const prepared = preparedPath.prepared;
  if (!prepared) return "";
  return ` Cache hit: ${prepared.cacheHit ?? prepared.cached}. Local: ${preparedPath.path}. Source: ${prepared.sourcePath ?? "unknown"}. Cache: ${prepared.cachePath ?? "unknown"}.`;
}

function waitForMobileImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.decoding = "async";
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to load image preview."));
    image.src = url;
  });
}

function mobilePreviewSizeLimitError(entry: FileEntry): string | null {
  if (entry.kind === "folder" || entry.sizeBytes == null || entry.sizeBytes <= maxMobilePreviewBytes) {
    return null;
  }
  return `Preview is limited to ${maxMobilePreviewBytes / (1024 * 1024)} MB.`;
}

function mobileCacheBustedUrl(url: string, attempt: number): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}mistyPreviewAttempt=${attempt}-${Date.now()}`;
}

function mobileSleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function revokeMobileObjectUrl(url?: string | null) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

function mobileMutationDisabledNote(entry: FileEntry): string | undefined {
  if (entry.isDeleted) return "Trash items cannot be changed yet.";
  if (isVirtualRemoteEntry(entry)) return "Manage remotes from the Remotes tab.";
  return undefined;
}

function mobilePinDisabledNote(entry: FileEntry): string | undefined {
  if (entry.isDeleted) return "Trash items cannot be pinned.";
  if (entry.kind !== "folder") return "Only folders can be pinned.";
  return undefined;
}

function mobilePathIsPinned(path: string, pinnedPaths: string[]): boolean {
  const normalized = normalizePath(path);
  return pinnedPaths.some((candidate) => normalizePath(candidate) === normalized);
}

async function recordMobileLibraryRecent(entry: FileEntry): Promise<void> {
  try {
    await explorerLibraryRecordRecent(mobileLibraryItemFromEntry(entry));
  } catch {
    // Recent is a convenience and should not block navigation/open.
  }
}

async function recordMobileLastOpenedPath(path: string): Promise<void> {
  if (!path.trim()) return;
  try {
    await explorerLibraryRecordLastOpened(path);
  } catch {
    // Last-opened path is best-effort on mobile.
  }
}

function mobileLibraryItemFromEntry(entry: FileEntry): ExplorerLibraryItem {
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
    comments: "",
  };
}

function mobileLibraryTagsForEntry(entry: FileEntry, library: ExplorerLibrarySnapshot | null): string[] {
  if (!library) return [];
  const item = [...library.recentFiles, ...library.starredFiles]
    .find((candidate) => normalizePath(candidate.path) === normalizePath(entry.path));
  return item?.tags ?? [];
}

function splitMobileRenameParts(entry: FileEntry): [string, string] {
  if (entry.kind === "folder") return [entry.name, ""];
  const extension = entry.extension && entry.extension.startsWith(".") ? entry.extension : "";
  if (!extension || !entry.name.endsWith(extension) || entry.name === extension) return [entry.name, ""];
  return [entry.name.slice(0, -extension.length), extension];
}

function validateMobileBatchRenameItems(items: MobileBatchRenameItem[], siblings: FileEntry[]): MobileBatchRenameItem[] {
  const selectedIds = new Set(items.map((item) => item.entry.id));
  const existingNamesByDirectory = new Map<string, Set<string>>();
  for (const sibling of siblings) {
    if (selectedIds.has(sibling.id)) continue;
    const directory = parentPathFor(sibling.path) ?? "";
    const names = existingNamesByDirectory.get(directory) ?? new Set<string>();
    names.add(sibling.name);
    existingNamesByDirectory.set(directory, names);
  }

  const targetCounts = new Map<string, number>();
  for (const item of items) {
    const effectiveName = `${item.value.trim()}${item.lockedExtension}`;
    const targetPath = joinMobilePath(parentPathFor(item.entry.path) ?? "", effectiveName);
    targetCounts.set(targetPath, (targetCounts.get(targetPath) ?? 0) + 1);
  }

  return items.map((item) => {
    const value = item.value;
    const trimmed = value.trim();
    const effectiveName = `${trimmed}${item.lockedExtension}`;
    const directory = parentPathFor(item.entry.path) ?? "";
    const targetPath = joinMobilePath(directory, effectiveName);
    let error: string | null = null;
    if (!trimmed) error = "Name cannot be empty.";
    else if (value !== trimmed) error = "Name cannot begin or end with spaces.";
    else if (value.includes("/") || value.includes("\\")) error = "Name cannot contain path separators.";
    else if (value.includes("\0")) error = "Name contains an invalid character.";
    else if ((targetCounts.get(targetPath) ?? 0) > 1) error = "Another selected item will use this name.";
    else if (effectiveName !== item.entry.name && existingNamesByDirectory.get(directory)?.has(effectiveName)) {
      error = "Name already exists in this folder.";
    }
    return { ...item, error };
  });
}

function mobileLocationShortLabel(path: string): string {
  const parent = parentPathFor(path);
  if (!parent) return "Location unavailable";
  const name = parent.split("/").filter(Boolean).pop();
  return name || parent;
}

function mobileParentNavigationTarget(path: string, rootPath: string, mountRoot: string): string | null {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(rootPath);
  const normalizedMount = normalizePath(mountRoot);
  if (isVirtualLibraryPath(normalizedPath)) return null;
  if (normalizedPath === normalizedRoot || normalizedPath === normalizedMount || normalizedPath === "/") return null;
  const parent = parentPathFor(normalizedPath);
  if (!parent) return null;
  if (normalizedPath.startsWith(`${normalizedMount}/`) && parent.length < normalizedMount.length) return normalizedMount;
  if (normalizedPath.startsWith(`${normalizedRoot}/`) && parent.length < normalizedRoot.length) return normalizedRoot;
  return parent;
}

function chooseMobileDownloadDirectory(rootPath: string): string {
  return joinMobilePath(rootPath || smokeHome, "Downloads");
}

async function pollMobileActionTransfer(
  debugId: string,
  match: MobileActionDebugMatch,
  setActionDebug: Dispatch<SetStateAction<MobileActionDebugState | null>>,
) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await delayMobileDebugPoll(attempt === 0 ? 650 : 900);
    try {
      const page = await transfersSnapshot({ limit: 80 });
      const rows = [...page.rows].sort((left, right) => right.queuedAtMs - left.queuedAtMs);
      const transfer = rows.find((row) => mobileTransferMatchesDebug(row, match));
      if (!transfer) continue;
      const debugTransfer = mobileTransferDebug(transfer);
      setActionDebug((current) => current?.id === debugId
        ? {
          ...current,
          stage: transfer.status === "failed"
            ? "Transfer failed"
            : transfer.status === "completed"
              ? "Transfer completed"
              : `Transfer ${transfer.status.replace(/_/g, " ")}`,
          transfer: debugTransfer,
          error: transfer.status === "failed" ? transfer.errorMessage || "Transfer failed without an error message." : current.error,
        }
        : current);
      if (["failed", "completed", "canceled", "skipped", "interrupted"].includes(transfer.status)) return;
    } catch (debugError) {
      setActionDebug((current) => current?.id === debugId
        ? { ...current, stage: "Debug poll failed", error: errorText(debugError) }
        : current);
      return;
    }
  }
  setActionDebug((current) => current?.id === debugId
    ? { ...current, stage: "Queued, but no transfer row found yet" }
    : current);
}

function delayMobileDebugPoll(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function mobileActionQueueDebug(queue: OperationQueueSnapshot): unknown {
  return {
    activeCount: queue.activeCount,
    maxConcurrent: queue.maxConcurrent,
    redoAvailable: queue.redoAvailable,
    recentOperations: queue.operations.slice(-6).map((operation) => ({
      id: operation.operationId,
      transferId: operation.transferId,
      kind: operation.kind,
      status: operation.status,
      title: operation.title,
      error: operation.errorMessage,
      source: operation.source,
      target: operation.target,
      attempt: operation.attempt,
    })),
  };
}

function mobileTransferMatchesDebug(row: TransferRecord, match: MobileActionDebugMatch): boolean {
  if (!match.types.includes(row.transferType)) return false;
  if (match.fileName && row.fileName !== match.fileName) return false;
  const hints = (match.pathHints ?? []).map(normalizePath).filter(Boolean);
  if (hints.length === 0) return true;
  const haystack = [
    row.localSourcePath,
    row.localDestPath,
    row.remoteSourcePath,
    row.remoteDestPath,
    row.fileName,
  ].map(normalizePath).filter(Boolean);
  return hints.some((hint) => haystack.some((value) => value.includes(hint) || hint.includes(value)));
}

function mobileTransferDebug(row: TransferRecord): MobileActionDebugTransfer {
  return {
    id: row.id,
    type: row.transferType,
    status: row.status,
    fileName: row.fileName,
    detail: row.detailMessage,
    error: row.errorMessage,
    localSourcePath: row.localSourcePath,
    localDestPath: row.localDestPath,
    remoteSourceName: row.remoteSourceName,
    remoteSourcePath: row.remoteSourcePath,
    remoteDestName: row.remoteDestName,
    remoteDestPath: row.remoteDestPath,
  };
}

function basenameForMobilePath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function remoteDebugPath(transfer: MobileActionDebugTransfer): string {
  const source = transfer.remoteSourceName || transfer.remoteSourcePath
    ? `${transfer.remoteSourceName || "remote"}:${transfer.remoteSourcePath || "/"}`
    : "";
  const dest = transfer.remoteDestName || transfer.remoteDestPath
    ? `${transfer.remoteDestName || "remote"}:${transfer.remoteDestPath || "/"}`
    : "";
  if (source && dest) return `${source} -> ${dest}`;
  return source || dest || "none";
}

function formatMobileDebugValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parentPathFor(path: string): string | null {
  if (!path || path === "/") return null;
  const trimmed = path.replace(/\/+$/, "");
  const slashIndex = trimmed.lastIndexOf("/");
  if (slashIndex <= 0) return "/";
  return trimmed.slice(0, slashIndex);
}

function mobileFolderTitle(path: string, rootPath: string, mountRoot: string, remotes: ProviderRemote[]): string {
  const virtual = mobileVirtualLibraryLabel(path);
  if (virtual) return virtual;
  const remote = mobileRemotePathInfo(path, mountRoot, remotes);
  if (remote) return remote.title;
  if (isHomePath(path, rootPath)) return "On My iPhone";
  const parts = visiblePathParts(relativeMobilePath(path, rootPath));
  const name = parts[parts.length - 1];
  if (!name) return "Files";
  if (name === ".misty") return "Misty";
  return name;
}

function mobileLocationLabel(path: string, rootPath: string, mountRoot: string, remotes: ProviderRemote[]): string {
  const virtual = mobileVirtualLibraryLabel(path);
  if (virtual) return `Library › ${virtual}`;
  const remote = mobileRemotePathInfo(path, mountRoot, remotes);
  if (remote) return remote.label;
  const parts = visiblePathParts(relativeMobilePath(path, rootPath));
  if (parts.length === 0) return "On My iPhone";
  return `On My iPhone › ${parts.map(displayPathPart).join(" › ")}`;
}

function mobileVirtualLibraryLabel(path: string): string | null {
  const normalized = normalizePath(path);
  if (normalized === mobileRecentPath) return "Recent";
  if (normalized === mobileStarredPath) return "Starred";
  if (normalized === mobileTrashPath) return "Trash";
  return null;
}

function relativeMobilePath(path: string, homeDir: string): string[] {
  const normalizedPath = normalizePath(path);
  const normalizedHome = normalizePath(homeDir);
  if (normalizedPath === normalizedHome) return [];
  if (normalizedHome && normalizedPath.startsWith(`${normalizedHome}/`)) {
    return normalizedPath.slice(normalizedHome.length + 1).split("/").filter(Boolean);
  }
  return normalizedPath.split("/").filter(Boolean).slice(-2);
}

function visiblePathParts(parts: string[]): string[] {
  return parts
    .filter((part) => !hiddenMobilePathPart(part))
    .map(displayPathPart);
}

function displayPathPart(part: string): string {
  if (part === ".misty") return "Misty";
  if (part === "db") return "Database";
  if (part === "tmp") return "Temporary";
  return part;
}

function hiddenMobilePathPart(part: string): boolean {
  const normalized = part.toLowerCase();
  return normalized === "application support" ||
    normalized === "containers" ||
    normalized === "data" ||
    normalized === "application";
}

function isHomePath(path: string, homeDir: string): boolean {
  return normalizePath(path) === normalizePath(homeDir);
}

function normalizePath(path: string): string {
  if (!path) return "";
  return path.replace(/\/+$/, "") || "/";
}

function resolvePreferredMobileRoot(preferredWorkspaceRoot: string, fallbackHomePath: string): string {
  const trimmed = preferredWorkspaceRoot.trim();
  if (!trimmed || trimmed === "~") return fallbackHomePath;
  if (trimmed.startsWith("~/")) return joinMobilePath(fallbackHomePath, trimmed.slice(2));
  if (isAbsoluteMobilePath(trimmed)) return normalizePath(trimmed) || fallbackHomePath;
  return joinMobilePath(fallbackHomePath, trimmed);
}

function resolveMobileMountRoot(rootPath: string, configuredPath: string): string {
  if (isAbsoluteMobilePath(configuredPath)) return normalizePath(configuredPath);
  return joinMobilePath(rootPath, configuredPath);
}

function isAbsoluteMobilePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function joinMobilePath(...parts: string[]): string {
  const [first, ...rest] = parts;
  return [
    (first || "/").replace(/\/+$/, "") || "/",
    ...rest.map((part) => part.replace(/^\/+|\/+$/g, "")).filter(Boolean),
  ].join("/").replace(/\/{2,}/g, "/");
}

function pathIsInsideMobile(path: string, root: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedPath = normalizePath(path);
  if (normalizedPath === normalizedRoot) return true;
  if (normalizedRoot === "/") return false;
  return normalizedPath.startsWith(`${normalizedRoot}/`);
}

function mobileRemotePathInfo(
  path: string,
  mountRoot: string,
  remotes: ProviderRemote[],
): { title: string; label: string; remoteName: string | null } | null {
  const normalizedMount = normalizePath(mountRoot);
  const normalizedPath = normalizePath(path);
  if (!pathIsInsideMobile(normalizedPath, normalizedMount)) return null;
  const suffix = normalizedPath === normalizedMount
    ? ""
    : normalizedPath.slice(normalizedMount.length + 1);
  const [remoteName = "", ...remoteParts] = suffix.split("/").filter(Boolean);
  const remote = remotes.find((candidate) => candidate.name === remoteName);
  const providerLabel = remoteProviderLabel(remote?.type ?? "");
  if (!remoteName) return { title: "Remote", label: "Remote folders", remoteName: null };
  const title = remoteParts.length > 0 ? displayPathPart(remoteParts[remoteParts.length - 1]) : remote?.name ?? remoteName;
  const labelParts = ["Remote", providerLabel, remote?.name ?? remoteName, ...remoteParts.map(displayPathPart)].filter(Boolean);
  return {
    title,
    label: labelParts.join(" › "),
    remoteName,
  };
}

function remoteProviderLabel(providerType: string): string {
  const normalized = providerType.trim().toLowerCase();
  if (normalized === "drive") return "Drive";
  if (normalized === "onedrive") return "OneDrive";
  if (normalized === "dropbox") return "Dropbox";
  if (normalized === "s3") return "S3";
  if (normalized === "sftp") return "SFTP";
  return providerType ? displayPathPart(providerType) : "Remote";
}

function isRemoteRootPath(path: string, mountRoot: string): boolean {
  return normalizePath(path) === normalizePath(mountRoot);
}

function loadMobileFilesSidebarCollapsed(): Record<MobileSidebarSection, boolean> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem("misty.mobile.files.sidebar.collapsed") ?? "{}") as Partial<Record<MobileSidebarSection, boolean>>;
    return {
      workspaces: parsed.workspaces === true,
      tabs: parsed.tabs === true,
      locations: parsed.locations === true,
      quick: parsed.quick === true,
      providers: parsed.providers === true,
    };
  } catch {
    return { workspaces: false, tabs: false, locations: false, quick: false, providers: false };
  }
}

function saveMobileFilesSidebarCollapsed(state: Record<MobileSidebarSection, boolean>): void {
  try {
    window.localStorage.setItem("misty.mobile.files.sidebar.collapsed", JSON.stringify(state));
  } catch {
    // Sidebar memory is best-effort.
  }
}

function sanitizeMobilePathText(message: string, homeDir: string): string {
  let sanitized = message;
  const normalizedHome = normalizePath(homeDir);
  if (normalizedHome && normalizedHome !== "/") {
    sanitized = sanitized.split(normalizedHome).join("On My iPhone");
  }
  return sanitized
    .replace(/\/private\/var\/[^\s:")']+/g, "On My iPhone")
    .replace(/\/var\/mobile\/[^\s:")']+/g, "On My iPhone")
    .replace(/Application Support/gi, "App Data");
}

function MobileFileSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }, (_, index) => (
        <div className="grid min-h-[82px] grid-cols-[42px_minmax(0,1fr)] items-center gap-4 py-2" key={index}>
          <span className="misty-skeleton h-6 rounded-lg" />
          <span className="misty-skeleton h-6 rounded-lg" />
        </div>
      ))}
    </>
  );
}

export default MobileFilesPage;
