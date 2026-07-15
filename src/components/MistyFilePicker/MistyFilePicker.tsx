import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Cloud,
  CloudDownload,
  Eye,
  EyeOff,
  File,
  Folder,
  FolderOpen,
  HardDrive,
  Home,
  LoaderCircle,
  RefreshCcw,
  X,
} from "lucide-react";
import { explorerListDirectory } from "../../api/misty";
import type { DirectoryListing, FileEntry, ProviderRemote } from "../../api/types";
import { errorText } from "../../shared/format";
import { useMultiPanelStore } from "../../shared/multipanel/useMultiPanelStore";
import { useAppStore } from "../../stores/useAppStore";
import { useExplorerStore } from "../../stores/useExplorerStore";
import { useProvidersStore } from "../../stores/useProvidersStore";
import {
  selectAdvancedPreferences,
  selectGeneralPreferences,
  useSettingsStore,
} from "../../stores/useSettingsStore";
import "./styles.css";

export type MistyFilePickerMode = "file" | "folder";

const emptyProviderRemotes: ProviderRemote[] = [];

export interface MistyFilePickerProps {
  mode: MistyFilePickerMode;
  title?: string;
  initialPath?: string | null;
  allowedExtensions?: string[];
  onCancel: () => void;
  onSelect: (path: string) => void;
}

