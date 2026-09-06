import { ExplorerSidebarView } from "./ExplorerSidebarView";
import { hostExplorerSidebarRuntime } from "./explorerSidebar/hostExplorerSidebarRuntime";
import type { ExplorerSidebarProps } from "../model/interfaces/components/ExplorerSidebar";
export { canUnmountMountedDevice } from "./ExplorerSidebarView";
export type {
  AndroidLocalGrantRequest,
  ExplorerSidebarProps,
} from "../model/interfaces/components/ExplorerSidebar";
export type { QuickAccessItem } from "../model/types/components/ExplorerSidebar";
export function ExplorerSidebar(props: ExplorerSidebarProps) {
  return <ExplorerSidebarView {...props} runtime={hostExplorerSidebarRuntime} />;
}
