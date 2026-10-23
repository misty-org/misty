import { normalizeDockingLayout, validDockingLayout } from "@/features/app-shell/dockingLayout";
import { traversePaneHistory } from "./paneHistory";
import { appendTab, layoutTabs, activateTab } from "./layoutTabs";
import {
  collapseEmptyDockLeaves,
  createDockId,
  createDockLeaf,
  dockLeaves,
  dockTreeViews,
  fillEmptyDockLeaves,
  findDockLeaf,
  insertDockSplit,
  mapDockLeaf,
  moveDockPane,
  normalizePaneLayout,
  removeDockLeaf,
  swapDockLeaves,
  updateDockSplitRatio,
} from "./dockTree";
import { canCloseWorkspaceView, removeDockView } from "./workspaceViewOperations";
import { maxWorkspacePanes } from "./model";
import { createDefaultWorkspaceView, createBlankWorkspaceView } from "./workspaceDefaultView";
import type { StoreApi } from "zustand";
import type { WorkspaceStore } from "./useWorkspaceStore";
import { withLayout } from "./workspaceLayoutUpdate";

/** Pane history, docking, splitting and the split layout. */
export function workspacePaneActions(
  set: StoreApi<WorkspaceStore>["setState"],
  get: () => WorkspaceStore,
): Pick<
  WorkspaceStore,
  | "navigatePane"
  | "moveView"
  | "dockView"
  | "dockViews"
  | "detachPaneToTab"
  | "reorderPaneViews"
  | "reorderView"
  | "splitPane"
  | "closePane"
  | "movePane"
  | "swapPanes"
  | "setWindowDockingLayout"
  | "fillEmptyPanes"
  | "updateSplitRatio"
