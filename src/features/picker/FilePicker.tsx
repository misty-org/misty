import type { MistyFilePickerMode } from "@/models/types/features/picker/FilePicker";
export type { MistyFilePickerMode } from "@/models/types/features/picker/FilePicker";
import type { MistyFilePickerProps } from "@/models/interfaces/features/picker/FilePicker";
export type { MistyFilePickerProps } from "@/models/interfaces/features/picker/FilePicker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { CloudDownload, FolderOpen } from "lucide-react";
import { Button } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { devicesSnapshot, explorerListDirectory } from "@/stores/backend";
import type {
  DirectoryListing,
  FileEntry,
  MountedDevice,
  ProviderRemote,
} from "@/models/interfaces/services/misty-api";
import { FileBrowser } from "../explorer/components/FileBrowser";
import { ExplorerPickerSidebar } from "../explorer/components/ExplorerPickerSidebar";
import { ExplorerPickerToolbar } from "../explorer/components/ExplorerPickerToolbar";
import { errorText } from "@/lib/format";
import { useMultiPanelStore } from "@/features/workspace";
import { useAppStore } from "@/stores/app";
import { sortListing, useExplorerStore } from "@/stores/explorer";
import type { ExplorerSortColumn, ExplorerSortState } from "@/stores/explorer";
import { useProvidersStore } from "@/stores/providers";
import {
  selectAdvancedPreferences,
  selectGeneralPreferences,
  useSettingsStore,
} from "@/stores/app";

