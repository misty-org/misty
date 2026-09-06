import type { ExplorerSidebarRuntime } from "./explorerSidebar/ExplorerSidebarRuntime";
import { providerIconForType } from "@/shared/assets/icons";
import {
  AssetIcon,
  Button,
  Collapsible,
  CollapsibleContent,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  TreeBranch,
  cn,
} from "@/shared/ui";
import { HardDrive, Pencil, Plus, Search, SlidersHorizontal, Unplug } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { ExplorerSidebarProps } from "../model/interfaces/components/ExplorerSidebar";
import { SidebarQuickAccessSectionView } from "./explorerSidebar/SidebarQuickAccessSectionView";
import { SmartFolderDialog } from "./ExplorerSidebarDialogs";
import {
  buildDeviceEntries,
  deviceCapacityLabel,
  joinPath,
  pathIsInside,
  SidebarDeviceGroupHeader,
  SidebarSectionHeader,
  sidebarStyles,
  smartFolderMatchMode,
  smartFolderQueryFromRules,
  visibleSmartFolderRules,
} from "./ExplorerSidebarSupport";
import type { SidebarDeviceEntry } from "./ExplorerSidebarSupport";
export type {
  AndroidLocalGrantRequest,
  ExplorerSidebarProps,
} from "../model/interfaces/components/ExplorerSidebar";
export type { QuickAccessItem } from "../model/types/components/ExplorerSidebar";

