import type {
  WorkspaceDialogState,
  SmartFolderMatchMode,
  SmartFolderDialogState,
  QuickAccessMenuItem,
} from "@/models/types/features/explorer/components/ExplorerSidebarSupport";
export type {
  WorkspaceDialogState,
  SmartFolderMatchMode,
  SmartFolderDialogState,
  QuickAccessMenuItem,
} from "@/models/types/features/explorer/components/ExplorerSidebarSupport";
import type {
  DeviceCustomizationState,
  SidebarCollapsedState,
  SidebarDeviceEntry,
  SmartFolderDraft,
} from "@/models/interfaces/features/explorer/components/ExplorerSidebarSupport";
export type {
  DeviceCustomizationState,
  SidebarCollapsedState,
  SidebarDeviceEntry,
  SmartFolderDraft,
} from "@/models/interfaces/features/explorer/components/ExplorerSidebarSupport";
import { Button } from "@/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type {
  MountedDevice,
  SavedSearch,
  SavedSearchRule,
} from "@/models/interfaces/services/misty-api";
import { formatBytes } from "../utils/fileFormat";
import {
  explorerPathName,
  joinExplorerPath,
  normalizeExplorerPath,
} from "../utils/pathNormalization";

const DEVICE_CUSTOMIZATION_STORAGE_KEY = "misty.explorer.sidebar.devices";
const SIDEBAR_COLLAPSE_STORAGE_KEY = "misty.explorer.sidebar.collapsed";
const QUICK_ACCESS_HIDDEN_STORAGE_KEY = "misty.explorer.sidebar.quickAccessHidden";

export const sidebarStyles = {
  root: "misty-transient-scrollbar h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto bg-[var(--misty-files-panel-bg,transparent)] px-4 py-4 text-sidebar-foreground [overscroll-behavior:contain] max-[980px]:hidden",
  section: "[&+&]:mt-5",
  sectionTitle: "group/section-title mb-2 flex min-w-0 items-center gap-2",
  sectionToggle:
    "min-w-0 justify-start gap-2 px-0 text-left text-muted-foreground shadow-none !bg-transparent hover:!bg-transparent hover:text-foreground focus-visible:!bg-transparent aria-expanded:!bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:!bg-transparent aria-expanded:hover:text-foreground",
  sectionToggleLabel:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold",
  sectionChevron: "flex-none text-muted-foreground",
  sectionActions: "ml-auto flex flex-none items-center gap-[3px]",
  sectionActionsReveal:
    "opacity-0 transition-opacity group-hover/section-title:opacity-100 group-focus-within/section-title:opacity-100",
  sectionActionButton: "size-8 text-muted-foreground shadow-none",
  spinning: "[&>svg]:animate-spin",
  itemIcon: "grid size-[34px] flex-none place-items-center [&_svg]:size-[31px]",
  itemButton:
    "h-10 w-full justify-start gap-2 px-2 text-left text-sm font-medium text-muted-foreground shadow-none hover:!bg-[linear-gradient(90deg,color-mix(in_srgb,var(--sidebar-accent)_84%,transparent),color-mix(in_srgb,var(--sidebar-accent)_64%,transparent))] hover:text-foreground",
  itemSelected:
    "!bg-[linear-gradient(90deg,color-mix(in_srgb,var(--sidebar-accent)_96%,transparent),color-mix(in_srgb,var(--sidebar-accent)_72%,transparent))] text-accent-foreground hover:!bg-[linear-gradient(90deg,color-mix(in_srgb,var(--sidebar-accent)_96%,transparent),color-mix(in_srgb,var(--sidebar-accent)_72%,transparent))] hover:text-accent-foreground",
  remoteIcon: "grid size-[34px] flex-none place-items-center",
  pinnedRow:
    "group/pin flex min-h-10 min-w-0 items-center rounded-md text-muted-foreground transition-colors hover:bg-[linear-gradient(90deg,color-mix(in_srgb,var(--sidebar-accent)_84%,transparent),color-mix(in_srgb,var(--sidebar-accent)_64%,transparent))] hover:text-foreground",
  pinnedButton:
    "h-10 min-w-0 flex-1 justify-start gap-2 px-2 text-left text-sm font-medium text-inherit shadow-none !bg-transparent hover:!bg-transparent hover:text-inherit active:translate-y-0 aria-expanded:!bg-transparent",
  pinnedUnpinButton:
    "mr-1 size-8 flex-none !bg-transparent text-inherit opacity-0 shadow-none hover:!bg-transparent hover:opacity-100 focus-visible:opacity-100 active:translate-y-0 aria-expanded:!bg-transparent",
  workspaceSelect:
    "h-10 w-full justify-start gap-2 border border-sidebar-border/55 bg-sidebar-accent/20 px-2 text-left text-sm font-medium shadow-none hover:border-sidebar-border/80 hover:bg-sidebar-accent/28 [&_svg]:size-4",
  workspaceSelectLabel: "ml-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
  list: "grid gap-1",
  muted: "px-3 py-1 text-sm text-muted-foreground",
  deviceButton:
    "h-auto w-full items-start justify-start gap-2 px-2 py-2 text-left text-sm font-medium text-muted-foreground shadow-none hover:!bg-[linear-gradient(90deg,color-mix(in_srgb,var(--sidebar-accent)_84%,transparent),color-mix(in_srgb,var(--sidebar-accent)_64%,transparent))]",
  deviceIcon: "grid size-[34px] flex-none place-items-center pt-[1px] [&_svg]:size-[31px]",
  deviceRow: "grid min-w-0 grid-cols-[minmax(0,1fr)] items-stretch",
  deviceCopy: "grid min-w-0 flex-1 gap-[3px]",
  deviceName:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-foreground",
  deviceMeta:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground/70",
  deviceMeter: "mt-0.5 h-1 overflow-hidden rounded-full bg-muted",
  deviceMeterFill: "block h-full bg-muted-foreground",
  errorText: "m-0 text-sm text-destructive",
  smartMeta:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground/70",
} as const;

