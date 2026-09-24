import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { layoutTabs } from "@/features/workspace/layoutTabs";
import { dockLeaves } from "@/features/workspace/dockTree";
import { parseBrowserTabState, type WorkspaceVirtualWindow } from "@/features/workspace/model";
import {
  navigateSyncedBrowserWebview,
  useBrowserRuntimeStore,
} from "@/features/webviews/browserRuntime";
import type { WorkspaceSource } from "./controller";
import { retainDeviceState } from "./deviceState";

const browserTabs = (windows: WorkspaceVirtualWindow[]) =>
  windows.flatMap((window) =>
    layoutTabs(window.layout).flatMap((layout) =>
      dockLeaves(layout.root).flatMap((pane) =>
        pane.tabs.filter((tab) => tab.surfaceId === "browser"),
      ),
    ),
  );

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
    const previousTabs = new Map(
      browserTabs(state.virtualWindowsByScope.global ?? []).map((tab) => [tab.id, tab]),
    );
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
    for (const tab of browserTabs(windows)) {
      const previous = previousTabs.get(tab.id);
      const next = parseBrowserTabState(tab.state);
      if (!previous || parseBrowserTabState(previous.state).url === next.url) continue;
      const stillCurrent = () => {
        const current = browserTabs(
          useWorkspaceStore.getState().virtualWindowsByScope.global ?? [],
        ).find((candidate) => candidate.id === tab.id && candidate.instanceKey === tab.instanceKey);
        if (!current) return false;
        const browser = parseBrowserTabState(current.state);
        return browser.url === next.url && browser.profileId === next.profileId;
      };
      void navigateSyncedBrowserWebview(tab, next.url, stillCurrent).catch((error: unknown) => {
        if (stillCurrent())
          useBrowserRuntimeStore
            .getState()
            .setError(tab.id, error instanceof Error ? error.message : String(error));
      });
    }
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