export function MistyFilePicker({
  mode,
  title,
  initialPath,
  allowedExtensions,
  onCancel,
  onSelect,
}: MistyFilePickerProps) {
  const app = useAppStore((state) => state.app);
  const homeDir = app?.environment.homeDir ?? "";
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const explorerPath = useExplorerStore((state) => state.panes[activePaneId]?.listing?.path ?? null);
  const explorerLocation = useExplorerStore((state) => state.panes[activePaneId]?.listing?.location ?? null);
  const remotes = useProvidersStore((state) => state.providers?.remotes ?? emptyProviderRemotes);
  const loadProviders = useProvidersStore((state) => state.load);
  const settingsDocument = useSettingsStore((state) => state.settings?.document);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const dialogRef = useRef<HTMLElement | null>(null);
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

  const loadPath = useCallback(async (
    path: string,
    historyMode: "push" | "replace" | "none" = "push",
    hidden = showHidden,
  ) => {
    const nextRequestId = ++requestId.current;
    setLoading(true);
    setError(null);
    setSelected(null);
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

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previouslyFocused?.focus();
    };
  }, []);

  const favorites = useMemo(() => {
    if (!homeDir) return [];
    return [
      { label: "Home", path: homeDir, icon: Home },
      { label: "Desktop", path: joinPath(homeDir, "Desktop"), icon: Folder },
      { label: "Documents", path: joinPath(homeDir, "Documents"), icon: Folder },
      { label: "Downloads", path: joinPath(homeDir, "Downloads"), icon: Folder },
    ];
  }, [homeDir]);

  const cloudLocations = useMemo(() => remotes.map((remote) => ({
    label: remote.name,
    path: joinPath(mountRoot, remote.name),
    provider: remote.type,
  })), [mountRoot, remotes]);

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
    if (selected && canSelectEntry(selected)) onSelect(selected.path);
  };

  const selectionIsCloud = selected?.location.kind !== undefined && selected.location.kind !== "local";
  const browsingCloud = listing?.location.kind !== undefined && listing.location.kind !== "local";
  const showCloudNotice = selectionIsCloud || browsingCloud;
  const canChoose = mode === "folder"
    ? selected?.kind === "folder"
      ? canSelectEntry(selected)
      : Boolean(listing?.path && listing.location.kind === "local")
    : Boolean(selected && canSelectEntry(selected));

  const selectEntry = (entry: FileEntry) => {
    if (entry.location.kind !== "local" || matchesModeAndExtension(entry)) {
      setSelected(entry);
      return;
    }
    setSelected(null);
  };

  const openEntry = (entry: FileEntry) => {
    if (entry.kind === "folder") {
      void loadPath(entry.path);
    } else if (canSelectEntry(entry)) {
      onSelect(entry.path);
    } else {
      selectEntry(entry);
    }
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
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

  const handleEntryKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, entry: FileEntry) => {
    const option = event.currentTarget;
    const options = Array.from(option.parentElement?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const currentIndex = options.indexOf(option);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = Math.min(options.length - 1, currentIndex + 1);
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = Math.max(0, currentIndex - 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      options[nextIndex]?.focus();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      openEntry(entry);
    }
  };

  const picker = (
    <div className="misty-picker-layer" role="presentation" onKeyDown={handleDialogKeyDown}>
      <section
        className="misty-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId}${showCloudNotice ? ` ${cloudNoticeId}` : ""}`}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="misty-picker-header">
          <div className="misty-picker-title">
            <span><FolderOpen size={20} /></span>
            <div>
              <h2 id={titleId}>{title || (mode === "folder" ? "Choose a folder" : "Choose a file")}</h2>
              <p id={descriptionId}>Browse your current Explorer context and connected locations.</p>
            </div>
          </div>
          <button type="button" className="misty-picker-icon-button" aria-label="Close picker" onClick={onCancel}><X size={18} /></button>
        </header>

        <div className="misty-picker-toolbar">
          <div className="misty-picker-nav-buttons">
            <button type="button" aria-label="Back" disabled={historyIndex <= 0} onClick={() => navigateHistory(historyIndex - 1)}><ArrowLeft size={16} /></button>
            <button type="button" aria-label="Forward" disabled={historyIndex < 0 || historyIndex >= history.length - 1} onClick={() => navigateHistory(historyIndex + 1)}><ArrowRight size={16} /></button>
            <button type="button" aria-label="Parent folder" disabled={!listing?.parentPath} onClick={() => listing?.parentPath && void loadPath(listing.parentPath)}><ArrowUp size={16} /></button>
            <button type="button" aria-label="Refresh" onClick={() => listing && void loadPath(listing.path, "none")}><RefreshCcw className={loading ? "is-spinning" : ""} size={15} /></button>
          </div>
          <nav className="misty-picker-breadcrumbs" aria-label="Current folder">
            {pathSegments(listing?.path || initialPath || homeDir).map((segment, index) => (
              <button type="button" key={`${segment.path}-${index}`} onClick={() => void loadPath(segment.path)}>
                {index > 0 ? <ChevronRight size={13} /> : null}{segment.label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            className={`misty-picker-hidden-toggle${showHidden ? " is-active" : ""}`}
            aria-pressed={showHidden}
            title={showHidden ? "Hide hidden files" : "Show hidden files"}
            onClick={() => {
              const next = !showHidden;
              setShowHidden(next);
              if (listing) void loadPath(listing.path, "none", next);
            }}
          >
            {showHidden ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        <div className="misty-picker-notice-slot">
          {showCloudNotice ? (
            <div className="misty-picker-cloud-notice" id={cloudNoticeId} role="status">
              <CloudDownload size={17} aria-hidden="true" />
              <span><strong>Download required.</strong> You can browse cloud items here, but you must fully download an item to a local folder before choosing it.</span>
            </div>
          ) : null}
        </div>

        <div className="misty-picker-content">
          <aside className="misty-picker-sidebar" aria-label="Locations">
            {explorerPath ? (
              <>
                <span className="misty-picker-sidebar-label">Explorer</span>
                <button
                  type="button"
                  className={samePath(listing?.path, explorerPath) ? "is-active" : ""}
                  aria-label={`Current Explorer folder, ${explorerPath}`}
                  onClick={() => void loadPath(explorerPath)}
                >
                  <FolderOpen size={16} /><span>Current Explorer</span>
                  {explorerLocation?.kind !== "local" ? <small>Cloud</small> : null}
                </button>
              </>
            ) : null}
            <span className="misty-picker-sidebar-label">Locations</span>
            {favorites.map((favorite) => {
              const Icon = favorite.icon;
              return (
                <button
                  type="button"
                  key={favorite.label}
                  className={samePath(listing?.path, favorite.path) ? "is-active" : ""}
                  onClick={() => void loadPath(favorite.path)}
                >
                  <Icon size={15} /><span>{favorite.label}</span>
                </button>
              );
            })}
            <span className="misty-picker-sidebar-label is-device">Device</span>
            <button type="button" onClick={() => homeDir && void loadPath(homeDir)}><HardDrive size={15} /><span>This Misty</span></button>
            {cloudLocations.length ? <span className="misty-picker-sidebar-label is-device">Cloud</span> : null}
            {cloudLocations.map((cloud) => (
              <button
                type="button"
                key={cloud.path}
                className={samePath(listing?.path, cloud.path) ? "is-active" : ""}
                aria-label={`${cloud.label}, ${cloud.provider} cloud location`}
                title={`${cloud.provider} · Browse only; download locally before choosing`}
                onClick={() => void loadPath(cloud.path)}
              >
                <Cloud size={16} /><span>{cloud.label}</span><small>{cloud.provider}</small>
              </button>
            ))}
          </aside>

          <main className="misty-picker-browser" aria-busy={loading} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
            {error ? (
              <div className="misty-picker-state is-error" role="alert"><FolderOpen size={28} /><strong>Couldn’t open this folder</strong><span>{error}</span></div>
            ) : loading && !listing ? (
              <div className="misty-picker-state" role="status"><LoaderCircle className="is-spinning" size={24} /><span>Opening folder…</span></div>
            ) : listing?.entries.length ? (
              <div className="misty-picker-list" role="listbox" aria-label="Folder contents">
                {listing.entries.map((entry, index) => {
                  const isFolder = entry.kind === "folder";
                  const allowed = canSelectEntry(entry);
                  const cloud = entry.location.kind !== "local";
                  const isSelected = selected?.path === entry.path;
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={!allowed && !isFolder}
                      aria-describedby={cloud && showCloudNotice ? cloudNoticeId : undefined}
                      tabIndex={isSelected || (!selected && index === 0) ? 0 : -1}
                      key={entry.id}
                      className={`${isSelected ? "is-selected" : ""}${!cloud && !isFolder && !allowed ? " is-unavailable" : ""}${cloud ? " is-cloud" : ""}`}
                      onClick={() => selectEntry(entry)}
                      onDoubleClick={() => openEntry(entry)}
                      onKeyDown={(event) => handleEntryKeyDown(event, entry)}
                    >
                      <span className={`misty-picker-entry-icon is-${entry.kind}`}>{isFolder ? <Folder size={18} /> : <File size={18} />}</span>
                      <span className="misty-picker-entry-name">{entry.name}</span>
                      <span className="misty-picker-entry-kind">{cloud ? "Cloud · " : ""}{isFolder ? "Folder" : entry.extension ? entry.extension.toUpperCase() : "File"}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="misty-picker-state"><FolderOpen size={28} /><strong>This folder is empty</strong><span>You can still choose the current folder.</span></div>
            )}
            {loading && listing ? <div className="misty-picker-loading-bar" /> : null}
          </main>
        </div>

        <footer className="misty-picker-footer">
          <div>
            <span>{mode === "folder" ? "Folder" : "File"}</span>
            <strong title={selected?.path || listing?.path}>
              {selectionIsCloud ? "Download this item locally before choosing it" : selected?.path || (mode === "folder" ? listing?.path : "Select a file")}
            </strong>
          </div>
          <div className="misty-picker-footer-actions">
            <button type="button" className="misty-picker-cancel" onClick={onCancel}>Cancel</button>
            <button type="button" className="misty-picker-confirm" disabled={loading || !canChoose} onClick={choose}>
              {mode === "folder" ? (selected ? "Choose folder" : "Choose this folder") : "Choose file"}
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

function samePath(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  return left.replace(/[\\/]+$/, "").toLowerCase() === right.replace(/[\\/]+$/, "").toLowerCase();
}

function pathSegments(path: string): Array<{ label: string; path: string }> {
  if (!path) return [];
  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const normalized = path.replace(/\\/g, "/");
  const drive = normalized.match(/^([A-Za-z]:)(?:\/|$)/)?.[1] ?? null;
  const parts = normalized.replace(/^[A-Za-z]:\/?/, "").split("/").filter(Boolean);
  const segments: Array<{ label: string; path: string }> = [];
  let current = drive ? `${drive}${separator}` : separator;
  segments.push({ label: drive || separator, path: current });
  for (const part of parts) {
    current = `${current.replace(/[\\/]+$/, "")}${separator}${part}`;
    segments.push({ label: part, path: current });
  }
  return segments;
}
