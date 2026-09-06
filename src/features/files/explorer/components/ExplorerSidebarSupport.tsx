import type { MountedDevice, SavedSearch, SavedSearchRule } from "@/native/contracts";
import {
  Button,
  TreeBranch,
  cn,
  navigationDisclosureChevronClass,
  navigationDisclosureLabelClass,
  navigationTreeBranchClass,
  navigationTreeContentInsetClass,
  navigationTreeGroupClass,
  navigationTreeIconClass,
  navigationTreeRowClass,
  navigationTreeSurfaceClass,
} from "@/shared/ui";
import { ChevronRight } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type {
  DeviceCustomizationState,
  SidebarCollapsedState,
  SidebarDeviceEntry,
} from "../model/interfaces/components/ExplorerSidebarSupport";
import type {
  SmartFolderDialogState,
  SmartFolderMatchMode,
} from "../model/types/components/ExplorerSidebarSupport";
import { formatBytes } from "../utils/fileFormat";
import {
  explorerPathName,
  joinExplorerPath,
  normalizeExplorerPath,
} from "@/shared/lib/pathNormalization";
export type {
  DeviceCustomizationState,
  SidebarCollapsedState,
  SidebarDeviceEntry,
  SmartFolderDraft,
} from "../model/interfaces/components/ExplorerSidebarSupport";
export type {
  QuickAccessMenuItem,
  SmartFolderDialogState,
  SmartFolderMatchMode,
} from "../model/types/components/ExplorerSidebarSupport";

const DEVICE_CUSTOMIZATION_STORAGE_KEY = "misty.explorer.sidebar.devices";
const SIDEBAR_COLLAPSE_STORAGE_KEY = "misty.explorer.sidebar.collapsed";
const QUICK_ACCESS_HIDDEN_STORAGE_KEY = "misty.explorer.sidebar.quickAccessHidden";

export const sidebarStyles = {
  root: "misty-transient-scrollbar h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto bg-charcoal-sidebar px-3 py-3 text-cream-muted [overscroll-behavior:contain]",
  section: `${navigationTreeGroupClass} [&+&]:mt-3`,
  sectionTitle: "group/section-title flex h-9 min-w-0 items-center gap-1 px-2.5",
  sectionToggle:
    "misty-navigator-row-target h-9 min-w-0 flex-1 justify-start gap-1 rounded-md px-0 text-left text-[13px] font-semibold text-cream-bright shadow-none !bg-transparent hover:!bg-transparent hover:text-cream-bright focus-visible:!bg-transparent aria-expanded:!bg-transparent aria-expanded:text-cream-bright",
  sectionToggleLabel: navigationDisclosureLabelClass,
  sectionChevron: navigationDisclosureChevronClass,
  sectionActions: "ml-auto flex flex-none items-center gap-0",
  sectionActionsReveal:
    "opacity-0 transition-opacity group-hover/section-title:opacity-100 group-focus-within/section-title:opacity-100",
  sectionActionButton:
    "misty-sidebar-icon-target size-6 text-cream-muted shadow-none hover:bg-charcoal-card hover:text-cream-bright [&_svg]:!size-3.5",
  spinning: "[&>svg]:animate-spin",
  treeRow: `${navigationTreeRowClass} mr-0 h-auto min-h-7`,
  treeBranch: navigationTreeBranchClass,
  treeSurface: `${navigationTreeSurfaceClass} h-auto min-h-7 gap-0 pl-0 pr-0 group-hover/tree-row:bg-charcoal-card`,
  quickAccessSurface:
    "group-hover/tree-row:bg-charcoal-card group-hover/tree-row:text-cream-bright",
  itemIcon: navigationTreeIconClass,
  itemButton: `h-7 min-w-0 flex-1 justify-start gap-2 rounded-md border-0 bg-transparent text-left text-[13px] font-medium text-cream-muted shadow-none hover:bg-charcoal-card hover:text-cream-bright active:translate-y-0 ${navigationTreeContentInsetClass}`,
  itemSelected: "bg-charcoal-active text-cream-bright",
  remoteIcon: navigationTreeIconClass,
  pinnedRow:
    "group/pin flex min-h-7 min-w-0 items-center rounded-md text-cream-muted transition-colors",
  pinnedButton: `h-7 min-w-0 flex-1 justify-start gap-2 border-0 text-left text-[13px] font-medium text-inherit shadow-none !bg-transparent hover:!bg-transparent hover:text-cream-bright active:translate-y-0 aria-expanded:!bg-transparent ${navigationTreeContentInsetClass}`,
  pinnedUnpinButton:
    "mr-0.5 size-7 flex-none !bg-transparent text-inherit opacity-0 shadow-none hover:!bg-transparent hover:text-cream-bright hover:opacity-100 focus-visible:opacity-100 active:translate-y-0 aria-expanded:!bg-transparent",
  workspaceSelect:
    "h-10 w-full justify-start gap-2.5 border border-charcoal-border/55 bg-charcoal-active px-2.5 text-left text-sm font-medium shadow-none hover:border-charcoal-border/80 hover:bg-charcoal-active [&_svg]:!size-5",
  workspaceSelectLabel: "ml-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
  list: navigationTreeGroupClass,
  muted: "ml-6 mr-2 px-2 py-1 text-[13px] text-cream-muted",
  deviceButton: `h-auto min-h-12 min-w-0 flex-1 items-start justify-start gap-2 rounded-md border-0 bg-transparent py-1.5 text-left text-[13px] font-medium text-cream-muted shadow-none hover:bg-charcoal-card hover:text-cream-bright active:translate-y-0 ${navigationTreeContentInsetClass}`,
  deviceIcon: cn(navigationTreeIconClass, "pt-px"),
  deviceRow: "grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] items-stretch",
  deviceCopy: "grid min-w-0 flex-1 gap-0.5",
  deviceName:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium text-cream-bright",
  deviceMeta:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-cream-muted",
  deviceMeter: "mt-0.5 h-1 overflow-hidden rounded-full bg-charcoal-card",
  deviceMeterFill: "block h-full bg-cream-bright/70",
  deviceGroup: navigationTreeGroupClass,
  deviceGroupTreeRow: `${navigationTreeRowClass} mr-0 h-7`,
  deviceNestedTreeRow: `${navigationTreeRowClass} ml-12 mr-0 h-auto min-h-7`,
  deviceGroupHeader: cn(
    navigationTreeSurfaceClass,
    "h-7 grid-cols-[minmax(0,1fr)_auto] gap-1 pl-0 pr-0 group-hover/tree-row:bg-charcoal-card",
  ),
  deviceGroupToggle: `h-7 min-w-0 flex-1 justify-start gap-1 bg-transparent text-left text-[13px] font-medium text-cream-muted shadow-none hover:bg-transparent hover:text-cream-bright active:translate-y-0 ${navigationTreeContentInsetClass}`,
  deviceGroupLabel:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium",
  deviceGroupAction:
    "misty-sidebar-icon-target size-6 text-cream-muted shadow-none hover:bg-charcoal-card hover:text-cream-bright [&_svg]:!size-3.5",
  deviceGroupEmpty: "ml-12 mr-2 px-2 py-1 text-[11px] text-cream-muted",
  errorText: "m-0 text-sm text-cream-bright",
  smartMeta: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-cream-muted/70",
} as const;

