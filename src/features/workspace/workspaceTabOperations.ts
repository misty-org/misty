import { appViewHasUnsavedChanges } from "@/features/apps/appUpdateSafety";
import { dockTabs } from "./dockTree";
import type {
  WorkspaceDockNode,
  WorkspaceScopeKey,
  WorkspaceTab,
  WorkspaceVirtualWindow,
} from "./model";

export function removeDockTab(
  node: WorkspaceDockNode,
  tabId: string,
  preferredTabId?: string,
): WorkspaceDockNode {
  if (node.type === "leaf") {
    const index = node.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return node;
    const tabs = node.tabs.filter((tab) => tab.id !== tabId);
    return {
      ...node,
      tabs,
      activeTabId:
        node.activeTabId === tabId
          ? (tabs.find((tab) => tab.id === preferredTabId)?.id ??
            tabs[Math.min(index, tabs.length - 1)]?.id ??
            null)
          : node.activeTabId,
    };
  }
  const first = removeDockTab(node.first, tabId, preferredTabId);
  const second = removeDockTab(node.second, tabId, preferredTabId);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function compareTabRecency(a: WorkspaceTab, b: WorkspaceTab): number {
  return b.lastFocusedAt - a.lastFocusedAt || b.createdAt - a.createdAt;
}

export function nextWorkspaceFocusTimestamp(
  windowsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceVirtualWindow[]>>,
): number {
  const latest = Object.values(windowsByScope)
    .flatMap((windows) => windows ?? [])
    .flatMap((window) => dockTabs(window.layout.root))
    .reduce((maximum, tab) => Math.max(maximum, tab.lastFocusedAt), 0);
  return Math.max(Date.now(), latest + 1);
}

export function nextTabTitle(
  tabs: WorkspaceTab[] | undefined,
  surfaceId: WorkspaceTab["surfaceId"],
  baseLabel: string,
): string {
  if (!tabs?.length) return baseLabel;
  const existing = tabs.filter(
    (t) =>
      t.surfaceId === surfaceId && (t.title === baseLabel || t.title.startsWith(`${baseLabel} `)),
  );
  if (existing.length === 0) return baseLabel;
  return `${baseLabel} ${existing.length + 1}`;
}

export function lastUsedUpdatesForTab(
  tab: { groupKey: WorkspaceTab["groupKey"]; surfaceId: WorkspaceTab["surfaceId"] },
  tabId: string,
): Record<string, string> {
  const updates: Record<string, string> = { [tab.groupKey]: tabId };
  if (tab.surfaceId === "space") {
    const spaceId = tab.groupKey.split(":")[1];
    if (spaceId) updates[`space:${spaceId}`] = tabId;
  }
  return updates;
}

export function canCloseWorkspaceTab(_tab?: WorkspaceTab, _scopedTabs?: WorkspaceTab[]): boolean {
  if (_tab && appViewHasUnsavedChanges(_tab.id)) {
    window.dispatchEvent(new CustomEvent("misty:app-update-notice", {detail: "Save the changes in Code before closing this tab."}));
    return false;
  }
  return true;
}

export function canCloseWorkspaceWindow(
  _workspaceWindow: WorkspaceVirtualWindow,
  scopedWindows: WorkspaceVirtualWindow[],
): boolean {
  return scopedWindows.length > 1;
}
