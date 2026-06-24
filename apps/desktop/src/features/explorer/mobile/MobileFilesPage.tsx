import { openPath } from "@tauri-apps/plugin-opener";
import {
  ArrowUp,
  ChevronRight,
  Cloud,
  Download,
  File,
  FileText,
  FolderOpen,
  Folder,
  HardDrive,
  Home,
  Menu,
  MoreHorizontal,
  RefreshCcw,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  explorerListDirectory,
  explorerOpenAssociation,
  explorerOpenWith,
  explorerPrepareOpenItem,
} from "../../../api/misty";
import type { DirectoryListing, FileEntry, ProviderRemote } from "../../../api/types";
import { useAppStore } from "../../../app/useAppStore";
import { errorText } from "../../../shared/format";
import { selectAdvancedPreferences, selectGeneralPreferences, useSettingsStore } from "../../settings/useSettingsStore";
import { useProvidersStore } from "../../providers/useProvidersStore";
import { formatBytes, formatDate } from "../utils/fileFormat";

const mobileFilesLastPathStorageKey = "misty.mobile.files.lastPath";
const smokeHome = "/Users/misty";
const EMPTY_PROVIDER_REMOTES: ProviderRemote[] = [];

type EmptyReason = "none" | "missing-path";
type MobileSidebarSection = "locations" | "providers";

interface MobileSidebarItem {
  id: string;
  label: string;
  detail: string;
  path: string;
  icon: LucideIcon;
}

