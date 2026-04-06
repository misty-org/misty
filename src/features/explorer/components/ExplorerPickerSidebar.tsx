import { Button } from "../../../components/ui/button";
import {
  Briefcase,
  Download,
  FileText,
  Folder,
  HardDrive,
  Home,
  Monitor,
  RefreshCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MountedDevice, ProviderRemote } from "@/services/misty-api/types";
import { providerIconForType } from "@/shared/assets/icons";
import { AssetIcon } from "@/shared/components/AssetIcon";
import { useMinimumSpin } from "@/shared/hooks/useMinimumSpin";
import {
  buildDeviceEntries,
  dedupePinnedPathsForQuickAccess,
  deviceCapacityLabel,
  joinPath,
  loadDeviceCustomization,
  loadHiddenQuickAccessPaths,
  loadSidebarCollapsedState,
  pathIsInside,
  pinnedPathLabel,
  quickAccessPathHidden,
  saveSidebarCollapsedState,
  sidebarStyles,
  SidebarSectionHeader,
} from "./ExplorerSidebarSupport";
import type { SidebarCollapsedState } from "./ExplorerSidebarSupport";

interface ExplorerPickerSidebarProps {
  homePath: string;
  activePath: string;
  mountRoot: string;
  remotes: ProviderRemote[];
  remoteLoading: boolean;
  devices: MountedDevice[];
  devicesLoading: boolean;
  pinnedPaths: string[];
  activeWorkspaceTitle: string;
  onNavigate: (path: string) => void;
  onRefreshDevices: () => void;
}

const quickAccessItems = [
  { label: "Home", icon: Home, suffix: "" },
  { label: "Desktop", icon: Monitor, suffix: "Desktop" },
  { label: "Documents", icon: FileText, suffix: "Documents" },
  { label: "Downloads", icon: Download, suffix: "Downloads" },
] as const;

export function ExplorerPickerSidebar(props: ExplorerPickerSidebarProps) {
  const [collapsedSections, setCollapsedSections] =
    useState<SidebarCollapsedState>(loadSidebarCollapsedState);
  const [devicesRefreshSpinning, startDevicesRefreshSpin] = useMinimumSpin(props.devicesLoading);
  const hiddenQuickAccessPaths = useMemo(loadHiddenQuickAccessPaths, []);
  const quickAccess = useMemo(
    () =>
      quickAccessItems
        .map((item) => ({
          ...item,
          path: item.suffix ? joinPath(props.homePath, item.suffix) : props.homePath,
        }))
        .filter((item) => !quickAccessPathHidden(item.path, hiddenQuickAccessPaths)),
    [hiddenQuickAccessPaths, props.homePath],
  );
  const visiblePinnedPaths = useMemo(
    () =>
      dedupePinnedPathsForQuickAccess(
        props.pinnedPaths,
        quickAccess.map((item) => item.path),
      ),
    [props.pinnedPaths, quickAccess],
  );
  const deviceEntries = useMemo(
    () => buildDeviceEntries(props.devices, loadDeviceCustomization()),
    [props.devices],
  );

  useEffect(() => {
    saveSidebarCollapsedState(collapsedSections);
  }, [collapsedSections]);

  const toggleSection = (section: keyof SidebarCollapsedState) => {
    setCollapsedSections((current) => ({ ...current, [section]: !current[section] }));
  };

  return (
    <aside className={sidebarStyles.root} aria-label="File locations">
      <section className={sidebarStyles.section}>
        <div className={sidebarStyles.workspaceSelect}>
          <Briefcase size={20} />
          <span className={sidebarStyles.workspaceSelectLabel}>{props.activeWorkspaceTitle}</span>
        </div>
      </section>

      <section className={sidebarStyles.section}>
        <SidebarSectionHeader
          title="Quick access"
          collapsed={collapsedSections.quickAccess}
          onToggle={() => toggleSection("quickAccess")}
        />
        {!collapsedSections.quickAccess ? (
          <div className={sidebarStyles.list}>
            {quickAccess.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  className={`${sidebarStyles.pinnedRow} ${props.activePath === item.path ? sidebarStyles.itemSelected : ""}`}
                  key={item.path}
                >
                  <Button
                    className={sidebarStyles.pinnedButton}
                    type="button"
                    onClick={() => props.onNavigate(item.path)}
                  >
                    <Icon size={20} />
                    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                      {item.label}
                    </span>
                  </Button>
                </div>
              );
            })}
            {visiblePinnedPaths.map((path) => (
              <div
                className={`${sidebarStyles.pinnedRow} ${props.activePath === path ? sidebarStyles.itemSelected : ""}`}
                key={path}
              >
                <Button
                  className={sidebarStyles.pinnedButton}
                  type="button"
                  onClick={() => props.onNavigate(path)}
                >
                  <Folder size={20} />
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {pinnedPathLabel(path)}
                  </span>
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className={sidebarStyles.section}>
        <SidebarSectionHeader
          title="Remote"
          collapsed={collapsedSections.remote}
          onToggle={() => toggleSection("remote")}
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
                  <Button
                    type="button"
                    key={`${remote.type}:${remote.name}`}
                    className={`${sidebarStyles.itemButton} ${props.activePath === path || props.activePath.startsWith(`${path}/`) ? sidebarStyles.itemSelected : ""}`}
                    onClick={() => props.onNavigate(path)}
                  >
                    <span className={sidebarStyles.remoteIcon}>
                      <AssetIcon src={providerIcon.src} color={providerIcon.color} size={24} />
                    </span>
                    <span>{remote.name}</span>
                  </Button>
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
          actions={
            <Button
              type="button"
              aria-label="Refresh devices"
              className={`${sidebarStyles.sectionActionButton} ${devicesRefreshSpinning ? sidebarStyles.spinning : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                startDevicesRefreshSpin();
                props.onRefreshDevices();
              }}
            >
              <RefreshCcw size={14} />
            </Button>
          }
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
                  <div className={sidebarStyles.deviceRow} key={device.id}>
                    <Button
                      type="button"
                      className={`${sidebarStyles.deviceButton} ${pathIsInside(props.activePath, device.mountPath) ? sidebarStyles.itemSelected : ""}`}
                      onClick={() => props.onNavigate(device.mountPath)}
                    >
                      <span className={sidebarStyles.deviceIcon} aria-hidden="true">
                        <HardDrive size={20} />
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
                  </div>
                );
              })}
            </div>
          )
        ) : null}
      </section>
    </aside>
  );
}
