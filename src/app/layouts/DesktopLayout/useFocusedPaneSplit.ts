import { canFitDockSplit, dockLeaves } from "@/features/workspace";
import { dockPaneCloseDirection } from "@/features/workspace/dockTree";
import type { WorkspaceLayout } from "@/features/workspace/model";
import { PanelBottomClose, PanelLeftClose, PanelRightClose, PanelTopClose } from "lucide-react";
import { minimumForWorkspaceViews } from "./WorkspaceDockTree";
import { usePaneBounds } from "./useTabStripGeometry";

/** The focused pane plus which split and close actions it currently allows. */
export function useFocusedPaneSplit(layout: WorkspaceLayout) {
  const pane =
    dockLeaves(layout.root).find((pane) => pane.id === layout.focusedPaneId) ??
    dockLeaves(layout.root)[0];
  const bounds = usePaneBounds(pane.id, layout.root);
  const ClosePaneIcon = {
    up: PanelTopClose,
    down: PanelBottomClose,
    left: PanelLeftClose,
    right: PanelRightClose,
  }[dockPaneCloseDirection(layout.root, pane.id) ?? "up"];
  const canSplit = dockLeaves(layout.root).length < 4;
  const canRight =
    canSplit &&
    canFitDockSplit(bounds, "right", minimumForWorkspaceViews(pane.views), {
      width: 280,
      height: 180,
    });
  const canDown =
    canSplit &&
    canFitDockSplit(bounds, "down", minimumForWorkspaceViews(pane.views), {
      width: 280,
      height: 180,
    });
  return { pane, ClosePaneIcon, canRight, canDown };
}
