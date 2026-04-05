import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  CloudDownload,
  FolderOpen,
  X,
} from "lucide-react";
import { devicesSnapshot, explorerListDirectory } from "../../api/misty";
import type { DirectoryListing, FileEntry, MountedDevice, ProviderRemote } from "../../api/types";
import { FileBrowser } from "../../pages/Files/components/FileBrowser";
import { ExplorerPickerSidebar } from "../../pages/Files/components/ExplorerPickerSidebar";
import { ExplorerPickerToolbar } from "../../pages/Files/components/ExplorerPickerToolbar";
import { errorText } from "../../shared/format";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { useMultiPanelStore } from "../../shared/multipanel/useMultiPanelStore";
import { useAppStore } from "../../stores/useAppStore";
import { sortListing, useExplorerStore } from "../../stores/useExplorerStore";
import type { ExplorerSortColumn, ExplorerSortState } from "../../stores/useExplorerStore";
import { useProvidersStore } from "../../stores/useProvidersStore";
import {
  selectAdvancedPreferences,
  selectGeneralPreferences,
  useSettingsStore,
} from "../../stores/useSettingsStore";

export type MistyFilePickerMode = "file" | "folder";

const emptyProviderRemotes: ProviderRemote[] = [];
const emptyMountedDevices: MountedDevice[] = [];
const emptyCutPaths = new Set<string>();
const pickerControlClass = "inline-grid place-items-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))] text-[var(--misty-text-muted)] transition-colors hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))] hover:text-[var(--misty-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-default disabled:opacity-35";

export interface MistyFilePickerProps {
  mode: MistyFilePickerMode;
  multiple?: boolean;
  title?: string;
  initialPath?: string | null;
  allowedExtensions?: string[];
  onCancel: () => void;
  onSelect: (path: string) => void;
  onSelectMany?: (paths: string[]) => void;
}

