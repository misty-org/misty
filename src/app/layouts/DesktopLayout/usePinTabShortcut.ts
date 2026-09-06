import { useCallback } from "react";
import { useBrowserSyncStore } from "@/features/browser-workspace/store";
import { useShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceStore } from "@/features/workspace";
import { dockTreeViews } from "@/features/workspace/dockTree";
import { layoutTabs } from "@/features/workspace/layoutTabs";

/** Pins or unpins the active tab from the keyboard or command palette. */
export function usePinTabShortcut() {
  useShortcutHandler(
    "workspace.toggle_pin_tab",
    useCallback(() => {
      const state = useWorkspaceStore.getState();
      const id = state.layout.activeTabId;
      const tab = layoutTabs(state.layout).find((item) => item.id === id);
      if (!tab) return false;
      if (tab.pinnedUrl) {
        state.unpinTab(tab.id);
        return true;
      }
      // Synced workspaces keep pins only once every device understands them.
      const sync = useBrowserSyncStore.getState().session?.sync;
      if (sync && sync.pinned_tabs !== true) return false;
      return state.pinTab(tab.id);
    }, []),
  );
}

/** Closing a pinned tab's only page sends it back to where it was pinned. */
export function resetPinnedTabForView(viewId: string) {
  const state = useWorkspaceStore.getState();
  const owner = layoutTabs(state.layout).find((item) =>
    dockTreeViews(item.root).some((view) => view.id === viewId),
  );
  return Boolean(owner && dockTreeViews(owner.root).length === 1 && state.resetPinnedTab(owner.id));
}
