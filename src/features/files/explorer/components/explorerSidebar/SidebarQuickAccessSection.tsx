import { ExplorerDropTarget } from "../../drag/ExplorerDropTarget";
import type { ComponentProps } from "react";
import { SidebarQuickAccessSectionView } from "./SidebarQuickAccessSectionView";
export function SidebarQuickAccessSection(
  props: Omit<ComponentProps<typeof SidebarQuickAccessSectionView>, "DropTarget">,
) {
  return <SidebarQuickAccessSectionView {...props} DropTarget={ExplorerDropTarget} />;
}
