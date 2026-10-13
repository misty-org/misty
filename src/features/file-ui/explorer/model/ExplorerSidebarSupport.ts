import type { MountedDevice, SavedSearchRule } from "@/native/ipc";

export type SmartFolderMatchMode = "all" | "any";

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

export type SmartFolderDialogState = { draft: SmartFolderDraft } | null;
