import { contiguousTabs } from "./tabGroups";
import {
  activeLayoutView,
  appendTab,
  emptyTab,
  layoutTabs,
  activateTab,
  singleViewTab,
} from "./layoutTabs";
import {
  collapseEmptyDockLeaves,
  dockLeaves,
  dockTreeViews,
  findDockLeaf,
  mapDockLeaf,
} from "./dockTree";
import type { WorkspaceGroupKey, WorkspaceLayout } from "./model";
import {
  canCloseWorkspaceView,
  lastUsedUpdatesForView,
  nextWorkspaceFocusTimestamp,
  removeDockView,
} from "./workspaceViewOperations";
import { rememberClosedWorkspaceView, restoreClosedWorkspaceItem } from "./closedWorkspaceItems";
import { maxWorkspacePanes } from "./model";
import type { StoreApi } from "zustand";
import type { WorkspaceStore } from "./useWorkspaceStore";
import { withLayout } from "./workspaceLayoutUpdate";

/** Focusing, selecting, closing and reopening tabs and views. */
export function workspaceTabActions(
  set: StoreApi<WorkspaceStore>["setState"],
  get: () => WorkspaceStore,
): Pick<
  WorkspaceStore,
  | "focusPane"
  | "focusView"
  | "selectTab"
  | "renameTab"
  | "reorderTabs"
  | "closeTab"
  | "closeView"
  | "reopenClosedView"
  | "cycleView"
  | "selectView"
