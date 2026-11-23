import { dockTreeViews } from "../panes/dock_tree";
import { activateTab, isEmptyTab, layoutTabs } from "../panes/layout_tabs";
import type { WorkspaceLayout, WorkspaceTab } from "./workspace_views";
import type { WorkspaceStore } from "./use_workspace_store";
import { normalizeWorkspaceLayout } from "../profiles/windows";

const unusedTab = (tab: WorkspaceTab) =>
  isEmptyTab(tab) || dockTreeViews(tab.root).every((view) => view.placeholder);

export function isUntouched(layout: WorkspaceLayout): boolean {
  return layoutTabs(layout).every(unusedTab);
}

export function adoptWindowTabs(
  current: Pick<WorkspaceStore, "layout" | "closedItems">,
  closed: Partial<Pick<WorkspaceStore, "layout" | "closedItems">>,
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
  return {
    layout: normalizeWorkspaceLayout(activateTab({ ...current.layout, tabs }, active)),
    closedItems,
  };
}
