import type { StoreApi } from "zustand";
import { dockTreeViews } from "../panes/dock_tree";
import { layoutTabs } from "../panes/layout_tabs";
import {
  addTabToGroup,
  groupTabs,
  groupTabWith,
  moveGroup,
  moveTabTo,
  removeTabFromGroup,
  separateTab,
  showGroupSideBySide,
  ungroup,
  updateGroup,
} from "../panes/tab_groups";
import type { WorkspaceStore } from "./use_workspace_store";
import type { WorkspaceLayout, WorkspaceView } from "./workspace_views";
import { withLayout } from "./workspace_layout_update";

export function workspaceGroupActions(
  set: StoreApi<WorkspaceStore>["setState"],
  get: () => WorkspaceStore,
): Pick<
  WorkspaceStore,
  | "groupTabWith"
  | "addTabToGroup"
  | "newTabGroup"
  | "removeTabFromGroup"
  | "moveTab"
  | "moveTabGroup"
  | "updateTabGroup"
  | "toggleTabGroup"
  | "ungroupTabs"
  | "closeTabGroup"
  | "newTabInGroup"
  | "showTabGroupSideBySide"
  | "separateTab"
> {
  const apply = (change: (layout: WorkspaceLayout) => WorkspaceLayout) => {
    const current = get();
    const next = change(current.layout);
    if (next !== current.layout) set(withLayout(current, next));
  };
  const members = (id: string) => layoutTabs(get().layout).filter((tab) => tab.group === id);
  return {
    groupTabWith: (tabId, targetId) => apply((layout) => groupTabWith(layout, tabId, targetId)),
    addTabToGroup: (tabId, group) => apply((layout) => addTabToGroup(layout, tabId, group)),
    newTabGroup: (tabId) => apply((layout) => groupTabs(layout, [tabId])),
    removeTabFromGroup: (tabId) => apply((layout) => removeTabFromGroup(layout, tabId)),
    moveTab: (tabId, index, group) => apply((layout) => moveTabTo(layout, tabId, index, group)),
    moveTabGroup: (id, before) => apply((layout) => moveGroup(layout, id, before)),
    updateTabGroup: (id, patch) => apply((layout) => updateGroup(layout, id, patch)),
    toggleTabGroup: (id) => {
      const layout = get().layout;
      const group = layout.groups?.find((candidate) => candidate.id === id);
      if (!group) return null;
      if (group.collapsed) {
        apply((current) => updateGroup(current, id, { collapsed: false }));
        return null;
      }
      const tabs = layoutTabs(layout);
      let shown: WorkspaceView | null = null;
      if (tabs.find((tab) => tab.id === layout.activeTabId)?.group === id) {
        const end = tabs.map((tab) => tab.group).lastIndexOf(id);
        const start = tabs.findIndex((tab) => tab.group === id);
        const outside =
          tabs.slice(end + 1).find((tab) => dockTreeViews(tab.root).length) ??
          [...tabs.slice(0, start)].reverse().find((tab) => dockTreeViews(tab.root).length);
        if (!outside) return null;
        shown = get().selectTab(outside.id);
      }
      apply((current) => updateGroup(current, id, { collapsed: true }));
      return shown;
    },
    ungroupTabs: (id) => apply((layout) => ungroup(layout, id)),
    closeTabGroup: (id) => {
      let closed = false;
      for (const tab of members(id)) closed = get().closeTab(tab.id) || closed;
      return closed;
    },
    newTabInGroup: (id) => {
      const view = get().newTab();
      const owner = layoutTabs(get().layout).find((tab) =>
        dockTreeViews(tab.root).some((candidate) => candidate.id === view.id),
      );
      if (owner) apply((layout) => addTabToGroup(layout, owner.id, id));
      return view;
    },
    showTabGroupSideBySide: (id) => apply((layout) => showGroupSideBySide(layout, id)),
    separateTab: (tabId) => apply((layout) => separateTab(layout, tabId)),
  };
}