export { DeviceDialog, SmartFolderDialog } from "./ExplorerSidebarDialogs";
export { smartFolderQueryFromRules } from "./ExplorerSidebarQuery";

export function SidebarSectionHeader(props: {
  title: string;
  collapsed: boolean;
  actions?: ReactNode;
  onToggle: () => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
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
        <span className={sidebarStyles.sectionToggleLabel}>
          <span className="min-w-0 truncate">{props.title}</span>
          <ChevronRight
            className={cn(
              sidebarStyles.sectionChevron,
              "size-4 transition-transform duration-150 motion-reduce:transition-none",
              !props.collapsed && "rotate-90",
            )}
            strokeWidth={2}
            aria-hidden="true"
            data-chevron-placement="inline"
          />
        </span>
      </Button>
      {props.actions ? (
        <div className={`${sidebarStyles.sectionActions} ${sidebarStyles.sectionActionsReveal}`}>
          {props.actions}
        </div>
      ) : null}
    </div>
  );
}

export function SidebarDeviceGroupHeader(props: {
  title: string;
  collapsed: boolean;
  first: boolean;
  last: boolean;
  actions?: ReactNode;
  onToggle: () => void;
}) {
  return (
    <div className={sidebarStyles.deviceGroupTreeRow}>
      <TreeBranch className={sidebarStyles.treeBranch} first={props.first} last={props.last} />
      <div className={sidebarStyles.deviceGroupHeader}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={sidebarStyles.deviceGroupToggle}
          aria-expanded={!props.collapsed}
          onClick={props.onToggle}
        >
          <span className={sidebarStyles.deviceGroupLabel}>{props.title}</span>
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
              !props.collapsed && "rotate-90",
            )}
            strokeWidth={2}
            aria-hidden="true"
          />
        </Button>
        {props.actions}
      </div>
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
  const seen = new Set<string>();
  const entries: SidebarDeviceEntry[] = [];
  for (const device of devices) {
    seen.add(device.mountPath);
    entries.push({
      ...device,
      name: customization.nameOverrides[device.mountPath] || device.name,
      custom: false,
    });
  }
  for (const path of customization.customMountPaths) {
    if (!path || seen.has(path)) continue;
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
      // Older builds mislabeled hiding a sidebar row as "Unmount". Never
      // carry those hidden paths forward: mounted devices must reflect the OS.
      hiddenPaths: [],
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
