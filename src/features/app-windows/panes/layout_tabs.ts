import { workspaceSurfaceFromRoute } from "../tabs/route_surface";
import { createDockLeaf, dockLeaves, dockTreeViews, mapDockTreeViews } from "./dock_tree";
import type {
  WorkspaceDockNode,
  WorkspaceLayout,
  WorkspaceTab,
  WorkspaceView,
} from "../tabs/workspace_views";

export function layoutTabs(layout: WorkspaceLayout): WorkspaceTab[] {
  if (layout.tabs?.length) return layout.tabs;
  return [
    {
      id: `layout:${dockTreeViews(layout.root)[0]?.id ?? layout.root.id}`,
      root: layout.root,
      focusedPaneId: layout.focusedPaneId,
    },
  ];
}

export function allLayoutPanes(layout: WorkspaceLayout) {
  return layoutTabs(layout).flatMap((tab) => dockLeaves(tab.root));
}

export function allLayoutViews(layout: WorkspaceLayout): WorkspaceView[] {
  return layoutTabs(layout).flatMap((tab) => dockTreeViews(tab.root));
}

export function activeLayoutView(
  layout: Pick<WorkspaceLayout, "root" | "focusedPaneId">,
): WorkspaceView | null {
  const panes = dockLeaves(layout.root);
  const pane = panes.find((pane) => pane.id === layout.focusedPaneId) ?? panes[0];
  return pane?.views.find((tab) => tab.id === pane.activeViewId) ?? pane?.views[0] ?? null;
}

export function activateTab(layout: WorkspaceLayout, id: string): WorkspaceLayout {
  const tabs = layoutTabs(layout);
  const active = tabs.find((tab) => tab.id === id);
  return active
    ? { ...layout, root: active.root, focusedPaneId: active.focusedPaneId, tabs, activeTabId: id }
    : layout;
}

export function isEmptyTab(tab: WorkspaceTab): boolean {
  return dockTreeViews(tab.root).length === 0;
}

export function emptyTab(): WorkspaceTab {
  const pane = createDockLeaf();
  return { id: `layout:${pane.id}`, root: pane, focusedPaneId: pane.id };
}

export function appendTab(layout: WorkspaceLayout, tab: WorkspaceTab): WorkspaceLayout {
  const kept = isEmptyTab(tab) ? [] : layoutTabs(layout).filter((t) => !isEmptyTab(t));
  return activateTab({ ...layout, tabs: [...kept, tab] }, tab.id);
}

export function singleViewTab(view: WorkspaceView): WorkspaceTab {
  const pane = createDockLeaf([view]);
  return { id: `layout:${view.id}`, root: pane, focusedPaneId: pane.id };
}

export function mapLayoutViews(
  layout: WorkspaceLayout,
  update: (view: WorkspaceView) => WorkspaceView,
): WorkspaceLayout {
  if (!layout.tabs?.length) return { ...layout, root: mapDockTreeViews(layout.root, update) };
  const tabs = layoutTabs(layout).map((tab) => ({
    ...tab,
    root: mapDockTreeViews(tab.root, update),
  }));
  return activateTab({ ...layout, tabs }, layout.activeTabId ?? tabs[0].id);
}

export function migrateTabs(layout: WorkspaceLayout): WorkspaceLayout {
  if (layout.tabs?.length) return layout;
  const hidden: WorkspaceView[] = [];
  const visit = (node: WorkspaceDockNode): WorkspaceDockNode => {
    if (node.type === "split")
      return { ...node, first: visit(node.first), second: visit(node.second) };
    const active = node.views.find((tab) => tab.id === node.activeViewId) ?? node.views[0];
    hidden.push(...node.views.filter((tab) => tab !== active));
    return { ...node, views: active ? [active] : [], activeViewId: active?.id ?? null };
  };
  const root = visit(layout.root);
  const view = activeLayoutView({ ...layout, root });
  const active = {
    id: `layout:${view?.id ?? root.id}`,
    root,
    focusedPaneId: layout.focusedPaneId,
  };
  return {
    ...active,
    tabs: [active, ...hidden.map(singleViewTab)],
    activeTabId: active.id,
  };
}

export function paneViewLabel(view: WorkspaceView | null | undefined): string {
  if (!view || view.placeholder) return "New tab";
  return view.title?.trim() || workspaceSurfaceFromRoute(view.route)?.title || "New tab";
}
export function tabLabel(tab: WorkspaceTab): string {
  const view = activeLayoutView(tab);
  if (view?.placeholder) return tab.title && tab.title !== "New pane" ? tab.title : "New tab";
  return tab.title || paneViewLabel(view);
}

export function recoverPaneHistoryViews(layout: WorkspaceLayout): WorkspaceLayout {
  const tabs = layoutTabs(layout);
  const visible = new Set(allLayoutViews(layout).map((view) => view.id));
  const recovered = new Map<string, WorkspaceView>();
  let changed = false;
  const visit = (node: WorkspaceDockNode): WorkspaceDockNode => {
    if (node.type === "split")
      return { ...node, first: visit(node.first), second: visit(node.second) };
    const active = node.views[0];
    if (!active || !node.history?.entries.some((entry) => entry.id !== active.id)) return node;
    changed = true;
    for (const entry of node.history.entries) {
      if (!entry.placeholder && !visible.has(entry.id)) recovered.set(entry.id, entry);
    }
    const entries = node.history.entries.filter((entry) => entry.id === active.id);
    const index = Math.max(
      0,
      node.history.entries
        .slice(0, node.history.index + 1)
        .filter((entry) => entry.id === active.id).length - 1,
    );
    return { ...node, history: entries.length ? { entries, index } : undefined };
  };
  const updated = tabs.map((tab) => ({
    ...tab,
    root: visit(tab.id === layout.activeTabId ? layout.root : tab.root),
  }));
  if (!changed) return layout;
  return activateTab(
    { ...layout, tabs: [...updated, ...Array.from(recovered.values(), singleViewTab)] },
    layout.activeTabId ?? tabs[0].id,
  );
}

export function workspaceTabsById(state: {
  layout: WorkspaceLayout;
  asides?: Record<string, { layout: WorkspaceLayout }>;
}): Map<string, WorkspaceView> {
  const views = [
    ...allLayoutViews(state.layout),
    ...Object.values(state.asides ?? {}).flatMap((aside) => allLayoutViews(aside.layout)),
  ];
  return new Map(views.map((tab) => [tab.id, tab]));
}
