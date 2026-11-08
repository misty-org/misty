import { allLayoutViews } from "../panes/layoutTabs";
import { workspaceViewHasUnsavedChanges } from "../recovery/unsavedChanges";
import type { WorkspaceDockNode, WorkspaceLayout, WorkspaceView } from "./workspaceViews";

export function removeDockView(
  node: WorkspaceDockNode,
  tabId: string,
  preferredTabId?: string,
): WorkspaceDockNode {
  if (node.type === "leaf") {
    const index = node.views.findIndex((tab) => tab.id === tabId);
    if (index < 0) return node;
    const tabs = node.views.filter((tab) => tab.id !== tabId);
    return {
      ...node,
      views: tabs,
      activeViewId:
        node.activeViewId === tabId
          ? (tabs.find((tab) => tab.id === preferredTabId)?.id ??
            tabs[Math.min(index, tabs.length - 1)]?.id ??
            null)
          : node.activeViewId,
    };
  }
  const first = removeDockView(node.first, tabId, preferredTabId);
  const second = removeDockView(node.second, tabId, preferredTabId);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function compareViewRecency(a: WorkspaceView, b: WorkspaceView): number {
  return b.lastFocusedAt - a.lastFocusedAt || b.createdAt - a.createdAt;
}

export function nextWorkspaceFocusTimestamp(layout: WorkspaceLayout): number {
  const latest = allLayoutViews(layout).reduce(
    (maximum, tab) => Math.max(maximum, tab.lastFocusedAt),
    0,
  );
  return Math.max(Date.now(), latest + 1);
}

export function lastUsedUpdatesForView(
  tab: { groupKey: WorkspaceView["groupKey"]; surfaceId: WorkspaceView["surfaceId"] },
  tabId: string,
): Record<string, string> {
  const updates: Record<string, string> = { [tab.groupKey]: tabId };
  if (tab.surfaceId === "space") {
    const spaceId = tab.groupKey.split(":")[1];
    if (spaceId) updates[`space:${spaceId}`] = tabId;
  }
  return updates;
}

export function canCloseWorkspaceView(_tab?: WorkspaceView): boolean {
  if (_tab && workspaceViewHasUnsavedChanges(_tab.id)) {
    window.dispatchEvent(
      new CustomEvent("misty:workspace-notice", {
        detail: "Save your changes before closing this tab.",
      }),
    );
    return false;
  }
  return true;
}
