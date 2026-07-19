import { Button } from "../../../components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type { ExplorerLibrarySnapshot, MountedDevice, SavedSearch, SavedSearchRule } from "../../../api/types";
import { formatBytes } from "../utils/fileFormat";

const DEVICE_CUSTOMIZATION_STORAGE_KEY = "misty.explorer.sidebar.devices";
const SIDEBAR_COLLAPSE_STORAGE_KEY = "misty.explorer.sidebar.collapsed";
const QUICK_ACCESS_HIDDEN_STORAGE_KEY = "misty.explorer.sidebar.quickAccessHidden";

export const sidebarStyles = {
  root:
    "misty-transient-scrollbar h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto !bg-transparent px-3.5 py-4 [overscroll-behavior:contain] max-[980px]:hidden",
  section: "[&+&]:mt-4",
  sectionTitle: "mb-2.5 flex min-w-0 items-center gap-2",
  sectionToggle:
    "inline-flex min-w-0 items-center gap-1.5 rounded-md border-0 bg-transparent py-[3px] pl-0 pr-1 text-left text-[var(--misty-text)] hover:text-[var(--misty-primary-hover)]",
  sectionToggleLabel:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-medium",
  sectionChevron: "flex-none text-[var(--misty-text-subtle)]",
  sectionActions: "ml-auto flex flex-none items-center gap-[3px]",
  sectionActionButton:
    "grid size-6 place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--misty-text-subtle)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] hover:text-[var(--misty-text)]",
  spinning: "[&>svg]:animate-spin",
  itemButton:
    "relative flex w-full items-center gap-2.5 rounded-lg border border-transparent bg-transparent px-[11px] py-2.5 text-left text-[var(--misty-text-muted)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] hover:text-[var(--misty-text)]",
  itemSelected: "bg-[var(--misty-neutral-selected-bg,var(--misty-sidebar-selected))] text-[var(--misty-text)]",
  remoteIcon: "grid size-6 flex-none place-items-center",
  pinnedRow:
    "group/pin flex min-w-0 items-center rounded-lg border border-transparent bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] hover:text-[var(--misty-text)]",
  pinnedButton:
    "flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent px-[11px] py-2.5 text-left text-inherit",
  pinnedUnpinButton:
    "mr-1 grid size-7 flex-none place-items-center rounded-lg border border-transparent bg-transparent p-0 text-[var(--misty-text-subtle)] opacity-0 hover:bg-[var(--misty-neutral-selected-bg,var(--misty-surface-selected))] hover:text-[var(--misty-text)] group-hover/pin:opacity-100 group-focus-within/pin:opacity-100",
  workspaceSelect:
    "flex w-full items-center gap-2.5 rounded-lg border border-transparent bg-transparent px-[11px] py-2.5 text-left text-[var(--misty-text)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))]",
  workspaceSelectLabel:
    "ml-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
  list: "grid gap-1",
  muted: "text-[var(--misty-text-subtle)]",
  deviceButton:
    "flex w-full items-start gap-2.5 rounded-lg border border-transparent bg-transparent px-[11px] py-[9px] text-left text-[var(--misty-text-muted)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] hover:text-[var(--misty-text)]",
  deviceIcon:
    "grid size-6 flex-none place-items-center self-center",
  deviceRow:
    "grid min-w-0 grid-cols-[minmax(0,1fr)] items-stretch",
  deviceCopy: "grid min-w-0 flex-1 gap-[3px]",
  deviceName:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[var(--misty-text)]",
  deviceMeta:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--misty-text-subtle)]",
  deviceMeter:
    "mt-0.5 h-1 overflow-hidden rounded-full bg-[var(--misty-surface-3)]",
  deviceMeterFill: "block h-full bg-[var(--misty-text-muted)]",
  deviceMenuButton:
    "flex w-7 min-w-7 justify-center rounded-lg border border-transparent bg-transparent p-0 text-[var(--misty-text-muted)] opacity-0 hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] hover:text-[var(--misty-text)] group-hover/device:opacity-100 group-focus-within/device:opacity-100",
  menu:
    "fixed z-[var(--misty-layer-menu)] grid w-44 gap-0.5 rounded-md bg-popover/90 p-1 shadow-md ring-1 ring-foreground/10 backdrop-blur-xl",
  workspaceMenu: "w-60",
  menuButton:
    "flex h-8 items-center gap-2 rounded-sm border-0 bg-transparent px-2 text-left text-foreground hover:bg-foreground/10 hover:text-foreground disabled:cursor-default disabled:opacity-40",
  menuButtonSelected: "bg-[var(--misty-neutral-selected-bg,var(--misty-surface-selected))] text-[var(--misty-text)]",
  workspaceMenuRow:
    "group/workspace flex h-8 min-w-0 items-center gap-1 rounded-sm border-0 bg-transparent text-foreground hover:bg-foreground/10 hover:text-foreground",
  workspaceMenuSelect:
    "flex h-full min-w-0 flex-1 items-center gap-2 border-0 bg-transparent px-2.5 text-left text-inherit",
  workspaceMenuActions:
    "mr-1 flex flex-none items-center gap-px opacity-0 group-hover/workspace:opacity-100 group-focus-within/workspace:opacity-100",
  workspaceMenuIconButton:
    "grid size-7 place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--misty-text-muted)] hover:bg-[var(--misty-neutral-selected-bg,var(--misty-surface-selected))] hover:text-[var(--misty-text)] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--misty-text-muted)]",
  menuButtonIcon: "grid size-[17px] flex-none place-items-center text-[var(--misty-text-muted)]",
  menuButtonTruncate: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  menuButtonCheck: "w-[17px] flex-none text-[var(--misty-text)]",
  menuSeparator: "mx-1 my-[5px] h-px bg-[var(--misty-divider-subtle)]",
  errorText: "m-0 text-sm text-destructive",
  smartMeta: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--misty-text-subtle)]",
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
      <Button type="button" className={sidebarStyles.sectionToggle} onClick={props.onToggle} aria-expanded={!props.collapsed}>
        <span className={sidebarStyles.sectionToggleLabel}>{props.title}</span>
        <Chevron className={sidebarStyles.sectionChevron} size={14} />
      </Button>
      {props.actions ? <div className={sidebarStyles.sectionActions}>{props.actions}</div> : null}
    </div>
  );
}

