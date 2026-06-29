import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Folder,
  HardDrive,
  Home,
  Check,
  Monitor,
  MoreHorizontal,
  Pencil,
  PinOff,
  Plus,
  RefreshCcw,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MouseEvent, ReactNode } from "react";
import type { MountedDevice, ProviderRemote } from "../../../api/types";
import { providerIconForType } from "../../../shared/assets/icons";
import { AssetIcon } from "../../../shared/components/AssetIcon";
import { formatBytes } from "../utils/fileFormat";
import type { ExplorerWorkspaceEntry } from "../state/useExplorerStore";

const DEVICE_CUSTOMIZATION_STORAGE_KEY = "misty.explorer.sidebar.devices";
const SIDEBAR_COLLAPSE_STORAGE_KEY = "misty.explorer.sidebar.collapsed";
const QUICK_ACCESS_HIDDEN_STORAGE_KEY = "misty.explorer.sidebar.quickAccessHidden";

const sidebarStyles = {
  root:
    "h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto border-r border-[#292929] bg-[#141414] px-3.5 py-4 [overscroll-behavior:contain] [scrollbar-gutter:stable] [scrollbar-width:thin] max-[980px]:hidden",
  section: "[&+&]:mt-4",
  sectionTitle: "mb-2.5 flex min-w-0 items-center gap-2",
  sectionToggle:
    "inline-flex min-w-0 items-center gap-1.5 rounded-md border-0 bg-transparent py-[3px] pl-0 pr-1 text-left text-[#d5d5d5] hover:text-[#eeeeee]",
  sectionToggleLabel:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-medium",
  sectionChevron: "flex-none text-[#949494]",
  sectionActions: "ml-auto flex flex-none items-center gap-[3px]",
  sectionActionButton:
    "grid size-6 place-items-center rounded-md border-0 bg-transparent p-0 text-[#949494] hover:bg-[#1f1f1f] hover:text-[#dddddd]",
  spinning: "[&>svg]:animate-spin",
  itemButton:
    "flex w-full items-center gap-2.5 rounded-lg border border-transparent bg-transparent px-[11px] py-2.5 text-left text-[#d5d5d5] hover:bg-[#2b2b2b] hover:text-[#bdbdbd]",
  itemSelected: "bg-[#2b2b2b] text-[#bdbdbd]",
  remoteIcon: "grid size-6 flex-none place-items-center",
  pinnedRow:
    "group/pin flex min-w-0 items-center rounded-lg border border-transparent bg-transparent text-[#d5d5d5] hover:bg-[#2b2b2b] hover:text-[#bdbdbd]",
  pinnedButton:
    "flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent px-[11px] py-2.5 text-left text-inherit",
  pinnedUnpinButton:
    "mr-1 grid size-7 flex-none place-items-center rounded-lg border border-transparent bg-transparent p-0 text-[#8f8f8f] opacity-0 hover:bg-[#3a3a3a] hover:text-[#eeeeee] group-hover/pin:opacity-100 group-focus-within/pin:opacity-100",
  workspaceSelect:
    "flex w-full items-center gap-2.5 rounded-lg border border-[#373737] bg-[#1c1c1c] px-[11px] py-2.5 text-left text-[#d5d5d5]",
  workspaceSelectLabel:
    "ml-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
  list: "grid gap-1",
  muted: "text-[#949494]",
  deviceButton:
    "flex w-full items-start gap-2.5 rounded-lg border border-transparent bg-transparent px-[11px] py-[9px] text-left text-[#d5d5d5] hover:bg-[#2b2b2b] hover:text-[#bdbdbd]",
  deviceRow:
    "grid min-w-0 grid-cols-[minmax(0,1fr)_28px] items-stretch gap-0.5",
  deviceCopy: "grid min-w-0 flex-1 gap-[3px]",
  deviceName:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[#d5d5d5]",
  deviceMeta:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[#949494]",
  deviceMeter:
    "mt-0.5 h-1 overflow-hidden rounded-full bg-[#2f2f2f]",
  deviceMeterFill: "block h-full bg-[#e2e2e2]",
  deviceMenuButton:
    "flex w-7 min-w-7 justify-center rounded-lg border border-transparent bg-transparent p-0 text-[#d5d5d5] opacity-0 hover:bg-[#2b2b2b] hover:text-[#bdbdbd] group-hover/device:opacity-100 group-focus-within/device:opacity-100",
  menu:
    "fixed z-[2147483000] grid w-44 gap-0.5 rounded-[11px] border border-[#323232] bg-[rgba(17,17,17,0.98)] p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.45)]",
  workspaceMenu: "w-60",
  menuButton:
    "flex h-[34px] items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-[#dddddd] hover:bg-[#222222] hover:text-[#eeeeee] disabled:cursor-default disabled:opacity-40",
  menuButtonSelected: "bg-[#292929] text-[#eeeeee]",
  workspaceMenuRow:
    "group/workspace flex h-[34px] min-w-0 items-center gap-1 rounded-lg border-0 bg-transparent text-[#dddddd] hover:bg-[#222222] hover:text-[#eeeeee]",
  workspaceMenuSelect:
    "flex h-full min-w-0 flex-1 items-center gap-2 border-0 bg-transparent px-2.5 text-left text-inherit",
  workspaceMenuActions:
    "mr-1 flex flex-none items-center gap-px opacity-0 group-hover/workspace:opacity-100 group-focus-within/workspace:opacity-100",
  workspaceMenuIconButton:
    "grid size-7 place-items-center rounded-md border-0 bg-transparent p-0 text-[#a9a9a9] hover:bg-[#303030] hover:text-[#eeeeee] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[#a9a9a9]",
  menuButtonIcon: "grid size-[17px] flex-none place-items-center text-[#bdbdbd]",
  menuButtonTruncate: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  menuButtonCheck: "w-[17px] flex-none text-[#d8d8d8]",
  menuSeparator: "mx-1 my-[5px] h-px bg-[#292929]",
  dialogBackdrop: "fixed inset-0 z-[2147483200] grid place-items-center bg-[rgba(6,6,6,0.58)] p-6 backdrop-blur-[3px]",
  dialog: "grid w-[min(380px,100%)] gap-4 rounded-[10px] border border-[#353535] bg-[#141414] p-[18px] shadow-[0_24px_64px_rgba(0,0,0,0.55)]",
  dialogHeader: "flex items-center justify-between gap-3",
  dialogTitle: "m-0 text-[17px] font-semibold",
  dialogClose:
    "grid size-[30px] place-items-center rounded-lg border-0 bg-transparent p-0 text-[#b3b3b3] hover:bg-[#252525] hover:text-[#f7f7f7]",
  dialogLabel: "grid gap-2 text-[#b2b2b2]",
  dialogText: "m-0 leading-normal text-[#b2b2b2]",
  dialogInput: "h-[38px] w-full rounded-[7px] border border-[#3f3f3f] bg-[#0e0e0e] px-[11px] text-[#f0f0f0] outline-none focus:border-[#787878] focus:shadow-[0_0_0_2px_rgba(120,120,120,0.18)]",
  dialogActions: "flex justify-end gap-2",
  dialogActionButton: "h-[34px] min-w-[82px] rounded-[7px]",
  dialogDanger: "border-[#484848] bg-[#313131] text-[#f4f4f4]",
} as const;

interface ExplorerSidebarProps {
  homePath: string;
  activePath: string;
  mountRoot: string;
  remotes: ProviderRemote[];
  remoteLoading: boolean;
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
  const [hiddenQuickAccessPaths, setHiddenQuickAccessPaths] = useState<string[]>(loadHiddenQuickAccessPaths);
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
                className={`${sidebarStyles.sectionActionButton} ${props.devicesLoading ? sidebarStyles.spinning : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
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
                  <div className={`${sidebarStyles.deviceRow} group/device`} key={device.id}>
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
                    <button
                      type="button"
                      className={sidebarStyles.deviceMenuButton}
                      aria-label={`Actions for ${device.name}`}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setDeviceMenu({
                          device,
                          left: Math.max(8, Math.min(rect.right - 176, window.innerWidth - 184)),
                          top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 90)),
                        });
                      }}
                    >
                      <MoreHorizontal size={16} />
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

function WorkspaceDialog(props: {
  state: NonNullable<WorkspaceDialogState>;
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const deleting = props.state.kind === "delete";
  const title = props.state.kind === "create"
    ? "New Workspace"
    : props.state.kind === "rename"
      ? "Rename Workspace"
      : "Delete Workspace";
  return (
    <div className={sidebarStyles.dialogBackdrop} role="presentation" onPointerDown={props.onCancel}>
      <form
        className={sidebarStyles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          props.onConfirm();
        }}
      >
        <header className={sidebarStyles.dialogHeader}>
          <h2 className={sidebarStyles.dialogTitle}>{title}</h2>
          <button className={sidebarStyles.dialogClose} type="button" aria-label="Close" onClick={props.onCancel}><X size={16} /></button>
        </header>
        {deleting ? (
          <p className={sidebarStyles.dialogText}>Delete <strong>{props.state.title}</strong>? This removes the saved layout, not any files.</p>
        ) : (
          <label className={sidebarStyles.dialogLabel}>
            <span>Name</span>
            <input
              className={sidebarStyles.dialogInput}
              autoFocus
              value={props.value}
              onChange={(event) => props.onChange(event.target.value)}
            />
          </label>
        )}
        <div className={sidebarStyles.dialogActions}>
          <button className={sidebarStyles.dialogActionButton} type="button" onClick={props.onCancel}>Cancel</button>
          <button className={`${sidebarStyles.dialogActionButton} ${deleting ? sidebarStyles.dialogDanger : ""}`} type="submit" disabled={!deleting && !props.value.trim()}>
            {deleting ? "Delete" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SidebarSectionHeader(props: {
  title: string;
  collapsed: boolean;
  actions?: ReactNode;
  onToggle: () => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const Chevron = props.collapsed ? ChevronRight : ChevronDown;
  return (
    <div className={sidebarStyles.sectionTitle} onContextMenu={props.onContextMenu}>
      <button type="button" className={sidebarStyles.sectionToggle} onClick={props.onToggle} aria-expanded={!props.collapsed}>
        <span className={sidebarStyles.sectionToggleLabel}>{props.title}</span>
        <Chevron className={sidebarStyles.sectionChevron} size={14} />
      </button>
      {props.actions ? <div className={sidebarStyles.sectionActions}>{props.actions}</div> : null}
    </div>
  );
}

function DeviceDialog(props: {
  title: string;
  label: string;
  placeholder?: string;
  value: string;
  confirmLabel: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={sidebarStyles.dialogBackdrop} role="presentation" onPointerDown={props.onCancel}>
      <form
        className={sidebarStyles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          props.onConfirm();
        }}
      >
        <header className={sidebarStyles.dialogHeader}>
          <h2 className={sidebarStyles.dialogTitle}>{props.title}</h2>
          <button className={sidebarStyles.dialogClose} type="button" aria-label="Close" onClick={props.onCancel}><X size={16} /></button>
        </header>
        <label className={sidebarStyles.dialogLabel}>
          <span>{props.label}</span>
          <input
            className={sidebarStyles.dialogInput}
            autoFocus
            value={props.value}
            placeholder={props.placeholder}
            onChange={(event) => props.onChange(event.target.value)}
          />
        </label>
        <div className={sidebarStyles.dialogActions}>
          <button className={sidebarStyles.dialogActionButton} type="button" onClick={props.onCancel}>Cancel</button>
          <button className={sidebarStyles.dialogActionButton} type="submit" disabled={!props.value.trim()}>{props.confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}

interface DeviceCustomizationState {
  nameOverrides: Record<string, string>;
  hiddenPaths: string[];
  customMountPaths: string[];
}

interface SidebarCollapsedState {
  quickAccess: boolean;
  remote: boolean;
  devices: boolean;
}

interface SidebarDeviceEntry extends MountedDevice {
  custom: boolean;
}

type WorkspaceDialogState =
  | { kind: "create"; workspaceId: ""; title: string }
  | { kind: "rename"; workspaceId: string; title: string }
  | { kind: "delete"; workspaceId: string; title: string }
  | null;

interface WorkspaceMenuState {
  left: number;
  top: number;
  width: number;
}

interface DeviceMenuState {
  device: SidebarDeviceEntry;
  left: number;
  top: number;
}

type QuickAccessMenuItem = {
  kind: "builtIn" | "pinned";
  label: string;
  path: string;
};

interface QuickAccessMenuState {
  item: QuickAccessMenuItem | null;
  mode: "item" | "checklist";
  left: number;
  top: number;
  width: number;
}

function buildDeviceEntries(devices: MountedDevice[], customization: DeviceCustomizationState): SidebarDeviceEntry[] {
  const hidden = new Set(customization.hiddenPaths);
  const seen = new Set<string>();
  const entries: SidebarDeviceEntry[] = [];
  for (const device of devices) {
    if (hidden.has(device.mountPath)) continue;
    seen.add(device.mountPath);
    entries.push({
      ...device,
      name: customization.nameOverrides[device.mountPath] || device.name,
      custom: false,
    });
  }
  for (const path of customization.customMountPaths) {
    if (!path || hidden.has(path) || seen.has(path)) continue;
    entries.push({
      id: `custom:${path}`,
      name: customization.nameOverrides[path] || path.split("/").filter(Boolean).pop() || path,
      mountPath: path,
      fsType: "",
      isRemovable: false,
      totalBytes: 0,
      freeBytes: 0,
      custom: true,
    });
  }
  return entries;
}

function deviceCapacityLabel(usedBytes: number, totalBytes: number, fallback: string): string {
  if (totalBytes === 0) return fallback || "Capacity unavailable";
  return `${formatBytes(usedBytes)} / ${formatBytes(totalBytes)} used`;
}

function pathIsInside(path: string, root: string): boolean {
  const normalizedRoot = root.replace(/\/+$/, "") || "/";
  if (path === normalizedRoot) return true;
  if (normalizedRoot === "/") return false;
  return path.startsWith(`${normalizedRoot}/`);
}

function dedupePinnedPathsForQuickAccess(paths: string[], builtInPaths: string[]): string[] {
  const seen = new Set(builtInPaths.map(normalizeSidebarPath));
  const pinnedPaths: string[] = [];
  for (const path of paths) {
    const normalized = normalizeSidebarPath(path);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    pinnedPaths.push(normalized);
  }
  return pinnedPaths;
}

function normalizeSidebarPath(path: string): string {
  const trimmed = path.trim();
  const normalized = trimmed.replace(/\/+$/, "");
  return normalized || (trimmed === "/" ? "/" : "");
}

function pinnedPathLabel(path: string): string {
  if (path === "misty://recent") return "Recent";
  if (path === "misty://starred") return "Starred";
  if (path === "misty://trash") return "Trash";
  return path.split("/").filter(Boolean).pop() || path;
}

function quickAccessPathHidden(path: string, hiddenPaths: string[]): boolean {
  const normalized = normalizeSidebarPath(path);
  return hiddenPaths.some((candidate) => normalizeSidebarPath(candidate) === normalized);
}

function addHiddenQuickAccessPath(paths: string[], path: string): string[] {
  const normalized = normalizeSidebarPath(path);
  if (!normalized || quickAccessPathHidden(normalized, paths)) return paths;
  return [...paths, normalized];
}

function loadHiddenQuickAccessPaths(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QUICK_ACCESS_HIDDEN_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const hiddenPaths: string[] = [];
    for (const value of parsed) {
      if (typeof value !== "string") continue;
      const normalized = normalizeSidebarPath(value);
      if (!normalized || quickAccessPathHidden(normalized, hiddenPaths)) continue;
      hiddenPaths.push(normalized);
    }
    return hiddenPaths;
  } catch {
    return [];
  }
}

function saveHiddenQuickAccessPaths(paths: string[]): void {
  window.localStorage.setItem(QUICK_ACCESS_HIDDEN_STORAGE_KEY, JSON.stringify(paths));
}

function loadDeviceCustomization(): DeviceCustomizationState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DEVICE_CUSTOMIZATION_STORAGE_KEY) ?? "{}") as Partial<DeviceCustomizationState>;
    return {
      nameOverrides: parsed.nameOverrides && typeof parsed.nameOverrides === "object" && !Array.isArray(parsed.nameOverrides)
        ? Object.fromEntries(Object.entries(parsed.nameOverrides).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
        : {},
      hiddenPaths: Array.isArray(parsed.hiddenPaths) ? uniqueStrings(parsed.hiddenPaths.filter((value): value is string => typeof value === "string")) : [],
      customMountPaths: Array.isArray(parsed.customMountPaths)
        ? uniqueStrings(parsed.customMountPaths.filter((value): value is string => typeof value === "string").map(normalizeDevicePath).filter(Boolean))
        : [],
    };
  } catch {
    return { nameOverrides: {}, hiddenPaths: [], customMountPaths: [] };
  }
}

function saveDeviceCustomization(state: DeviceCustomizationState): void {
  window.localStorage.setItem(DEVICE_CUSTOMIZATION_STORAGE_KEY, JSON.stringify(state));
}

function loadSidebarCollapsedState(): SidebarCollapsedState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) ?? "{}") as Partial<SidebarCollapsedState>;
    return {
      quickAccess: parsed.quickAccess === true,
      remote: parsed.remote === true,
      devices: parsed.devices === true,
    };
  } catch {
    return { quickAccess: false, remote: false, devices: false };
  }
}

function saveSidebarCollapsedState(state: SidebarCollapsedState): void {
  window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, JSON.stringify(state));
}

function normalizeDevicePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length <= 1) return trimmed;
  return trimmed.replace(/\/+$/, "");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function joinPath(...parts: string[]): string {
  const [first, ...rest] = parts;
  return [first.replace(/\/+$/, ""), ...rest.map((part) => part.replace(/^\/+|\/+$/g, ""))].join("/");
}
