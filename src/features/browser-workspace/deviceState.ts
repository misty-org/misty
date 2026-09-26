import { dockLeaves } from "@/features/workspace/dockTree";
import { layoutTabs } from "@/features/workspace/layoutTabs";
import { isPrivateBrowserTab } from "@/features/workspace/privateBrowsing";
import {
  parseBrowserTabState,
  type WorkspaceDockNode,
  type WorkspaceTab,
  type WorkspaceVirtualWindow,
} from "@/features/workspace/model";

/** Shared projection owns structure and navigation; these fields belong to the
 * current device and must survive an unrelated remote workspace edit. */
export function retainDeviceState(
  incoming: WorkspaceVirtualWindow[],
  previous: WorkspaceVirtualWindow[],
): WorkspaceVirtualWindow[] {
  const oldWindows = new Map(previous.map((window) => [window.id, window]));
  const oldPanes = new Map(
    previous.flatMap((window) =>
      layoutTabs(window.layout).flatMap((layout) =>
        dockLeaves(layout.root).map((pane) => [pane.id, pane] as const),
      ),
    ),
  );
  const oldTabs = new Map(
    [...oldPanes.values()].flatMap((pane) => pane.tabs.map((tab) => [tab.id, tab] as const)),
  );
  const retainTab = (tab: WorkspaceTab): WorkspaceTab => {
    const old = oldTabs.get(tab.id);
    if (!old || old.surfaceId !== tab.surfaceId) return tab;
    // Sync only ever sees a private tab's placeholder; the page stays local.
    if (isPrivateBrowserTab(old)) return { ...tab, ...old };
    let state = tab.state;
    if (tab.surfaceId === "files") state = old.state;
    if (tab.surfaceId === "browser") {
      const nextBrowser = parseBrowserTabState(tab.state);
      const oldBrowser = parseBrowserTabState(old.state);
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
    const tabs = node.tabs.map(retainTab);
    const old = oldPanes.get(node.id);
    // History stays local to the pane and its current view. Replacing a view
    // remotely must not resurrect that view through an unrelated history stack.
    const history =
      old?.activeTabId === node.activeTabId && old?.history
        ? {
            ...old.history,
            entries: old.history.entries.map((entry, index) =>
              index === old.history!.index
                ? (tabs.find((tab) => tab.id === entry.id) ?? entry)
                : entry,
            ),
          }
        : undefined;
    return { ...node, tabs, history };
  };
  return incoming.map((window) => {
    const old = oldWindows.get(window.id);
    const tabs = layoutTabs(window.layout).map((layout) => ({
      ...layout,
      root: retainTree(layout.root),
    }));
    const selected =
      tabs.find((layout) => layout.id === window.layout.activeLayoutTabId) ?? tabs[0];
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
