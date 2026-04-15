import type {
  HomeQuickAccessItem,
  HomeSmartFolderItem,
  HomeTagItem,
  HomeSidebarPanelsProps,
} from "@/models/types/pages/Home/desktop/HomeSidebarPanels";
export type {
  HomeQuickAccessItem,
  HomeSmartFolderItem,
  HomeTagItem,
  HomeSidebarPanelsProps,
} from "@/models/types/pages/Home/desktop/HomeSidebarPanels";
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
import { useId, type ReactNode } from "react";
import type { MountedDevice, ProviderRemote } from "@/models/interfaces/services/misty-api";
import { providerIconForType } from "@/assets/icons";
import { AssetIcon } from "@/ui";
import { joinPath, titleFromPath } from "./recentFileUtils";
import { Button } from "@/ui";
import { Card } from "@/ui";
import { Skeleton } from "@/ui";

const panelClass = "flex h-full min-h-0 min-w-0 flex-col p-4";
const headerClass =
  "flex shrink-0 items-center gap-2.5 border-b border-border/60 pb-3 text-base font-semibold text-foreground";
const rowClass =
  "grid w-full min-w-0 grid-cols-[32px_minmax(0,1fr)] items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-1 text-left transition-colors hover:bg-muted/45 hover:text-accent-foreground";
const iconCellClass = "grid size-8 place-items-center rounded-md bg-muted/60 text-muted-foreground";

export function HomeSidebarPanels(props: HomeSidebarPanelsProps) {
  return (
    <div
      aria-label="Home overview"
      className="grid h-full min-h-0 min-w-0 flex-1 grid-cols-[repeat(3,minmax(0,1fr))] grid-rows-[minmax(0,1fr)] items-stretch gap-4 max-[1180px]:grid-cols-2 max-[1180px]:grid-rows-[minmax(0,2fr)_minmax(0,1fr)] max-[820px]:grid-cols-1 max-[820px]:grid-rows-[repeat(3,minmax(0,1fr))]"
      role="region"
    >
      <div className="grid min-h-0 min-w-0 grid-rows-2 gap-4">
        <Card className="min-h-0 min-w-0 gap-0 !bg-transparent py-0" size="sm">
          <div className="h-full min-h-0 p-4">{props.workspacePanel}</div>
        </Card>
        <DashboardCard icon={<HardDrive className="size-4" />} title="Devices">
          <PanelRows
            emptyMessage="No devices connected."
            loading={props.devicesLoading}
            showEmpty={props.devices.length === 0}
          >
            {props.devices.map((device) => (
              <PanelButton key={device.id} onClick={() => props.onOpenDevice(device)}>
                <span className={iconCellClass}>
                  <HardDrive className="size-4" />
                </span>
                <PanelLabel label={device.name} detail={deviceCapacityLabel(device)} />
              </PanelButton>
            ))}
          </PanelRows>
        </DashboardCard>
      </div>

      <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1.65fr)_minmax(0,0.65fr)] gap-4">
        <DashboardCard icon={<Home className="size-4" />} title="Quick access">
          <PanelRows>
            {props.quickAccessItems.map((item) => (
              <PanelButton key={item.id} onClick={() => props.onOpenQuickAccess(item)}>
                <span className={iconCellClass}>
                  <QuickAccessIcon icon={item.icon} />
                </span>
                <PanelLabel label={item.label} detail={item.path} />
              </PanelButton>
            ))}
          </PanelRows>
        </DashboardCard>
        <DashboardCard icon={<Search className="size-4" />} title="Smart Folders">
          <PanelRows
            emptyMessage="No smart folders yet."
            loading={props.smartFoldersLoading}
            showEmpty={props.smartFolders.length === 0}
          >
            {props.smartFolders.map((smartFolder) => (
              <PanelButton
                key={smartFolder.id}
                onClick={() => props.onOpenSmartFolder(smartFolder)}
              >
                <span className={iconCellClass}>
                  <Search className="size-4" />
                </span>
                <PanelLabel label={smartFolder.name} detail={smartFolder.query || "Search rules"} />
              </PanelButton>
            ))}
          </PanelRows>
        </DashboardCard>
      </div>

      <div className="grid min-h-0 min-w-0 grid-rows-2 gap-4 max-[1180px]:col-span-2 max-[1180px]:grid-cols-2 max-[1180px]:grid-rows-1 max-[820px]:col-span-1 max-[820px]:grid-cols-1 max-[820px]:grid-rows-2">
        <DashboardCard icon={<Server className="size-4" />} title="Remote">
          <PanelRows
            emptyMessage="No remotes connected."
            loading={props.remotesLoading}
            showEmpty={props.remotes.length === 0}
          >
            {props.remotes.map((remote) => {
              const providerIcon = providerIconForType(remote.type);
              return (
                <PanelButton
                  key={`${remote.type}:${remote.name}`}
                  onClick={() => props.onOpenRemote(remote)}
                >
                  <span className={iconCellClass}>
                    <AssetIcon src={providerIcon.src} color={providerIcon.color} size={20} />
                  </span>
                  <PanelLabel label={remote.name} detail={remote.statusLabel || remote.type} />
                </PanelButton>
              );
            })}
          </PanelRows>
        </DashboardCard>
        <DashboardCard icon={<Tag className="size-4" />} title="Tags">
          <PanelRows
            emptyMessage="No tags yet."
            loading={props.tagsLoading}
            showEmpty={props.tags.length === 0}
          >
            {props.tags.map((tag) => (
              <PanelButton key={tag.key} onClick={() => props.onOpenTag(tag)}>
                <span className={iconCellClass}>
                  <Tag className="size-4" />
                </span>
                <PanelLabel
                  label={tag.name}
                  detail={`${tag.count} ${tag.count === 1 ? "item" : "items"}`}
                />
              </PanelButton>
            ))}
          </PanelRows>
        </DashboardCard>
      </div>
    </div>
  );
}

