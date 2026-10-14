import type { DeviceCustomizationState } from "../model/ExplorerSidebarSupport";
import { normalizeExplorerPath } from "@/shared/lib/pathNormalization";

/** The sidebar's per-device layout: hidden and ordered Quick access rows, devices, collapsed sections. */
const DEVICE_CUSTOMIZATION_STORAGE_KEY = "misty.explorer.sidebar.devices";
const QUICK_ACCESS_HIDDEN_STORAGE_KEY = "misty.explorer.sidebar.quickAccessHidden";
export function normalizeSidebarPath(path: string): string {
  return normalizeExplorerPath(path);
}

export function quickAccessPathHidden(path: string, hiddenPaths: string[]): boolean {
  const normalized = normalizeSidebarPath(path);
  return hiddenPaths.some((candidate) => normalizeSidebarPath(candidate) === normalized);
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
function normalizeDevicePath(path: string): string {
  return normalizeExplorerPath(path);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
