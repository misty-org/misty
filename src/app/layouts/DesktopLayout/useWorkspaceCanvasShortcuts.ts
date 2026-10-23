import { useEffect } from "react";
import { registerShortcutHandler } from "@/features/shortcuts";
import {
  canCloseWorkspaceView,
  canFitDockSplit,
  dockLeaves,
  findDockLeaf,
  maxWorkspacePanes,
  paneBoundsFromDocument,
  paneIdInDirection,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { usePaneSwapMode } from "@/features/workspace/paneSwapMode";
import type { DockSplitDirection } from "@/features/workspace/model";
import { minimumForWorkspaceViews } from "./dockSplitFit";
import {
  closeSpaceWindow,
  openIncognitoWindow,
  showSpacesMenu,
} from "@/features/workspace/spaceWindow";

/** Pane and Space-window keyboard shortcuts for the workspace. */
export function useWorkspaceCanvasShortcuts(actions: {
  openTab: (view: WorkspaceView) => void;
  splitWorkspacePane: (
    paneId: string,
    direction: DockSplitDirection,
    tabId?: string,
  ) => string | null;
}) {
  const { openTab, splitWorkspacePane } = actions;
  useEffect(() => {
    const paneInDirection = (direction: "left" | "right" | "up" | "down") => {
      const state = useWorkspaceStore.getState();
      return paneIdInDirection(state.layout.focusedPaneId, direction, paneBoundsFromDocument());
    };
    const focusPane = (direction: "left" | "right" | "up" | "down") => {
      const state = useWorkspaceStore.getState();
      const paneId = paneInDirection(direction);
      const pane = paneId ? findDockLeaf(state.layout.root, paneId) : null;
      const tab =
        pane?.views.find((candidate) => candidate.id === pane.activeViewId) ?? pane?.views[0];
      if (tab) openTab(tab);
      else if (pane) state.focusPane(pane.id);
    };
    const canSplitFocusedPane = (direction: "right" | "down") => {
      const state = useWorkspaceStore.getState();
      if (dockLeaves(state.layout.root).length >= maxWorkspacePanes) return false;
      const pane = findDockLeaf(state.layout.root, state.layout.focusedPaneId);
      const bounds = paneBoundsFromDocument().find((candidate) => candidate.id === pane?.id);
      if (!pane || !bounds) return false;
      return canFitDockSplit(bounds, direction, minimumForWorkspaceViews(pane.views), {
        width: 360,
        height: 240,
      });
    };
    const unregister = [
      registerShortcutHandler(
        "workspace.focus_pane_left",
        () => focusPane("left"),
        () => Boolean(paneInDirection("left")),
      ),
      registerShortcutHandler(
        "workspace.focus_pane_up",
        () => focusPane("up"),
        () => Boolean(paneInDirection("up")),
      ),
      registerShortcutHandler(
        "workspace.focus_pane_right",
        () => focusPane("right"),
        () => Boolean(paneInDirection("right")),
      ),
      registerShortcutHandler(
        "workspace.focus_pane_down",
        () => focusPane("down"),
        () => Boolean(paneInDirection("down")),
      ),
      registerShortcutHandler(
        "workspace.split_right",
        () => {
          const state = useWorkspaceStore.getState();
          splitWorkspacePane(state.layout.focusedPaneId, "right");
        },
        () => canSplitFocusedPane("right"),
      ),
      registerShortcutHandler(
        "workspace.split_down",
        () => {
          const state = useWorkspaceStore.getState();
          splitWorkspacePane(state.layout.focusedPaneId, "down");
        },
        () => canSplitFocusedPane("down"),
      ),
      registerShortcutHandler(
        "workspace.close_pane",
        () => {
          const state = useWorkspaceStore.getState();
          state.closePane(state.layout.focusedPaneId);
        },
        () => dockLeaves(useWorkspaceStore.getState().layout.root).length > 1,
      ),
    ];
    return () => unregister.forEach((remove) => remove());
  }, [openTab, splitWorkspacePane]);

  useEffect(() => {
    // Each Space opens in its own OS window; these act on this window or open another.
    const unregister = [
      registerShortcutHandler("workspace.open_space", () => void showSpacesMenu()),
      registerShortcutHandler("workspace.new_incognito_window", () => void openIncognitoWindow()),
      registerShortcutHandler(
        "workspace.close_window",
        () => void closeSpaceWindow(),
        () => canCloseWorkspaceView(),
      ),
      registerShortcutHandler("workspace.swap_panel_next", () => {
        const mode = usePaneSwapMode.getState();
        if (mode.sourceId) mode.cancel();
        else mode.start();
      }),
    ];
    return () => unregister.forEach((remove) => remove());
  }, []);
}
