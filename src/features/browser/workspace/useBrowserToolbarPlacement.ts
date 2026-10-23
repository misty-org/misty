import { useEffect } from "react";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { useBrowserToolbarSlot } from "./browserToolbarSlot";

/**
 * Where a browser page's toolbar goes. The focused pane's toolbar lives in the tab sidebar.
 * Without one (focus mode) the page keeps its own toolbar row.
 */
export function useBrowserToolbarPlacement(tabId: string) {
  const { nav: navSlot, top: topSlot } = useBrowserToolbarSlot();
  const paneFocused = useWorkspaceStore((store) =>
    dockLeaves(store.layout.root).some(
      (pane) => pane.id === store.layout.focusedPaneId && pane.activeViewId === tabId,
    ),
  );
  const sidebar = Boolean(topSlot);
  const claimsNav = paneFocused && sidebar && Boolean(navSlot);
  useEffect(
    () => (claimsNav ? useBrowserToolbarSlot.getState().claimNav() : undefined),
    [claimsNav],
  );
  return { paneFocused, sidebar };
}
