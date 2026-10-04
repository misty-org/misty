import { useEffect, useState } from "react";
import {
  type DeviceCustomizationState,
  type SidebarCollapsedState,
  loadDeviceCustomization,
  loadHiddenQuickAccessPaths,
  loadQuickAccessOrder,
  loadSidebarCollapsedState,
  saveDeviceCustomization,
  saveHiddenQuickAccessPaths,
  saveQuickAccessOrder,
  saveSidebarCollapsedState,
} from "@/features/file-ui";

/**
 * Everything the sidebar remembers between sessions.
 *
 * Which sections are collapsed, local device labels, and which Quick access
 * rows were hidden and in what order. Each is written back on change.
 */
export function useSidebarPreferences() {
  const [collapsedSections, setCollapsedSections] =
    useState<SidebarCollapsedState>(loadSidebarCollapsedState);
  const [deviceCustomization, setDeviceCustomization] =
    useState<DeviceCustomizationState>(loadDeviceCustomization);
  const [hiddenQuickAccessPaths, setHiddenQuickAccessPaths] = useState<string[]>(
    loadHiddenQuickAccessPaths,
  );
  const [quickAccessOrder, setQuickAccessOrder] = useState<string[]>(loadQuickAccessOrder);

  useEffect(() => saveDeviceCustomization(deviceCustomization), [deviceCustomization]);
  useEffect(() => saveSidebarCollapsedState(collapsedSections), [collapsedSections]);
  useEffect(() => saveHiddenQuickAccessPaths(hiddenQuickAccessPaths), [hiddenQuickAccessPaths]);
  useEffect(() => saveQuickAccessOrder(quickAccessOrder), [quickAccessOrder]);

  const toggleSection = (section: keyof SidebarCollapsedState) =>
    setCollapsedSections((current) => ({ ...current, [section]: !current[section] }));

  return {
    collapsedSections,
    setCollapsedSections,
    deviceCustomization,
    setDeviceCustomization,
    hiddenQuickAccessPaths,
    setHiddenQuickAccessPaths,
    quickAccessOrder,
    setQuickAccessOrder,
    toggleSection,
  };
}
