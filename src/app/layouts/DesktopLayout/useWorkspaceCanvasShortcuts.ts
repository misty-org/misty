import { useEffect } from "react";
import { registerShortcutHandler } from "@/features/shortcuts";
import {
  canCloseWorkspaceWindow,
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
import { minimumForWorkspaceViews } from "./WorkspaceDockTree";

/** Pane and virtual-window keyboard shortcuts for the workspace. */
export function useWorkspaceCanvasShortcuts(actions: {
  closeWorkspaceVirtualWindow: (windowId: string) => void;
  createWorkspaceVirtualWindow: () => void;
  navigateToActiveLayoutTab: () => void;
  openTab: (view: WorkspaceView) => void;
  reopenWorkspaceVirtualWindow: (windowId?: string) => void;
  selectVirtualWindow: (windowId: string) => void;
  splitWorkspacePane: (
    paneId: string,
    direction: DockSplitDirection,
    tabId?: string,
  ) => string | null;
}) {
  const {
    closeWorkspaceVirtualWindow,
    createWorkspaceVirtualWindow,
    navigateToActiveLayoutTab,
    openTab,
    reopenWorkspaceVirtualWindow,
    selectVirtualWindow,
    splitWorkspacePane,
  } = actions;
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
    const hasMultipleVirtualWindows = () => {
      const state = useWorkspaceStore.getState();
      return (state.windowsByScope[state.activeScopeKey]?.length ?? 0) > 1;
    };
    const cycleWindow = (direction: 1 | -1) => {
      const state = useWorkspaceStore.getState();
      const windows = state.windowsByScope[state.activeScopeKey] ?? [];
      if (windows.length < 2) return;
      const index = Math.max(
        0,
        windows.findIndex((window) => window.id === state.activeWindowId),
      );
      selectVirtualWindow(windows[(index + direction + windows.length) % windows.length].id);
    };
    const unregister = [
      registerShortcutHandler("workspace.new_virtual_window", () => {
        createWorkspaceVirtualWindow();
      }),
      registerShortcutHandler(
        "workspace.close_virtual_window",
        () => closeWorkspaceVirtualWindow(useWorkspaceStore.getState().activeWindowId),
        () => {
          const state = useWorkspaceStore.getState();
          const windows = state.windowsByScope[state.activeScopeKey] ?? [];
          const active = windows.find(
            (workspaceWindow) => workspaceWindow.id === state.activeWindowId,
          );
          return Boolean(active && windows.length > 1 && canCloseWorkspaceWindow(active, windows));
        },
      ),
      registerShortcutHandler(
        "workspace.next_virtual_window",
        () => cycleWindow(1),
        hasMultipleVirtualWindows,
      ),
      registerShortcutHandler(
        "workspace.previous_virtual_window",
        () => cycleWindow(-1),
        hasMultipleVirtualWindows,
      ),
      registerShortcutHandler(
        "workspace.reopen_virtual_window",
        () => reopenWorkspaceVirtualWindow(),
        () => {
          const state = useWorkspaceStore.getState();
          return Boolean(state.closedWindowsByScope[state.activeScopeKey]?.length);
        },
      ),
      registerShortcutHandler("workspace.swap_panel_next", () => {
        usePaneSwapMode.getState().start();
      }),
      ...Array.from({ length: 9 }, (_, index) =>
        registerShortcutHandler(
          `workspace.window_${index + 1}`,
          () => {
            const state = useWorkspaceStore.getState();
            const workspaceWindow = state.windowsByScope[state.activeScopeKey]?.[index];
            if (workspaceWindow) selectVirtualWindow(workspaceWindow.id);
          },
          () => {
            const state = useWorkspaceStore.getState();
            return Boolean(state.windowsByScope[state.activeScopeKey]?.[index]);
          },
        ),
      ),
    ];
    return () => unregister.forEach((remove) => remove());
  }, [
    closeWorkspaceVirtualWindow,
    createWorkspaceVirtualWindow,
    navigateToActiveLayoutTab,
    reopenWorkspaceVirtualWindow,
    selectVirtualWindow,
  ]);
}
