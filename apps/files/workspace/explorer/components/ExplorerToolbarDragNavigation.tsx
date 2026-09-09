import type { ComponentProps } from "react";
import { ExplorerDropTarget } from "../drag/ExplorerDropTarget";
import { ExplorerToolbarDragNavigationView } from "./ExplorerToolbarDragNavigationView";
export function ExplorerToolbarDragNavigation(
  props: Omit<ComponentProps<typeof ExplorerToolbarDragNavigationView>, "DropTarget">,
) {
  return <ExplorerToolbarDragNavigationView {...props} DropTarget={ExplorerDropTarget} />;
}
