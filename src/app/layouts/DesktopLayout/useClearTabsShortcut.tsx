import { useCallback } from "react";
import { useShortcutHandler } from "@/features/shortcuts";
import { layoutTabs, useWorkspaceStore } from "@/features/app-windows";

/** Closes every tab except the active one, from the command palette. */
export function useClearTabsShortcut() {
  useShortcutHandler(
    "workspace.clear_tabs",
    useCallback(() => {
      const state = useWorkspaceStore.getState();
      const activeId = state.layout.activeTabId;
      const doomed = layoutTabs(state.layout).filter((tab) => tab.id !== activeId);
      for (const tab of doomed) state.closeTab(tab.id);
      return true;
    }, []),
  );
}