export interface DeviceCustomizationState {
  nameOverrides: Record<string, string>;
  hiddenPaths: string[];
  customMountPaths: string[];
}

export interface SidebarCollapsedState {
  quickAccess: boolean;
  smartFolders: boolean;
  tags: boolean;
  remote: boolean;
  devices: boolean;
}

export interface LibraryTagView {
  key: string;
  name: string;
  count: number;
}

export interface SidebarDeviceEntry extends MountedDevice {
  custom: boolean;
}

export type WorkspaceDialogState =
  | { kind: "create"; workspaceId: ""; title: string }
  | { kind: "rename"; workspaceId: string; title: string }
  | { kind: "delete"; workspaceId: string; title: string }
  | null;

export type SmartFolderMatchMode = "all" | "any";

export interface SmartFolderDraft {
  id: string;
  name: string;
  query: string;
  matchMode: SmartFolderMatchMode;
  rules: SavedSearchRule[];
}

export type SmartFolderDialogState = { draft: SmartFolderDraft } | null;

export interface WorkspaceMenuState {
  left: number;
  top: number;
  width: number;
}

export interface DeviceMenuState {
  device: SidebarDeviceEntry;
  left: number;
  top: number;
}

export type QuickAccessMenuItem = {
  kind: "builtIn" | "pinned";
  label: string;
  path: string;
};

export interface QuickAccessMenuState {
  item: QuickAccessMenuItem | null;
  mode: "item" | "checklist";
  left: number;
  top: number;
  width: number;
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

export function smartFolderRulesWithMode(rules: SavedSearchRule[], matchMode: SmartFolderMatchMode): SavedSearchRule[] {
  const cleaned = visibleSmartFolderRules(rules)
    .map((rule) => ({
      field: rule.field.trim(),
      operator: rule.operator.trim() || "contains",
      value: rule.value.trim(),
    }))
    .filter((rule) => rule.field && rule.value);
  return [
    { field: smartFolderModeField, operator: "mode", value: matchMode },
    ...cleaned,
  ];
}

export function sortSavedSearches(searches: SavedSearch[]): SavedSearch[] {
  return [...searches].sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.name.localeCompare(right.name));
}

export function smartFolderId(): string {
  return `smart_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildDeviceEntries(devices: MountedDevice[], customization: DeviceCustomizationState): SidebarDeviceEntry[] {
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

export function deviceCapacityLabel(usedBytes: number, totalBytes: number, fallback: string): string {
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
  const trimmed = path.trim();
  const normalized = trimmed.replace(/\/+$/, "");
  return normalized || (trimmed === "/" ? "/" : "");
}

export function pinnedPathLabel(path: string): string {
  if (path === "misty://recent") return "Recent";
  if (path === "misty://starred") return "Starred";
  if (path === "misty://trash") return "Trash";
  return path.split("/").filter(Boolean).pop() || path;
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

export function saveDeviceCustomization(state: DeviceCustomizationState): void {
  window.localStorage.setItem(DEVICE_CUSTOMIZATION_STORAGE_KEY, JSON.stringify(state));
}

export function loadSidebarCollapsedState(): SidebarCollapsedState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) ?? "{}") as Partial<SidebarCollapsedState>;
    return {
      quickAccess: parsed.quickAccess === true,
      smartFolders: parsed.smartFolders === true,
      tags: parsed.tags === true,
      remote: parsed.remote === true,
      devices: parsed.devices === true,
    };
  } catch {
    return { quickAccess: false, smartFolders: false, tags: false, remote: false, devices: false };
  }
}

export function saveSidebarCollapsedState(state: SidebarCollapsedState): void {
  window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, JSON.stringify(state));
}

export function normalizeDevicePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length <= 1) return trimmed;
  return trimmed.replace(/\/+$/, "");
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildLibraryTagViews(library: ExplorerLibrarySnapshot | null): LibraryTagView[] {
  if (!library) return [];
  const tags = new Map<string, LibraryTagView>();
  const seenByPath = new Map<string, Set<string>>();
  for (const item of [...library.recentFiles, ...library.starredFiles]) {
    const pathKey = normalizeSidebarPath(item.path);
    if (!pathKey) continue;
    const pathTags = seenByPath.get(pathKey) ?? new Set<string>();
    for (const rawTag of item.tags ?? []) {
      const name = rawTag.trim();
      const key = name.toLowerCase();
      if (!name || pathTags.has(key)) continue;
      pathTags.add(key);
      const current = tags.get(key);
      tags.set(key, {
        key,
        name: current?.name ?? name,
        count: (current?.count ?? 0) + 1,
      });
    }
    seenByPath.set(pathKey, pathTags);
  }
  return [...tags.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

export function quoteTagQueryValue(value: string): string {
  const trimmed = value.replace(/"/g, "").trim();
  return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
}

export function joinPath(...parts: string[]): string {
  const [first, ...rest] = parts;
  return [first.replace(/\/+$/, ""), ...rest.map((part) => part.replace(/^\/+|\/+$/g, ""))].join("/");
}
