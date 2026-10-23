import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { findDockLeaf } from "./dockTree";
import { paneHistoryPosition } from "./paneHistory";
import { useWorkspaceStore } from "./useWorkspaceStore";

/**
 * Back and forward for the focused pane. Every pane keeps its own history of the pages it showed,
 * so one tab or split pane never goes back into another's. A browser page travels through its own
 * web history instead, and reports `browser` so callers leave it to that.
 */
export function useFocusedPaneHistory() {
  const state = useWorkspaceStore(
    useShallow((store) => {
      const pane = findDockLeaf(store.layout.root, store.layout.focusedPaneId ?? "");
      if (!pane) return { canBack: false, canForward: false, browser: false };
      const { index, length } = paneHistoryPosition(pane);
      return {
        canBack: index > 0,
        canForward: index < length - 1,
        browser: pane.views[0]?.surfaceId === "browser",
      };
    }),
  );
  /** Moves the focused pane through its history; the page it lands on, or null at an end. */
  const go = useCallback((delta: -1 | 1) => useWorkspaceStore.getState().navigatePane(delta), []);
  return { ...state, go };
}
