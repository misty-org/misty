import {
  Briefcase,
  ChevronDown,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Folder,
  HardDrive,
  Home,
  Check,
  Monitor,
  Pencil,
  PinOff,
  Plus,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MouseEvent } from "react";
import { savedSearchesDelete, savedSearchesSave, savedSearchesSnapshot } from "../../../api/misty";
import type { ExplorerLibrarySnapshot, MountedDevice, ProviderRemote, SavedSearch } from "../../../api/types";
import { providerIconForType } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";
import { errorText } from "../../../shared/format";
import { useMinimumSpin } from "../../../shared/hooks/useMinimumSpin";
import type { ExplorerWorkspaceEntry } from "../../../stores/useExplorerStore";
import { useSearchStore } from "../../../stores/useSearchStore";
import {
  addHiddenQuickAccessPath,
  buildDeviceEntries,
  buildLibraryTagViews,
  createSmartFolderDialogState,
  dedupePinnedPathsForQuickAccess,
  DeviceDialog,
  deviceCapacityLabel,
  joinPath,
  loadDeviceCustomization,
  loadHiddenQuickAccessPaths,
  loadSidebarCollapsedState,
  normalizeDevicePath,
  normalizeSidebarPath,
  pathIsInside,
  pinnedPathLabel,
  quickAccessPathHidden,
  quoteTagQueryValue,
  saveDeviceCustomization,
  saveHiddenQuickAccessPaths,
  saveSidebarCollapsedState,
  sidebarStyles,
  SidebarSectionHeader,
  SmartFolderDialog,
  smartFolderId,
  smartFolderMatchMode,
  smartFolderQueryFromRules,
  smartFolderRulesWithMode,
  sortSavedSearches,
  uniqueStrings,
  visibleSmartFolderRules,
  WorkspaceDialog,
} from "./ExplorerSidebarSupport";
import type {
  DeviceCustomizationState,
  DeviceMenuState,
  QuickAccessMenuItem,
  QuickAccessMenuState,
  SidebarCollapsedState,
  SidebarDeviceEntry,
  SmartFolderDraft,
  SmartFolderDialogState,
  WorkspaceDialogState,
  WorkspaceMenuState,
} from "./ExplorerSidebarSupport";


