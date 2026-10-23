import { migrateSavedLinkGroups } from "@/features/workspace/tabGroups";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { layoutTabs } from "@/features/workspace/layoutTabs";
import { currentWindow, spaceLayout } from "@/features/workspace/windows";
import { windowSpaceScope } from "@/features/workspace/spaceWindow";
import { dockLeaves } from "@/features/workspace/dockTree";
import { parseBrowserViewState, type WorkspaceWindow } from "@/features/workspace/model";
import {
  navigateSyncedBrowserWebview,
  useBrowserRuntimeStore,
} from "@/features/webviews/browserRuntime";
import type { WorkspaceSource } from "./controllerSnapshot";
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
      // This Space window is one window of the sync tree. Incognito windows never sync.
      windows: [{ ...currentWindow(state), layout: spaceLayout(state) }],
      activeWindowId: state.activeWindowId,
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
    const local = [{ ...currentWindow(state), layout: spaceLayout(state) }];
    const previousTabs = new Map(browserViews(local).map((tab) => [tab.id, tab]));
    // This window takes its own window from the tree, or the one that was active.
    const projectedWindow =
      projected.windows.find((window) => window.id === state.activeWindowId) ??
      projected.windows.find((window) => window.id === projected.activeWindowId) ??
      projected.windows[0];
    const windows = retainDeviceState(
      [projectedWindow ?? emptyWindow()],
      local,
      projected.tabGroups !== undefined,
    );
    const active = windows[0];
    // Do not call the legacy normalizer: it creates random Google tabs for empty
    // remote panes, which would be mistaken for local edits and sent back.
    const groupMigration = migrateSavedLinkGroups({
      ...state,
      bookmarkFolders: projected.folders.filter((folder) => folder.fields.icon !== "folder"),
      bookmarks: projected.bookmarks,
    });
    // While a device profile is showing, its own tabs stay on screen; the synced
    // tabs update in the background and appear when the Space's own layout returns.
    const scope = windowSpaceScope();
    const showing = state.activeScopeKey === scope;
    useWorkspaceStore.setState({
      ...groupMigration,
      bookmarkFolders: projected.folders,
      bookmarks: projected.bookmarks,
      ...(showing ? { layout: active.layout } : {}),
      activeWindowId: active.id,
      layoutsByScope: { ...state.layoutsByScope, [scope]: active.layout },
      // Synced once every device supports it; otherwise each machine keeps its own.
      ...(projected.tabGroups ? { tabGroups: projected.tabGroups } : {}),
    });
    for (const tab of browserViews(windows)) {
      const previous = previousTabs.get(tab.id);
      const next = parseBrowserViewState(tab.state);
      if (!previous || parseBrowserViewState(previous.state).url === next.url) continue;
      const stillCurrent = () => {
        const current = browserViews([
          { ...active, layout: spaceLayout(useWorkspaceStore.getState()) },
        ]).find(
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