export function buildHomeQuickAccessItems(
  homePath: string,
  pinnedPaths: string[],
  androidLocal = false,
): HomeQuickAccessItem[] {
  const quickItems: HomeQuickAccessItem[] = androidLocal
    ? [
        { id: "quick:local", icon: "folder", label: "Local", path: homePath },
        { id: "quick:recent", icon: "recent", label: "Recent", path: "misty://recent" },
        { id: "quick:starred", icon: "starred", label: "Starred", path: "misty://starred" },
        { id: "quick:trash", icon: "trash", label: "Trash", path: "misty://trash" },
      ]
    : [
        { id: "quick:home", icon: "home", label: "Home", path: homePath },
        {
          id: "quick:desktop",
          icon: "desktop",
          label: "Desktop",
          path: joinPath(homePath, "Desktop"),
        },
        {
          id: "quick:documents",
          icon: "documents",
          label: "Documents",
          path: joinPath(homePath, "Documents"),
        },
        {
          id: "quick:downloads",
          icon: "downloads",
          label: "Downloads",
          path: joinPath(homePath, "Downloads"),
        },
        { id: "quick:recent", icon: "recent", label: "Recent", path: "misty://recent" },
        { id: "quick:starred", icon: "starred", label: "Starred", path: "misty://starred" },
        { id: "quick:trash", icon: "trash", label: "Trash", path: "misty://trash" },
      ];
  const seen = new Set(quickItems.map((item) => normalizePanelPath(item.path)));
  const pinnedItems = pinnedPaths.flatMap((path): HomeQuickAccessItem[] => {
    const normalized = normalizePanelPath(path);
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [
      {
        id: `pinned:${normalized}`,
        icon: "pin",
        label: titleFromPath(normalized),
        path: normalized,
      },
    ];
  });

  return [...quickItems, ...pinnedItems];
}

function DashboardCard({
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
  const titleId = useId();

  return (
    <Card
      aria-labelledby={titleId}
      className="min-h-0 min-w-0 gap-0 !bg-transparent py-0"
      size="sm"
    >
      <section className={`${panelClass} ${className}`}>
        <div className={headerClass}>
          <span className="shrink-0 text-muted-foreground">{icon}</span>
          <h2 className="truncate" id={titleId}>
            {title}
          </h2>
        </div>
        <div className="min-h-0 flex-1 pt-3">{children}</div>
      </section>
    </Card>
  );
}

function PanelButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button
      className={`${rowClass} h-auto justify-start font-normal`}
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  );
}

function PanelLabel({ detail, label }: { detail: string; label: string }) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-sm font-medium text-foreground">{label}</span>
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span>
    </span>
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
      <div aria-busy="true" className="grid shrink-0 gap-1" role="status">
        <span className="sr-only">Loading items</span>
        {[0, 1, 2].map((index) => (
          <Skeleton className="h-11 rounded-md" key={index} />
        ))}
      </div>
    );
  }

  if (showEmpty) {
    return (
      <div className="shrink-0 rounded-md bg-muted/30 px-3 py-3 text-center" role="status">
        <p className="truncate text-xs leading-5 text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="misty-scrollbar grid max-h-80 content-start gap-1 overflow-y-auto pr-1">
      {children}
    </div>
  );
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
  if (trimmed.startsWith("misty://")) return trimmed.replace(/\/+$/, "");
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
