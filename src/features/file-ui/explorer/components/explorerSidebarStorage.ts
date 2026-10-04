import type {
  DeviceCustomizationState,
  SidebarCollapsedState,
} from "../model/interfaces/components/ExplorerSidebarSupport";
import { normalizeExplorerPath } from "@/shared/lib/pathNormalization";

/** The sidebar's per-device layout: hidden and ordered Quick access rows, devices, collapsed sections. */
const DEVICE_CUSTOMIZATION_STORAGE_KEY = "misty.explorer.sidebar.devices";
const SIDEBAR_COLLAPSE_STORAGE_KEY = "misty.explorer.sidebar.collapsed";
const QUICK_ACCESS_HIDDEN_STORAGE_KEY = "misty.explorer.sidebar.quickAccessHidden";
const QUICK_ACCESS_ORDER_STORAGE_KEY = "misty.explorer.sidebar.quickAccessOrder";

export function normalizeSidebarPath(path: string): string {
  return normalizeExplorerPath(path);
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

/** Quick access paths in the order the user dragged them; unknown paths keep their place. */
export function loadQuickAccessOrder(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QUICK_ACCESS_ORDER_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveQuickAccessOrder(paths: string[]): void {
  window.localStorage.setItem(QUICK_ACCESS_ORDER_STORAGE_KEY, JSON.stringify(paths));
}

/** Sorts rows by a saved path order, leaving rows the order doesn't mention in place at the end. */
export function orderQuickAccessRows<T extends { path: string }>(rows: T[], order: string[]): T[] {
  const rank = new Map(order.map((path, index) => [normalizeSidebarPath(path), index]));
  return rows
    .map((row, index) => ({ row, index, rank: rank.get(normalizeSidebarPath(row.path)) }))
    .sort(
      (a, b) =>
        (a.rank ?? order.length + a.index) - (b.rank ?? order.length + b.index) ||
        a.index - b.index,
    )
    .map(({ row }) => row);
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
    return {
      quickAccess: false,
      smartFolders: false,
      remote: false,
      devices: false,
    };
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