export const ExplorerSidebarView = memo(function ExplorerSidebarView(
  props: ExplorerSidebarProps & { runtime: ExplorerSidebarRuntime },
) {
  const {
    collapsedSections,
    deviceCustomization,
    hiddenQuickAccessPaths,
    setHiddenQuickAccessPaths,
    toggleSection,
  } = props.runtime.useSidebarPreferences();
  const [deviceActionError, setDeviceActionError] = useState<string | null>(null);
  const [localDevicesOpen, setLocalDevicesOpen] = useState(true);
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
  } = props.runtime.useSidebarSmartFolders(props);
  const quickAccessModel = props.runtime.useSidebarQuickAccess({
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
      <SidebarQuickAccessSectionView
        DropTarget={props.runtime.DropTarget}
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
              <props.runtime.Error
                error={smartFolderError}
                scope="files:sidebar:collections"
                title="File collection needs attention"
                target={{ kind: "workspace-tool", tool: "files" }}
              />
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

      <Collapsible className={sidebarStyles.section} open={!collapsedSections.remote}>
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
                <SlidersHorizontal size={14} />
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
                <Plus size={13} />
              </Button>
            </>
          }
        />
        <CollapsibleContent>
          {props.remoteLoading && props.remotes.length === 0 ? (
            <div className={sidebarStyles.muted}>Loading remote...</div>
          ) : props.remotes.length === 0 ? (
            <div className={sidebarStyles.muted}>No remotes connected</div>
          ) : (
            <div className={sidebarStyles.list}>
              {props.remotes.map((remote, index) => {
                const path = joinPath(props.mountRoot, remote.name);
                const providerIcon = providerIconForType(remote.type);
                const selected =
                  props.activePath === path || props.activePath.startsWith(`${path}/`);
                return (
                  <props.runtime.DropTarget
                    key={`${remote.type}:${remote.name}`}
                    id={`sidebar:remote:${remote.name}`}
                    path={path}
                    remoteName={remote.name}
                    springLoad
                    onSpringLoad={() => props.onNavigate(path)}
                  >
                    <div className={sidebarStyles.treeRow}>
                      <TreeBranch
                        className={sidebarStyles.treeBranch}
                        first={index === 0}
                        last={index === props.remotes.length - 1}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className={cn(
                          sidebarStyles.treeSurface,
                          sidebarStyles.itemButton,
                          selected && sidebarStyles.itemSelected,
                        )}
                        onClick={() => props.onNavigate(path)}
                      >
                        <span className={sidebarStyles.remoteIcon}>
                          <AssetIcon src={providerIcon.src} size={24} />
                        </span>
                        <span className="min-w-0 truncate">{remote.name}</span>
                      </Button>
                    </div>
                  </props.runtime.DropTarget>
                );
              })}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible className={sidebarStyles.section} open={!collapsedSections.devices}>
        <SidebarSectionHeader
          title="Devices"
          collapsed={collapsedSections.devices}
          onToggle={() => toggleSection("devices")}
        />
        <CollapsibleContent className="grid gap-1">
          <Collapsible className={sidebarStyles.deviceGroup} open={localDevicesOpen}>
            <SidebarDeviceGroupHeader
              title="Local"
              collapsed={!localDevicesOpen}
              first
              last={false}
              onToggle={() => setLocalDevicesOpen((open) => !open)}
            />
            <CollapsibleContent>
              {deviceEntries.length === 0 ? (
                <div className={sidebarStyles.deviceGroupEmpty}>
                  {props.devicesLoading ? "Loading drives..." : "No local devices"}
                </div>
              ) : (
                <div className={sidebarStyles.list}>
                  {deviceEntries.map((device, index) => {
                    const usedBytes = Math.max(0, device.totalBytes - device.freeBytes);
                    const usedRatio =
                      device.totalBytes > 0
                        ? Math.min(100, Math.round((usedBytes / device.totalBytes) * 100))
                        : 0;
                    return (
                      <ContextMenu key={device.id}>
                        <ContextMenuTrigger asChild>
                          <div className={sidebarStyles.deviceNestedTreeRow}>
                            <TreeBranch
                              className={sidebarStyles.treeBranch}
                              first={index === 0}
                              last={index === deviceEntries.length - 1}
                            />
                            <div className={sidebarStyles.deviceRow}>
                              <props.runtime.DropTarget
                                id={`sidebar:device:${device.id}`}
                                path={device.mountPath}
                                springLoad
                                onSpringLoad={() => props.onNavigate(device.mountPath)}
                              >
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className={cn(
                                    sidebarStyles.treeSurface,
                                    sidebarStyles.deviceButton,
                                    pathIsInside(props.activePath, device.mountPath) &&
                                      sidebarStyles.itemSelected,
                                  )}
                                  onClick={() => props.onNavigate(device.mountPath)}
                                >
                                  <span className={sidebarStyles.deviceIcon} aria-hidden="true">
                                    <HardDrive size={24} strokeWidth={1.9} />
                                  </span>
                                  <span className={sidebarStyles.deviceCopy}>
                                    <strong className={sidebarStyles.deviceName}>
                                      {device.name}
                                    </strong>
                                    <small className={sidebarStyles.deviceMeta}>
                                      {deviceCapacityLabel(
                                        usedBytes,
                                        device.totalBytes,
                                        device.fsType || device.mountPath,
                                      )}
                                    </small>
                                    {device.totalBytes > 0 ? (
                                      <span
                                        className={sidebarStyles.deviceMeter}
                                        aria-hidden="true"
                                      >
                                        <i
                                          className={sidebarStyles.deviceMeterFill}
                                          style={{ width: `${usedRatio}%` }}
                                        />
                                      </span>
                                    ) : null}
                                  </span>
                                </Button>
                              </props.runtime.DropTarget>
                            </div>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem
                            disabled={!canUnmountMountedDevice(device)}
                            onSelect={() =>
                              void unmountMountedDevice(device, setDeviceActionError, props.runtime)
                            }
                          >
                            <Unplug size={15} />
                            <span>
                              {device.isSystem
                                ? "Startup disk — protected"
                                : canUnmountMountedDevice(device)
                                  ? "Unmount…"
                                  : "Unmount unavailable"}
                            </span>
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </div>
              )}
              {deviceActionError ? (
                <props.runtime.Error
                  error={deviceActionError}
                  scope="files:sidebar:device"
                  title="Device action could not be completed"
                  target={{ kind: "workspace-tool", tool: "files" }}
                />
              ) : null}
            </CollapsibleContent>
          </Collapsible>

          <props.runtime.ConnectedDevices
            activePath={props.activePath}
            onNavigate={props.onNavigate}
          />
        </CollapsibleContent>
      </Collapsible>
      {smartFolderDialog ? (
        <SmartFolderDialog
          state={smartFolderDialog}
          error={null}
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

export function canUnmountMountedDevice(device: SidebarDeviceEntry): boolean {
  const macos = /mac/i.test(navigator.platform) || /mac os/i.test(navigator.userAgent);
  return (
    macos &&
    !device.custom &&
    !device.isSystem &&
    device.mountPath !== "/" &&
    (device.isRemovable || device.isExternal || device.isNetwork)
  );
}

async function unmountMountedDevice(
  device: SidebarDeviceEntry,
  setError: (message: string | null) => void,
  runtime: ExplorerSidebarRuntime,
): Promise<void> {
  if (!canUnmountMountedDevice(device)) {
    setError(
      device.isSystem
        ? "The startup disk is protected and cannot be unmounted."
        : "Only removable, external, or network volumes can be unmounted.",
    );
    return;
  }
  if (
    !(await runtime.confirmUnmount(
      `Unmount “${device.name}”?\n\nClose any files using this volume before continuing.`,
    ))
  ) {
    return;
  }
  setError(null);
  try {
    await runtime.unmount(device);
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : String(cause));
  }
}
