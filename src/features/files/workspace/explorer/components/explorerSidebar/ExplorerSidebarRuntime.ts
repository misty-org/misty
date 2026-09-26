import type { ComponentProps, ComponentType } from "react";
import type { ExplorerDropTarget } from "../../drag/ExplorerDropTarget";
import type { ConnectedDevicesSidebarSection } from "./ConnectedDevicesSidebarSection";
import type { PreviewErrorComponent } from "../globalPreview/PreviewRuntime";
import type { SidebarDeviceEntry } from "../ExplorerSidebarSupport";
import type { useSidebarPreferences } from "./useSidebarPreferences";
import type { useSidebarQuickAccess } from "./useSidebarQuickAccess";
import type { useSidebarSmartFolders } from "./useSidebarSmartFolders";
export interface ExplorerSidebarRuntime {
  Error: PreviewErrorComponent;
  DropTarget: ComponentType<ComponentProps<typeof ExplorerDropTarget>>;
  ConnectedDevices: ComponentType<ComponentProps<typeof ConnectedDevicesSidebarSection>>;
  useSidebarPreferences: typeof useSidebarPreferences;
  useSidebarQuickAccess: typeof useSidebarQuickAccess;
  useSidebarSmartFolders: typeof useSidebarSmartFolders;
  confirmUnmount(message: string): Promise<boolean>;
  unmount(device: SidebarDeviceEntry): Promise<unknown>;
}
