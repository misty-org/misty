import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { findDockLeaf } from "./dock_tree";
import { paneHistoryPosition } from "./pane_history";
import { useWorkspaceStore } from "../tabs/use_workspace_store";

export function useFocusedPaneHistory() {
  const state = useWorkspaceStore(
    useShallow((store) => {
      const pane = findDockLeaf(store.layout.root, store.layout.focusedPaneId ?? "");
      if (!pane) return { canBack: false, canForward: false };
      const { index, length } = paneHistoryPosition(pane);
      return { canBack: index > 0, canForward: index < length - 1 };
    }),
  );
  const go = useCallback((delta: -1 | 1) => useWorkspaceStore.getState().navigatePane(delta), []);
  return { ...state, go };
}