const emptyProviderRemotes: ProviderRemote[] = [];
const emptyMountedDevices: MountedDevice[] = [];
const emptyCutPaths = new Set<string>();

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
  const explorerPath = useExplorerStore(
    (state) => state.panes[activePaneId]?.listing?.path ?? null,
  );
  const explorerViewMode = useExplorerStore(
    (state) => state.paneViewModes[activePaneId] ?? state.viewMode,
  );
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

  const mountRoot = useMemo(() => {
    const general = selectGeneralPreferences(settingsDocument);
    const advanced = selectAdvancedPreferences(settingsDocument);
    const storageHome = resolvePreferredRoot(general.preferredWorkspaceRoot, homeDir);
    return resolveMountRoot(
      storageHome,
      advanced.mountPath || app?.environment.mountPath || ".misty/mnt",
    );
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

  const loadPath = useCallback(
    async (
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
    },
    [historyIndex, showHidden],
  );

  useEffect(() => {
    const startPath = initialPath?.trim() || explorerPath || homeDir;
    void loadPath(startPath, "replace");
    // Reset only when the picker opens with a different starting location.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath, homeDir]);

  const selectableFiles = useMemo(() => {
    if (!allowedExtensions?.length) return null;
    return new Set(
      allowedExtensions.map((extension) => extension.toLowerCase().replace(/^\./, "")),
    );
  }, [allowedExtensions]);

  const matchesModeAndExtension = (entry: FileEntry) => {
    if (entry.kind === "folder") return mode === "folder";
    if (mode !== "file" || entry.kind !== "file") return false;
    return (
      !selectableFiles || selectableFiles.has(entry.extension.toLowerCase().replace(/^\./, ""))
    );
  };

  const canSelectEntry = (entry: FileEntry) =>
    entry.location.kind === "local" && matchesModeAndExtension(entry);

  const browserListing = useMemo(
    () => (listing ? sortListing(listing, sort, directorySizes) : null),
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

  const selectionIsCloud =
    selected?.location.kind !== undefined && selected.location.kind !== "local";
  const browsingCloud = listing?.location.kind !== undefined && listing.location.kind !== "local";
  const showCloudNotice = selectionIsCloud || browsingCloud;
  const canChoose =
    mode === "folder"
      ? selected?.kind === "folder"
        ? canSelectEntry(selected)
        : Boolean(listing?.path && listing.location.kind === "local")
      : multiple
        ? selectedPaths.length > 0
        : Boolean(selected && canSelectEntry(selected));

  const selectBrowserEntry = (
    entryId: string,
    event: ReactMouseEvent,
    visibleEntryIds: string[],
  ) => {
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
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="grid h-[min(680px,calc(100vh-88px))] w-[min(1100px,calc(100vw-32px))] max-w-none grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-2xl bg-[var(--misty-app-modal-bg,var(--popover))] p-0 text-foreground max-[560px]:size-full max-[560px]:rounded-none">
        <DialogHeader className="flex min-h-[76px] grid-cols-[1fr_auto] items-center justify-between gap-4 border-b border-border px-5 py-0 text-left">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
              <FolderOpen size={20} />
            </span>
            <div>
              <DialogTitle className="text-[17px]">
                {title || (mode === "folder" ? "Choose a folder" : "Choose a file")}
              </DialogTitle>
              <DialogDescription>
                {multiple && mode === "file"
                  ? "Select one or more files from Explorer and connected locations."
                  : "Browse your current Explorer context and connected locations."}
              </DialogDescription>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-dialog-autofocus
            aria-label="Close picker"
            onClick={onCancel}
          >
            ×
          </Button>
        </DialogHeader>

        <div className="border-b border-border">
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
            <div
              className="flex min-h-11 items-center gap-2.5 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs leading-relaxed text-amber-500"
              role="status"
            >
              <CloudDownload className="shrink-0" size={17} aria-hidden="true" />
              <span>
                <strong>Download required.</strong> You can browse cloud items here, but you must
                fully download an item to a local folder before choosing it.
              </span>
            </div>
          ) : null}
        </div>

        <div className="grid min-h-0 grid-cols-[260px_minmax(0,1fr)] max-[980px]:grid-cols-[minmax(0,1fr)]">
          <div className="min-h-0 overflow-hidden border-r border-border max-[980px]:hidden">
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

          <main className="relative grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden bg-background">
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
              onContextMenu={(event) => event.preventDefault()}
              onBackgroundContextMenu={(event) => event.preventDefault()}
              onDropItems={() => undefined}
              onInlineEditChange={() => undefined}
              onInlineEditCommit={() => undefined}
              onInlineEditCancel={() => undefined}
            />
            {loading && listing ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-primary/60" />
            ) : null}
          </main>
        </div>

        <DialogFooter className="mt-0 flex min-h-[72px] flex-row items-center justify-between gap-5 border-t border-border px-[18px]">
          <div className="grid min-w-0 gap-1 max-[800px]:hidden">
            <span className="text-[10px] capitalize text-muted-foreground">
              {mode === "folder" ? "Folder" : multiple ? "Files" : "File"}
            </span>
            <strong
              className="max-w-[560px] truncate text-xs font-semibold text-foreground/80"
              title={
                multiple && selectedPaths.length > 0
                  ? selectedPaths.join("\n")
                  : selected?.path || listing?.path
              }
            >
              {selectionIsCloud
                ? "Download this item locally before choosing it"
                : multiple && selectedPaths.length > 0
                  ? `${selectedPaths.length} file${selectedPaths.length === 1 ? "" : "s"} selected`
                  : selected?.path || (mode === "folder" ? listing?.path : "Select a file")}
            </strong>
          </div>
          <div className="ml-auto flex shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" disabled={loading || !canChoose} onClick={choose}>
              {mode === "folder"
                ? selected
                  ? "Choose folder"
                  : "Choose this folder"
                : multiple
                  ? selectedPaths.length > 0
                    ? `Choose ${selectedPaths.length} file${selectedPaths.length === 1 ? "" : "s"}`
                    : "Choose files"
                  : "Choose file"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\"))
    return joinPath(homePath, trimmed.slice(2));
  if (/^(?:\/|[A-Za-z]:[\\/])/.test(trimmed)) return trimmed;
  return joinPath(homePath, trimmed);
}
