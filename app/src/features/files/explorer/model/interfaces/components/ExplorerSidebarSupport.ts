import type { MountedDevice, SavedSearchRule } from "@/native/contracts";

import type { SmartFolderMatchMode } from "../../types/components/ExplorerSidebarSupport";

export interface DeviceCustomizationState {
  nameOverrides: Record<string, string>;
  hiddenPaths: string[];
  customMountPaths: string[];
}

export interface SidebarCollapsedState {
  quickAccess: boolean;
  smartFolders: boolean;
  remote: boolean;
  devices: boolean;
}

export interface SidebarDeviceEntry extends MountedDevice {
  custom: boolean;
}

export interface SmartFolderDraft {
  id: string;
  name: string;
  query: string;
  matchMode: SmartFolderMatchMode;
  rules: SavedSearchRule[];
}