interface ExplorerSidebarProps {
  homePath: string;
  activePath: string;
  mountRoot: string;
  remotes: ProviderRemote[];
  remoteLoading: boolean;
  library: ExplorerLibrarySnapshot | null;
  devices: MountedDevice[];
  devicesLoading: boolean;
  pinnedPaths: string[];
  workspaceEntries: ExplorerWorkspaceEntry[];
  activeWorkspaceId: string;
  activeWorkspaceTitle: string;
  onNavigate: (path: string) => void;
  onRefreshDevices: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (title: string) => void;
  onRenameWorkspace: (workspaceId: string, title: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onOpenInNewTab: (path: string, title?: string) => void;
  onManageRemotes: () => void;
  onAddRemote: () => void;
  onUnpinPinnedPath: (path: string) => void;
}

export const ExplorerSidebar = memo(function ExplorerSidebar(props: ExplorerSidebarProps) {
  const [collapsedSections, setCollapsedSections] = useState<SidebarCollapsedState>(loadSidebarCollapsedState);
  const [deviceCustomization, setDeviceCustomization] = useState<DeviceCustomizationState>(loadDeviceCustomization);
  const [deviceMenu, setDeviceMenu] = useState<DeviceMenuState | null>(null);
  const [addDeviceOpen, setAddDeviceOpen] = useState(false);
  const [addDevicePath, setAddDevicePath] = useState("");
  const [renameDevice, setRenameDevice] = useState<SidebarDeviceEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceMenuState | null>(null);
  const [quickAccessMenu, setQuickAccessMenu] = useState<QuickAccessMenuState | null>(null);
  const [workspaceDialog, setWorkspaceDialog] = useState<WorkspaceDialogState>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [smartFolderDialog, setSmartFolderDialog] = useState<SmartFolderDialogState>(null);
  const [smartFolderError, setSmartFolderError] = useState<string | null>(null);
  const [smartFoldersLoading, setSmartFoldersLoading] = useState(false);
  const [hiddenQuickAccessPaths, setHiddenQuickAccessPaths] = useState<string[]>(loadHiddenQuickAccessPaths);
  const [devicesRefreshSpinning, startDevicesRefreshSpin] = useMinimumSpin(props.devicesLoading);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const quickAccessMenuRef = useRef<HTMLDivElement | null>(null);
  const quickAccess = useMemo(() => [
    { label: "Home", icon: Home, path: props.homePath },
    { label: "Desktop", icon: Monitor, path: `${props.homePath}/Desktop` },
    { label: "Documents", icon: FileText, path: `${props.homePath}/Documents` },
    { label: "Downloads", icon: Download, path: `${props.homePath}/Downloads` },
    { label: "Recent", icon: Clock3, path: "misty://recent" },
    { label: "Starred", icon: Star, path: "misty://starred" },
    { label: "Trash", icon: Trash2, path: "misty://trash" },
  ], [props.homePath]);
  const visiblePinnedPaths = useMemo(
    () => dedupePinnedPathsForQuickAccess(props.pinnedPaths, quickAccess.filter((item) => !quickAccessPathHidden(item.path, hiddenQuickAccessPaths)).map((item) => item.path)),
    [hiddenQuickAccessPaths, props.pinnedPaths, quickAccess],
  );
  const visibleQuickAccess = useMemo(
    () => quickAccess.filter((item) => !quickAccessPathHidden(item.path, hiddenQuickAccessPaths)),
    [hiddenQuickAccessPaths, quickAccess],
  );
  const visibleTagViews = useMemo(
    () => buildLibraryTagViews(props.library),
    [props.library],
  );
  const deviceEntries = useMemo(
    () => buildDeviceEntries(props.devices, deviceCustomization),
    [deviceCustomization, props.devices],
  );

  useEffect(() => {
    saveDeviceCustomization(deviceCustomization);
  }, [deviceCustomization]);

  useEffect(() => {
    saveSidebarCollapsedState(collapsedSections);
  }, [collapsedSections]);

  useEffect(() => {
    saveHiddenQuickAccessPaths(hiddenQuickAccessPaths);
  }, [hiddenQuickAccessPaths]);

  useEffect(() => {
    let disposed = false;
    setSmartFoldersLoading(true);
    void savedSearchesSnapshot()
      .then((snapshot) => {
        if (!disposed) {
          setSavedSearches(sortSavedSearches(snapshot.searches));
          setSmartFolderError(null);
        }
      })
      .catch((error) => {
        if (!disposed) setSmartFolderError(errorText(error));
      })
      .finally(() => {
        if (!disposed) setSmartFoldersLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!deviceMenu && !workspaceMenu && !quickAccessMenu) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      if (target && workspaceButtonRef.current?.contains(target)) return;
      if (target && workspaceMenuRef.current?.contains(target)) return;
      if (target && quickAccessMenuRef.current?.contains(target)) return;
      setDeviceMenu(null);
      setWorkspaceMenu(null);
      setQuickAccessMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDeviceMenu(null);
        setWorkspaceMenu(null);
        setQuickAccessMenu(null);
      }
    };
    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [deviceMenu, quickAccessMenu, workspaceMenu]);

  const startRename = (device: SidebarDeviceEntry) => {
    setRenameDevice(device);
    setRenameValue(device.name);
    setDeviceMenu(null);
  };

  const hideDevice = (device: SidebarDeviceEntry) => {
    setDeviceCustomization((current) => ({
      ...current,
      hiddenPaths: uniqueStrings([...current.hiddenPaths, device.mountPath]),
    }));
    setDeviceMenu(null);
  };

  const confirmAddDevice = () => {
    const path = normalizeDevicePath(addDevicePath);
    if (!path) return;
    setDeviceCustomization((current) => ({
      ...current,
      customMountPaths: uniqueStrings([...current.customMountPaths, path]),
      hiddenPaths: current.hiddenPaths.filter((candidate) => candidate !== path),
    }));
    setAddDeviceOpen(false);
    setAddDevicePath("");
  };

  const confirmRenameDevice = () => {
    const name = renameValue.trim();
    if (!renameDevice || !name) return;
    setDeviceCustomization((current) => ({
      ...current,
      nameOverrides: { ...current.nameOverrides, [renameDevice.mountPath]: name },
    }));
    setRenameDevice(null);
    setRenameValue("");
  };
  const toggleSection = (section: keyof SidebarCollapsedState) => {
    setCollapsedSections((current) => ({ ...current, [section]: !current[section] }));
  };
  const openQuickAccessMenu = (
    event: MouseEvent,
    item: QuickAccessMenuItem | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const width = item ? 224 : 236;
    setDeviceMenu(null);
    setWorkspaceMenu(null);
    setQuickAccessMenu({
      item,
      mode: item ? "item" : "checklist",
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - 150)),
      width,
    });
  };
  const removeQuickAccessItem = (item: QuickAccessMenuItem) => {
    if (item.kind === "builtIn") {
      setHiddenQuickAccessPaths((paths) => addHiddenQuickAccessPath(paths, item.path));
    } else {
      props.onUnpinPinnedPath(item.path);
    }
    setQuickAccessMenu(null);
  };
  const resetQuickAccessDefaults = () => {
    setHiddenQuickAccessPaths([]);
    setQuickAccessMenu(null);
  };
  const toggleQuickAccessDefault = (path: string) => {
    setHiddenQuickAccessPaths((paths) =>
      quickAccessPathHidden(path, paths)
        ? paths.filter((candidate) => normalizeSidebarPath(candidate) !== normalizeSidebarPath(path))
        : addHiddenQuickAccessPath(paths, path)
    );
  };
  const openWorkspaceDialog = (kind: "create" | "rename" | "delete", target?: ExplorerWorkspaceEntry) => {
    const active = target
      ?? props.workspaceEntries.find((workspace) => workspace.id === props.activeWorkspaceId)
      ?? (props.activeWorkspaceId ? { id: props.activeWorkspaceId, title: props.activeWorkspaceTitle } : null);
    setWorkspaceMenu(null);
    setWorkspaceDialog(kind === "rename" && active
      ? { kind, workspaceId: active.id, title: active.title }
      : kind === "delete" && active
        ? { kind, workspaceId: active.id, title: active.title }
        : { kind: "create", workspaceId: "", title: "Workspace" });
    setWorkspaceDraft(kind === "rename" && active ? active.title : "Workspace");
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
  const openSmartFolderDialog = (search?: SavedSearch) => {
    setSmartFolderError(null);
    setSmartFolderDialog(createSmartFolderDialogState(search));
  };
  const saveSmartFolder = async (draft: SmartFolderDraft) => {
    const name = draft.name.trim();
    if (!name) return;
    const search: SavedSearch = {
      id: draft.id || smartFolderId(),
      name,
      query: draft.query.trim() || smartFolderQueryFromRules(draft.rules, draft.matchMode),
      rules: smartFolderRulesWithMode(draft.rules, draft.matchMode),
      updatedAtMs: Date.now(),
    };
    try {
      const snapshot = await savedSearchesSave(search);
      setSavedSearches(sortSavedSearches(snapshot.searches));
      setSmartFolderDialog(null);
      setSmartFolderError(null);
    } catch (error) {
      setSmartFolderError(errorText(error));
    }
  };
  const deleteSmartFolder = async (id: string) => {
    try {
      const snapshot = await savedSearchesDelete(id);
      setSavedSearches(sortSavedSearches(snapshot.searches));
      setSmartFolderDialog(null);
      setSmartFolderError(null);
    } catch (error) {
      setSmartFolderError(errorText(error));
    }
  };
  const runSmartFolder = async (search: SavedSearch) => {
    const query = search.query.trim() || smartFolderQueryFromRules(search.rules, smartFolderMatchMode(search.rules));
    if (!query) return;
    const searchStore = useSearchStore.getState();
    await searchStore.openSearch(props.activePath || props.homePath);
    searchStore.setScope("everything");
    searchStore.setQuery(query);
  };
  const openTagView = async (tag: string) => {
    const searchStore = useSearchStore.getState();
    await searchStore.openSearch(props.activePath || props.homePath);
    searchStore.setScope("everything");
    searchStore.setQuery(`tag:${quoteTagQueryValue(tag)}`);
  };

  return (
    <aside className={sidebarStyles.root}>
      <section className={sidebarStyles.section}>
        <button
          type="button"
          ref={workspaceButtonRef}
          className={sidebarStyles.workspaceSelect}
          aria-haspopup="menu"
          aria-expanded={Boolean(workspaceMenu)}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const width = Math.max(220, rect.width);
            setWorkspaceMenu((current) => {
              if (current) return null;
              return {
                left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
                top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 260)),
                width,
              };
            });
          }}
        >
          <Briefcase size={20} />
          <span className={sidebarStyles.workspaceSelectLabel}>{props.activeWorkspaceTitle}</span>
          <ChevronDown size={15} />
        </button>
      </section>

      <section className={sidebarStyles.section}>
        <SidebarSectionHeader
          title="Quick access"
          collapsed={collapsedSections.quickAccess}
          onToggle={() => toggleSection("quickAccess")}
          onContextMenu={(event) => openQuickAccessMenu(event, null)}
        />
        {!collapsedSections.quickAccess ? (
          <div className={sidebarStyles.list}>
            {visibleQuickAccess.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  className={`${sidebarStyles.pinnedRow} ${props.activePath === item.path ? sidebarStyles.itemSelected : ""}`}
                  key={`quick:${item.path}`}
                  onContextMenu={(event) => openQuickAccessMenu(event, {
                    kind: "builtIn",
                    label: item.label,
                    path: item.path,
                  })}
                >
                  <button
                    className={sidebarStyles.pinnedButton}
                    onClick={() => props.onNavigate(item.path)}
                    title={item.path}
                  >
                    <Icon size={20} />
                    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{item.label}</span>
                  </button>
                  <button
                    type="button"
                    className={sidebarStyles.pinnedUnpinButton}
                    title={`Unpin ${item.label}`}
                    aria-label={`Unpin ${item.label} from Quick access`}
                    onClick={() => setHiddenQuickAccessPaths((paths) => addHiddenQuickAccessPath(paths, item.path))}
                  >
                    <PinOff size={15} />
                  </button>
                </div>
              );
            })}
            {visiblePinnedPaths.map((path) => (
              <div
                className={`${sidebarStyles.pinnedRow} ${props.activePath === path ? sidebarStyles.itemSelected : ""}`}
                key={`pin:${path}`}
                onContextMenu={(event) => openQuickAccessMenu(event, {
                  kind: "pinned",
                  label: pinnedPathLabel(path),
                  path,
                })}
              >
                <button
                  className={sidebarStyles.pinnedButton}
                  onClick={() => props.onNavigate(path)}
                  title={path}
                >
                  <Folder size={20} />
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{pinnedPathLabel(path)}</span>
                </button>
                <button
                  type="button"
                  className={sidebarStyles.pinnedUnpinButton}
                  title={`Unpin ${path}`}
                  aria-label={`Unpin ${path} from Quick access`}
                  onClick={() => props.onUnpinPinnedPath(path)}
                >
                  <PinOff size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className={sidebarStyles.section}>
        <SidebarSectionHeader
          title="Smart Folders"
          collapsed={collapsedSections.smartFolders}
          onToggle={() => toggleSection("smartFolders")}
          actions={(
            <button
              type="button"
              title="New smart folder"
              aria-label="New smart folder"
              className={sidebarStyles.sectionActionButton}
              onClick={(event) => {
                event.stopPropagation();
                openSmartFolderDialog();
              }}
            >
              <Plus size={15} />
            </button>
          )}
        />
        {!collapsedSections.smartFolders ? (
          <div className={sidebarStyles.list}>
            {smartFolderError ? <p className={sidebarStyles.errorText}>{smartFolderError}</p> : null}
            {smartFoldersLoading && savedSearches.length === 0 ? <div className={sidebarStyles.muted}>Loading smart folders...</div> : null}
            {!smartFoldersLoading && savedSearches.length === 0 ? <div className={sidebarStyles.muted}>No smart folders yet</div> : null}
            {savedSearches.map((search) => {
              const query = search.query.trim() || smartFolderQueryFromRules(search.rules, smartFolderMatchMode(search.rules));
              return (
                <div className={`${sidebarStyles.pinnedRow} group/pin`} key={search.id}>
                  <button
                    className={sidebarStyles.pinnedButton}
                    onClick={() => void runSmartFolder(search)}
                    title={query || search.name}
                  >
                    <Search size={20} />
                    <span className="grid min-w-0 gap-[2px]">
                      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{search.name}</span>
                      <small className={sidebarStyles.smartMeta}>{query || `${visibleSmartFolderRules(search.rules).length} rules`}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={sidebarStyles.pinnedUnpinButton}
                    title={`Edit ${search.name}`}
                    aria-label={`Edit ${search.name}`}
                    onClick={() => openSmartFolderDialog(search)}
                  >
                    <Pencil size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className={sidebarStyles.section}>
        <SidebarSectionHeader
          title="Tags"
          collapsed={collapsedSections.tags}
          onToggle={() => toggleSection("tags")}
        />
        {!collapsedSections.tags ? (
          <div className={sidebarStyles.list}>
            {visibleTagViews.length === 0 ? <div className={sidebarStyles.muted}>No tags yet</div> : null}
            {visibleTagViews.map((tagView) => (
              <button
                key={tagView.key}
                className={sidebarStyles.itemButton}
                onClick={() => void openTagView(tagView.name)}
                title={`tag:${tagView.name}`}
              >
                <Tag size={20} />
                <span className="grid min-w-0 gap-[2px]">
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{tagView.name}</span>
                  <small className={sidebarStyles.smartMeta}>{tagView.count} {tagView.count === 1 ? "item" : "items"}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className={sidebarStyles.section}>
        <SidebarSectionHeader
          title="Remote"
          collapsed={collapsedSections.remote}
          onToggle={() => toggleSection("remote")}
          actions={(
            <>
              <button
                type="button"
                title="Manage remotes"
                aria-label="Manage remotes"
                className={sidebarStyles.sectionActionButton}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onManageRemotes();
                }}
              >
                <SlidersHorizontal size={15} />
              </button>
              <button
                type="button"
                title="Add remote"
                aria-label="Add remote"
                className={sidebarStyles.sectionActionButton}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onAddRemote();
                }}
              >
                <Plus size={15} />
              </button>
            </>
          )}
        />
        {!collapsedSections.remote ? (
          props.remoteLoading && props.remotes.length === 0 ? (
            <div className={sidebarStyles.muted}>Loading remote...</div>
          ) : props.remotes.length === 0 ? (
            <div className={sidebarStyles.muted}>No remotes connected</div>
          ) : (
            <div className={sidebarStyles.list}>
              {props.remotes.map((remote) => {
                const path = joinPath(props.mountRoot, remote.name);
                const providerIcon = providerIconForType(remote.type);
                return (
                  <button
                    key={`${remote.type}:${remote.name}`}
                    className={`${sidebarStyles.itemButton} ${props.activePath === path || props.activePath.startsWith(`${path}/`) ? sidebarStyles.itemSelected : ""}`}
                    onClick={() => props.onNavigate(path)}
                    title={`${remote.type}: ${remote.name}`}
                  >
                    <span className={sidebarStyles.remoteIcon}>
                      <AssetIcon src={providerIcon.src} color={providerIcon.color} size={24} />
                    </span>
                    <span>{remote.name}</span>
                  </button>
                );
              })}
            </div>
          )
        ) : null}
      </section>

      <section className={sidebarStyles.section}>
        <SidebarSectionHeader
          title="Devices"
          collapsed={collapsedSections.devices}
          onToggle={() => toggleSection("devices")}
          actions={(
            <>
              <button
                type="button"
                title="Refresh devices"
                className={`${sidebarStyles.sectionActionButton} ${devicesRefreshSpinning ? sidebarStyles.spinning : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  startDevicesRefreshSpin();
                  props.onRefreshDevices();
                }}
              >
                <RefreshCcw size={14} />
              </button>
              <button
                type="button"
                title="Add mount point"
                className={sidebarStyles.sectionActionButton}
                onClick={(event) => {
                  event.stopPropagation();
                  setAddDeviceOpen(true);
                }}
              >
                <Plus size={15} />
              </button>
            </>
          )}
        />
        {!collapsedSections.devices ? (
          deviceEntries.length === 0 ? (
            <div className={sidebarStyles.muted}>{props.devicesLoading ? "Loading devices..." : "No devices connected"}</div>
          ) : (
            <div className={sidebarStyles.list}>
              {deviceEntries.map((device) => {
                const usedBytes = Math.max(0, device.totalBytes - device.freeBytes);
                const usedRatio = device.totalBytes > 0 ? Math.min(100, Math.round((usedBytes / device.totalBytes) * 100)) : 0;
                return (
                  <div className={sidebarStyles.deviceRow} key={device.id}>
                    <button
                      type="button"
                      className={`${sidebarStyles.deviceButton} ${pathIsInside(props.activePath, device.mountPath) ? sidebarStyles.itemSelected : ""}`}
                      onClick={() => props.onNavigate(device.mountPath)}
                      title={`${device.name} · ${device.mountPath}`}
                    >
                      <HardDrive size={20} />
                      <span className={sidebarStyles.deviceCopy}>
                        <strong className={sidebarStyles.deviceName}>{device.name}</strong>
                        <small className={sidebarStyles.deviceMeta}>{deviceCapacityLabel(usedBytes, device.totalBytes, device.fsType || device.mountPath)}</small>
                        {device.totalBytes > 0 ? (
                          <span className={sidebarStyles.deviceMeter} aria-hidden="true"><i className={sidebarStyles.deviceMeterFill} style={{ width: `${usedRatio}%` }} /></span>
                        ) : null}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )
        ) : null}
      </section>
      {workspaceMenu
        ? createPortal(
            <div
              ref={workspaceMenuRef}
              className={`${sidebarStyles.menu} ${sidebarStyles.workspaceMenu}`}
              style={{ left: workspaceMenu.left, top: workspaceMenu.top, width: workspaceMenu.width }}
              role="menu"
            >
              {(props.workspaceEntries.length > 0 ? props.workspaceEntries : [{ id: props.activeWorkspaceId || "workspace_0", title: props.activeWorkspaceTitle }]).map((workspace) => (
                <div
                  key={workspace.id}
                  className={`${sidebarStyles.workspaceMenuRow} ${workspace.id === props.activeWorkspaceId ? sidebarStyles.menuButtonSelected : ""}`}
                >
                  <button
                    className={sidebarStyles.workspaceMenuSelect}
                    type="button"
                    role="menuitemradio"
                    aria-checked={workspace.id === props.activeWorkspaceId}
                    onClick={() => {
                      setWorkspaceMenu(null);
                      props.onSelectWorkspace(workspace.id);
                    }}
                  >
                    <span className={sidebarStyles.menuButtonCheck}>
                      {workspace.id === props.activeWorkspaceId ? <Check size={15} /> : null}
                    </span>
                    <span className={sidebarStyles.menuButtonTruncate}>{workspace.title}</span>
                  </button>
                  <span className={sidebarStyles.workspaceMenuActions}>
                    <button
                      className={sidebarStyles.workspaceMenuIconButton}
                      type="button"
                      title={`Rename ${workspace.title}`}
                      aria-label={`Rename ${workspace.title}`}
                      onClick={() => openWorkspaceDialog("rename", workspace)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className={sidebarStyles.workspaceMenuIconButton}
                      type="button"
                      title={`Delete ${workspace.title}`}
                      aria-label={`Delete ${workspace.title}`}
                      onClick={() => openWorkspaceDialog("delete", workspace)}
                      disabled={props.workspaceEntries.length <= 1}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </div>
              ))}
              <div className={sidebarStyles.menuSeparator} />
              <button className={sidebarStyles.menuButton} type="button" role="menuitem" onClick={() => openWorkspaceDialog("create")}>
                <span className={sidebarStyles.menuButtonIcon}><Plus size={15} /></span>
                <span>New</span>
              </button>
            </div>,
            document.body,
          )
        : null}
      {quickAccessMenu
        ? createPortal(
            <div
              ref={quickAccessMenuRef}
              className={sidebarStyles.menu}
              style={{ left: quickAccessMenu.left, top: quickAccessMenu.top, width: quickAccessMenu.width }}
              role="menu"
              aria-label="Quick access actions"
            >
              {quickAccessMenu.mode === "item" ? (
                <>
                  <button
                    className={sidebarStyles.menuButton}
                    type="button"
                    role="menuitem"
                    disabled={!quickAccessMenu.item}
                    onClick={() => {
                      if (!quickAccessMenu.item) return;
                      props.onOpenInNewTab(quickAccessMenu.item.path, quickAccessMenu.item.label);
                      setQuickAccessMenu(null);
                    }}
                  >
                    <ExternalLink size={15} />
                    <span>Open in New Tab</span>
                  </button>
                  <button
                    className={sidebarStyles.menuButton}
                    type="button"
                    role="menuitem"
                    disabled={!quickAccessMenu.item}
                    onClick={() => {
                      if (quickAccessMenu.item) removeQuickAccessItem(quickAccessMenu.item);
                    }}
                  >
                    <X size={15} />
                    <span>Remove from Sidebar</span>
                  </button>
                  <div className={sidebarStyles.menuSeparator} />
                </>
              ) : null}
              {quickAccessMenu.mode === "checklist" ? (
                <>
                  {quickAccess.map((item) => {
                    const checked = !quickAccessPathHidden(item.path, hiddenQuickAccessPaths);
                    return (
                      <button
                        key={`quick-menu:${item.path}`}
                        className={sidebarStyles.menuButton}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={checked}
                        onClick={() => toggleQuickAccessDefault(item.path)}
                      >
                        <span className={sidebarStyles.menuButtonCheck}>{checked ? <Check size={15} /> : null}</span>
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                  <div className={sidebarStyles.menuSeparator} />
                </>
              ) : null}
              <button
                className={sidebarStyles.menuButton}
                type="button"
                role="menuitem"
                onClick={resetQuickAccessDefaults}
              >
                <RefreshCcw size={15} />
                <span>Reset Defaults</span>
              </button>
            </div>,
            document.body,
          )
        : null}
      {deviceMenu
        ? createPortal(
            <div
              ref={menuRef}
              className={sidebarStyles.menu}
              style={{ left: deviceMenu.left, top: deviceMenu.top }}
              role="menu"
            >
              <button className={sidebarStyles.menuButton} type="button" role="menuitem" onClick={() => startRename(deviceMenu.device)}>Rename</button>
              <button className={sidebarStyles.menuButton} type="button" role="menuitem" onClick={() => hideDevice(deviceMenu.device)}>Hide</button>
            </div>,
            document.body,
          )
        : null}
      {workspaceDialog
        ? createPortal(
            <WorkspaceDialog
              state={workspaceDialog}
              value={workspaceDraft}
              onChange={setWorkspaceDraft}
              onConfirm={confirmWorkspaceDialog}
              onCancel={() => {
                setWorkspaceDialog(null);
                setWorkspaceDraft("");
              }}
            />,
            document.body,
          )
        : null}
      {smartFolderDialog
        ? createPortal(
            <SmartFolderDialog
              state={smartFolderDialog}
              error={smartFolderError}
              onSave={saveSmartFolder}
              onDelete={deleteSmartFolder}
              onCancel={() => {
                setSmartFolderDialog(null);
                setSmartFolderError(null);
              }}
            />,
            document.body,
          )
        : null}
      {addDeviceOpen
        ? createPortal(
            <DeviceDialog
              title="Add Mount Point"
              label="Mount Path"
              placeholder="/Volumes/MyDrive"
              value={addDevicePath}
              confirmLabel="Add"
              onChange={setAddDevicePath}
              onConfirm={confirmAddDevice}
              onCancel={() => {
                setAddDeviceOpen(false);
                setAddDevicePath("");
              }}
            />,
            document.body,
          )
        : null}
      {renameDevice
        ? createPortal(
            <DeviceDialog
              title="Rename Drive"
              label="Drive Name"
              value={renameValue}
              confirmLabel="Save"
              onChange={setRenameValue}
              onConfirm={confirmRenameDevice}
              onCancel={() => {
                setRenameDevice(null);
                setRenameValue("");
              }}
            />,
            document.body,
          )
        : null}
    </aside>
  );
});
