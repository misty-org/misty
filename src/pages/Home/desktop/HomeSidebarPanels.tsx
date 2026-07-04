import {
  Clock3,
  Download,
  FileText,
  Folder,
  HardDrive,
  Home,
  Monitor,
  Pin,
  Search,
  Server,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import type { MountedDevice, ProviderRemote } from "../../../api/types";
import { joinPath, titleFromPath } from "./recentFileUtils";

export type HomeQuickAccessItem = {
  id: string;
  label: string;
  path: string;
  icon: "desktop" | "documents" | "downloads" | "folder" | "home" | "pin" | "recent" | "starred" | "trash";
};

export type HomeSmartFolderItem = {
  id: string;
  name: string;
  query: string;
};

export type HomeTagItem = {
  key: string;
  name: string;
  count: number;
};

type HomeSidebarPanelsProps = {
  devices: MountedDevice[];
  devicesLoading: boolean;
  onOpenDevice: (device: MountedDevice) => void;
  onOpenQuickAccess: (item: HomeQuickAccessItem) => void;
  onOpenRemote: (remote: ProviderRemote) => void;
  onOpenSmartFolder: (smartFolder: HomeSmartFolderItem) => void;
  onOpenTag: (tag: HomeTagItem) => void;
  quickAccessItems: HomeQuickAccessItem[];
  remotes: ProviderRemote[];
  remotesLoading: boolean;
  smartFolders: HomeSmartFolderItem[];
  smartFoldersLoading: boolean;
  tags: HomeTagItem[];
  tagsLoading: boolean;
};

const panelClass =
  "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#090c10]/78 p-3 shadow-xl shadow-black/20";
const headerClass =
  "mb-2 flex shrink-0 items-center gap-2 border-b border-white/[0.06] pb-2 text-sm font-semibold text-text";
const rowClass =
  "grid w-full min-w-0 grid-cols-[26px_minmax(0,1fr)] items-center gap-2 rounded-xl border border-transparent bg-transparent px-2 py-1.5 text-left transition hover:border-white/[0.08] hover:bg-white/[0.045]";
const iconCellClass =
  "grid h-6 w-6 place-items-center rounded-lg bg-white/[0.045] text-text-muted";

export function HomeSidebarPanels(props: HomeSidebarPanelsProps) {
  return (
    <>
      <SidebarPanel
        className="xl:col-span-4 xl:col-start-5 xl:row-span-4 xl:row-start-1"
        icon={<Home className="h-4 w-4" />}
        title="Quick access"
      >
        <PanelRows>
          {props.quickAccessItems.map((item) => (
            <button
              className={rowClass}
              key={item.id}
              onClick={() => props.onOpenQuickAccess(item)}
              title={item.path}
              type="button"
            >
              <span className={iconCellClass}>
                <QuickAccessIcon icon={item.icon} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-text">
                  {item.label}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                  {item.path}
                </span>
              </span>
            </button>
          ))}
        </PanelRows>
      </SidebarPanel>

      <SidebarPanel
        className="xl:col-span-4 xl:col-start-5 xl:row-span-2 xl:row-start-5"
        icon={<Search className="h-4 w-4" />}
        title="Smart Folders"
      >
        <PanelRows
          emptyMessage="No smart folders yet."
          loading={props.smartFoldersLoading}
          showEmpty={props.smartFolders.length === 0}
        >
          {props.smartFolders.map((smartFolder) => (
            <button
              className={rowClass}
              key={smartFolder.id}
              onClick={() => props.onOpenSmartFolder(smartFolder)}
              title={smartFolder.query || smartFolder.name}
              type="button"
            >
              <span className={iconCellClass}>
                <Search className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-text">
                  {smartFolder.name}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                  {smartFolder.query || "Search rules"}
                </span>
              </span>
            </button>
          ))}
        </PanelRows>
      </SidebarPanel>

      <SidebarPanel
        className="xl:col-span-4 xl:col-start-9 xl:row-span-3 xl:row-start-4"
        icon={<Tag className="h-4 w-4" />}
        title="Tags"
      >
        <PanelRows
          emptyMessage="No tags yet."
          loading={props.tagsLoading}
          showEmpty={props.tags.length === 0}
        >
          {props.tags.map((tag) => (
            <button
              className={rowClass}
              key={tag.key}
              onClick={() => props.onOpenTag(tag)}
              type="button"
            >
              <span className={iconCellClass}>
                <Tag className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-text">
                  {tag.name}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                  {tag.count} {tag.count === 1 ? "item" : "items"}
                </span>
              </span>
            </button>
          ))}
        </PanelRows>
      </SidebarPanel>

      <SidebarPanel
        className="xl:col-span-4 xl:col-start-9 xl:row-span-3 xl:row-start-1"
        icon={<Server className="h-4 w-4" />}
        title="Remote"
      >
        <PanelRows
          emptyMessage="No remotes connected."
          loading={props.remotesLoading}
          showEmpty={props.remotes.length === 0}
        >
          {props.remotes.map((remote) => (
            <button
              className={rowClass}
              key={`${remote.type}:${remote.name}`}
              onClick={() => props.onOpenRemote(remote)}
              title={`${remote.type}: ${remote.name}`}
              type="button"
            >
              <span className={iconCellClass}>
                <Server className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-text">
                  {remote.name}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                  {remote.statusLabel || remote.type}
                </span>
              </span>
            </button>
          ))}
        </PanelRows>
      </SidebarPanel>

      <SidebarPanel
        className="xl:col-span-4 xl:col-start-1 xl:row-span-3 xl:row-start-4"
        icon={<HardDrive className="h-4 w-4" />}
        title="Devices"
      >
        <PanelRows
          emptyMessage="No devices connected."
          loading={props.devicesLoading}
          showEmpty={props.devices.length === 0}
        >
          {props.devices.map((device) => (
            <button
              className={rowClass}
              key={device.id}
              onClick={() => props.onOpenDevice(device)}
              title={device.mountPath}
              type="button"
            >
              <span className={iconCellClass}>
                <HardDrive className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-text">
                  {device.name}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                  {deviceCapacityLabel(device)}
                </span>
              </span>
            </button>
          ))}
        </PanelRows>
      </SidebarPanel>
    </>
  );
}

export function buildHomeQuickAccessItems(
  homePath: string,
  pinnedPaths: string[],
): HomeQuickAccessItem[] {
  const quickItems: HomeQuickAccessItem[] = [
    { id: "quick:home", icon: "home", label: "Home", path: homePath },
    { id: "quick:desktop", icon: "desktop", label: "Desktop", path: joinPath(homePath, "Desktop") },
    { id: "quick:documents", icon: "documents", label: "Documents", path: joinPath(homePath, "Documents") },
    { id: "quick:downloads", icon: "downloads", label: "Downloads", path: joinPath(homePath, "Downloads") },
    { id: "quick:recent", icon: "recent", label: "Recent", path: "misty://recent" },
    { id: "quick:starred", icon: "starred", label: "Starred", path: "misty://starred" },
    { id: "quick:trash", icon: "trash", label: "Trash", path: "misty://trash" },
  ];
  const seen = new Set(quickItems.map((item) => normalizePanelPath(item.path)));
  const pinnedItems = pinnedPaths.flatMap((path): HomeQuickAccessItem[] => {
    const normalized = normalizePanelPath(path);
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [{
      id: `pinned:${normalized}`,
      icon: "pin",
      label: titleFromPath(normalized),
      path: normalized,
    }];
  });

  return [...quickItems, ...pinnedItems];
}

function SidebarPanel({
  children,
  className = "",
  icon,
  title,
}: {
  children: ReactNode;
  className?: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className={`${panelClass} ${className}`}>
      <div className={headerClass}>
        <span className="shrink-0 text-text-muted">{icon}</span>
        <span className="truncate">{title}</span>
      </div>
      {children}
    </section>
  );
}

function PanelRows({
  children,
  emptyMessage,
  loading = false,
  showEmpty = false,
}: {
  children: ReactNode;
  emptyMessage?: string;
  loading?: boolean;
  showEmpty?: boolean;
}) {
  if (loading) {
    return (
      <div className="grid shrink-0 gap-1">
        {[0, 1, 2].map((index) => (
          <div className="misty-skeleton h-11 rounded-lg" key={index} />
        ))}
      </div>
    );
  }

  if (showEmpty) {
    return (
      <div className="shrink-0 rounded-xl border border-dashed border-white/[0.08] px-3 py-3 text-center">
        <p className="truncate text-xs leading-5 text-text-muted">{emptyMessage}</p>
      </div>
    );
  }

  return <div className="misty-scrollbar grid min-h-0 flex-1 content-start gap-1 overflow-x-hidden overflow-y-scroll pr-1">{children}</div>;
}

function QuickAccessIcon({ icon }: { icon: HomeQuickAccessItem["icon"] }) {
  const className = "h-4 w-4";
  switch (icon) {
    case "desktop":
      return <Monitor className={className} />;
    case "documents":
      return <FileText className={className} />;
    case "downloads":
      return <Download className={className} />;
    case "home":
      return <Home className={className} />;
    case "pin":
      return <Pin className={className} />;
    case "recent":
      return <Clock3 className={className} />;
    case "starred":
      return <Star className={className} />;
    case "trash":
      return <Trash2 className={className} />;
    default:
      return <Folder className={className} />;
  }
}

function normalizePanelPath(path: string): string {
  const trimmed = path.trim();
  const normalized = trimmed.replace(/\/+$/, "");
  return normalized || (trimmed === "/" ? "/" : "");
}

function deviceCapacityLabel(device: MountedDevice): string {
  if (device.totalBytes <= 0) return device.fsType || device.mountPath;
  const usedBytes = Math.max(0, device.totalBytes - device.freeBytes);
  return `${formatBytes(usedBytes)} / ${formatBytes(device.totalBytes)} used`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}
