import type {
  MountedDevice,
  PluginCommandEntry,
  PluginPanelEntry,
  ProviderRemote,
} from "@/models/interfaces/services/misty-api";

export const minSidebarWidth = 212;
export const maxSidebarWidth = 380;
export const minPreviewWidth = 240;
export const maxPreviewWidth = 420;
export const transferRefreshPollMs = 12000;
export const devicesChangedEvent = "misty://devices-changed";
export const explorerDuplicateFinderEvent = "misty:explorer-duplicate-finder";
export const explorerCompareWithEvent = "misty:explorer-compare-with";

export const emptyPinnedPaths: string[] = [];
export const emptyProviderRemotes: ProviderRemote[] = [];
export const emptyPluginCommands: PluginCommandEntry[] = [];
export const emptyPluginPanels: PluginPanelEntry[] = [];
export const emptyMountedDevices: MountedDevice[] = [];