> {
  return {
    focusPane: (paneId) => {
      const current = get();
      const pane = findDockLeaf(current.layout.root, paneId);
      if (!pane) return false;
      const tab =
        pane.views.find((candidate) => candidate.id === pane.activeViewId) ?? pane.views[0];
      if (tab) return get().focusView(tab.id);
      if (current.layout.focusedPaneId === paneId) return true;
      set(
        withLayout(current, {
          ...current.layout,
          focusedPaneId: paneId,
        }),
      );
      return true;
    },
    focusView: (tabId) => {
      let current = get();
      const ownerTab = layoutTabs(current.layout).find((tab) =>
        dockTreeViews(tab.root).some((view) => view.id === tabId),
      );
      if (!ownerTab) return false;
      if (ownerTab.tabGroupId) {
        set({
          tabGroups: get().tabGroups.map((g) =>
            g.id === ownerTab.tabGroupId && g.collapsed ? { ...g, collapsed: false } : g,
          ),
        });
        current = get();
      }
      const switched = ownerTab.id !== current.layout.activeTabId;
      if (ownerTab.id !== current.layout.activeTabId) {
        set(withLayout(current, activateTab(current.layout, ownerTab.id)));
        current = get();
      }
      const pane = dockLeaves(current.layout.root).find((candidate) =>
        candidate.views.some((tab) => tab.id === tabId),
      );
      const tab = pane?.views.find((candidate) => candidate.id === tabId);
      if (!pane || !tab) return false;
      const updates = lastUsedUpdatesForView(tab, tabId);
      if (!switched && current.layout.focusedPaneId === pane.id && pane.activeViewId === tabId) {
        if (
          (Object.keys(updates) as WorkspaceGroupKey[]).every(
            (key) => current.lastUsedViewByGroup[key] === updates[key],
          )
        ) {
          return true;
        }
        set({ lastUsedViewByGroup: { ...current.lastUsedViewByGroup, ...updates } });
        return true;
      }
      const now = nextWorkspaceFocusTimestamp(current.layoutsByScope);
      set({
        ...withLayout(current, {
          ...current.layout,
          focusedPaneId: pane.id,
          root: mapDockLeaf(current.layout.root, pane.id, (candidate) => ({
            ...candidate,
            activeViewId: tabId,
            views: candidate.views.map((item) =>
              item.id === tabId ? { ...item, lastFocusedAt: now } : item,
            ),
          })),
        }),
        lastUsedViewByGroup: { ...current.lastUsedViewByGroup, ...updates },
      });
      return true;
    },
    selectTab: (id) => {
      const current = get();
      const selected = layoutTabs(current.layout).find((tab) => tab.id === id);
      if (!selected) return null;
      if (selected.tabGroupId)
        set({
          tabGroups: current.tabGroups.map((g) =>
            g.id === selected.tabGroupId ? { ...g, collapsed: false } : g,
          ),
        });
      const view = activeLayoutView(selected);
      if (view) get().focusView(view.id);
      else set(withLayout(current, activateTab(current.layout, id)));
      return view;
    },
    renameTab: (id, title) => {
      const current = get();
      set(
        withLayout(current, {
          ...current.layout,
          tabs: layoutTabs(current.layout).map((tab) =>
            tab.id === id ? { ...tab, title: title.trim() || undefined } : tab,
          ),
        }),
      );
    },
    reorderTabs: (ids) => {
      const current = get(),
        tabs = layoutTabs(current.layout);
      if (
        ids.length !== tabs.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !tabs.some((tab) => tab.id === id))
      )
        return;
      set(
        withLayout(current, {
          ...current.layout,
          tabs: contiguousTabs(ids.map((id) => tabs.find((tab) => tab.id === id)!)),
        }),
      );
    },
    closeTab: (id) => {
      if (!canCloseWorkspaceView()) return false;
      const current = get(),
        tabs = layoutTabs(current.layout);
      const closing = tabs.find((tab) => tab.id === id);
      if (!closing || dockTreeViews(closing.root).some((view) => !canCloseWorkspaceView(view)))
        return false;
      const view = activeLayoutView(closing);
      let remaining = tabs.filter((tab) => tab.id !== id);
      if (!remaining.length) remaining = [emptyTab()];
      const next =
        remaining.find((tab) => tab.id === current.layout.activeTabId) ??
        [...remaining].sort(
          (a, b) =>
            Math.max(...dockTreeViews(b.root).map((view) => view.lastFocusedAt)) -
            Math.max(...dockTreeViews(a.root).map((view) => view.lastFocusedAt)),
        )[0];
      set({
        ...withLayout(current, activateTab({ ...current.layout, tabs: remaining }, next.id)),
        closedItems: view
          ? [
              {
                view,
                windowId: current.activeWindowId,
                paneId: closing.focusedPaneId,
                tab: closing,
              },
              ...current.closedItems,
            ].slice(0, 20)
          : current.closedItems,
      });
      return true;
    },
    closeView: (tabId, paneId) => {
      const current = get();
      const owner = layoutTabs(current.layout).find((tab) =>
        dockTreeViews(tab.root).some((view) => view.id === tabId),
      );
      if (!owner) return false;
      if (dockTreeViews(owner.root).length === 1) return get().closeTab(owner.id);
      const pane = dockLeaves(owner.root).find(
        (pane) => (!paneId || pane.id === paneId) && pane.views.some((view) => view.id === tabId),
      );
      const view = pane?.views.find((view) => view.id === tabId);
      if (!pane || !view || !canCloseWorkspaceView(view)) return false;
      const root = collapseEmptyDockLeaves(removeDockView(owner.root, tabId));
      if (!root) return false;
      const updated = {
        ...owner,
        root,
        focusedPaneId:
          owner.focusedPaneId === pane.id ? dockLeaves(root)[0].id : owner.focusedPaneId,
      };
      const layout = {
        ...current.layout,
        tabs: layoutTabs(current.layout).map((tab) => (tab.id === owner.id ? updated : tab)),
      };
      set({
        ...withLayout(current, activateTab(layout, current.layout.activeTabId ?? owner.id)),
        closedItems: [
          {
            ...rememberClosedWorkspaceView(owner, view, current.activeWindowId),
            tabId: owner.id,
          },
          ...current.closedItems,
        ].slice(0, 20),
      });
      return true;
    },
    reopenClosedView: (index = 0) => {
      const current = get();
      const closed = current.closedItems[index];
      if (!closed) return null;
      const closedTabs = current.closedItems.filter((_, position) => position !== index);
      let layout: WorkspaceLayout;
      if (closed.tab) layout = appendTab(current.layout, closed.tab);
      else {
        const owner = layoutTabs(current.layout).find((tab) => tab.id === closed.tabId);
        if (owner && dockLeaves(owner.root).length < maxWorkspacePanes) {
          const restored = restoreClosedWorkspaceItem(owner, closed, closed.view);
          const updated = {
            ...owner,
            root: restored.root,
            focusedPaneId: restored.focusedPaneId,
          };
          layout = activateTab(
            {
              ...current.layout,
              tabs: layoutTabs(current.layout).map((tab) => (tab.id === owner.id ? updated : tab)),
            },
            owner.id,
          );
        } else {
          const restored = singleViewTab(closed.view);
          if (closed.pane) {
            restored.root = closed.pane;
            restored.focusedPaneId = closed.pane.id;
          }
          layout = appendTab(current.layout, restored);
        }
      }
      set({ ...withLayout(current, layout), closedItems: closedTabs });
      get().focusView(closed.view.id);
      return closed.view;
    },
    cycleView: (direction) => {
      const current = get(),
        tabs = layoutTabs(current.layout);
      const index = Math.max(
        0,
        tabs.findIndex((tab) => tab.id === current.layout.activeTabId),
      );
      return get().selectTab(tabs[(index + direction + tabs.length) % tabs.length].id);
    },
    selectView: (index) => {
      const tabs = layoutTabs(get().layout);
      const tab = index === "last" ? tabs[tabs.length - 1] : tabs[index];
      return tab ? get().selectTab(tab.id) : null;
    },
  };
}