> {
  return {
    navigatePane: (delta, paneId) => {
      const current = get(),
        pane = findDockLeaf(current.layout.root, paneId ?? current.layout.focusedPaneId);
      if (!pane) return null;
      const next = traversePaneHistory(pane, delta);
      if (
        !next ||
        (pane.views[0]?.id !== next.views[0]?.id && !canCloseWorkspaceView(pane.views[0]))
      )
        return null;
      set(
        withLayout(current, {
          ...current.layout,
          root: mapDockLeaf(current.layout.root, pane.id, () => next),
          focusedPaneId: pane.id,
        }),
      );
      return next.views[0] ?? null;
    },
    moveView: (tabId, paneId, index) => get().dockView(tabId, paneId, "center", index),
    dockView: (tabId, paneId, zone, index) => get().dockViews([tabId], paneId, zone, index),
    dockViews: (tabIds, paneId, zone) => {
      const current = get();
      if (tabIds.length !== 1) return false;
      const source = layoutTabs(current.layout).find((tab) =>
        dockTreeViews(tab.root).some((view) => view.id === tabIds[0]),
      );
      const targetTab = layoutTabs(current.layout).find((tab) =>
        dockLeaves(tab.root).some((pane) => pane.id === paneId),
      );
      const target = targetTab && findDockLeaf(targetTab.root, paneId);
      const sourcePane =
        source &&
        dockLeaves(source.root).find((pane) => pane.views.some((view) => view.id === tabIds[0]));
      const moving = sourcePane?.views.find((view) => view.id === tabIds[0]);
      if (!source || !targetTab || !target || !moving || !sourcePane || sourcePane.id === paneId)
        return false;
      if (zone !== "center" && dockLeaves(targetTab.root).length >= maxWorkspacePanes) return false;
      const same = source.id === targetTab.id;
      let sourceRoot = source.root;
      let targetRoot = targetTab.root;
      if (zone === "center") {
        // A pane has one view. Dropping in its center exchanges the views.
        sourceRoot = mapDockLeaf(sourceRoot, sourcePane.id, (pane) => ({
          ...pane,
          views: target.views,
          activeViewId: target.activeViewId,
          history: target.history,
        }));
        targetRoot = mapDockLeaf(same ? sourceRoot : targetRoot, paneId, (pane) => ({
          ...pane,
          views: [moving],
          activeViewId: moving.id,
          history: sourcePane.history,
        }));
      } else {
        sourceRoot = removeDockView(sourceRoot, moving.id);
        targetRoot = insertDockSplit(same ? sourceRoot : targetRoot, paneId, sourcePane, zone);
      }
      const destinationRoot = collapseEmptyDockLeaves(targetRoot)!;
      const sourceRemaining = collapseEmptyDockLeaves(sourceRoot);
      const destinationPane = dockLeaves(destinationRoot).find((pane) =>
        pane.views.some((view) => view.id === moving.id),
      )!;
      const tabs = layoutTabs(current.layout).flatMap((tab) => {
        if (tab.id === targetTab.id)
          return [{ ...tab, root: destinationRoot, focusedPaneId: destinationPane.id }];
        if (tab.id !== source.id) return [tab];
        return sourceRemaining
          ? [{ ...tab, root: sourceRemaining, focusedPaneId: dockLeaves(sourceRemaining)[0].id }]
          : [];
      });
      set(withLayout(current, activateTab({ ...current.layout, tabs }, targetTab.id)));
      return true;
    },
    detachPaneToTab: (viewId) => {
      const current = get();
      const source = layoutTabs(current.layout).find((tab) =>
        dockTreeViews(tab.root).some((view) => view.id === viewId),
      );
      if (!source) return false;
      if (dockLeaves(source.root).length === 1) return get().focusView(viewId);
      const pane = dockLeaves(source.root).find((pane) => pane.views[0]?.id === viewId)!;
      const root = removeDockLeaf(source.root, pane.id)!;
      const updated = { ...source, root, focusedPaneId: dockLeaves(root)[0].id };
      const newTab = { id: createDockId("tab"), root: pane, focusedPaneId: pane.id };
      const tabs = layoutTabs(current.layout).map((tab) => (tab.id === source.id ? updated : tab));
      set(
        withLayout(current, appendTab(activateTab({ ...current.layout, tabs }, source.id), newTab)),
      );
      return true;
    },
    reorderPaneViews: (_paneId, ids) => {
      const tabs = layoutTabs(get().layout);
      const order = ids
        .map((id) => tabs.find((tab) => dockTreeViews(tab.root).some((view) => view.id === id))?.id)
        .filter((id): id is string => Boolean(id));
      if (order.length === tabs.length) get().reorderTabs(order);
    },
    reorderView: (_paneId, tabId, index) => {
      const tabs = layoutTabs(get().layout);
      const moving = tabs.find((tab) => dockTreeViews(tab.root).some((view) => view.id === tabId));
      if (!moving) return;
      const ids = tabs.filter((tab) => tab.id !== moving.id).map((tab) => tab.id);
      ids.splice(Math.max(0, Math.min(index, ids.length)), 0, moving.id);
      get().reorderTabs(ids);
    },
    splitPane: (paneId, direction, tabId) => {
      const current = get();
      if (tabId) {
        if (!get().dockView(tabId, paneId, direction)) return null;
        return (
          dockLeaves(get().layout.root).find((pane) => pane.views.some((tab) => tab.id === tabId))
            ?.id ?? null
        );
      }
      if (dockLeaves(current.layout.root).length >= maxWorkspacePanes) return null;
      const pane = findDockLeaf(current.layout.root, paneId);
      if (!pane) return null;
      const leaf = createDockLeaf([createBlankWorkspaceView(current.activeScopeKey)]);
      set({
        ...withLayout(current, {
          ...current.layout,
          root: normalizePaneLayout(insertDockSplit(current.layout.root, paneId, leaf, direction)),
          focusedPaneId: leaf.id,
        }),
      });
      return leaf.id;
    },
    closePane: (paneId) => {
      const pane = findDockLeaf(get().layout.root, paneId);
      if (dockLeaves(get().layout.root).length > 1 && pane?.views[0])
        get().closeView(pane.views[0].id, paneId);
    },
    movePane: (paneId, direction, targetPaneId) => {
      const current = get();
      const root = moveDockPane(current.layout.root, paneId, direction, targetPaneId);
      if (root === current.layout.root) return false;
      set({ ...withLayout(current, { ...current.layout, root, focusedPaneId: paneId }) });
      return true;
    },
    swapPanes: (firstPaneId, secondPaneId) => {
      const current = get();
      const root = swapDockLeaves(
        normalizePaneLayout(current.layout.root),
        firstPaneId,
        secondPaneId,
      );
      if (root === current.layout.root) return false;
      set({ ...withLayout(current, { ...current.layout, root, focusedPaneId: secondPaneId }) });
      return true;
    },
    setWindowDockingLayout: (dockingLayout) => {
      if (!validDockingLayout(dockingLayout)) return;
      set({ dockingLayout: normalizeDockingLayout(dockingLayout) });
    },
    fillEmptyPanes: () => {
      set((current) => {
        const root = fillEmptyDockLeaves(current.layout.root, () =>
          createDefaultWorkspaceView(current.activeScopeKey),
        );
        return root === current.layout.root
          ? current
          : withLayout(current, { ...current.layout, root });
      });
    },
    updateSplitRatio: (splitId, ratio) => {
      set((current) => {
        const root = updateDockSplitRatio(current.layout.root, splitId, ratio);
        return root === current.layout.root
          ? current
          : withLayout(current, { ...current.layout, root });
      });
    },
  };
}
