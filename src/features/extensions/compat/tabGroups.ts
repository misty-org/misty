import { browserTabIdForRuntime } from "@/features/webviews/browserRuntime";
import { dockTreeViews, layoutTabs, useWorkspaceStore } from "@/features/workspace";
import type { MistyTabGroup, TabGroupColor } from "@/features/workspace/tabGroups";
import { compatObject, emitCompatEvent, type CompatHandler } from "./events";

/** Chrome numbers groups; Misty names them. The number is a stable hash of the name. */
function groupNumber(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 1) || 1;
}
const chromeColor = (color: TabGroupColor) => (color === "gray" ? "grey" : color);
const mistyColor = (value: unknown): TabGroupColor | undefined =>
  value === "grey"
    ? "gray"
    : (["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"] as const).find(
        (color) => color === value,
      );

/** Open groups in the current window; closed (saved) groups have no tabs to show. */
function openGroups(): MistyTabGroup[] {
  const state = useWorkspaceStore.getState();
  return state.tabGroups.filter((g) => g.scopeKey === state.activeScopeKey && !g.savedTabs);
}
function apiGroup(group: MistyTabGroup) {
  return {
    id: groupNumber(group.id),
    title: group.name,
    color: chromeColor(group.color),
    collapsed: group.collapsed,
    windowId: -1,
  };
}
function findGroup(value: unknown): MistyTabGroup {
  const group = openGroups().find((g) => groupNumber(g.id) === Number(value));
  if (!group) throw new Error(`No group with id: ${String(value)}.`);
  return group;
}

/** Workspace tabs for the runtime ids Misty's native host resolved. Groups
 * belong to one window, so every tab must be in the current one. */
function workspaceTabs(value: unknown): string[] {
  const runtimeIds = Array.isArray(value) ? value.map(String) : [];
  const tabs = layoutTabs(useWorkspaceStore.getState().layout);
  return runtimeIds.map((runtimeId) => {
    const viewId = browserTabIdForRuntime(runtimeId);
    const tab = tabs.find((candidate) => dockTreeViews(candidate.root).some((v) => v.id === viewId));
    if (!tab) throw new Error("Misty can group tabs only in the current window.");
    return tab.id;
  });
}

export const tabGroupHandlers: Record<string, CompatHandler> = {
  "tabs.group": ([runtimeIds, groupId]) => {
    const tabIds = workspaceTabs(runtimeIds);
    const workspace = useWorkspaceStore.getState();
    if (groupId !== null && groupId !== undefined) {
      const group = findGroup(groupId);
      for (const tabId of tabIds) useWorkspaceStore.getState().addTabToGroup(tabId, group.id);
      return groupNumber(group.id);
    }
    const created = workspace.createTabGroup(tabIds);
    if (!created) throw new Error("Misty could not group those tabs.");
    return groupNumber(created);
  },
  "tabs.ungroup": ([runtimeIds]) => {
    for (const tabId of workspaceTabs(runtimeIds))
      useWorkspaceStore.getState().addTabToGroup(tabId, null);
  },
  "tabGroups.get": ([id]) => apiGroup(findGroup(id)),
  "tabGroups.query": ([value]) => {
    const query = compatObject(value);
    const color = query.color === undefined ? undefined : mistyColor(query.color);
    return openGroups()
      .filter(
        (g) =>
          (query.title === undefined || g.name === query.title) &&
          (query.color === undefined || g.color === color) &&
          (query.collapsed === undefined || g.collapsed === query.collapsed),
      )
      .map(apiGroup);
  },
  "tabGroups.update": ([id, value]) => {
    const group = findGroup(id);
    const changes = compatObject(value);
    const color = mistyColor(changes.color);
    useWorkspaceStore.getState().updateTabGroup(group.id, {
      ...(typeof changes.title === "string" ? { name: changes.title } : {}),
      ...(color ? { color } : {}),
    });
    if (typeof changes.collapsed === "boolean" && changes.collapsed !== group.collapsed)
      useWorkspaceStore.getState().toggleTabGroup(group.id);
    return apiGroup(findGroup(id));
  },
};

/** Reports tab groups made, changed or removed in the current window. */
export function watchTabGroups(): () => void {
  let previous = new Map(openGroups().map((g) => [g.id, g]));
  return useWorkspaceStore.subscribe((state, prior) => {
    if (state.tabGroups === prior.tabGroups && state.activeScopeKey === prior.activeScopeKey) return;
    const current = new Map(openGroups().map((g) => [g.id, g]));
    // Switching Spaces shows other groups; nothing was made or removed.
    if (state.activeScopeKey !== prior.activeScopeKey) {
      previous = current;
      return;
    }
    for (const [id, group] of current) {
      const before = previous.get(id);
      if (!before) emitCompatEvent("tabGroups.onCreated", [apiGroup(group)]);
      else if (
        before.name !== group.name ||
        before.color !== group.color ||
        before.collapsed !== group.collapsed
      )
        emitCompatEvent("tabGroups.onUpdated", [apiGroup(group)]);
    }
    for (const [id, group] of previous)
      if (!current.has(id)) emitCompatEvent("tabGroups.onRemoved", [apiGroup(group)]);
    previous = current;
  });
}
