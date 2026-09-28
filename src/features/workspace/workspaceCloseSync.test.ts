import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBrowserSyncStore } from "@/features/browser-workspace/store";
import type { NativeSyncView } from "@/features/browser-workspace/native";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { dockTabs } from "./dockTree";
import { allLayoutViews } from "./layoutTabs";

const state = () => useWorkspaceStore.getState();
const follower = (): NativeSyncView =>
  ({
    device_id: "here",
    full_sync: true,
    workspace: { active_device: { device_id: "there", epoch: "remote", sequence: 1 } },
  }) as NativeSyncView;
beforeEach(() => {
  useBrowserSyncStore.setState({ session: null });
  state().reset();
});
afterEach(() => {
  useBrowserSyncStore.setState({ session: null });
});

it.each(["legacy", "trees"])(
  "rejects tab, pane, group, and window closes while following (%s)",
  (mode) => {
    state().createVirtualWindow();
    const id = state().layout.activeLayoutTabId!;
    const paneId = state().splitPane(state().layout.focusedPaneId, "right")!;
    const tab = dockTabs(state().layout.root)[0];
    const groupId = state().createTabGroup([id], "Work")!;
    const windowId = state().activeVirtualWindowId;
    const session = follower();
    if (mode === "trees")
      session.trees = {
        driving_tree: null,
        trees: [{ tree_id: "there" }],
      } as NativeSyncView["trees"];
    useBrowserSyncStore.setState({ session });
    const before = state();
    const notice = vi.fn();
    window.addEventListener("misty:workspace-notice", notice);
    try {
      expect(state().closeTab(tab.id)).toBe(false);
      expect(state().closeLayoutTab(id)).toBe(false);
      state().closePane(paneId);
      expect(state().closeTabGroup(groupId)).toBe(false);
      expect(state().closeVirtualWindow(windowId)).toBe(false);
      expect(state().layout).toBe(before.layout);
      expect(state().closedTabs).toBe(before.closedTabs);
      expect(state().closedVirtualWindowsByScope).toBe(before.closedVirtualWindowsByScope);
      expect(notice).toHaveBeenCalled();
    } finally {
      window.removeEventListener("misty:workspace-notice", notice);
    }
  },
);

it.each(["local", "independent", "driver"])(
  "still closes tabs when editing is allowed (%s)",
  (mode) => {
    const tab = state().openBrowserTab({ url: "https://example.com" });
    if (mode !== "local") {
      const session = follower();
      if (mode === "independent") session.full_sync = false;
      else session.workspace.active_device!.device_id = "here";
      useBrowserSyncStore.setState({ session });
    }
    expect(state().closeTab(tab.id)).toBe(true);
    expect(allLayoutViews(state().layout).some((item) => item.id === tab.id)).toBe(false);
    expect(state().closedTabs[0].tab.id).toBe(tab.id);
  },
);
