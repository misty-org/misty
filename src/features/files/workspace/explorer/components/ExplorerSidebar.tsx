import type { ExplorerSidebarProps } from "../model/interfaces/components/ExplorerSidebar";
import { hostExplorerSidebarRuntime } from "./explorerSidebar/hostExplorerSidebarRuntime";
import { ExplorerSidebarView } from "./ExplorerSidebarView";
export type { ExplorerSidebarProps } from "../model/interfaces/components/ExplorerSidebar";
export type { QuickAccessItem } from "../model/types/components/ExplorerSidebar";
export { canUnmountMountedDevice } from "./ExplorerSidebarView";
export function ExplorerSidebar(props: ExplorerSidebarProps) {
  return <ExplorerSidebarView {...props} runtime={hostExplorerSidebarRuntime} />;
}
