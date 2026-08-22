import { providerIconForType } from "@/shared/assets/icons";
import { devicesUnmount } from "@/features/files/native";
import {
  AssetIcon,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/ui";
import { HardDrive, Pencil, Plus, Search, SlidersHorizontal, Unplug } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { ExplorerDropTarget } from "../drag/ExplorerDropTarget";
import type { ExplorerSidebarProps } from "../model/interfaces/components/ExplorerSidebar";
import { SidebarQuickAccessSection } from "./explorerSidebar/SidebarQuickAccessSection";
import { ConnectedDevicesSidebarSection } from "./explorerSidebar/ConnectedDevicesSidebarSection";
import { useSidebarPreferences } from "./explorerSidebar/useSidebarPreferences";
import { useSidebarQuickAccess } from "./explorerSidebar/useSidebarQuickAccess";
import { useSidebarSmartFolders } from "./explorerSidebar/useSidebarSmartFolders";
import { SmartFolderDialog } from "./ExplorerSidebarDialogs";
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
import type { SidebarDeviceEntry } from "./ExplorerSidebarSupport";
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
  } = useSidebarPreferences();
  const [deviceActionError, setDeviceActionError] = useState<string | null>(null);
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
        <div className={collapsedSections.devices ? "hidden" : "grid gap-3"}>
          <div className={sidebarStyles.deviceGroup}>
            <div className={sidebarStyles.deviceGroupHeader}>
              <span className={sidebarStyles.deviceGroupLabel}>Local</span>
            </div>
            {deviceEntries.length === 0 ? (
              <div className={sidebarStyles.deviceGroupEmpty}>
                {props.devicesLoading ? "Loading drives..." : "No local devices"}
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
                        <ContextMenuItem
                          disabled={!canUnmountMountedDevice(device)}
                          onSelect={() => void unmountMountedDevice(device, setDeviceActionError)}
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
              <p className="m-0 px-2 py-1 text-xs text-cream-bright">{deviceActionError}</p>
            ) : null}
          </div>
          <ConnectedDevicesSidebarSection
            activePath={props.activePath}
            onNavigate={props.onNavigate}
          />
        </div>
      </section>
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
    !window.confirm(
      `Unmount “${device.name}”?\n\nClose any files using this volume before continuing.`,
    )
  ) {
    return;
  }
  setError(null);
  try {
    await devicesUnmount({ volumeId: device.volumeId, mountPath: device.mountPath });
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : String(cause));
  }
}