export function MistyFilePicker({
  mode,
  multiple = false,
  title,
  initialPath,
  allowedExtensions,
  onCancel,
  onSelect,
  onSelectMany,
}: MistyFilePickerProps) {
  const app = useAppStore((state) => state.app);
  const homeDir = app?.environment.homeDir ?? "";
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const explorerPath = useExplorerStore((state) => state.panes[activePaneId]?.listing?.path ?? null);
  const explorerViewMode = useExplorerStore((state) => state.paneViewModes[activePaneId] ?? state.viewMode);
  const explorerSort = useExplorerStore((state) => state.paneSorts[activePaneId] ?? state.sort);
  const directorySizes = useExplorerStore((state) => state.directorySizes);
  const pinnedPaths = useExplorerStore((state) => state.pinnedPaths);
  const activeWorkspaceTitle = useExplorerStore((state) => state.activeWorkspaceTitle);
  const remotes = useProvidersStore((state) => state.providers?.remotes ?? emptyProviderRemotes);
  const providersLoading = useProvidersStore((state) => state.loading);
  const loadProviders = useProvidersStore((state) => state.load);
  const settingsDocument = useSettingsStore((state) => state.settings?.document);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sort, setSort] = useState<ExplorerSortState>(explorerSort);
  const [devices, setDevices] = useState<MountedDevice[]>(emptyMountedDevices);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showHidden, setShowHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const selectionAnchorId = useRef<string | null>(null);
  const pickerDialog = useDialogFocus<HTMLElement>(true);
  const titleId = useId();
  const descriptionId = useId();
  const cloudNoticeId = useId();

  const mountRoot = useMemo(() => {
    const general = selectGeneralPreferences(settingsDocument);
    const advanced = selectAdvancedPreferences(settingsDocument);
    const storageHome = resolvePreferredRoot(general.preferredWorkspaceRoot, homeDir);
    return resolveMountRoot(storageHome, advanced.mountPath || app?.environment.mountPath || ".misty/mnt");
  }, [app?.environment.mountPath, homeDir, settingsDocument]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const refreshDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const snapshot = await devicesSnapshot();
      setDevices(snapshot.devices);
    } catch {
      setDevices(emptyMountedDevices);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const loadPath = useCallback(async (
    path: string,
    historyMode: "push" | "replace" | "none" = "push",
    hidden = showHidden,
  ) => {
    const nextRequestId = ++requestId.current;
    setLoading(true);
    setError(null);
    setSelectedIds([]);
    selectionAnchorId.current = null;
    try {
      const next = await explorerListDirectory({ path: path || null, showHidden: hidden });
      if (requestId.current !== nextRequestId) return;
      setListing(next);
      if (historyMode === "push") {
        setHistory((current) => {
          const prefix = current.slice(0, historyIndex + 1);
          return [...prefix, next.path];
        });
        setHistoryIndex((current) => current + 1);
      } else if (historyMode === "replace") {
        setHistory([next.path]);
        setHistoryIndex(0);
      }
    } catch (nextError) {
      if (requestId.current === nextRequestId) setError(errorText(nextError));
    } finally {
      if (requestId.current === nextRequestId) setLoading(false);
    }
  }, [historyIndex, showHidden]);

  useEffect(() => {
    const startPath = initialPath?.trim() || explorerPath || homeDir;
    void loadPath(startPath, "replace");
    // Reset only when the picker opens with a different starting location.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath, homeDir]);

  const selectableFiles = useMemo(() => {
    if (!allowedExtensions?.length) return null;
    return new Set(allowedExtensions.map((extension) => extension.toLowerCase().replace(/^\./, "")));
  }, [allowedExtensions]);

  const matchesModeAndExtension = (entry: FileEntry) => {
    if (entry.kind === "folder") return mode === "folder";
    if (mode !== "file" || entry.kind !== "file") return false;
    return !selectableFiles || selectableFiles.has(entry.extension.toLowerCase().replace(/^\./, ""));
  };

  const canSelectEntry = (entry: FileEntry) => (
    entry.location.kind === "local" && matchesModeAndExtension(entry)
  );

  const browserListing = useMemo(
    () => listing ? sortListing(listing, sort, directorySizes) : null,
    [directorySizes, listing, sort],
  );
  const selectedEntries = selectedIds
    .map((entryId) => listing?.entries.find((entry) => entry.id === entryId))
    .filter((entry): entry is FileEntry => Boolean(entry));
  const selected = selectedEntries[selectedEntries.length - 1] ?? null;
  const selectedPaths = selectedEntries.filter(canSelectEntry).map((entry) => entry.path);

  const navigateHistory = (nextIndex: number) => {
    const path = history[nextIndex];
    if (!path) return;
    setHistoryIndex(nextIndex);
    void loadPath(path, "none");
  };

  const choose = () => {
    if (mode === "folder") {
      const path = selected?.kind === "folder" ? selected.path : listing?.path;
      const location = selected?.kind === "folder" ? selected.location : listing?.location;
      if (path && location?.kind === "local") onSelect(path);
      return;
    }
    if (multiple && selectedPaths.length > 0) {
      if (onSelectMany) onSelectMany(selectedPaths);
      else onSelect(selectedPaths[0]);
      return;
    }
    if (selected && canSelectEntry(selected)) onSelect(selected.path);
  };

  const selectionIsCloud = selected?.location.kind !== undefined && selected.location.kind !== "local";
  const browsingCloud = listing?.location.kind !== undefined && listing.location.kind !== "local";
  const showCloudNotice = selectionIsCloud || browsingCloud;
  const canChoose = mode === "folder"
    ? selected?.kind === "folder"
      ? canSelectEntry(selected)
      : Boolean(listing?.path && listing.location.kind === "local")
    : multiple
      ? selectedPaths.length > 0
      : Boolean(selected && canSelectEntry(selected));

  const selectBrowserEntry = (entryId: string, event: ReactMouseEvent, visibleEntryIds: string[]) => {
    const entry = listing?.entries.find((candidate) => candidate.id === entryId);
    if (!entry) return;

    let nextSelectedIds: string[];
    if (multiple && mode === "file" && event.shiftKey) {
      const anchorId = selectionAnchorId.current ?? entryId;
      const anchorIndex = visibleEntryIds.indexOf(anchorId);
      const targetIndex = visibleEntryIds.indexOf(entryId);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        nextSelectedIds = visibleEntryIds.slice(start, end + 1);
      } else {
        nextSelectedIds = [entryId];
      }
    } else if (multiple && mode === "file" && (event.metaKey || event.ctrlKey)) {
      nextSelectedIds = selectedIds.includes(entryId)
        ? selectedIds.filter((candidate) => candidate !== entryId)
        : [...selectedIds, entryId];
    } else {
      nextSelectedIds = [entryId];
    }

    setSelectedIds(nextSelectedIds);
    selectionAnchorId.current = entryId;
  };

  const openEntry = (entry: FileEntry) => {
    if (entry.kind === "folder") {
      void loadPath(entry.path);
    } else if (multiple && mode === "file") {
      return;
    } else if (canSelectEntry(entry)) {
      onSelect(entry.path);
    } else {
      setSelectedIds([entry.id]);
    }
  };

  const updateSort = (column: ExplorerSortColumn) => {
    setSort((current) => current.column === column
      ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
      : { column, direction: "asc" });
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab" || !pickerDialog.dialogRef.current) return;
    const focusable = Array.from(pickerDialog.dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      pickerDialog.dialogRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const picker = (
    <div className="fixed bottom-0 left-[72px] right-0 top-[var(--misty-window-titlebar-inset)] z-[2147483100] grid place-items-center bg-black/60 p-6 backdrop-blur-md max-[800px]:left-0 max-[800px]:p-3 max-[560px]:p-0" role="presentation" onKeyDown={handleDialogKeyDown}>
      <section
        className="grid h-[min(680px,calc(100vh-88px))] w-[min(1100px,calc(100vw-140px))] grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-[var(--misty-border)] bg-[var(--misty-app-modal-bg,var(--misty-surface))] text-[var(--misty-text)] shadow-2xl outline-none max-[800px]:size-full max-[560px]:rounded-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId}${showCloudNotice ? ` ${cloudNoticeId}` : ""}`}
        ref={pickerDialog.dialogRef}
        tabIndex={-1}
      >
        <header className="flex min-h-[76px] items-center justify-between gap-4 border-b border-[var(--misty-border-soft)] px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--misty-surface-2)] text-[var(--misty-text-muted)]"><FolderOpen size={20} /></span>
            <div>
              <h2 className="m-0 text-[17px] font-semibold" id={titleId}>{title || (mode === "folder" ? "Choose a folder" : "Choose a file")}</h2>
              <p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--misty-text-subtle)]" id={descriptionId}>{multiple && mode === "file" ? "Select one or more files from Explorer and connected locations." : "Browse your current Explorer context and connected locations."}</p>
            </div>
          </div>
          <button type="button" className={`${pickerControlClass} size-[38px] shrink-0`} data-dialog-autofocus aria-label="Close picker" onClick={onCancel}><X size={18} /></button>
        </header>

        <div className="border-b border-[var(--misty-divider-subtle)]">
          <ExplorerPickerToolbar
            path={listing?.path || initialPath || homeDir}
            query={searchQuery}
            canGoBack={historyIndex > 0}
            canGoForward={historyIndex >= 0 && historyIndex < history.length - 1}
            canGoParent={Boolean(listing?.parentPath)}
            onBack={() => navigateHistory(historyIndex - 1)}
            onForward={() => navigateHistory(historyIndex + 1)}
            onParent={() => listing?.parentPath && void loadPath(listing.parentPath)}
            onNavigate={(path) => void loadPath(path)}
            onRefresh={() => listing && void loadPath(listing.path, "none")}
            onQueryChange={setSearchQuery}
          />
        </div>

        <div className="min-h-0">
          {showCloudNotice ? (
            <div className="flex min-h-11 items-center gap-2.5 border-b border-amber-200/20 bg-amber-300/5 px-4 py-2 text-xs leading-relaxed text-amber-100/80" id={cloudNoticeId} role="status">
              <CloudDownload className="shrink-0" size={17} aria-hidden="true" />
              <span><strong className="text-amber-100">Download required.</strong> You can browse cloud items here, but you must fully download an item to a local folder before choosing it.</span>
            </div>
          ) : null}
        </div>

        <div className="grid min-h-0 grid-cols-[260px_minmax(0,1fr)] max-[980px]:grid-cols-[minmax(0,1fr)]">
          <div className="min-h-0 overflow-hidden border-r border-[var(--misty-divider-subtle)] max-[980px]:hidden">
            <ExplorerPickerSidebar
              homePath={homeDir}
              activePath={listing?.path || explorerPath || homeDir}
              mountRoot={mountRoot}
              remotes={remotes}
              remoteLoading={providersLoading}
              devices={devices}
              devicesLoading={devicesLoading}
              pinnedPaths={pinnedPaths}
              activeWorkspaceTitle={activeWorkspaceTitle}
              onNavigate={(path) => void loadPath(path)}
              onRefreshDevices={() => void refreshDevices()}
            />
          </div>

          <main className="relative grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden bg-[var(--misty-surface)]">
            <FileBrowser
              paneId="misty-file-picker"
              selectionOnly
              listing={browserListing}
              selectedIds={selectedIds}
              loading={loading && !listing}
              error={error}
              viewMode={explorerViewMode}
              sort={sort}
              showHidden={showHidden}
              commandQuery={searchQuery}
              commandQueryMode="filter"
              directorySizes={directorySizes}
              cutPaths={emptyCutPaths}
              inlineEdit={null}
              onSort={updateSort}
              onToggleHidden={() => {
                const next = !showHidden;
                setShowHidden(next);
                if (listing) void loadPath(listing.path, "none", next);
              }}
              onSelect={selectBrowserEntry}
              onClearSelection={() => setSelectedIds([])}
              onOpen={openEntry}
              onDownload={() => undefined}
              onContextMenu={(event) => event.preventDefault()}
              onBackgroundContextMenu={(event) => event.preventDefault()}
              onDropItems={() => undefined}
              onInlineEditChange={() => undefined}
              onInlineEditCommit={() => undefined}
              onInlineEditCancel={() => undefined}
            />
            {loading && listing ? <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-white/35" /> : null}
          </main>
        </div>

        <footer className="flex min-h-[72px] items-center justify-between gap-5 border-t border-[var(--misty-border-soft)] px-[18px]">
          <div className="grid min-w-0 gap-1 max-[800px]:hidden">
            <span className="text-[10px] capitalize text-[var(--misty-text-subtle)]">{mode === "folder" ? "Folder" : multiple ? "Files" : "File"}</span>
            <strong className="max-w-[560px] truncate text-xs font-semibold text-[var(--misty-text-muted)]" title={multiple && selectedPaths.length > 0 ? selectedPaths.join("\n") : selected?.path || listing?.path}>
              {selectionIsCloud ? "Download this item locally before choosing it" : multiple && selectedPaths.length > 0 ? `${selectedPaths.length} file${selectedPaths.length === 1 ? "" : "s"} selected` : selected?.path || (mode === "folder" ? listing?.path : "Select a file")}
            </strong>
          </div>
          <div className="ml-auto flex shrink-0 gap-2">
            <button type="button" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))] px-4 text-[13px] text-[var(--misty-text-muted)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))] hover:text-[var(--misty-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30" onClick={onCancel}>Cancel</button>
            <button type="button" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--misty-border-strong)] bg-[var(--misty-primary)] px-4 text-[13px] font-semibold text-[var(--misty-primary-contrast)] hover:bg-[var(--misty-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-default disabled:opacity-45" disabled={loading || !canChoose} onClick={choose}>
              {mode === "folder" ? (selected ? "Choose folder" : "Choose this folder") : multiple ? selectedPaths.length > 0 ? `Choose ${selectedPaths.length} file${selectedPaths.length === 1 ? "" : "s"}` : "Choose files" : "Choose file"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(picker, document.body);
}

function joinPath(parent: string, child: string): string {
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${child}`;
}

function resolveMountRoot(homePath: string, configuredPath: string): string {
  if (/^(?:\/|[A-Za-z]:[\\/])/.test(configuredPath)) return configuredPath.replace(/[\\/]+$/, "");
  return joinPath(homePath, configuredPath.replace(/^[\\/]+|[\\/]+$/g, ""));
}

function resolvePreferredRoot(configuredPath: string, homePath: string): string {
  const trimmed = configuredPath.trim();
  if (!trimmed || trimmed === "~") return homePath;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return joinPath(homePath, trimmed.slice(2));
  if (/^(?:\/|[A-Za-z]:[\\/])/.test(trimmed)) return trimmed;
  return joinPath(homePath, trimmed);
}
