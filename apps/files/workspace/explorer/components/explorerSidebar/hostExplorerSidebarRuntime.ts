import { SystemErrorActivity } from "@/features/activity";
import { devicesUnmount } from "@/features/files/native";
import { ExplorerDropTarget } from "../../drag/ExplorerDropTarget";
import { ConnectedDevicesSidebarSection } from "./ConnectedDevicesSidebarSection";
import { useSidebarPreferences } from "./useSidebarPreferences";
import { useSidebarQuickAccess } from "./useSidebarQuickAccess";
import { useSidebarSmartFolders } from "./useSidebarSmartFolders";
import type { ExplorerSidebarRuntime } from "./ExplorerSidebarRuntime";
export const hostExplorerSidebarRuntime: ExplorerSidebarRuntime = {
  Error: SystemErrorActivity,
  DropTarget: ExplorerDropTarget,
  ConnectedDevices: ConnectedDevicesSidebarSection,
  useSidebarPreferences,
  useSidebarQuickAccess,
  useSidebarSmartFolders,
  confirmUnmount: async (message) => window.confirm(message),
  unmount: (device) => devicesUnmount({ volumeId: device.volumeId, mountPath: device.mountPath }),
};