export function MobileFilesPage() {
  const app = useAppStore((state) => state.app);
  const homeDir = app?.environment.homeDir ?? smokeHome;
  const { preferredWorkspaceRoot, mountPath } = useSettingsStore(useShallow((state) => ({
    preferredWorkspaceRoot: selectGeneralPreferences(state.settings?.document).preferredWorkspaceRoot,
    mountPath: selectAdvancedPreferences(state.settings?.document).mountPath,
  })));
  const { remotes, remoteLoading } = useProvidersStore(useShallow((state) => ({
    remotes: state.providers?.remotes ?? EMPTY_PROVIDER_REMOTES,
    remoteLoading: state.loading,
  })));
  const rootPath = resolvePreferredMobileRoot(preferredWorkspaceRoot, homeDir);
  const mountRoot = resolveMobileMountRoot(rootPath, mountPath || app?.environment.mountPath || ".misty/mnt");
  const [path, setPath] = useState(() => initialMobilePath(rootPath));
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyReason, setEmptyReason] = useState<EmptyReason>("none");
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [opening, setOpening] = useState(false);

  const loadDirectory = useCallback(async (nextPath: string, options: { refresh?: boolean } = {}) => {
    setLoading(true);
    setError(null);
    setEmptyReason("none");
    try {
      const next = await explorerListDirectory({
        path: nextPath,
        forceRemoteRefresh: options.refresh,
      });
      setListing(next);
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
  }, [homeDir]);

  useEffect(() => {
    void loadDirectory(path);
  }, [loadDirectory, path]);

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
  const currentPath = listing?.path ?? path;
  const currentTitle = emptyReason === "missing-path"
    ? "Folder unavailable"
    : mobileFolderTitle(currentPath, rootPath, mountRoot, remotes);
  const activeFilesTab = mobileRemotePathInfo(currentPath, mountRoot, remotes)?.remoteName ? "providers" : "device";

  const openEntry = (entry: FileEntry) => {
    if (entry.kind === "folder") {
      setSelectedEntry(null);
      setQuery("");
      setPath(entry.path);
      return;
    }
    setSelectedEntry(entry);
  };

  const openSelectedFile = async () => {
    if (!selectedEntry || selectedEntry.kind === "folder") return;
    setOpening(true);
    setError(null);
    try {
      const localPath = selectedEntry.location.kind === "local"
        ? selectedEntry.path
        : (await explorerPrepareOpenItem({
          path: selectedEntry.path,
          sizeBytes: selectedEntry.sizeBytes,
          remoteModified: selectedEntry.remoteModified,
        })).localPath;
      const association = await explorerOpenAssociation(selectedEntry.path);
      if (association) await explorerOpenWith(association, localPath);
      else await openPath(localPath);
      setSelectedEntry(null);
    } catch (openError) {
      setError(sanitizeMobilePathText(`Unable to open file: ${errorText(openError)}`, homeDir));
    } finally {
      setOpening(false);
    }
  };

  const navigateToPath = (nextPath: string) => {
    setSelectedEntry(null);
    setQuery("");
    setSidebarOpen(false);
    setPath(nextPath);
  };

  const openProvidersTab = () => {
    const firstRemote = remotes[0];
    if (firstRemote) {
      navigateToPath(joinMobilePath(mountRoot, firstRemote.type, firstRemote.name));
      return;
    }
    setSidebarOpen(true);
  };

  return (
    <section className="mobile-page mobile-files-page">
      <div className="mobile-files-searchbar">
        <button
          type="button"
          className="mobile-files-menu-button"
          aria-label="Files sidebar"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(true)}
        >
          <Menu size={27} strokeWidth={1.85} />
        </button>
        <input
          value={query}
          placeholder={`Search in ${mobileSearchScopeLabel(currentTitle)}`}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="mobile-files-tabs" role="tablist" aria-label="Files sections">
        <button
          type="button"
          className={activeFilesTab === "device" ? "active" : ""}
          role="tab"
          aria-selected={activeFilesTab === "device"}
          onClick={() => navigateToPath(rootPath)}
        >
          On Device
        </button>
        <button
          type="button"
          className={activeFilesTab === "providers" ? "active" : ""}
          role="tab"
          aria-selected={activeFilesTab === "providers"}
          onClick={openProvidersTab}
        >
          Providers
        </button>
      </div>

      <div className="mobile-files-sortbar">
        <div>
          <span>Name</span>
          <span className="mobile-files-sort-direction">
            <ArrowUp size={28} strokeWidth={2.4} />
          </span>
        </div>
        <button
          type="button"
          className="mobile-files-sort-action"
          aria-label="Refresh files"
          disabled={loading}
          onClick={() => void loadDirectory(path, { refresh: true })}
        >
          <RefreshCcw className={loading ? "spin" : undefined} size={24} strokeWidth={2.2} />
        </button>
      </div>

      {error ? <div className="mobile-error">{error}</div> : null}

      <div className="mobile-file-list" aria-busy={loading}>
        {loading && !listing ? <MobileFileSkeleton /> : null}
        {!loading && listing && entries.length === 0 ? (
          <MobileFilesEmptyState
            reason={emptyReason}
            searching={Boolean(query.trim())}
          />
        ) : null}
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="mobile-file-row"
          >
            <button type="button" className="mobile-file-row-main" onClick={() => openEntry(entry)}>
              <span className={`mobile-file-icon ${mobileFileIconClass(entry)}`}>
                {entry.kind === "folder" ? <Folder size={25} strokeWidth={1.8} /> : <MobileFileGlyph entry={entry} />}
              </span>
              <span>
                <strong>{entry.name}</strong>
                <small>{mobileFileMeta(entry)}</small>
              </span>
            </button>
            <button
              type="button"
              className="mobile-file-more-button"
              aria-label={`Details for ${entry.name}`}
              onClick={() => setSelectedEntry(entry)}
            >
              <MoreHorizontal size={24} strokeWidth={2.4} />
            </button>
          </div>
        ))}
      </div>

      {selectedEntry ? (
        <div className="mobile-sheet-backdrop" role="presentation" onClick={() => setSelectedEntry(null)}>
          <section
            className="mobile-detail-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="File details"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>{selectedEntry.kind}</span>
                <h2>{selectedEntry.name}</h2>
              </div>
              <button type="button" className="mobile-icon-button" aria-label="Close" onClick={() => setSelectedEntry(null)}>
                <X size={20} />
              </button>
            </header>
            <dl className="mobile-detail-list">
              <div>
                <dt>Location</dt>
                <dd>{mobileLocationLabel(selectedEntry.path, rootPath, mountRoot, remotes)}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{formatBytes(selectedEntry.sizeBytes)}</dd>
              </div>
              <div>
                <dt>Modified</dt>
                <dd>{formatDate(selectedEntry.modifiedMs)}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{selectedEntry.mimeType || selectedEntry.extension || selectedEntry.kind}</dd>
              </div>
            </dl>
            {selectedEntry.kind !== "folder" ? (
              <button type="button" className="mobile-primary-action" disabled={opening} onClick={() => void openSelectedFile()}>
                {opening ? "Opening..." : "Open"}
              </button>
            ) : null}
          </section>
        </div>
      ) : null}

      <MobileFilesSidebar
        open={sidebarOpen}
        activePath={currentPath}
        rootPath={rootPath}
        mountRoot={mountRoot}
        remotes={remotes}
        remoteLoading={remoteLoading}
        onClose={() => setSidebarOpen(false)}
        onNavigate={navigateToPath}
      />
    </section>
  );
}

