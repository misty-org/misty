import { createDockLeaf } from "../panes/dock_tree";
import { activateTab, emptyTab } from "../panes/layout_tabs";
import type {
  WorkspaceDockNode,
  WorkspaceLayout,
  WorkspacePane,
  WorkspaceTab,
  WorkspaceView,
} from "../tabs/workspace_views";

export function knownWorkspaceView(view: WorkspaceView | null | undefined): WorkspaceView | null {
  if (!view || typeof view !== "object") return null;
  if (typeof view.id !== "string" || typeof view.route !== "string") return null;
  if (view.surfaceId === "space") return /^\/spaces(?:\/|$)/.test(view.route) ? view : null;
  if (view.surfaceId === "agents") return /^\/agents(?:[/?#]|$)/.test(view.route) ? view : null;
  if (view.surfaceId === "direct")
    return /^\/(?:dms\/[^/?#]+|friends)(?:[?#]|$)/.test(view.route) ? view : null;
  if (view.surfaceId === "browser")
    return /^\/browser\/web-[\w-]{8,64}$/.test(view.route) ? view : null;
  return null;
}

function knownNode(node: WorkspaceDockNode): WorkspaceDockNode | null {
  if (node.type === "split") {
    const first = knownNode(node.first);
    const second = knownNode(node.second);
    if (!first || !second) return first ?? second;
    return { ...node, first, second };
  }
  const views = (node.views ?? []).flatMap((view) => knownWorkspaceView(view) ?? []);
  if (!views.length) return null;
  const entries = node.history?.entries?.flatMap((view) => knownWorkspaceView(view) ?? []);
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

export function knownWorkspacePane(pane: WorkspacePane): WorkspacePane | undefined {
  const known = knownNode(pane);
  return known?.type === "leaf" ? known : undefined;
}

export function knownWorkspaceTab(tab: WorkspaceTab): WorkspaceTab | null {
  const root = knownNode(tab.root);
  return root ? { ...tab, root } : null;
}

export function withKnownWorkspaceViews(layout: WorkspaceLayout): WorkspaceLayout {
  if (!layout.tabs?.length) return { ...layout, root: knownNode(layout.root) ?? createDockLeaf() };
  const kept = layout.tabs.flatMap((tab) => knownWorkspaceTab(tab) ?? []);
  const tabs = kept.length ? kept : [emptyTab()];
  const active = tabs.find((tab) => tab.id === layout.activeTabId) ?? tabs[0];
  return activateTab({ ...layout, tabs }, active.id);
}
