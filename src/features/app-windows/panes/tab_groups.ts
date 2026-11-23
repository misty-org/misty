import { isTabGroupColor, tabGroupColors, type TabGroupColor } from "@misty/ui";
import { createDockId, dockLeaves, dockTreeViews } from "./dock_tree";
import { activateTab, layoutTabs } from "./layout_tabs";
import {
  maxWorkspacePanes,
  type WorkspaceDockNode,
  type WorkspaceLayout,
  type WorkspaceTab,
  type WorkspaceTabGroup,
} from "../tabs/workspace_views";

export function tabGroups(layout: WorkspaceLayout): WorkspaceTabGroup[] {
  return layout.groups ?? [];
}

function currentTabs(layout: WorkspaceLayout): WorkspaceTab[] {
  return layoutTabs(layout).map((tab) =>
    tab.id === layout.activeTabId
      ? { ...tab, root: layout.root, focusedPaneId: layout.focusedPaneId }
      : tab,
  );
}

function withTabs(
  layout: WorkspaceLayout,
  tabs: WorkspaceTab[],
  groups = tabGroups(layout),
  active?: string,
): WorkspaceLayout {
  const shown =
    tabs.find((tab) => tab.id === active) ??
    tabs.find((tab) => tab.id === layout.activeTabId) ??
    tabs[0];
  return activateTab({ ...layout, tabs, groups: groups.length ? groups : undefined }, shown.id);
}

export function tidyTabGroups(layout: WorkspaceLayout): WorkspaceLayout {
  const groups = tabGroups(layout).flatMap((group) =>
    group && typeof group.id === "string"
      ? [
          {
            id: group.id,
            title: typeof group.title === "string" ? group.title : "",
            color: isTabGroupColor(group.color) ? group.color : "grey",
            ...(group.collapsed ? { collapsed: true } : {}),
          },
        ]
      : [],
  );
  const known = new Set(groups.map((group) => group.id));
  const tabs = layoutTabs(layout).map((tab) =>
    tab.group && !known.has(tab.group) ? { ...tab, group: undefined } : tab,
  );
  const placed = new Set<string>();
  const ordered = tabs.flatMap((tab) => {
    if (!tab.group) return [tab];
    if (placed.has(tab.group)) return [];
    placed.add(tab.group);
    return tabs.filter((other) => other.group === tab.group);
  });
  const active = ordered.find((tab) => tab.id === layout.activeTabId)?.group;
  const kept = groups
    .filter((group) => placed.has(group.id))
    .map((group) => (group.id === active && group.collapsed ? { ...group, collapsed: false } : group));
  const sameTabs =
    layout.tabs?.length === ordered.length &&
    ordered.every((tab, index) => tab === layout.tabs![index]);
  const sameGroups =
    kept.length === tabGroups(layout).length &&
    kept.every((group, index) => {
      const before = tabGroups(layout)[index];
      return (
        before.id === group.id &&
        before.title === group.title &&
        before.color === group.color &&
        Boolean(before.collapsed) === Boolean(group.collapsed)
      );
    });
  if ((sameTabs || !layout.tabs?.length) && sameGroups) return layout;
  return {
    ...layout,
    ...(layout.tabs?.length ? { tabs: ordered } : {}),
    groups: kept.length ? kept : undefined,
  };
}

export function nextGroupColor(layout: WorkspaceLayout): TabGroupColor {
  const used = tabGroups(layout).map((group) => group.color);
  return (
    tabGroupColors.find((color) => !used.includes(color)) ??
    tabGroupColors[used.length % tabGroupColors.length]
  );
}

function newGroup(layout: WorkspaceLayout): WorkspaceTabGroup {
  return {
    id: createDockId("tab").replace(/^tab/, "group"),
    title: "",
    color: nextGroupColor(layout),
  };
}

function placeTab(
  tabs: WorkspaceTab[],
  tab: WorkspaceTab,
  index: number,
): WorkspaceTab[] {
  const rest = tabs.filter((other) => other.id !== tab.id);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), tab, ...rest.slice(at)];
}

function groupEnd(tabs: WorkspaceTab[], group: string, skip?: string): number {
  const rest = tabs.filter((tab) => tab.id !== skip);
  const last = rest.map((tab) => tab.group).lastIndexOf(group);
  return last < 0 ? rest.length : last + 1;
}

export function addTabToGroup(
  layout: WorkspaceLayout,
  tabId: string,
  group: string,
): WorkspaceLayout {
  const tabs = currentTabs(layout);
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab || !tabGroups(layout).some((candidate) => candidate.id === group)) return layout;
  return withTabs(layout, placeTab(tabs, { ...tab, group }, groupEnd(tabs, group, tabId)));
}

export function groupTabs(layout: WorkspaceLayout, tabIds: string[]): WorkspaceLayout {
  const tabs = currentTabs(layout);
  const picked = tabs.filter((tab) => tabIds.includes(tab.id));
  if (!picked.length) return layout;
  const group = newGroup(layout);
  const first = tabs.indexOf(picked[0]);
  const rest = tabs.filter((tab) => !tabIds.includes(tab.id));
  const at = rest.filter((tab) => tabs.indexOf(tab) < first).length;
  const moved = picked.map((tab) => ({ ...tab, group: group.id }));
  return withTabs(layout, [...rest.slice(0, at), ...moved, ...rest.slice(at)], [
    ...tabGroups(layout),
    group,
  ]);
}

