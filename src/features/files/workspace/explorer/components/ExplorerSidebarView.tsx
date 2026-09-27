import {
  Button,
  cn,
  Collapsible,
  CollapsibleContent,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  IconButton,
} from "@/shared/ui";
import { HardDrive, Pencil, Plus, Search, Unplug } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { ExplorerSidebarProps } from "../model/interfaces/components/ExplorerSidebar";
import type { ExplorerSidebarRuntime } from "./explorerSidebar/ExplorerSidebarRuntime";
import { SidebarQuickAccessSectionView } from "./explorerSidebar/SidebarQuickAccessSectionView";
import { SmartFolderDialog } from "./ExplorerSidebarDialogs";
import type { SidebarDeviceEntry } from "./ExplorerSidebarSupport";
import {
  buildDeviceEntries,
  deviceCapacityLabel,
  pathIsInside,
  SidebarDeviceGroup,
  SidebarSectionHeader,
  sidebarStyles,
  smartFolderMatchMode,
  smartFolderQueryFromRules,
  visibleSmartFolderRules,
} from "./ExplorerSidebarSupport";
export type { ExplorerSidebarProps } from "../model/interfaces/components/ExplorerSidebar";
export type { QuickAccessItem } from "../model/types/components/ExplorerSidebar";
export const ExplorerSidebarView = memo(function ExplorerSidebarView(
  props: ExplorerSidebarProps & {
    runtime: ExplorerSidebarRuntime;
  },
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
            <IconButton
              size="xs"
              tooltip={false}
              label="New collection"
              className={sidebarStyles.sectionActionButton}
              onClick={(event) => {
                event.stopPropagation();
                openSmartFolderDialog();
              }}
            >
              <Plus size={15} />
            </IconButton>
          }
        />
        {!collapsedSections.smartFolders ? (
          <div className={sidebarStyles.list}>
            {smartFolderError ? (
              <props.runtime.Error
                error={smartFolderError}
                scope="files:sidebar:collections"
                title="File collection needs attention"
                target={{
                  kind: "workspace-tool",
                  tool: "files",
                }}
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

      <Collapsible className={sidebarStyles.section} open={!collapsedSections.devices}>
        <SidebarSectionHeader
          title="Devices"
          collapsed={collapsedSections.devices}
          onToggle={() => toggleSection("devices")}
        />
        <CollapsibleContent className={sidebarStyles.list}>
          <SidebarDeviceGroup
            title="Local"
            open={localDevicesOpen}
            onOpenChange={setLocalDevicesOpen}
          >
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
                        <div className={sidebarStyles.deviceNestedTreeRow}>
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
                                    <span className={sidebarStyles.deviceMeter} aria-hidden="true">
                                      <i
                                        className={sidebarStyles.deviceMeterFill}
                                        style={{
                                          width: `${usedRatio}%`,
                                        }}
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
                target={{
                  kind: "workspace-tool",
                  tool: "files",
                }}
              />
            ) : null}
          </SidebarDeviceGroup>

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