export { DeviceDialog, SmartFolderDialog, WorkspaceDialog } from "./ExplorerSidebarDialogs";
export { smartFolderQueryFromRules } from "./ExplorerSidebarQuery";

export function SidebarSectionHeader(props: {
  title: string;
  collapsed: boolean;
  actions?: ReactNode;
  onToggle: () => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const Chevron = props.collapsed ? ChevronRight : ChevronDown;
  return (
    <div className={sidebarStyles.sectionTitle} onContextMenu={props.onContextMenu}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={sidebarStyles.sectionToggle}
        onClick={props.onToggle}
        aria-expanded={!props.collapsed}
      >
        <span className={sidebarStyles.sectionToggleLabel}>{props.title}</span>
        <Chevron className={sidebarStyles.sectionChevron} size={14} />
      </Button>
      {props.actions ? (
        <div className={`${sidebarStyles.sectionActions} ${sidebarStyles.sectionActionsReveal}`}>
          {props.actions}
        </div>
      ) : null}
    </div>
  );
}

const smartFolderModeField = "__match";

function defaultSmartFolderRule(): SavedSearchRule {
  return { field: "text", operator: "contains", value: "" };
}

export function createSmartFolderDialogState(search?: SavedSearch): SmartFolderDialogState {
  return {
    draft: {
      id: search?.id ?? "",
      name: search?.name ?? "New Collection",
      query: search?.query ?? "",
      matchMode: search ? smartFolderMatchMode(search.rules) : "all",
      rules: search ? visibleSmartFolderRules(search.rules) : [defaultSmartFolderRule()],
    },
  };
}

export function smartFolderMatchMode(rules: SavedSearchRule[]): SmartFolderMatchMode {
  return rules.find((rule) => rule.field === smartFolderModeField)?.value === "any" ? "any" : "all";
}

export function visibleSmartFolderRules(rules: SavedSearchRule[]): SavedSearchRule[] {
  const visible = rules.filter((rule) => rule.field !== smartFolderModeField);
  return visible.length > 0 ? visible : [defaultSmartFolderRule()];
}

export function smartFolderRulesWithMode(
  rules: SavedSearchRule[],
  matchMode: SmartFolderMatchMode,
): SavedSearchRule[] {
  const cleaned = visibleSmartFolderRules(rules)
    .map((rule) => ({
      field: rule.field.trim(),
      operator: rule.operator.trim() || "contains",
      value: rule.value.trim(),
    }))
    .filter((rule) => rule.field && rule.value);
  return [{ field: smartFolderModeField, operator: "mode", value: matchMode }, ...cleaned];
}

export function sortSavedSearches(searches: SavedSearch[]): SavedSearch[] {
  return [...searches].sort(
    (left, right) => right.updatedAtMs - left.updatedAtMs || left.name.localeCompare(right.name),
  );
}

export function smartFolderId(): string {
  return `smart_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildDeviceEntries(
  devices: MountedDevice[],
  customization: DeviceCustomizationState,
): SidebarDeviceEntry[] {
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
      volumeId: `custom:${path}`,
      name: customization.nameOverrides[path] || path.split("/").filter(Boolean).pop() || path,
      mountPath: path,
      fsType: "",
      isRemovable: false,
      isSystem: false,
      isExternal: true,
      isNetwork: false,
      writable: true,
      totalBytes: 0,
      freeBytes: 0,
      custom: true,
    });
  }
  return entries;
}

export function deviceCapacityLabel(
  usedBytes: number,
  totalBytes: number,
  fallback: string,
): string {
  if (totalBytes === 0) return fallback || "Capacity unavailable";
  return `${formatBytes(usedBytes)} / ${formatBytes(totalBytes)} used`;
}

export function pathIsInside(path: string, root: string): boolean {
  const normalizedRoot = root.replace(/\/+$/, "") || "/";
  if (path === normalizedRoot) return true;
  if (normalizedRoot === "/") return false;
  return path.startsWith(`${normalizedRoot}/`);
}

export function dedupePinnedPathsForQuickAccess(paths: string[], builtInPaths: string[]): string[] {
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

export function normalizeSidebarPath(path: string): string {
  return normalizeExplorerPath(path);
}

export function pinnedPathLabel(path: string): string {
  if (path === "misty://recent") return "Recent";
  if (path === "misty://starred") return "Starred";
  if (path === "misty://trash") return "Trash";
  return explorerPathName(path) || path;
}

export function quickAccessPathHidden(path: string, hiddenPaths: string[]): boolean {
  const normalized = normalizeSidebarPath(path);
  return hiddenPaths.some((candidate) => normalizeSidebarPath(candidate) === normalized);
}

export function addHiddenQuickAccessPath(paths: string[], path: string): string[] {
  const normalized = normalizeSidebarPath(path);
  if (!normalized || quickAccessPathHidden(normalized, paths)) return paths;
  return [...paths, normalized];
}

export function loadHiddenQuickAccessPaths(): string[] {
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

export function saveHiddenQuickAccessPaths(paths: string[]): void {
  window.localStorage.setItem(QUICK_ACCESS_HIDDEN_STORAGE_KEY, JSON.stringify(paths));
}

export function loadDeviceCustomization(): DeviceCustomizationState {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(DEVICE_CUSTOMIZATION_STORAGE_KEY) ?? "{}",
    ) as Partial<DeviceCustomizationState>;
    return {
      nameOverrides:
        parsed.nameOverrides &&
        typeof parsed.nameOverrides === "object" &&
        !Array.isArray(parsed.nameOverrides)
          ? Object.fromEntries(
              Object.entries(parsed.nameOverrides).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            )
          : {},
      hiddenPaths: Array.isArray(parsed.hiddenPaths)
        ? uniqueStrings(
            parsed.hiddenPaths.filter((value): value is string => typeof value === "string"),
          )
        : [],
      customMountPaths: Array.isArray(parsed.customMountPaths)
        ? uniqueStrings(
            parsed.customMountPaths
              .filter((value): value is string => typeof value === "string")
              .map(normalizeDevicePath)
              .filter(Boolean),
          )
        : [],
    };
  } catch {
    return { nameOverrides: {}, hiddenPaths: [], customMountPaths: [] };
  }
}

export function saveDeviceCustomization(state: DeviceCustomizationState): void {
  window.localStorage.setItem(DEVICE_CUSTOMIZATION_STORAGE_KEY, JSON.stringify(state));
}

export function loadSidebarCollapsedState(): SidebarCollapsedState {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) ?? "{}",
    ) as Partial<SidebarCollapsedState>;
    return {
      quickAccess: parsed.quickAccess === true,
      smartFolders: parsed.smartFolders === true,
      remote: parsed.remote === true,
      devices: parsed.devices === true,
    };
  } catch {
    return { quickAccess: false, smartFolders: false, remote: false, devices: false };
  }
}

export function saveSidebarCollapsedState(state: SidebarCollapsedState): void {
  window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, JSON.stringify(state));
}

export function normalizeDevicePath(path: string): string {
  return normalizeExplorerPath(path);
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function joinPath(...parts: string[]): string {
  const [first, ...rest] = parts;
  return joinExplorerPath(first, ...rest);
}
