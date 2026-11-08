import { dockTreeViews } from "../panes/dockTree";
import { activateTab, isEmptyTab, layoutTabs } from "../panes/layoutTabs";
import type { WorkspaceLayout, WorkspaceTab } from "./workspaceViews";
import { contiguousTabs } from "../tab-groups/tabGroups";
import type { WorkspaceStore } from "./useWorkspaceStore";
import { normalizeWorkspaceLayout } from "../profiles/windows";

const unusedTab = (tab: WorkspaceTab) =>
  isEmptyTab(tab) || dockTreeViews(tab.root).every((view) => view.placeholder);

/** A window showing nothing but the new tab it opened with. */
export function isUntouched(layout: WorkspaceLayout): boolean {
  return layoutTabs(layout).every(unusedTab);
}

/**
 * The store patch that moves a closed window's tabs into this one. They join the end of the tab
 * strip and stay asleep, since a page only loads when its tab is first shown; this window keeps
 * the tab it has on screen. A window with only its first empty tab takes up where the closed
 * one was instead. Nothing a closed window held is dropped except its unused new tabs.
 */
export function adoptWindowTabs(
  current: Pick<WorkspaceStore, "layout" | "tabGroups" | "closedItems">,
  closed: Partial<Pick<WorkspaceStore, "layout" | "tabGroups" | "closedItems">>,
): Partial<WorkspaceStore> {
  const held = new Set(layoutTabs(current.layout).map((tab) => tab.id));
  const incoming = closed.layout
    ? layoutTabs(closed.layout).filter((tab) => !held.has(tab.id) && !unusedTab(tab))
    : [];
  const closedItems = closed.closedItems?.length
    ? [...current.closedItems, ...closed.closedItems]
    : current.closedItems;
  if (!incoming.length) return { closedItems };
  const replace = isUntouched(current.layout);
  const tabs = replace ? incoming : [...layoutTabs(current.layout), ...incoming];
  const active = replace
    ? (incoming.find((tab) => tab.id === closed.layout?.activeTabId) ?? incoming[0]).id
    : (current.layout.activeTabId ?? tabs[0].id);
  const groups = new Set(incoming.flatMap((tab) => (tab.tabGroupId ? [tab.tabGroupId] : [])));
  const known = new Set(current.tabGroups.map((group) => group.id));
  return {
    layout: normalizeWorkspaceLayout(
      activateTab({ ...current.layout, tabs: contiguousTabs(tabs) }, active),
    ),
    closedItems,
    tabGroups: [
      ...current.tabGroups,
      ...(closed.tabGroups ?? []).filter(
        (group) => groups.has(group.id) && !group.savedTabs && !known.has(group.id),
      ),
    ],
  };
}
