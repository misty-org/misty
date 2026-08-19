import type { MountedDevice } from "@/native/ipc";

export const minSidebarWidth = 212;
export const maxSidebarWidth = 380;
export const minPreviewWidth = 240;
export const maxPreviewWidth = 420;
export const transferRefreshPollMs = 12000;
export const devicesChangedEvent = "misty://devices-changed";
export const explorerDuplicateFinderEvent = "misty:explorer-duplicate-finder";
export const explorerCompareWithEvent = "misty:explorer-compare-with";
export const emptyMountedDevices: MountedDevice[] = [];
