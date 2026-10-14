import type { MountedDevice } from "@/native/ipc";
import {
  cn,
  navigationDisclosureChevronClass,
  navigationDisclosureLabelClass,
  navigationTreeContentInsetClass,
  navigationTreeGroupClass,
  navigationTreeIconClass,
  navigationTreeRowClass,
  navigationTreeSurfaceClass,
} from "@/shared/ui";
import type { DeviceCustomizationState, SidebarDeviceEntry } from "../model/ExplorerSidebarSupport";
import { explorerPathName, joinExplorerPath } from "@/shared/lib/pathNormalization";
import { normalizeSidebarPath } from "./explorerSidebarStorage";
export * from "./explorerSidebarStorage";
export type { DeviceCustomizationState, SidebarDeviceEntry } from "../model/ExplorerSidebarSupport";
export const sidebarStyles = {
  root: cn(
    "misty-transient-scrollbar h-full min-h-0 min-w-0 overflow-x-hidden",
    "overflow-y-auto bg-charcoal-sidebar px-3 py-3 text-cream-muted",
    "[overscroll-behavior:contain]",
  ),
  section: `${navigationTreeGroupClass} [&+&]:mt-3`,
  sectionTitle: "group/section-title flex h-9 min-w-0 items-center gap-1 px-2.5",
  sectionToggle:
    "misty-navigator-row-target flex h-9 min-w-0 flex-1 items-center gap-1 rounded-md px-0 text-[13px] font-semibold text-cream-bright",
  sectionToggleLabel: navigationDisclosureLabelClass,
  sectionChevron: navigationDisclosureChevronClass,
  sectionActions: "ml-auto flex flex-none items-center gap-0",
  sectionActionsReveal:
    "opacity-0 transition-opacity group-hover/section-title:opacity-100 group-focus-within/section-title:opacity-100",
  sectionActionButton: "misty-sidebar-icon-target [&_svg]:!size-3.5",
  spinning: "[&>svg]:animate-spin",
  treeRow: `${navigationTreeRowClass} mr-0 h-auto min-h-[var(--navigation-row-height,32px)]`,
  treeSurface: `${navigationTreeSurfaceClass} h-auto min-h-[var(--navigation-row-height,32px)] gap-0 pl-0 pr-0 group-hover/tree-row:bg-charcoal-card`,
  quickAccessSurface:
    "group-hover/tree-row:bg-charcoal-card group-hover/tree-row:text-cream-bright",
  itemIcon: navigationTreeIconClass,
  itemButton: cn(
    "h-[var(--navigation-row-height,32px)] min-w-0 flex-1 justify-start gap-2.5 rounded-md",
    "border-0 bg-transparent text-left text-[13px] font-medium text-cream-muted shadow-none",
    "hover:bg-charcoal-hover hover:text-cream-bright active:translate-y-0",
    navigationTreeContentInsetClass,
  ),
  itemSelected: "bg-charcoal-hover text-cream-bright",
  remoteIcon: navigationTreeIconClass,
  pinnedRow:
    "group/pin flex min-h-[var(--navigation-row-height,32px)] min-w-0 items-center rounded-md text-cream-muted transition-colors",
  pinnedButton: cn(
    "h-[var(--navigation-row-height,32px)] min-w-0 flex-1 justify-start gap-2.5 border-0",
    "text-left text-[13px] font-medium text-inherit shadow-none !bg-transparent",
    "hover:!bg-transparent hover:text-cream-bright active:translate-y-0",
    "aria-expanded:!bg-transparent",
    navigationTreeContentInsetClass,
  ),
  pinnedUnpinButton: cn(
    "mr-0.5 size-7 flex-none !bg-transparent text-inherit opacity-0",
    "shadow-none hover:!bg-transparent hover:text-cream-bright",
    "hover:opacity-100 focus-visible:opacity-100 active:translate-y-0",
    "aria-expanded:!bg-transparent",
  ),
  workspaceSelect: cn(
    "h-10 w-full justify-start gap-2.5 border border-charcoal-border/55",
    "bg-charcoal-active px-2.5 text-left text-sm font-medium shadow-none",
    "hover:border-charcoal-border/80 hover:bg-charcoal-active [&_svg]:!size-5",
  ),
  workspaceSelectLabel: "ml-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
  list: navigationTreeGroupClass,
  muted: "ml-3 mr-2 px-2.5 py-1 text-[13px] text-cream-muted",
  deviceButton: cn(
    "h-auto min-h-12 min-w-0 flex-1 items-start justify-start gap-2 rounded-md border-0",
    "bg-transparent py-1.5 text-left text-[13px] font-medium text-cream-muted shadow-none",
    "hover:bg-charcoal-hover hover:text-cream-bright active:translate-y-0",
    navigationTreeContentInsetClass,
  ),
  deviceIcon: cn(navigationTreeIconClass, "pt-px"),
  deviceRow: "grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] items-stretch",
  deviceCopy: "grid min-w-0 flex-1 gap-0.5",
  deviceName:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium text-cream-bright",
  deviceMeta:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-cream-muted",
  deviceMeter: "mt-0.5 h-1 overflow-hidden rounded-full bg-charcoal-card",
  deviceMeterFill: "block h-full bg-cream-bright/70",
  deviceGroup: `relative ${navigationTreeGroupClass}`,
  deviceGroupTreeRow: `${navigationTreeRowClass} mr-0`,
  deviceNestedTreeRow: `${navigationTreeRowClass} mr-0 h-auto min-h-[var(--navigation-row-height,32px)]`,
  // Nested groups read as a smaller copy of the section header: bare text and
  // chevron, no row surface in any state. Only the action button gets a chip.
  deviceGroupHeader: "flex h-full min-w-0 flex-1 items-center gap-1",
  deviceGroupToggle: cn(
    "h-[var(--navigation-row-height,32px)] min-w-0 flex-1 justify-start gap-1 rounded-md",
    "text-left text-[13px] font-semibold text-cream-bright shadow-none !bg-transparent",
    "hover:!bg-transparent hover:text-cream-bright focus-visible:!bg-transparent",
    "aria-expanded:!bg-transparent aria-expanded:text-cream-bright active:translate-y-0",
    navigationTreeContentInsetClass,
  ),
  deviceGroupLabel: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  deviceGroupAction: "misty-sidebar-icon-target [&_svg]:!size-3.5",
  deviceGroupEmpty: "ml-3 mr-2 px-2.5 py-1 text-[11px] text-cream-muted",
  errorText: "m-0 text-sm text-cream-bright",
  smartMeta: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-cream-muted/70",
} as const;

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

export function pinnedPathLabel(path: string): string {
  if (path === "misty://recent") return "Recent";
  if (path === "misty://starred") return "Starred";
  if (path === "misty://trash") return "Trash";
  return explorerPathName(path) || path;
}

export function joinPath(...parts: string[]): string {
  const [first, ...rest] = parts;
  return joinExplorerPath(first, ...rest);
}
