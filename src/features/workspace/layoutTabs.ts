import { workspaceSurfaceFromRoute } from "./routeSurface";
import { createDockLeaf, dockLeaves, dockTabs, mapDockTabs } from "./dockTree";
import type { WorkspaceDockNode, WorkspaceLayout, WorkspaceLayoutTab, WorkspaceTab } from "./model";

export function layoutTabs(layout: WorkspaceLayout): WorkspaceLayoutTab[] {
  if (layout.tabs?.length) return layout.tabs;
  return [
    {
      id: `layout:${dockTabs(layout.root)[0]?.id ?? layout.root.id}`,
      root: layout.root,
      focusedPaneId: layout.focusedPaneId,
    },
  ];
}

export function allLayoutPanes(layout: WorkspaceLayout) {
  return layoutTabs(layout).flatMap((tab) => dockLeaves(tab.root));
}

export function allLayoutViews(layout: WorkspaceLayout): WorkspaceTab[] {
  return layoutTabs(layout).flatMap((tab) => dockTabs(tab.root));
}

export function activeLayoutView(
  layout: Pick<WorkspaceLayout, "root" | "focusedPaneId">,
): WorkspaceTab | null {
  const panes = dockLeaves(layout.root);
  const pane = panes.find((pane) => pane.id === layout.focusedPaneId) ?? panes[0];
  return pane?.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane?.tabs[0] ?? null;
}

export function selectLayoutTab(layout: WorkspaceLayout, id: string): WorkspaceLayout {
  const tabs = layoutTabs(layout);
  const active = tabs.find((tab) => tab.id === id);
  return active
    ? { root: active.root, focusedPaneId: active.focusedPaneId, tabs, activeLayoutTabId: id }
    : layout;
}

export function appendLayoutTab(layout: WorkspaceLayout, tab: WorkspaceLayoutTab): WorkspaceLayout {
  return selectLayoutTab({ ...layout, tabs: [...layoutTabs(layout), tab] }, tab.id);
}

export function singleViewLayoutTab(view: WorkspaceTab): WorkspaceLayoutTab {
  const pane = createDockLeaf([view]);
  return { id: `layout:${view.id}`, root: pane, focusedPaneId: pane.id };
}

export function mapLayoutViews(
  layout: WorkspaceLayout,
  update: (view: WorkspaceTab) => WorkspaceTab,
): WorkspaceLayout {
  if (!layout.tabs?.length) return { ...layout, root: mapDockTabs(layout.root, update) };
  const tabs = layoutTabs(layout).map((tab) => ({ ...tab, root: mapDockTabs(tab.root, update) }));
  return selectLayoutTab({ ...layout, tabs }, layout.activeLayoutTabId ?? tabs[0].id);
}

/** Preserve the old visible split, and lift every hidden view into its own tab. */
export function migrateLayoutTabs(layout: WorkspaceLayout): WorkspaceLayout {
  if (layout.tabs?.length) return layout;
  const hidden: WorkspaceTab[] = [];
  const visit = (node: WorkspaceDockNode): WorkspaceDockNode => {
    if (node.type === "split")
      return { ...node, first: visit(node.first), second: visit(node.second) };
    const active = node.tabs.find((tab) => tab.id === node.activeTabId) ?? node.tabs[0];
    hidden.push(...node.tabs.filter((tab) => tab !== active));
    return { ...node, tabs: active ? [active] : [], activeTabId: active?.id ?? null };
  };
  const root = visit(layout.root);
  const view = activeLayoutView({ ...layout, root });
  const active = {
    id: `layout:${view?.id ?? root.id}`,
    root,
    focusedPaneId: layout.focusedPaneId,
    legacyNameKeys: view ? [`tab:${view.id}`, `group:${view.groupInstanceId}`] : [],
  };
  return {
    ...active,
    tabs: [
      active,
      ...hidden.map((view) => ({
        ...singleViewLayoutTab(view),
        legacyNameKeys: [`tab:${view.id}`, `group:${view.groupInstanceId}`],
      })),
    ],
    activeLayoutTabId: active.id,
  };
}

export function paneViewLabel(view: WorkspaceTab | null | undefined): string {
  if (!view || view.placeholder) return "New Tab";
  return (
    view.title?.trim() ||
    workspaceSurfaceFromRoute(view.route)?.title ||
    (view.surfaceId === "home" ? "Home" : "New Tab")
  );
}
export function layoutTabLabel(tab: WorkspaceLayoutTab): string {
  const view = activeLayoutView(tab);
  if (view?.placeholder && tab.title === "New pane") return "New Tab";
  return tab.title || paneViewLabel(view);
}
