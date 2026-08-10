import { providerIconForType } from "@/shared/assets/icons";
import {
  AssetIcon,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui";
import {
  Briefcase,
  Check,
  ChevronDown,
  HardDrive,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Unplug,
} from "lucide-react";
import { memo, useMemo } from "react";
import { ExplorerDropTarget } from "../drag/ExplorerDropTarget";
import type { ExplorerSidebarProps } from "../model/interfaces/components/ExplorerSidebar";
import { SidebarQuickAccessSection } from "./explorerSidebar/SidebarQuickAccessSection";
import { useSidebarPreferences } from "./explorerSidebar/useSidebarPreferences";
import { useSidebarQuickAccess } from "./explorerSidebar/useSidebarQuickAccess";
import { useSidebarSmartFolders } from "./explorerSidebar/useSidebarSmartFolders";
import { useSidebarWorkspaceMenu } from "./explorerSidebar/useSidebarWorkspaceMenu";
import { SmartFolderDialog, WorkspaceDialog } from "./ExplorerSidebarDialogs";
import {
  buildDeviceEntries,
  deviceCapacityLabel,
  joinPath,
  pathIsInside,
  SidebarSectionHeader,
  sidebarStyles,
  smartFolderMatchMode,
  smartFolderQueryFromRules,
  visibleSmartFolderRules,
} from "./ExplorerSidebarSupport";
export type {
  AndroidLocalGrantRequest,
  ExplorerSidebarProps,
} from "../model/interfaces/components/ExplorerSidebar";
export type { QuickAccessItem } from "../model/types/components/ExplorerSidebar";

export const ExplorerSidebar = memo(function ExplorerSidebar(props: ExplorerSidebarProps) {
  const {
    collapsedSections,
    deviceCustomization,
    hiddenQuickAccessPaths,
    setHiddenQuickAccessPaths,
    toggleSection,
    unmountDevice,
  } = useSidebarPreferences();
  const {
    savedSearches,
    smartFolderDialog,
    setSmartFolderDialog,
    smartFolderError,
    setSmartFolderError,
    smartFoldersLoading,
    openSmartFolderDialog,
    saveSmartFolder,
    deleteSmartFolder,
    runSmartFolder,
  } = useSidebarSmartFolders(props);
  const {
    workspaceMenuOpen,
    setWorkspaceMenuOpen,
    workspaceDialog,
    setWorkspaceDialog,
    workspaceDraft,
    setWorkspaceDraft,
    openWorkspaceDialog,
    confirmWorkspaceDialog,
  } = useSidebarWorkspaceMenu(props);
  const quickAccessModel = useSidebarQuickAccess({
    sidebar: props,
    hiddenQuickAccessPaths,
    setHiddenQuickAccessPaths,
  });
  const deviceEntries = useMemo(
    () => buildDeviceEntries(props.devices, deviceCustomization),
    [deviceCustomization, props.devices],
  );

  return (
    <aside className={sidebarStyles.root} data-explorer-scroll-container>
      <section className={sidebarStyles.section}>
        {props.workspaceLocked ? (
          <div className={sidebarStyles.workspaceSelect} aria-label="File Manager workspace">
            <Briefcase size={20} />
            <span className={sidebarStyles.workspaceSelectLabel}>{props.activeWorkspaceTitle}</span>
          </div>
        ) : (
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
        )}
      </section>

      <SidebarQuickAccessSection
        sidebar={props}
        collapsed={collapsedSections.quickAccess}
        onToggle={() => toggleSection("quickAccess")}
        quick={quickAccessModel}
      />

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
