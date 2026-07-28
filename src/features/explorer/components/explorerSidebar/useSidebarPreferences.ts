import { useEffect, useState } from "react";
import type {
  DeviceCustomizationState,
  SidebarCollapsedState,
  SidebarDeviceEntry,
} from "@/models/interfaces/features/explorer/components/ExplorerSidebarSupport";
import {
  loadDeviceCustomization,
  loadHiddenQuickAccessPaths,
  loadSidebarCollapsedState,
  saveDeviceCustomization,
  saveHiddenQuickAccessPaths,
  saveSidebarCollapsedState,
  uniqueStrings,
} from "../ExplorerSidebarSupport";

/**
 * Everything the sidebar remembers between sessions.
 *
 * Which sections are collapsed, which devices have been renamed or unmounted,
 * and which Quick access rows were hidden. Each is written back on change.
 */
export function useSidebarPreferences() {
  const [collapsedSections, setCollapsedSections] =
    useState<SidebarCollapsedState>(loadSidebarCollapsedState);
  const [deviceCustomization, setDeviceCustomization] =
    useState<DeviceCustomizationState>(loadDeviceCustomization);
  const [hiddenQuickAccessPaths, setHiddenQuickAccessPaths] = useState<string[]>(
    loadHiddenQuickAccessPaths,
  );

  useEffect(() => saveDeviceCustomization(deviceCustomization), [deviceCustomization]);
  useEffect(() => saveSidebarCollapsedState(collapsedSections), [collapsedSections]);
  useEffect(() => saveHiddenQuickAccessPaths(hiddenQuickAccessPaths), [hiddenQuickAccessPaths]);

  const toggleSection = (section: keyof SidebarCollapsedState) =>
    setCollapsedSections((current) => ({ ...current, [section]: !current[section] }));

  /**
   * Removes a device from the list.
   *
   * A device the user added by hand is forgotten outright; a real mount can
   * only be hidden, because it will reappear from the OS on the next scan.
   */
  const unmountDevice = (device: SidebarDeviceEntry) =>
    setDeviceCustomization((current) => ({
      ...current,
      customMountPaths: device.custom
        ? current.customMountPaths.filter((path) => path !== device.mountPath)
        : current.customMountPaths,
      hiddenPaths: device.custom
        ? current.hiddenPaths.filter((path) => path !== device.mountPath)
        : uniqueStrings([...current.hiddenPaths, device.mountPath]),
      nameOverrides: Object.fromEntries(
        Object.entries(current.nameOverrides).filter(([path]) => path !== device.mountPath),
      ),
    }));

  return {
    collapsedSections,
    setCollapsedSections,
    deviceCustomization,
    setDeviceCustomization,
    hiddenQuickAccessPaths,
    setHiddenQuickAccessPaths,
    toggleSection,
    unmountDevice,
  };
}
