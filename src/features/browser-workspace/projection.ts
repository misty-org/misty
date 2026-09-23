import { workspaceSurfaceFromRoute } from "@/features/workspace/routeSurface";
import {
  createBrowserTabState,
  type WorkspaceDockNode,
  type WorkspaceLayoutTab,
  type WorkspaceTab,
  type WorkspaceVirtualWindow,
} from "@/features/workspace/model";
import type { DeviceSelection, RecordKind, SharedRecord, SplitTree, WorkspaceView } from "./model";

const recoveryWindowId = "recovery:window";
export const recoveryLayoutId = (tabId: string) => `recovery:layout:${tabId}`;
export const recoveryPaneId = (tabId: string) => `recovery:pane:${tabId}`;

function records<K extends RecordKind>(view: WorkspaceView, kind: K): SharedRecord<K>[] {
  return view.records.filter((record) => record.kind === kind) as SharedRecord<K>[];
}
function ordered<T extends { id: string; fields: { order: number } }>(values: T[]): T[] {
  return values.sort((a, b) => a.fields.order - b.fields.order || compareId(a.id, b.id));
}
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function panes(tree: SplitTree): string[] {
  return tree.type === "leaf" ? [tree.id] : [...panes(tree.first), ...panes(tree.second)];
}
function asTab(record: SharedRecord<"tab">): WorkspaceTab {
  const fields = record.fields;
  return {
    id: record.id,
    instanceKey: record.id,
    surfaceId: fields.surface,
    groupKey:
      fields.surface === "space"
        ? (workspaceSurfaceFromRoute(fields.tool_route!)?.groupKey ?? "tool:space")
        : `tool:${fields.surface}`,
    title: fields.title,
    route: fields.surface === "browser" ? "/browser" : fields.tool_route!,
    sidebarVisible: false,
    state:
      fields.surface === "browser"
        ? {
            ...createBrowserTabState(fields.url!),
            profileId: fields.profile_id!,
            websiteId: fields.website_id ?? undefined,
            agentOwned: fields.agent_owned || undefined,
          }
        : null,
    createdAt: 0,
    lastFocusedAt: 0,
  };
}
function emptyPane(id: string): WorkspaceDockNode {
  // Stable placeholders avoid creating a fresh shared tab as a side effect of
  // importing empty geometry. An explicit navigation materializes a real tab.
  return { type: "leaf", id, tabs: [], activeTabId: null };
}

export interface ProjectedWorkspace {
  windows: WorkspaceVirtualWindow[];
  activeWindowId: string | null;
  groups: SharedRecord<"group">[];
  websites: SharedRecord<"website">[];
  recoveryTabIds: string[];
}

/** Pure projection: never emits edits or mutates the shared placement records.
 * Recovery layouts are local projections until the user explicitly moves a view. */
export function projectWorkspace(view: WorkspaceView, local: DeviceSelection): ProjectedWorkspace {
  if (view.version !== 1 || !Number.isSafeInteger(view.sequence) || view.sequence < 0)
    throw new Error("Unsupported workspace view");
  const windows = ordered(records(view, "window"));
  const layouts = ordered(records(view, "layout"));
  const tabs = records(view, "tab").sort(
    (a, b) => a.fields.placement.order - b.fields.placement.order || compareId(a.id, b.id),
  );
  const placed = new Set<string>();
  const byWindow = new Map<string, WorkspaceLayoutTab[]>();
  const recoveryTabIds: string[] = [];

  for (const window of windows) {
    const windowLayouts: WorkspaceLayoutTab[] = [];
    for (const layout of layouts.filter((item) => item.fields.window_id === window.id)) {
      const build = (tree: SplitTree): WorkspaceDockNode => {
        if (tree.type === "split")
          return { ...tree, first: build(tree.first), second: build(tree.second) };
        const candidates = tabs.filter(
          (tab) =>
            tab.fields.placement.layout_id === layout.id &&
            tab.fields.placement.pane_id === tree.id,
        );
        const selected =
          candidates.find((tab) => tab.id === local.activeTabByPane[tree.id]) ?? candidates[0];
        if (!selected) return emptyPane(tree.id);
        placed.add(selected.id);
        return { type: "leaf", id: tree.id, tabs: [asTab(selected)], activeTabId: selected.id };
      };
      const paneIds = panes(layout.fields.tree);
      const focused = local.focusedPaneByLayout[layout.id];
      windowLayouts.push({
        id: layout.id,
        title: layout.fields.title,
        root: build(layout.fields.tree),
        focusedPaneId: paneIds.includes(focused) ? focused : paneIds[0],
      });
    }
    byWindow.set(window.id, windowLayouts);
  }

  // Preserve every live view even if a concurrently replaced split/container
  // no longer references its preferred pane, or two devices filled one pane.
  for (const tab of tabs.filter((tab) => !placed.has(tab.id))) {
    const sourceLayout = layouts.find((layout) => layout.id === tab.fields.placement.layout_id);
    const sourceWindow = sourceLayout?.fields.window_id;
    const targetWindow =
      sourceWindow && byWindow.has(sourceWindow)
        ? sourceWindow
        : (windows[0]?.id ?? recoveryWindowId);
    const target = byWindow.get(targetWindow) ?? [];
    const paneId = recoveryPaneId(tab.id);
    target.push({
      id: recoveryLayoutId(tab.id),
      title: tab.fields.title,
      focusedPaneId: paneId,
      root: { type: "leaf", id: paneId, tabs: [asTab(tab)], activeTabId: tab.id },
    });
    byWindow.set(targetWindow, target);
    recoveryTabIds.push(tab.id);
  }
  if (byWindow.has(recoveryWindowId) && !windows.some((window) => window.id === recoveryWindowId)) {
    windows.push({
      kind: "window",
      id: recoveryWindowId,
      fields: { title: "Recovered tabs", order: 0 },
    });
  }
  const projected = windows.map((window): WorkspaceVirtualWindow => {
    const windowLayouts = byWindow.get(window.id)!;
    if (!windowLayouts.length) {
      const id = `recovery:empty:${window.id}`;
      windowLayouts.push({ id, root: emptyPane(id), focusedPaneId: id });
    }
    const selected =
      windowLayouts.find((layout) => layout.id === local.activeLayoutByWindow[window.id]) ??
      windowLayouts[0];
    return {
      id: window.id,
      title: window.fields.title,
      createdAt: 0,
      lastFocusedAt: 0,
      layout: {
        root: selected.root,
        focusedPaneId: selected.focusedPaneId,
        tabs: windowLayouts,
        activeLayoutTabId: selected.id,
      },
    };
  });
  return {
    windows: projected,
    activeWindowId:
      projected.find((window) => window.id === local.activeWindowId)?.id ??
      projected[0]?.id ??
      null,
    groups: ordered(records(view, "group")),
    websites: ordered(records(view, "website")),
    recoveryTabIds,
  };
}
