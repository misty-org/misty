import { migrateSavedLinkGroups } from "@/features/workspace/tabGroups";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { layoutTabs, mapLayoutViews } from "@/features/workspace/layoutTabs";
import { scrubPrivateView } from "@/features/workspace/privateBrowsing";
import { dockLeaves } from "@/features/workspace/dockTree";
import { parseBrowserViewState, type WorkspaceWindow } from "@/features/workspace/model";
import {
  navigateSyncedBrowserWebview,
  useBrowserRuntimeStore,
} from "@/features/webviews/browserRuntime";
import type { WorkspaceSource } from "./controller";
import { retainDeviceState } from "./deviceState";

const browserViews = (windows: WorkspaceWindow[]) =>
  windows.flatMap((window) =>
    layoutTabs(window.layout).flatMap((layout) =>
      dockLeaves(layout.root).flatMap((pane) =>
        pane.views.filter((tab) => tab.surfaceId === "browser"),
      ),
    ),
  );

function emptyWindow(): WorkspaceWindow {
  const root = { type: "leaf" as const, id: "recovery:empty-pane", views: [], activeViewId: null };
  return {
    id: "recovery:empty-window",
    title: "Window",
    createdAt: 0,
    lastFocusedAt: 0,
    layout: {
      root,
      focusedPaneId: root.id,
      activeTabId: "recovery:empty-tab",
      tabs: [{ id: "recovery:empty-tab", root, focusedPaneId: root.id }],
    },
  };
}
export const workspaceSource: WorkspaceSource = {
  read() {
    const state = useWorkspaceStore.getState();
    return {
      // Private tabs travel only as placeholders, never with their pages.
      windows: (state.windowsByScope.global ?? []).map((window) => ({
        ...window,
        layout: mapLayoutViews(window.layout, scrubPrivateView),
      })),
      activeWindowId: state.activeWindowIdByScope.global ?? "",
      folders: state.bookmarkFolders,
      bookmarks: state.bookmarks,
      tabGroups: state.tabGroups,
    };
  },
  subscribe(changed) {
    return useWorkspaceStore.subscribe(changed);
  },
  write(projected) {
    const state = useWorkspaceStore.getState();
    const previousTabs = new Map(
      browserViews(state.windowsByScope.global ?? []).map((tab) => [tab.id, tab]),
    );
    const windows = retainDeviceState(
      projected.windows.length ? projected.windows : [emptyWindow()],
      state.windowsByScope.global ?? [],
      projected.tabGroups !== undefined,
    );
    const active = windows.find((window) => window.id === projected.activeWindowId) ?? windows[0];
    // Do not call the legacy normalizer: it creates random Google tabs for empty
    // remote panes, which would be mistaken for local edits and sent back.
    const groupMigration = migrateSavedLinkGroups({
      ...state,
      bookmarkFolders: projected.folders.filter((folder) => folder.fields.icon !== "folder"),
      bookmarks: projected.bookmarks,
    });
    // While a device profile is showing, its own windows stay on screen; the synced
    // windows update in the background and appear when the default profile returns.
    const showing = state.activeScopeKey === "global";
    useWorkspaceStore.setState({
      ...groupMigration,
      bookmarkFolders: projected.folders,
      bookmarks: projected.bookmarks,
      ...(showing ? { activeWindowId: active.id, layout: active.layout } : {}),
      activeWindowIdByScope: { ...state.activeWindowIdByScope, global: active.id },
      windowsByScope: { ...state.windowsByScope, global: windows },
      layoutsByScope: { ...state.layoutsByScope, global: active.layout },
      // Synced once every device supports it; otherwise each machine keeps its own.
      ...(projected.tabGroups ? { tabGroups: projected.tabGroups } : {}),
    });
    for (const tab of browserViews(windows)) {
      const previous = previousTabs.get(tab.id);
      const next = parseBrowserViewState(tab.state);
      if (!previous || parseBrowserViewState(previous.state).url === next.url) continue;
      const stillCurrent = () => {
        const current = browserViews(useWorkspaceStore.getState().windowsByScope.global ?? []).find(
          (candidate) => candidate.id === tab.id && candidate.instanceKey === tab.instanceKey,
        );
        if (!current) return false;
        const browser = parseBrowserViewState(current.state);
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
      (layout) => layout.id === active.layout.activeTabId,
    );
    if (showing && layout && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("misty:workspace-projection-applied"));
    }
  },
};