export function groupTabWith(
  layout: WorkspaceLayout,
  tabId: string,
  targetId: string,
): WorkspaceLayout {
  if (tabId === targetId) return layout;
  const tabs = currentTabs(layout);
  const tab = tabs.find((candidate) => candidate.id === tabId);
  const target = tabs.find((candidate) => candidate.id === targetId);
  if (!tab || !target) return layout;
  if (target.group) return addTabToGroup(layout, tabId, target.group);
  const group = newGroup(layout);
  const rest = tabs.filter((candidate) => candidate.id !== tabId);
  const at = rest.findIndex((candidate) => candidate.id === targetId);
  const next = [
    ...rest.slice(0, at),
    { ...target, group: group.id },
    { ...tab, group: group.id },
    ...rest.slice(at + 1),
  ];
  return withTabs(layout, next, [...tabGroups(layout), group]);
}

export function removeTabFromGroup(layout: WorkspaceLayout, tabId: string): WorkspaceLayout {
  const tabs = currentTabs(layout);
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab?.group) return layout;
  return withTabs(
    layout,
    placeTab(tabs, { ...tab, group: undefined }, groupEnd(tabs, tab.group, tabId)),
  );
}

export function moveTabTo(
  layout: WorkspaceLayout,
  tabId: string,
  index: number,
  group: string | null | undefined,
): WorkspaceLayout {
  const tabs = currentTabs(layout);
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab) return layout;
  const moved = group === undefined ? tab : { ...tab, group: group ?? undefined };
  return withTabs(layout, placeTab(tabs, moved, index));
}

export function moveGroup(
  layout: WorkspaceLayout,
  group: string,
  before: string | null,
): WorkspaceLayout {
  const tabs = currentTabs(layout);
  const block = tabs.filter((tab) => tab.group === group);
  if (!block.length || block.some((tab) => tab.id === before)) return layout;
  const rest = tabs.filter((tab) => tab.group !== group);
  const at = before ? rest.findIndex((tab) => tab.id === before) : rest.length;
  const index = at < 0 ? rest.length : at;
  return withTabs(layout, [...rest.slice(0, index), ...block, ...rest.slice(index)]);
}

export function updateGroup(
  layout: WorkspaceLayout,
  id: string,
  patch: Partial<Pick<WorkspaceTabGroup, "title" | "color" | "collapsed">>,
): WorkspaceLayout {
  return withTabs(
    layout,
    currentTabs(layout),
    tabGroups(layout).map((group) => (group.id === id ? { ...group, ...patch } : group)),
  );
}

export function ungroup(layout: WorkspaceLayout, id: string): WorkspaceLayout {
  return withTabs(
    layout,
    currentTabs(layout).map((tab) => (tab.group === id ? { ...tab, group: undefined } : tab)),
    tabGroups(layout).filter((group) => group.id !== id),
  );
}

export function groupPaneCount(layout: WorkspaceLayout, id: string): number {
  return currentTabs(layout)
    .filter((tab) => tab.group === id)
    .reduce((count, tab) => count + dockLeaves(tab.root).length, 0);
}

export function canShowSideBySide(layout: WorkspaceLayout, id: string): boolean {
  const members = currentTabs(layout).filter((tab) => tab.group === id);
  return members.length > 1 && groupPaneCount(layout, id) <= maxWorkspacePanes;
}

function sideBySide(roots: WorkspaceDockNode[]): WorkspaceDockNode {
  if (roots.length === 1) return roots[0];
  return {
    type: "split",
    id: createDockId("split"),
    direction: "horizontal",
    ratio: 1 / roots.length,
    first: roots[0],
    second: sideBySide(roots.slice(1)),
  };
}

export function showGroupSideBySide(layout: WorkspaceLayout, id: string): WorkspaceLayout {
  if (!canShowSideBySide(layout, id)) return layout;
  const tabs = currentTabs(layout);
  const members = tabs.filter((tab) => tab.group === id);
  const active = members.find((tab) => tab.id === layout.activeTabId) ?? members[0];
  const merged: WorkspaceTab = {
    id: members[0].id,
    root: sideBySide(members.map((tab) => tab.root)),
    focusedPaneId: active.focusedPaneId,
    group: id,
  };
  const at = tabs.indexOf(members[0]);
  const rest = tabs.filter((tab) => tab.group !== id);
  const shown = members.some((tab) => tab.id === layout.activeTabId)
    ? merged.id
    : layout.activeTabId;
  return withTabs(layout, [...rest.slice(0, at), merged, ...rest.slice(at)], undefined, shown);
}

export function separateTab(layout: WorkspaceLayout, tabId: string): WorkspaceLayout {
  const tabs = currentTabs(layout);
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab) return layout;
  const panes = dockLeaves(tab.root);
  if (panes.length < 2) return layout;
  const group = tab.group ? undefined : newGroup(layout);
  const groupId = tab.group ?? group!.id;
  const separated = panes.map(
    (pane, index): WorkspaceTab => ({
      id: index === 0 ? tab.id : `layout:${dockTreeViews(pane)[0]?.id ?? pane.id}`,
      root: pane,
      focusedPaneId: pane.id,
      group: groupId,
    }),
  );
  const at = tabs.indexOf(tab);
  const next = [...tabs.slice(0, at), ...separated, ...tabs.slice(at + 1)];
  return withTabs(layout, next, group ? [...tabGroups(layout), group] : tabGroups(layout));
}
