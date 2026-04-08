import type { QuickAccessItem } from "@/models/types/features/explorer/components/ExplorerSidebar";
export type { QuickAccessItem } from "@/models/types/features/explorer/components/ExplorerSidebar";
import type {
  ExplorerSidebarProps,
  AndroidLocalGrantRequest,
} from "@/models/interfaces/features/explorer/components/ExplorerSidebar";
export type {
  ExplorerSidebarProps,
  AndroidLocalGrantRequest,
} from "@/models/interfaces/features/explorer/components/ExplorerSidebar";
import { Button } from "@/ui";
import {
  Briefcase,
  Camera,
  ChevronDown,
  Clock3,
  Download,
  ExternalLink,
  Film,
  FileText,
  Folder,
  HardDrive,
  Home,
  Headphones,
  Image,
  Check,
  Mic2,
  Monitor,
  Music,
  Pencil,
  PinOff,
  Plus,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { savedSearchesDelete, savedSearchesSave, savedSearchesSnapshot } from "@/stores/backend";
import type {
  AndroidAllFilesAccessStatus,
  ExplorerLibrarySnapshot,
  FileEntry,
  MountedDevice,
  ProviderRemote,
  SavedSearch,
} from "@/models/interfaces/services/misty-api";
import { providerIconForType } from "@/assets/icons";
import { AssetIcon } from "@/ui";
import { errorText } from "@/lib/format";
import type { ExplorerWorkspaceEntry } from "@/stores/explorer";
import { useSearchStore } from "@/stores/explorer";
import {
  addHiddenQuickAccessPath,
  buildDeviceEntries,
  createSmartFolderDialogState,
  dedupePinnedPathsForQuickAccess,
  deviceCapacityLabel,
  joinPath,
  loadDeviceCustomization,
  loadHiddenQuickAccessPaths,
  loadSidebarCollapsedState,
  normalizeSidebarPath,
  pathIsInside,
  pinnedPathLabel,
  quickAccessPathHidden,
  saveDeviceCustomization,
  saveHiddenQuickAccessPaths,
  saveSidebarCollapsedState,
  sidebarStyles,
  SidebarSectionHeader,
  smartFolderId,
  smartFolderMatchMode,
  smartFolderQueryFromRules,
  smartFolderRulesWithMode,
  sortSavedSearches,
  uniqueStrings,
  visibleSmartFolderRules,
} from "./ExplorerSidebarSupport";
import { SmartFolderDialog, WorkspaceDialog } from "./ExplorerSidebarDialogs";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui";
import type {
  QuickAccessMenuItem,
  SmartFolderDialogState,
  WorkspaceDialogState,
} from "@/models/types/features/explorer/components/ExplorerSidebarSupport";
import type {
  DeviceCustomizationState,
  SidebarCollapsedState,
  SidebarDeviceEntry,
  SmartFolderDraft,
} from "@/models/interfaces/features/explorer/components/ExplorerSidebarSupport";
import { ExplorerDropTarget } from "../drag/ExplorerDropTarget";

const androidSuggestedLocalFolders = [
  { label: "Documents", icon: FileText, initialDirectory: "Documents", targetNames: ["documents"] },
  {
    label: "Downloads",
    icon: Download,
    initialDirectory: "Download",
    targetNames: ["download", "downloads"],
  },
  { label: "Pictures", icon: Image, initialDirectory: "Pictures", targetNames: ["pictures"] },
  { label: "Camera", icon: Camera, initialDirectory: "DCIM", targetNames: ["dcim", "camera"] },
  { label: "Movies", icon: Film, initialDirectory: "Movies", targetNames: ["movies", "videos"] },
  { label: "Music", icon: Music, initialDirectory: "Music", targetNames: ["music"] },
  { label: "Recordings", icon: Mic2, initialDirectory: "Recordings", targetNames: ["recordings"] },
  { label: "Ringtones", icon: Music, initialDirectory: "Ringtones", targetNames: ["ringtones"] },
  {
    label: "Audiobooks",
    icon: Headphones,
    initialDirectory: "Audiobooks",
    targetNames: ["audiobooks"],
  },
  { label: "Podcasts", icon: Headphones, initialDirectory: "Podcasts", targetNames: ["podcasts"] },
] satisfies Array<{
  label: string;
  icon: typeof Folder;
  initialDirectory: string;
  targetNames: string[];
}>;

export const ExplorerSidebar = memo(function ExplorerSidebar(props: ExplorerSidebarProps) {
  const [collapsedSections, setCollapsedSections] =
    useState<SidebarCollapsedState>(loadSidebarCollapsedState);
  const [deviceCustomization, setDeviceCustomization] =
    useState<DeviceCustomizationState>(loadDeviceCustomization);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceDialog, setWorkspaceDialog] = useState<WorkspaceDialogState>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [smartFolderDialog, setSmartFolderDialog] = useState<SmartFolderDialogState>(null);
  const [smartFolderError, setSmartFolderError] = useState<string | null>(null);
  const [smartFoldersLoading, setSmartFoldersLoading] = useState(false);
  const [hiddenQuickAccessPaths, setHiddenQuickAccessPaths] = useState<string[]>(
    loadHiddenQuickAccessPaths,
  );
  const quickAccess = useMemo<QuickAccessItem[]>(() => {
    if (!props.androidLocal) {
      return [
        { label: "Home", icon: Home, path: props.homePath },
        { label: "Desktop", icon: Monitor, path: `${props.homePath}/Desktop` },
        { label: "Documents", icon: FileText, path: `${props.homePath}/Documents` },
        { label: "Downloads", icon: Download, path: `${props.homePath}/Downloads` },
        { label: "Recent", icon: Clock3, path: "misty://recent" },
        { label: "Starred", icon: Star, path: "misty://starred" },
        { label: "Trash", icon: Trash2, path: "misty://trash" },
      ];
    }

    const storageRoot =
      props.androidAllFilesAccess?.granted && props.androidAllFilesAccess.storageRoot
        ? props.androidAllFilesAccess.storageRoot.replace(/\/+$/, "")
        : null;
    if (storageRoot) {
      return [
        { label: "Local", icon: Folder, path: storageRoot },
        ...androidSuggestedLocalFolders.map((item) => ({
          label: item.label,
          icon: item.icon,
          path: `${storageRoot}/${item.initialDirectory}`,
        })),
        { label: "Recent", icon: Clock3, path: "misty://recent" },
        { label: "Starred", icon: Star, path: "misty://starred" },
        { label: "Trash", icon: Trash2, path: "misty://trash" },
      ];
    }

    return [
      {
        label: "Local",
        icon: Folder,
        path: props.homePath,
        grantRequest: { label: "Local", targetNames: [], initialDirectory: "" },
      },
      ...androidSuggestedLocalFolders.map((item) => {
        const granted = props.androidGrantedFolders.find((folder) =>
          item.targetNames.includes(normalizeAndroidLocalName(folder.name)),
        );
        const path =
          granted?.path ?? `misty://local/grant/${normalizeAndroidLocalName(item.label)}`;
        return {
          label: item.label,
          icon: item.icon,
          path,
          grantRequest: {
            label: item.label,
            targetNames: item.targetNames,
            initialDirectory: item.initialDirectory,
            grantedPath: granted?.path,
          },
        };
      }),
      { label: "Recent", icon: Clock3, path: "misty://recent" },
      { label: "Starred", icon: Star, path: "misty://starred" },
      { label: "Trash", icon: Trash2, path: "misty://trash" },
    ];
  }, [
    props.androidAllFilesAccess,
    props.androidGrantedFolders,
    props.androidLocal,
    props.homePath,
  ]);
  const visiblePinnedPaths = useMemo(
    () =>
      dedupePinnedPathsForQuickAccess(
        props.pinnedPaths,
        quickAccess
          .filter((item) => !quickAccessPathHidden(item.path, hiddenQuickAccessPaths))
          .map((item) => item.path),
      ),
    [hiddenQuickAccessPaths, props.pinnedPaths, quickAccess],
  );
  const visibleQuickAccess = useMemo(
    () => quickAccess.filter((item) => !quickAccessPathHidden(item.path, hiddenQuickAccessPaths)),
    [hiddenQuickAccessPaths, quickAccess],
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

  const unmountDevice = (device: SidebarDeviceEntry) => {
    setDeviceCustomization((current) => ({
      ...current,
      customMountPaths: device.custom
        ? current.customMountPaths.filter((path) => path !== device.mountPath)
        : current.customMountPaths,
      hiddenPaths: device.custom
        ? current.hiddenPaths.filter((path) => path !== device.mountPath)
        : uniqueStrings([...current.hiddenPaths, device.mountPath]),
      nameOverrides: Object.fromEntries(
        Object.entries(current.nameOverrides).filter(([path]) => path !== device.mountPath),
      ),
    }));
  };

  const toggleSection = (section: keyof SidebarCollapsedState) => {
    setCollapsedSections((current) => ({ ...current, [section]: !current[section] }));
  };
  const removeQuickAccessItem = (item: QuickAccessMenuItem) => {
    if (item.kind === "builtIn") {
      setHiddenQuickAccessPaths((paths) => addHiddenQuickAccessPath(paths, item.path));
    } else {
      props.onUnpinPinnedPath(item.path);
    }
  };
  const resetQuickAccessDefaults = () => {
    setHiddenQuickAccessPaths([]);
  };
  const toggleQuickAccessDefault = (path: string) => {
    setHiddenQuickAccessPaths((paths) =>
      quickAccessPathHidden(path, paths)
        ? paths.filter(
            (candidate) => normalizeSidebarPath(candidate) !== normalizeSidebarPath(path),
          )
        : addHiddenQuickAccessPath(paths, path),
    );
  };
  const openWorkspaceDialog = (
    kind: "create" | "rename" | "delete",
    target?: ExplorerWorkspaceEntry,
  ) => {
    const active =
      target ??
      props.workspaceEntries.find((workspace) => workspace.id === props.activeWorkspaceId) ??
      (props.activeWorkspaceId
        ? { id: props.activeWorkspaceId, title: props.activeWorkspaceTitle }
        : null);
    setWorkspaceMenuOpen(false);
    setWorkspaceDialog(
      kind === "rename" && active
        ? { kind, workspaceId: active.id, title: active.title }
        : kind === "delete" && active
          ? { kind, workspaceId: active.id, title: active.title }
          : { kind: "create", workspaceId: "", title: "File layout" },
    );
    setWorkspaceDraft(kind === "rename" && active ? active.title : "File layout");
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
    const query =
      search.query.trim() ||
      smartFolderQueryFromRules(search.rules, smartFolderMatchMode(search.rules));
    if (!query) return;
    const searchStore = useSearchStore.getState();
    await searchStore.openSearch(props.activePath || props.homePath);
    searchStore.setScope("everything");
    searchStore.setQuery(query);
  };
  return (
    <aside className={sidebarStyles.root} data-explorer-scroll-container>
      <section className={sidebarStyles.section}>
        <DropdownMenu open={workspaceMenuOpen} onOpenChange={setWorkspaceMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" className={sidebarStyles.workspaceSelect}>
              <Briefcase size={20} />
              <span className={sidebarStyles.workspaceSelectLabel}>
                {props.activeWorkspaceTitle}
              </span>
              <ChevronDown size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {(props.workspaceEntries.length > 0
              ? props.workspaceEntries
              : [
                  {
                    id: props.activeWorkspaceId || "workspace_0",
                    title: props.activeWorkspaceTitle,
                  },
                ]
            ).map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                className="group/workspace gap-2 pr-1"
                role="menuitemradio"
                aria-checked={workspace.id === props.activeWorkspaceId}
                onSelect={() => props.onSelectWorkspace(workspace.id)}
              >
                <span className="w-[17px] flex-none">
                  {workspace.id === props.activeWorkspaceId ? <Check size={15} /> : null}
                </span>
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {workspace.title}
                </span>
                <span className="flex flex-none items-center gap-px opacity-0 group-hover/workspace:opacity-100 group-focus-within/workspace:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    aria-label={`Rename ${workspace.title}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      openWorkspaceDialog("rename", workspace);
                    }}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    aria-label={`Delete ${workspace.title}`}
                    disabled={props.workspaceEntries.length <= 1}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      openWorkspaceDialog("delete", workspace);
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openWorkspaceDialog("create")}>
              <Plus size={15} />
              <span>New</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </section>

      <section className={sidebarStyles.section}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div>
              <SidebarSectionHeader
                title="Quick access"
                collapsed={collapsedSections.quickAccess}
                onToggle={() => toggleSection("quickAccess")}
                actions={
                  props.androidLocal ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Add local folder"
                      className={sidebarStyles.sectionActionButton}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onGrantLocalFolder();
                      }}
                    >
                      <Plus size={15} />
                    </Button>
                  ) : undefined
                }
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56" aria-label="Quick access defaults">
            {quickAccess.map((item) => (
              <ContextMenuCheckboxItem
                key={`quick-menu:${item.path}`}
                checked={!quickAccessPathHidden(item.path, hiddenQuickAccessPaths)}
                onCheckedChange={() => toggleQuickAccessDefault(item.path)}
                onSelect={(event) => event.preventDefault()}
              >
                {item.label}
              </ContextMenuCheckboxItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={resetQuickAccessDefaults}>
              <RefreshCcw size={15} />
              <span>Reset Defaults</span>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {!collapsedSections.quickAccess ? (
          <div className={sidebarStyles.list}>
            {visibleQuickAccess.map((item) => {
              const Icon = item.icon;
              const grantedPath = item.grantRequest?.grantedPath;
              const selected = grantedPath
                ? props.activePath === grantedPath || props.activePath.startsWith(`${grantedPath}/`)
                : props.activePath === item.path;
              return (
                <ContextMenu key={`quick:${item.path}`}>
                  <ContextMenuTrigger asChild>
                    <div
                      className={`${sidebarStyles.pinnedRow} ${selected ? sidebarStyles.itemSelected : ""}`}
                    >
                      <ExplorerDropTarget
                        id={`sidebar:quick:${item.path}`}
                        path={grantedPath ?? item.path}
                        springLoad={!item.grantRequest || Boolean(grantedPath)}
                        onSpringLoad={() => props.onNavigate(grantedPath ?? item.path)}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          className={sidebarStyles.pinnedButton}
                          onClick={() => {
                            if (item.grantRequest) {
                              props.onGrantLocalFolder(item.grantRequest);
                            } else {
                              props.onNavigate(item.path);
                            }
                          }}
                        >
                          <span className={sidebarStyles.itemIcon} aria-hidden="true">
                            <Icon />
                          </span>
                          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                            {item.label}
                          </span>
                        </Button>
                      </ExplorerDropTarget>
                      {item.grantRequest && !grantedPath ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className={sidebarStyles.pinnedUnpinButton}
                          aria-label={`Grant access to ${item.label}`}
                          onClick={() => props.onGrantLocalFolder(item.grantRequest)}
                        >
                          <Plus size={15} />
                        </Button>
                      ) : item.grantRequest ? (
                        <span
                          className={sidebarStyles.pinnedUnpinButton}
                          aria-label={`${item.label} access granted`}
                        >
                          <Check size={15} />
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className={sidebarStyles.pinnedUnpinButton}
                          aria-label={`Unpin ${item.label} from Quick access`}
                          onClick={() =>
                            setHiddenQuickAccessPaths((paths) =>
                              addHiddenQuickAccessPath(paths, item.path),
                            )
                          }
                        >
                          <PinOff size={15} />
                        </Button>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-56">
                    <ContextMenuItem onSelect={() => props.onOpenInNewTab(item.path, item.label)}>
                      <ExternalLink size={15} />
                      <span>Open in New Tab</span>
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() =>
                        removeQuickAccessItem({
                          kind: "builtIn",
                          label: item.label,
                          path: item.path,
                        })
                      }
                    >
                      <X size={15} />
                      <span>Remove from Sidebar</span>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={resetQuickAccessDefaults}>
                      <RefreshCcw size={15} />
                      <span>Reset Defaults</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
            {visiblePinnedPaths.map((path) => (
              <ContextMenu key={`pin:${path}`}>
                <ContextMenuTrigger asChild>
                  <div
                    className={`${sidebarStyles.pinnedRow} ${props.activePath === path ? sidebarStyles.itemSelected : ""}`}
                  >
                    <ExplorerDropTarget
                      id={`sidebar:pinned:${path}`}
                      path={path}
                      springLoad
                      onSpringLoad={() => props.onNavigate(path)}
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        className={sidebarStyles.pinnedButton}
                        onClick={() => props.onNavigate(path)}
                      >
                        <span className={sidebarStyles.itemIcon} aria-hidden="true">
                          <Folder />
                        </span>
                        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                          {pinnedPathLabel(path)}
                        </span>
                      </Button>
                    </ExplorerDropTarget>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={sidebarStyles.pinnedUnpinButton}
                      aria-label={`Unpin ${path} from Quick access`}
                      onClick={() => props.onUnpinPinnedPath(path)}
                    >
                      <PinOff size={15} />
                    </Button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-56">
                  <ContextMenuItem
                    onSelect={() => props.onOpenInNewTab(path, pinnedPathLabel(path))}
                  >
                    <ExternalLink size={15} />
                    <span>Open in New Tab</span>
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() =>
                      removeQuickAccessItem({ kind: "pinned", label: pinnedPathLabel(path), path })
                    }
                  >
                    <X size={15} />
                    <span>Remove from Sidebar</span>
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={resetQuickAccessDefaults}>
                    <RefreshCcw size={15} />
                    <span>Reset Defaults</span>
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        ) : null}
      </section>

      <section className="hidden" aria-hidden="true">
        <SidebarSectionHeader
          title="Collections"
          collapsed={collapsedSections.smartFolders}
          onToggle={() => toggleSection("smartFolders")}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="New collection"
              className={sidebarStyles.sectionActionButton}
              onClick={(event) => {
                event.stopPropagation();
                openSmartFolderDialog();
              }}
            >
              <Plus size={15} />
            </Button>
          }
        />
        {!collapsedSections.smartFolders ? (
          <div className={sidebarStyles.list}>
            {smartFolderError ? (
              <p className={sidebarStyles.errorText}>{smartFolderError}</p>
            ) : null}
            {smartFoldersLoading && savedSearches.length === 0 ? (
              <div className={sidebarStyles.muted}>Loading collections...</div>
            ) : null}
            {!smartFoldersLoading && savedSearches.length === 0 ? (
              <div className={sidebarStyles.muted}>No collections yet</div>
            ) : null}
            {savedSearches.map((search) => {
              const query =
                search.query.trim() ||
                smartFolderQueryFromRules(search.rules, smartFolderMatchMode(search.rules));
              return (
                <div className={`${sidebarStyles.pinnedRow} group/pin`} key={search.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    className={sidebarStyles.pinnedButton}
                    onClick={() => void runSmartFolder(search)}
                  >
                    <span className={sidebarStyles.itemIcon} aria-hidden="true">
                      <Search />
                    </span>
                    <span className="grid min-w-0 gap-[2px]">
                      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                        {search.name}
                      </span>
                      <small className={sidebarStyles.smartMeta}>
                        {query || `${visibleSmartFolderRules(search.rules).length} rules`}
                      </small>
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={sidebarStyles.pinnedUnpinButton}
                    aria-label={`Edit ${search.name}`}
                    onClick={() => openSmartFolderDialog(search)}
                  >
                    <Pencil size={15} />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className={sidebarStyles.section}>
        <SidebarSectionHeader
          title="Remote"
          collapsed={collapsedSections.remote}
          onToggle={() => toggleSection("remote")}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Manage remotes"
                className={sidebarStyles.sectionActionButton}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onManageRemotes();
                }}
              >
                <SlidersHorizontal size={15} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Add remote"
                className={sidebarStyles.sectionActionButton}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onAddRemote();
                }}
              >
                <Plus size={15} />
              </Button>
            </>
          }
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
                  <ExplorerDropTarget
                    key={`${remote.type}:${remote.name}`}
                    id={`sidebar:remote:${remote.name}`}
                    path={path}
                    remoteName={remote.name}
                    springLoad
                    onSpringLoad={() => props.onNavigate(path)}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      className={`${sidebarStyles.itemButton} ${props.activePath === path || props.activePath.startsWith(`${path}/`) ? sidebarStyles.itemSelected : ""}`}
                      onClick={() => props.onNavigate(path)}
                    >
                      <span className={sidebarStyles.remoteIcon}>
                        <AssetIcon src={providerIcon.src} color={providerIcon.color} size={22} />
                      </span>
                      <span>{remote.name}</span>
                    </Button>
                  </ExplorerDropTarget>
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
        />
        {!collapsedSections.devices ? (
          deviceEntries.length === 0 ? (
            <div className={sidebarStyles.muted}>
              {props.devicesLoading ? "Loading devices..." : "No devices connected"}
            </div>
          ) : (
            <div className={sidebarStyles.list}>
              {deviceEntries.map((device) => {
                const usedBytes = Math.max(0, device.totalBytes - device.freeBytes);
                const usedRatio =
                  device.totalBytes > 0
                    ? Math.min(100, Math.round((usedBytes / device.totalBytes) * 100))
                    : 0;
                return (
                  <ContextMenu key={device.id}>
                    <ContextMenuTrigger asChild>
                      <div className={sidebarStyles.deviceRow}>
                        <ExplorerDropTarget
                          id={`sidebar:device:${device.id}`}
                          path={device.mountPath}
                          springLoad
                          onSpringLoad={() => props.onNavigate(device.mountPath)}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            className={`${sidebarStyles.deviceButton} ${pathIsInside(props.activePath, device.mountPath) ? sidebarStyles.itemSelected : ""}`}
                            onClick={() => props.onNavigate(device.mountPath)}
                          >
                            <span className={sidebarStyles.deviceIcon} aria-hidden="true">
                              <HardDrive />
                            </span>
                            <span className={sidebarStyles.deviceCopy}>
                              <strong className={sidebarStyles.deviceName}>{device.name}</strong>
                              <small className={sidebarStyles.deviceMeta}>
                                {deviceCapacityLabel(
                                  usedBytes,
                                  device.totalBytes,
                                  device.fsType || device.mountPath,
                                )}
                              </small>
                              {device.totalBytes > 0 ? (
                                <span className={sidebarStyles.deviceMeter} aria-hidden="true">
                                  <i
                                    className={sidebarStyles.deviceMeterFill}
                                    style={{ width: `${usedRatio}%` }}
                                  />
                                </span>
                              ) : null}
                            </span>
                          </Button>
                        </ExplorerDropTarget>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onSelect={() => unmountDevice(device)}>
                        <Unplug size={15} />
                        <span>Unmount</span>
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          )
        ) : null}
      </section>
      {workspaceDialog ? (
        <WorkspaceDialog
          state={workspaceDialog}
          value={workspaceDraft}
          onChange={setWorkspaceDraft}
          onConfirm={confirmWorkspaceDialog}
          onCancel={() => {
            setWorkspaceDialog(null);
            setWorkspaceDraft("");
          }}
        />
      ) : null}
      {smartFolderDialog ? (
        <SmartFolderDialog
          state={smartFolderDialog}
          error={smartFolderError}
          onSave={saveSmartFolder}
          onDelete={deleteSmartFolder}
          onCancel={() => {
            setSmartFolderDialog(null);
            setSmartFolderError(null);
          }}
        />
      ) : null}
    </aside>
  );
});

function normalizeAndroidLocalName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}
