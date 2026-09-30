import { contiguousTabs } from "@/features/workspace/tabGroups";
import { dockLeaves } from "@/features/workspace/dockTree";
import { layoutTabs } from "@/features/workspace/layoutTabs";
import { isPrivateBrowserView } from "@/features/workspace/privateBrowsing";
import {
  parseBrowserViewState,
  type WorkspaceDockNode,
  type WorkspaceView,
  type WorkspaceWindow,
} from "@/features/workspace/model";

/** Shared projection owns structure and navigation; these fields belong to the
 * current device and must survive an unrelated remote workspace edit. */
export function retainDeviceState(
  incoming: WorkspaceWindow[],
  previous: WorkspaceWindow[],
  /** Tab group membership comes from sync rather than staying local. */
  syncedGroups = false,
): WorkspaceWindow[] {
  const oldWindows = new Map(previous.map((window) => [window.id, window]));
  const oldLayouts = new Map(
    previous.flatMap((window) => layoutTabs(window.layout).map((tab) => [tab.id, tab] as const)),
  );
  const oldPanes = new Map(
    previous.flatMap((window) =>
      layoutTabs(window.layout).flatMap((layout) =>
        dockLeaves(layout.root).map((pane) => [pane.id, pane] as const),
      ),
    ),
  );
  const oldTabs = new Map(
    [...oldPanes.values()].flatMap((pane) => pane.views.map((tab) => [tab.id, tab] as const)),
  );
  const retainTab = (tab: WorkspaceView): WorkspaceView => {
    const old = oldTabs.get(tab.id);
    if (!old || old.surfaceId !== tab.surfaceId) return tab;
    // Sync only ever sees a private tab's placeholder; the page stays local.
    if (isPrivateBrowserView(old)) return { ...tab, ...old };
    let state = tab.state;
    if (tab.surfaceId === "files") state = old.state;
    if (tab.surfaceId === "browser") {
      const nextBrowser = parseBrowserViewState(tab.state);
      const oldBrowser = parseBrowserViewState(old.state);
      if (
        nextBrowser.url === oldBrowser.url &&
        (!oldBrowser.profileId || nextBrowser.profileId === oldBrowser.profileId)
      )
        state = { ...nextBrowser, faviconUrl: oldBrowser.faviconUrl };
    }
    return {
      ...tab,
      instanceKey: old.instanceKey,
      groupInstanceId: old.groupInstanceId,
      sidebarVisible: old.sidebarVisible,
      createdAt: old.createdAt,
      lastFocusedAt: old.lastFocusedAt,
      state,
    };
  };
  const retainTree = (node: WorkspaceDockNode): WorkspaceDockNode => {
    if (node.type === "split")
      return { ...node, first: retainTree(node.first), second: retainTree(node.second) };
    const tabs = node.views.map(retainTab);
    const old = oldPanes.get(node.id);
    // History stays local to the pane and its current view. Replacing a view
    // remotely must not resurrect that view through an unrelated history stack.
    const history =
      old?.activeViewId === node.activeViewId && old?.history
        ? {
            ...old.history,
            entries: old.history.entries.map((entry, index) =>
              index === old.history!.index
                ? (tabs.find((tab) => tab.id === entry.id) ?? entry)
                : entry,
            ),
          }
        : undefined;
    return { ...node, views: tabs, history };
  };
  return incoming.map((window) => {
    const old = oldWindows.get(window.id);
    const tabs = contiguousTabs(
      layoutTabs(window.layout).map((layout) => ({
        ...layout,
        tabGroupId: syncedGroups ? layout.tabGroupId : oldLayouts.get(layout.id)?.tabGroupId,
        root: retainTree(layout.root),
      })),
    );
    const selected = tabs.find((layout) => layout.id === window.layout.activeTabId) ?? tabs[0];
    return {
      ...window,
      createdAt: old?.createdAt ?? window.createdAt,
      lastFocusedAt: old?.lastFocusedAt ?? window.lastFocusedAt,
      layout: {
        ...window.layout,
        tabs,
        root: selected.root,
        focusedPaneId: selected.focusedPaneId,
      },
    };
  });
}
