import {
  MultiPanelWorkspace,
  type ChromeTabStripTab,
  type MultiPanelWorkspaceProps,
} from "@/features/workspace";
import { useCallback } from "react";
import { useExplorerDropRegistry } from "../drag/ExplorerDragContext";
import { createExplorerDropTargetSpec } from "../drag/ExplorerDropTarget";

export function ExplorerMultiPanelWorkspace(props: MultiPanelWorkspaceProps) {
  const registerDropZone = useExplorerDropRegistry();
  const registerTabDropTarget = useCallback(
    (
      element: HTMLElement,
      tab: ChromeTabStripTab,
      onSpringLoad: () => void,
      springLoad: boolean,
    ) => {
      if (!registerDropZone) return () => undefined;
      return registerDropZone(
        element,
        createExplorerDropTargetSpec({
          id: `tab:${tab.id}`,
          path: tab.path,
          paneId: tab.paneId,
          springLoad,
          onSpringLoad,
        }),
      );
    },
    [registerDropZone],
  );

  return <MultiPanelWorkspace {...props} registerTabDropTarget={registerTabDropTarget} />;
}
