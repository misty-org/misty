import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { layoutTabs } from "@/features/workspace/layoutTabs";
import type { WorkspaceVirtualWindow } from "@/features/workspace/model";
import type { WorkspaceSource } from "./controller";
import { retainDeviceState } from "./deviceState";

function emptyWindow(): WorkspaceVirtualWindow {
  const root = { type: "leaf" as const, id: "recovery:empty-pane", tabs: [], activeTabId: null };
  return {
    id: "recovery:empty-window",
    title: "Window",
    createdAt: 0,
    lastFocusedAt: 0,
    layout: {
      root,
      focusedPaneId: root.id,
      activeLayoutTabId: "recovery:empty-layout",
      tabs: [{ id: "recovery:empty-layout", root, focusedPaneId: root.id }],
    },
  };
}
export const workspaceSource: WorkspaceSource = {
  read() {
    const state = useWorkspaceStore.getState();
    return {
      windows: state.virtualWindowsByScope.global ?? [],
      activeWindowId: state.activeVirtualWindowIdByScope.global ?? "",
      groups: state.websiteGroups,
      websites: state.savedWebsites,
    };
  },
  subscribe(changed) {
    return useWorkspaceStore.subscribe(changed);
  },
  write(projected) {
    const state = useWorkspaceStore.getState();
    const windows = retainDeviceState(
      projected.windows.length ? projected.windows : [emptyWindow()],
      state.virtualWindowsByScope.global ?? [],
    );
    const active = windows.find((window) => window.id === projected.activeWindowId) ?? windows[0];
    // Do not call the legacy normalizer: it creates random Google tabs for empty
    // remote panes, which would be mistaken for local edits and sent back.
    useWorkspaceStore.setState({
      websiteGroups: projected.groups,
      savedWebsites: projected.websites,
      activeScopeKey: "global",
      activeVirtualWindowId: active.id,
      activeVirtualWindowIdByScope: { ...state.activeVirtualWindowIdByScope, global: active.id },
      virtualWindowsByScope: { ...state.virtualWindowsByScope, global: windows },
      layoutsByScope: { ...state.layoutsByScope, global: active.layout },
      layout: active.layout,
    });
    // Route synchronization follows this device's retained selection. It does
    // not import another device's focused pane or execute an agent action.
    const layout = layoutTabs(active.layout).find(
      (layout) => layout.id === active.layout.activeLayoutTabId,
    );
    if (layout && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("misty:workspace-projection-applied"));
    }
  },
};
