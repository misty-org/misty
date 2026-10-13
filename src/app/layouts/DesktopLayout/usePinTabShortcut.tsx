import { useCallback, useState } from "react";
import { useUserStore } from "@/features/auth/core";
import { pinnedTabsBlockedReason } from "@/features/browser-workspace/pinnedTabsGate";
import { useBrowserSyncStore } from "@/features/browser-workspace/store";
import { useShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceStore } from "@/features/workspace";
import { dockTreeViews } from "@/features/workspace/dockTree";
import { layoutTabs } from "@/features/workspace/layoutTabs";
import { pinnableTabUrl } from "@/features/workspace/pinnedTabs";
import { Notification } from "@/shared/ui";

/**
 * Pins or unpins the active tab from the keyboard or command palette. Returns
 * the notice shown when sync can't keep the pin yet.
 */
export function usePinTabShortcut() {
  const [blocked, setBlocked] = useState<{ id: number; reason: string } | null>(null);
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
      if (!pinnableTabUrl(tab)) return false;
      // Synced workspaces keep pins only once every device understands them.
      const reason = pinnedTabsBlockedReason(
        useBrowserSyncStore.getState().session,
        useUserStore.getState().me?.username,
      );
      if (reason) {
        setBlocked((current) => ({ id: (current?.id ?? 0) + 1, reason }));
        return true;
      }
      return state.pinTab(tab.id);
    }, []),
  );
  return blocked ? (
    <Notification key={blocked.id} duration={5000} onDismiss={() => setBlocked(null)}>
      {blocked.reason}
    </Notification>
  ) : null;
}

/** Closing a pinned tab's only page sends it back to where it was pinned. */
export function resetPinnedTabForView(viewId: string) {
  const state = useWorkspaceStore.getState();
  const owner = layoutTabs(state.layout).find((item) =>
    dockTreeViews(item.root).some((view) => view.id === viewId),
  );
  return Boolean(owner && dockTreeViews(owner.root).length === 1 && state.resetPinnedTab(owner.id));
}
