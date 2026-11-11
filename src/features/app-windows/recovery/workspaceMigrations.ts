import { createDockLeaf } from "../panes/dockTree";
import { activateTab, emptyTab } from "../panes/layoutTabs";
import type {
  WorkspaceDockNode,
  WorkspaceLayout,
  WorkspacePane,
  WorkspaceTab,
  WorkspaceView,
} from "../tabs/workspaceViews";
/** Saved views synced from records without a route; restore them at their tool's root. */
const missingRouteFallback: Partial<Record<string, string>> = {
  space: "/spaces",
  agents: "/agents",
  scheduled: "/scheduled",
};
/** A saved view restore could not carry forward. Its original stays in the
 * archived copy of the saved workspace. */
export interface UnrestoredView {
  id: string;
  title: string;
  reason: string;
}
let unrestored: UnrestoredView[] | undefined;
/** Runs a restore and lists the views it had to replace with placeholders. */
export function collectUnrestoredViews<T>(restore: () => T): {
  result: T;
  skipped: UnrestoredView[];
} {
  const previous = unrestored;
  unrestored = [];
  try {
    const result = restore();
    return { result, skipped: unrestored };
  } finally {
    unrestored = previous;
  }
}

/**
 * What a saved view is now: itself, the page that took over from its tool, or `null` when it
 * was a web page or a tool that is gone. A window shows web pages only to agents, beside their
 * chat, so a person's saved pages aren't brought back.
 *
 * Never throws: one damaged view becomes an empty placeholder in its place instead of stopping
 * the rest of the workspace from restoring.
 */
export function migrateRetiredWorkspaceView(view: WorkspaceView): WorkspaceView | null {
  try {
    return migrateView(view);
  } catch (error) {
    const id = typeof view?.id === "string" && view.id ? view.id : crypto.randomUUID();
    const title = typeof view?.title === "string" ? view.title : "";
    unrestored?.push({ id, title, reason: error instanceof Error ? error.message : String(error) });
    return {
      id,
      instanceKey: id,
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: title || "Agents",
      route: "/agents",
      sidebarVisible: true,
      state: {},
      placeholder: true,
      createdAt: typeof view?.createdAt === "number" ? view.createdAt : 0,
      lastFocusedAt: typeof view?.lastFocusedAt === "number" ? view.lastFocusedAt : 0,
    };
  }
}
function migrateView(view: WorkspaceView): WorkspaceView | null {
  const tab =
    typeof view.route === "string"
      ? view
      : { ...view, route: missingRouteFallback[view.surfaceId] ?? "/browser" };
  const route = new URL(tab.route, "https://misty.local");
  if (tab.surfaceId === "scheduled") {
    const params = route.searchParams;
    params.set("view", "scheduled");
    return {
      ...tab,
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Agents",
      route: `/agents?${params}`,
    };
  }
  if (tab.surfaceId === "space" && /^\/spaces(?:\/|$)/.test(tab.route)) return tab;
  const agents = tab.surfaceId === "agents" || tab.groupKey === "app:agents";
  if (agents) {
    // Legacy Scheduled routes keep their section inside Agents.
    if (route.pathname === "/scheduled") route.searchParams.set("view", "scheduled");
    return {
      ...tab,
      surfaceId: "agents",
      groupKey: "tool:agents",
      route: `/agents${route.search}`,
      placeholder: tab.placeholder,
    };
  }
  // A web page, or a tool that is gone (Home, Files, Transfers, Extensions and the like).
  return null;
}

/** A pane tree without the views that are gone; `null` when none of its views is left. */
function migrateNode(node: WorkspaceDockNode): WorkspaceDockNode | null {
  if (node.type === "split") {
    const first = migrateNode(node.first);
    const second = migrateNode(node.second);
    if (!first || !second) return first ?? second;
    return { ...node, first, second };
  }
  const views = (node.views ?? []).flatMap((view) => migrateRetiredWorkspaceView(view) ?? []);
  if (!views.length) return null;
  const entries = node.history?.entries?.flatMap((view) => migrateRetiredWorkspaceView(view) ?? []);
  const at = Number.isFinite(node.history?.index) ? node.history!.index : 0;
  return {
    ...node,
    views,
    activeViewId: views.some((view) => view.id === node.activeViewId)
      ? node.activeViewId
      : views[0].id,
    history: entries?.length
      ? { entries, index: Math.max(0, Math.min(at, entries.length - 1)) }
      : undefined,
  };
}

/** A pane as it was when one of its views closed, without the views that are gone. */
export function migrateRetiredWorkspacePane(pane: WorkspacePane): WorkspacePane | undefined {
  const migrated = migrateNode(pane);
  return migrated?.type === "leaf" ? migrated : undefined;
}

/** A tab without the views that are gone; `null` when it held nothing else. */
export function migrateRetiredWorkspaceTab(tab: WorkspaceTab): WorkspaceTab | null {
  const root = migrateNode(tab.root);
  return root ? { ...tab, root } : null;
}

/** A window's tabs without the views that are gone. A window left with none has no tabs. */
export function migrateRetiredWorkspaceViews(layout: WorkspaceLayout): WorkspaceLayout {
  if (!layout.tabs?.length)
    return { ...layout, root: migrateNode(layout.root) ?? createDockLeaf() };
  const kept = layout.tabs.flatMap((tab) => migrateRetiredWorkspaceTab(tab) ?? []);
  const tabs = kept.length ? kept : [emptyTab()];
  const active = tabs.find((tab) => tab.id === layout.activeTabId) ?? tabs[0];
  return activateTab({ ...layout, tabs }, active.id);
}
