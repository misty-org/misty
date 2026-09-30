import { useBrowserSyncStore } from "@/features/browser-workspace/store";
import { allLayoutViews } from "@/features/workspace/layoutTabs";
import { workspaceViewHasUnsavedChanges } from "@/features/workspace/unsavedChanges";
import type { WorkspaceDockNode, WorkspaceScopeKey, WorkspaceView, WorkspaceWindow } from "./model";

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

export function nextWorkspaceFocusTimestamp(
  windowsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceWindow[]>>,
): number {
  const latest = Object.values(windowsByScope)
    .flatMap((windows) => windows ?? [])
    .flatMap((window) => allLayoutViews(window.layout))
    .reduce((maximum, tab) => Math.max(maximum, tab.lastFocusedAt), 0);
  return Math.max(Date.now(), latest + 1);
}

export function nextViewTitle(
  tabs: WorkspaceView[] | undefined,
  surfaceId: WorkspaceView["surfaceId"],
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

export function canCloseWorkspaceView(
  _tab?: WorkspaceView,
  _scopedTabs?: WorkspaceView[],
): boolean {
  const session = useBrowserSyncStore.getState().session;
  const live = (deviceId?: string | null) =>
    !!deviceId && (session?.presence?.find((item) => item.device_id === deviceId)?.online ?? true);
  // Legacy workspaces have one active device; others follow it. Device trees
  // take edits from every machine on them, so nothing is ever read-only.
  const following =
    session &&
    session.full_sync !== false &&
    !session.sync &&
    !!session.workspace.active_device?.device_id &&
    session.workspace.active_device.device_id !== session.device_id &&
    live(session.workspace.active_device.device_id);
  if (following) {
    window.dispatchEvent(
      new CustomEvent("misty:workspace-notice", {
        detail: "Continue on this device before closing tabs in the synced workspace.",
      }),
    );
    return false;
  }
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

export function canCloseWorkspaceWindow(
  _workspaceWindow: WorkspaceWindow,
  scopedWindows: WorkspaceWindow[],
): boolean {
  return (
    scopedWindows.length > 1 &&
    canCloseWorkspaceView() &&
    allLayoutViews(_workspaceWindow.layout).every((tab) => canCloseWorkspaceView(tab))
  );
}
