import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  Clock3,
  Cloud,
  Download,
  FileText,
  Folder,
  HardDrive,
  Home,
  Monitor,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import type { MountedDevice, ProviderRemote } from "../../../api/types";
import { formatBytes } from "../utils/fileFormat";
import type { ExplorerWorkspaceEntry } from "../state/useExplorerStore";

const DEVICE_CUSTOMIZATION_STORAGE_KEY = "misty.explorer.sidebar.devices";
const SIDEBAR_COLLAPSE_STORAGE_KEY = "misty.explorer.sidebar.collapsed";

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
  const [workspaceDialog, setWorkspaceDialog] = useState<WorkspaceDialogState>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const quickAccess = [
    { label: "Home", icon: Home, path: props.homePath },
    { label: "Desktop", icon: Monitor, path: `${props.homePath}/Desktop` },
    { label: "Documents", icon: FileText, path: `${props.homePath}/Documents` },
    { label: "Downloads", icon: Download, path: `${props.homePath}/Downloads` },
    { label: "Projects", icon: Folder, path: `${props.homePath}/Projects` },
    { label: "Recent", icon: Clock3, path: "misty://recent" },
    { label: "Starred", icon: Star, path: "misty://starred" },
    { label: "Trash", icon: Trash2, path: "misty://trash" },
  ];
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
    if (!deviceMenu && !workspaceMenu) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      if (target && workspaceMenuRef.current?.contains(target)) return;
      setDeviceMenu(null);
      setWorkspaceMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDeviceMenu(null);
        setWorkspaceMenu(null);
      }
    };
    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [deviceMenu, workspaceMenu]);

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
  const openWorkspaceDialog = (kind: "create" | "rename" | "delete") => {
    const active = props.workspaceEntries.find((workspace) => workspace.id === props.activeWorkspaceId)
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
    <aside className="explorer-sidebar">
      <section>
        <h2>Workspace</h2>
        <button
          type="button"
          className="workspace-select"
          aria-haspopup="menu"
          aria-expanded={Boolean(workspaceMenu)}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setWorkspaceMenu({
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)),
              top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 260)),
            });
          }}
        >
          <Briefcase size={18} />
          <span>{props.activeWorkspaceTitle}</span>
          <ChevronDown size={15} />
        </button>
      </section>

      <section>
        <SidebarSectionHeader
          title="Quick access"
          collapsed={collapsedSections.quickAccess}
          onToggle={() => toggleSection("quickAccess")}
        />
        {!collapsedSections.quickAccess ? (
          <div className="sidebar-list">
            {quickAccess.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  className={props.activePath === item.path ? "selected" : ""}
                  onClick={() => props.onNavigate(item.path)}
                >
                  <Icon size={18} />
                  {item.label}
                </button>
              );
            })}
            {props.pinnedPaths.map((path) => (
              <button
                key={`pin:${path}`}
                className={props.activePath === path ? "selected" : ""}
                onClick={() => props.onNavigate(path)}
                title={path}
              >
                <Folder size={18} />
                <span>{path.split("/").filter(Boolean).pop() || path}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <SidebarSectionHeader
          title="Remote"
          collapsed={collapsedSections.remote}
          onToggle={() => toggleSection("remote")}
        />
        {!collapsedSections.remote ? (
          props.remoteLoading && props.remotes.length === 0 ? (
            <div className="sidebar-muted">Loading remote...</div>
          ) : props.remotes.length === 0 ? (
            <div className="sidebar-muted">No remotes connected</div>
          ) : (
            <div className="sidebar-list remote-sidebar-list">
              {props.remotes.map((remote) => {
                const path = joinPath(props.mountRoot, remote.type, remote.name);
                return (
                  <button
                    key={`${remote.type}:${remote.name}`}
                    className={props.activePath === path || props.activePath.startsWith(`${path}/`) ? "selected" : ""}
                    onClick={() => props.onNavigate(path)}
                    title={`${remote.type}: ${remote.name}`}
                  >
                    <Cloud size={18} />
                    <span>{remote.name}</span>
                  </button>
                );
              })}
            </div>
          )
        ) : null}
      </section>

      <section>
        <SidebarSectionHeader
          title="Devices"
          collapsed={collapsedSections.devices}
          onToggle={() => toggleSection("devices")}
          actions={(
            <>
              <button
                type="button"
                title="Refresh devices"
                className={props.devicesLoading ? "spinning" : ""}
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
            <div className="sidebar-muted">{props.devicesLoading ? "Loading devices..." : "No devices connected"}</div>
          ) : (
            <div className="sidebar-list device-list">
              {deviceEntries.map((device) => {
                const usedBytes = Math.max(0, device.totalBytes - device.freeBytes);
                const usedRatio = device.totalBytes > 0 ? Math.min(100, Math.round((usedBytes / device.totalBytes) * 100)) : 0;
                return (
                  <div className="device-row" key={device.id}>
                    <button
                      type="button"
                      className={pathIsInside(props.activePath, device.mountPath) ? "selected" : ""}
                      onClick={() => props.onNavigate(device.mountPath)}
                      title={`${device.name} · ${device.mountPath}`}
                    >
                      <HardDrive size={18} />
                      <span className="device-row-copy">
                        <strong>{device.name}</strong>
                        <small>{deviceCapacityLabel(usedBytes, device.totalBytes, device.fsType || device.mountPath)}</small>
                        {device.totalBytes > 0 ? (
                          <span className="device-meter" aria-hidden="true"><i style={{ width: `${usedRatio}%` }} /></span>
                        ) : null}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="device-row-menu-button"
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
              className="sidebar-device-menu sidebar-workspace-menu"
              style={{ left: workspaceMenu.left, top: workspaceMenu.top }}
              role="menu"
            >
              {(props.workspaceEntries.length > 0 ? props.workspaceEntries : [{ id: props.activeWorkspaceId || "workspace_0", title: props.activeWorkspaceTitle }]).map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={workspace.id === props.activeWorkspaceId}
                  className={workspace.id === props.activeWorkspaceId ? "selected" : ""}
                  onClick={() => {
                    setWorkspaceMenu(null);
                    props.onSelectWorkspace(workspace.id);
                  }}
                >
                  {workspace.title}
                </button>
              ))}
              <div className="context-menu-separator" />
              <button type="button" role="menuitem" onClick={() => openWorkspaceDialog("create")}>New Workspace</button>
              <button type="button" role="menuitem" onClick={() => openWorkspaceDialog("rename")} disabled={!props.activeWorkspaceId}>Rename Workspace</button>
              <button
                type="button"
                role="menuitem"
                onClick={() => openWorkspaceDialog("delete")}
                disabled={!props.activeWorkspaceId || props.workspaceEntries.length <= 1}
              >
                Delete Workspace
              </button>
            </div>,
            document.body,
          )
        : null}
      {deviceMenu
        ? createPortal(
            <div
              ref={menuRef}
              className="sidebar-device-menu"
              style={{ left: deviceMenu.left, top: deviceMenu.top }}
              role="menu"
            >
              <button type="button" role="menuitem" onClick={() => startRename(deviceMenu.device)}>Rename</button>
              <button type="button" role="menuitem" onClick={() => hideDevice(deviceMenu.device)}>Hide</button>
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
    <div className="explorer-dialog-backdrop" role="presentation" onPointerDown={props.onCancel}>
      <form
        className="explorer-dialog sidebar-device-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          props.onConfirm();
        }}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label="Close" onClick={props.onCancel}><X size={16} /></button>
        </header>
        {deleting ? (
          <p>Delete <strong>{props.state.title}</strong>? This removes the saved layout, not any files.</p>
        ) : (
          <label>
            <span>Name</span>
            <input
              autoFocus
              value={props.value}
              onChange={(event) => props.onChange(event.target.value)}
            />
          </label>
        )}
        <div className="explorer-dialog-actions">
          <button type="button" onClick={props.onCancel}>Cancel</button>
          <button type="submit" className={deleting ? "danger" : undefined} disabled={!deleting && !props.value.trim()}>
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
}) {
  const Chevron = props.collapsed ? ChevronRight : ChevronDown;
  return (
    <div className="sidebar-section-title">
      <button type="button" className="sidebar-section-toggle" onClick={props.onToggle} aria-expanded={!props.collapsed}>
        <span>{props.title}</span>
        <Chevron size={14} />
      </button>
      {props.actions ? <div className="sidebar-section-actions">{props.actions}</div> : null}
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
    <div className="explorer-dialog-backdrop" role="presentation" onPointerDown={props.onCancel}>
      <form
        className="explorer-dialog sidebar-device-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          props.onConfirm();
        }}
      >
        <header>
          <h2>{props.title}</h2>
          <button type="button" aria-label="Close" onClick={props.onCancel}><X size={16} /></button>
        </header>
        <label>
          <span>{props.label}</span>
          <input
            autoFocus
            value={props.value}
            placeholder={props.placeholder}
            onChange={(event) => props.onChange(event.target.value)}
          />
        </label>
        <div className="explorer-dialog-actions">
          <button type="button" onClick={props.onCancel}>Cancel</button>
          <button type="submit" disabled={!props.value.trim()}>{props.confirmLabel}</button>
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
}

interface DeviceMenuState {
  device: SidebarDeviceEntry;
  left: number;
  top: number;
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
