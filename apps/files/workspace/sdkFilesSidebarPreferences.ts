import { create } from "zustand";
import type { SetStateAction } from "react";
import type { MistyAppSDK } from "@misty/sdk";
import type {
  DeviceCustomizationState,
  SidebarCollapsedState,
} from "./explorer/model/interfaces/components/ExplorerSidebarSupport";
import type { ExplorerSidebarRuntime } from "./explorer/components/explorerSidebar/ExplorerSidebarRuntime";

interface Preferences {
  collapsedSections: SidebarCollapsedState;
  deviceCustomization: DeviceCustomizationState;
  hiddenQuickAccessPaths: string[];
}
const key = "files.sidebar.v1";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
function restore(value: unknown): Preferences {
  const saved = object(value),
    collapsed = object(saved.collapsedSections),
    device = object(saved.deviceCustomization);
  return {
    collapsedSections: {
      quickAccess: collapsed.quickAccess === true,
      smartFolders: collapsed.smartFolders === true,
      remote: collapsed.remote === true,
      devices: collapsed.devices === true,
    },
    deviceCustomization: {
      nameOverrides: Object.fromEntries(
        Object.entries(object(device.nameOverrides)).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
      hiddenPaths: strings(device.hiddenPaths),
      customMountPaths: strings(device.customMountPaths),
    },
    hiddenQuickAccessPaths: strings(saved.hiddenQuickAccessPaths),
  };
}

/** Keep the existing sidebar preferences in the SDK's app/account/Space store. */
export async function createSdkFilesSidebarPreferences(
  misty: Pick<MistyAppSDK, "storage">,
  signal: AbortSignal,
  report: (error: unknown) => void,
) {
  if (signal.aborted) throw new Error("This Files view is closed.");
  let saved: unknown;
  try {
    saved = await misty.storage.local.get(key);
  } catch (error) {
    if (!signal.aborted) report(error);
  }
  if (signal.aborted) throw new Error("This Files view is closed.");
  const store = create<Preferences>(() => restore(saved));
  let closed = false;
  let pending = Promise.resolve();
  function update<K extends keyof Preferences>(field: K, next: SetStateAction<Preferences[K]>) {
    if (closed || signal.aborted) throw new Error("This Files view is closed.");
    const previous = store.getState()[field];
    const value =
      typeof next === "function"
        ? (next as (previous: Preferences[K]) => Preferences[K])(previous)
        : next;
    if (value === previous) return;
    store.setState({ [field]: value } as Pick<Preferences, K>);
    const snapshot = store.getState();
    pending = pending
      .then(() => {
        if (!signal.aborted) return misty.storage.local.set(key, snapshot);
      })
      .catch((error) => {
        if (!closed && !signal.aborted) report(error);
      });
  }
  const close = () => {
    closed = true;
    signal.removeEventListener("abort", close);
    return pending;
  };
  signal.addEventListener("abort", close, { once: true });
  const useSidebarPreferences: ExplorerSidebarRuntime["useSidebarPreferences"] = () => {
    const state = store();
    return {
      ...state,
      setCollapsedSections: (next) => update("collapsedSections", next),
      setDeviceCustomization: (next) => update("deviceCustomization", next),
      setHiddenQuickAccessPaths: (next) => update("hiddenQuickAccessPaths", next),
      toggleSection: (section) =>
        update("collapsedSections", (current) => ({ ...current, [section]: !current[section] })),
    };
  };
  return { useSidebarPreferences, close, flush: () => pending };
}
