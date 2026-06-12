import { useEffect, useState } from "react";
import type {
  DeviceCustomizationState,
  SidebarCollapsedState,
} from "../../model/interfaces/components/ExplorerSidebarSupport";
import {
  loadDeviceCustomization,
  loadHiddenQuickAccessPaths,
  loadSidebarCollapsedState,
  saveDeviceCustomization,
  saveHiddenQuickAccessPaths,
  saveSidebarCollapsedState,
} from "../ExplorerSidebarSupport";

/**
 * Everything the sidebar remembers between sessions.
 *
 * Which sections are collapsed, local device labels, and which Quick access
 * rows were hidden. Each is written back on change.
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

  return {
    collapsedSections,
    setCollapsedSections,
    deviceCustomization,
    setDeviceCustomization,
    hiddenQuickAccessPaths,
    setHiddenQuickAccessPaths,
    toggleSection,
  };
}
