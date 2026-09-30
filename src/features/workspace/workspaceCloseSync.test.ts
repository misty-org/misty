import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBrowserSyncStore } from "@/features/browser-workspace/store";
import type { NativeSyncView } from "@/features/browser-workspace/native";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { dockTreeViews } from "./dockTree";
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

it("rejects tab, pane, group, and window closes while following a legacy workspace", () => {
  state().createWindow();
  const id = state().layout.activeTabId!;
  const paneId = state().splitPane(state().layout.focusedPaneId, "right")!;
  const tab = dockTreeViews(state().layout.root)[0];
  const groupId = state().createTabGroup([id], "Work")!;
  const windowId = state().activeWindowId;
  useBrowserSyncStore.setState({ session: follower() });
  const before = state();
  const notice = vi.fn();
  window.addEventListener("misty:workspace-notice", notice);
  try {
    expect(state().closeView(tab.id)).toBe(false);
    expect(state().closeTab(id)).toBe(false);
    state().closePane(paneId);
    expect(state().closeTabGroup(groupId)).toBe(false);
    expect(state().closeWindow(windowId)).toBe(false);
    expect(state().layout).toBe(before.layout);
    expect(state().closedItems).toBe(before.closedItems);
    expect(state().closedWindowsByScope).toBe(before.closedWindowsByScope);
    expect(notice).toHaveBeenCalled();
  } finally {
    window.removeEventListener("misty:workspace-notice", notice);
  }
});

it.each(["local", "independent", "driver", "trees"])(
  "still closes tabs when editing is allowed (%s)",
  (mode) => {
    const tab = state().openBrowserView({ url: "https://example.com" });
    if (mode !== "local") {
      const session = follower();
      if (mode === "independent") session.full_sync = false;
      // Device trees take edits from every machine, with or without the lease.
      else if (mode === "trees")
        session.sync = {
          driving_workspace: null,
          on_workspace: "there",
          workspaces: [{ workspace_id: "there", driver_device_id: "there" }],
        } as NativeSyncView["sync"];
      else session.workspace.active_device!.device_id = "here";
      useBrowserSyncStore.setState({ session });
    }
    expect(state().closeView(tab.id)).toBe(true);
    expect(allLayoutViews(state().layout).some((item) => item.id === tab.id)).toBe(false);
    expect(state().closedItems[0].view.id).toBe(tab.id);
  },
);