function MobileFilesSidebar(props: {
  open: boolean;
  activePath: string;
  rootPath: string;
  mountRoot: string;
  remotes: ProviderRemote[];
  remoteLoading: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<MobileSidebarSection, boolean>>(() => loadMobileFilesSidebarCollapsed());
  const locationItems = useMemo(() => mobileLocationItems(props.rootPath), [props.rootPath]);

  useEffect(() => {
    saveMobileFilesSidebarCollapsed(collapsed);
  }, [collapsed]);

  if (!props.open) return null;

  const toggle = (section: MobileSidebarSection) => {
    setCollapsed((current) => ({ ...current, [section]: !current[section] }));
  };

  return (
    <div className="mobile-files-sidebar-backdrop" role="presentation" onClick={props.onClose}>
      <aside
        className="mobile-files-sidebar"
        aria-label="Files sidebar"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Misty</span>
            <h2>Browse</h2>
          </div>
          <button type="button" className="mobile-icon-button" aria-label="Close sidebar" onClick={props.onClose}>
            <X size={19} strokeWidth={1.9} />
          </button>
        </header>

        <MobileSidebarSectionHeader
          title="Locations"
          collapsed={collapsed.locations}
          onToggle={() => toggle("locations")}
        />
        {!collapsed.locations ? (
          <div className="mobile-files-sidebar-list">
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
          title="Providers"
          collapsed={collapsed.providers}
          onToggle={() => toggle("providers")}
        />
        {!collapsed.providers ? (
          props.remoteLoading && props.remotes.length === 0 ? (
            <p className="mobile-files-sidebar-muted">Loading providers...</p>
          ) : props.remotes.length === 0 ? (
            <p className="mobile-files-sidebar-muted">No providers connected</p>
          ) : (
            <div className="mobile-files-sidebar-list">
              {props.remotes.map((remote) => {
                const path = joinMobilePath(props.mountRoot, remote.type, remote.name);
                return (
                  <MobileSidebarButton
                    key={`${remote.type}:${remote.name}`}
                    item={{
                      id: `${remote.type}:${remote.name}`,
                      label: remote.name,
                      detail: remote.type,
                      path,
                      icon: Cloud,
                    }}
                    selected={pathIsInsideMobile(props.activePath, path)}
                    onNavigate={props.onNavigate}
                  />
                );
              })}
            </div>
          )
        ) : null}
      </aside>
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
      className="mobile-files-sidebar-heading"
      aria-expanded={!props.collapsed}
      onClick={props.onToggle}
    >
      <span>{props.title}</span>
      <ChevronRight className={props.collapsed ? "" : "expanded"} size={16} strokeWidth={1.9} />
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
      className={`mobile-files-sidebar-item${props.selected ? " selected" : ""}`}
      onClick={() => props.onNavigate(props.item.path)}
    >
      <span className="mobile-files-sidebar-icon">
        <Icon size={20} strokeWidth={1.8} />
      </span>
      <span>
        <strong>{props.item.label}</strong>
        <small>{props.item.detail}</small>
      </span>
    </button>
  );
}

function MobileFilesEmptyState(props: { reason: EmptyReason; searching: boolean }) {
  const title = props.reason === "missing-path"
    ? "Folder unavailable"
    : "No files found";
  const message = props.reason === "missing-path"
    ? "This folder is no longer available on this device."
    : props.searching
      ? "Try a different search."
      : "This folder is empty.";

  return (
    <div className="mobile-empty-state">
      <span className="mobile-empty-icon" aria-hidden="true">
        <FolderOpen size={34} strokeWidth={1.7} />
      </span>
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}

function MobileFileGlyph(props: { entry: FileEntry }) {
  const Icon = mobileFileIconClass(props.entry) === "document" ? FileText : File;
  return <Icon size={25} strokeWidth={1.8} />;
}

function mobileFileIconClass(entry: FileEntry): string {
  if (entry.kind === "folder") return "folder";
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "svg"].includes(extension)) return "image";
  if (["doc", "docx", "rtf", "txt", "md", "pdf"].includes(extension)) return "document";
  if (["ts", "tsx", "js", "jsx", "go", "rs", "py", "java", "c", "cc", "cpp", "h", "hpp", "json"].includes(extension)) return "code";
  return "file";
}

function mobileFileMeta(entry: FileEntry): string {
  const modified = formatDate(entry.modifiedMs);
  if (entry.kind === "folder") return modified ? `Modified ${modified}` : "Folder";
  return modified ? `Modified ${modified}` : formatBytes(entry.sizeBytes);
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

function mobileLocationItems(rootPath: string): MobileSidebarItem[] {
  const candidates: MobileSidebarItem[] = [
    { id: "home", label: "On My iPhone", detail: "Local files", path: rootPath, icon: Home },
    { id: "misty", label: "Misty", detail: "App data", path: joinMobilePath(rootPath, ".misty"), icon: HardDrive },
    { id: "documents", label: "Documents", detail: "Local folder", path: joinMobilePath(rootPath, "Documents"), icon: FileText },
    { id: "downloads", label: "Downloads", detail: "Local folder", path: joinMobilePath(rootPath, "Downloads"), icon: Download },
    { id: "starred", label: "Starred", detail: "Coming later", path: joinMobilePath(rootPath, ".misty"), icon: Star },
    { id: "trash", label: "Trash", detail: "Coming later", path: joinMobilePath(rootPath, ".misty", "trash"), icon: Trash2 },
  ];
  return candidates;
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

function parentPathFor(path: string): string | null {
  if (!path || path === "/") return null;
  const trimmed = path.replace(/\/+$/, "");
  const slashIndex = trimmed.lastIndexOf("/");
  if (slashIndex <= 0) return "/";
  return trimmed.slice(0, slashIndex);
}

function mobileFolderTitle(path: string, rootPath: string, mountRoot: string, remotes: ProviderRemote[]): string {
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
  const remote = mobileRemotePathInfo(path, mountRoot, remotes);
  if (remote) return remote.label;
  const parts = visiblePathParts(relativeMobilePath(path, rootPath));
  if (parts.length === 0) return "On My iPhone";
  return `On My iPhone › ${parts.map(displayPathPart).join(" › ")}`;
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
  const [providerType = "", remoteName = "", ...remoteParts] = suffix.split("/").filter(Boolean);
  const remote = remotes.find((candidate) => candidate.type === providerType && candidate.name === remoteName);
  if (!remoteName) return { title: "Providers", label: "Cloud providers", remoteName: null };
  const title = remoteParts.length > 0 ? displayPathPart(remoteParts[remoteParts.length - 1]) : remote?.name ?? remoteName;
  const labelParts = ["Providers", remote?.name ?? remoteName, ...remoteParts.map(displayPathPart)];
  return {
    title,
    label: labelParts.join(" › "),
    remoteName,
  };
}

function loadMobileFilesSidebarCollapsed(): Record<MobileSidebarSection, boolean> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem("misty.mobile.files.sidebar.collapsed") ?? "{}") as Partial<Record<MobileSidebarSection, boolean>>;
    return {
      locations: parsed.locations === true,
      providers: parsed.providers === true,
    };
  } catch {
    return { locations: false, providers: false };
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
        <div className="mobile-file-row skeleton" key={index}>
          <span />
          <span />
        </div>
      ))}
    </>
  );
}
