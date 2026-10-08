import { workspaceSurfaceFromRoute } from "@/features/workspace/routeSurface";
import {
  browserViewTitle,
  createBrowserViewState,
  type WorkspaceDockNode,
  type WorkspaceTab,
  type WorkspaceView,
  type WorkspaceWindow,
} from "@/features/workspace/model";
import type { MistyTabGroup } from "@/features/workspace/tabGroups";
import type {
  DeviceSelection,
  RecordKind,
  SharedRecord,
  SplitTree,
  WorkspaceRecords,
} from "./model";
import { projectTabGroups } from "./tabGroupSync";

const recoveryWindowId = "recovery:window";
export const recoveryTabId = (viewId: string) => `recovery:tab:${viewId}`;
export const recoveryPaneId = (viewId: string) => `recovery:pane:${viewId}`;

function records<K extends RecordKind>(view: WorkspaceRecords, kind: K): SharedRecord<K>[] {
  return view.records.filter((record) => record.kind === kind) as SharedRecord<K>[];
}
function ordered<T extends { id: string; fields: { order: number } }>(values: T[]): T[] {
  return values.sort((a, b) => a.fields.order - b.fields.order || compareId(a.id, b.id));
}
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function panes(tree: SplitTree): string[] {
  return tree.type === "leaf" ? [tree.id] : [...panes(tree.first), ...panes(tree.second)];
}
/** Where a synced tool view opens when its record carries no route: records
 * from older clients may omit it, and the model allows null. */
const surfaceRoutes = {
  agents: "/agents",
  space: "/spaces",
  extensions: "/extensions",
} as const;
/** A synced view as the pane content the workspace UI renders. */
function viewAsWorkspaceView(record: SharedRecord<"view">): WorkspaceView {
  const fields = record.fields;
  if (fields.surface === "home" || fields.surface === "files") {
    // Older clients still sync the retired Home page and Files views (Files
    // moved to Kura, a separate app); both open as a new tab.
    const state = createBrowserViewState();
    return {
      id: record.id,
      instanceKey: record.id,
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: browserViewTitle(state.url),
      route: "/browser",
      sidebarVisible: false,
      state,
      createdAt: 0,
      lastFocusedAt: 0,
    };
  }
  const toolRoute =
    fields.surface === "browser"
      ? "/browser"
      : typeof fields.tool_route === "string" && fields.tool_route
        ? fields.tool_route
        : surfaceRoutes[fields.surface];
  return {
    id: record.id,
    instanceKey: record.id,
    surfaceId: fields.surface,
    groupKey:
      fields.surface === "space"
        ? (workspaceSurfaceFromRoute(toolRoute)?.groupKey ?? "tool:space")
        : `tool:${fields.surface}`,
    title: fields.title,
    route: toolRoute,
    sidebarVisible: false,
    state:
      fields.surface === "browser"
        ? {
            ...createBrowserViewState(fields.url!),
            profileId: fields.profile_id!,
            bookmarkId: fields.bookmark_id ?? undefined,
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
  return { type: "leaf", id, views: [], activeViewId: null };
}

export interface ProjectedWorkspace {
  windows: WorkspaceWindow[];
  activeWindowId: string | null;
  folders: SharedRecord<"folder">[];
  bookmarks: SharedRecord<"bookmark">[];
  recoveryViewIds: string[];
  /** Synced tab groups; absent while they are still local to each machine. */
  tabGroups?: MistyTabGroup[];
}

/** Pure projection: never emits edits or mutates the shared placement records.
 * Recovery tabs are local projections until the user explicitly moves a view. */
export function projectWorkspace(
  view: WorkspaceRecords,
  local: DeviceSelection,
  /** This machine's groups when tab groups sync (for local collapsed state). */
  localGroups?: MistyTabGroup[],
): ProjectedWorkspace {
  const groups = localGroups && projectTabGroups(view.records, localGroups);
  if (view.version !== 1 || !Number.isSafeInteger(view.sequence) || view.sequence < 0)
    throw new Error("Unsupported workspace view");
  const windows = ordered(records(view, "window"));
  const tabs = ordered(records(view, "tab"));
  const views = records(view, "view").sort(
    (a, b) => a.fields.placement.order - b.fields.placement.order || compareId(a.id, b.id),
  );
  const placed = new Set<string>();
  const byWindow = new Map<string, WorkspaceTab[]>();
  const recoveryViewIds: string[] = [];

  for (const window of windows) {
    const windowTabs: WorkspaceTab[] = [];
    for (const tab of tabs.filter((item) => item.fields.window_id === window.id)) {
      const build = (tree: SplitTree): WorkspaceDockNode => {
        if (tree.type === "split")
          return { ...tree, first: build(tree.first), second: build(tree.second) };
        const candidates = views.filter(
          (item) =>
            item.fields.placement.tab_id === tab.id && item.fields.placement.pane_id === tree.id,
        );
        const selected =
          candidates.find((item) => item.id === local.activeViewByPane[tree.id]) ?? candidates[0];
        if (!selected) return emptyPane(tree.id);
        placed.add(selected.id);
        return {
          type: "leaf",
          id: tree.id,
          views: [viewAsWorkspaceView(selected)],
          activeViewId: selected.id,
        };
      };
      const paneIds = panes(tab.fields.tree);
      const focused = local.focusedPaneByTab[tab.id];
      windowTabs.push({
        id: tab.id,
        title: tab.fields.title,
        root: build(tab.fields.tree),
        focusedPaneId: paneIds.includes(focused) ? focused : paneIds[0],
        ...(tab.fields.pinned_url ? { pinnedUrl: tab.fields.pinned_url } : {}),
        ...(groups && !tab.fields.pinned_url ? { tabGroupId: groups.groupOfTab.get(tab.id) } : {}),
      });
    }
    // Concurrent reorders can interleave; pinned tabs always lead their window.
    byWindow.set(window.id, [
      ...windowTabs.filter((tab) => tab.pinnedUrl),
      ...windowTabs.filter((tab) => !tab.pinnedUrl),
    ]);
  }

  // Preserve every live view even if a concurrently replaced split/container
  // no longer references its preferred pane, or two devices filled one pane.
  for (const item of views.filter((item) => !placed.has(item.id))) {
    const sourceTab = tabs.find((tab) => tab.id === item.fields.placement.tab_id);
    const sourceWindow = sourceTab?.fields.window_id;
    const targetWindow =
      sourceWindow && byWindow.has(sourceWindow)
        ? sourceWindow
        : (windows[0]?.id ?? recoveryWindowId);
    const target = byWindow.get(targetWindow) ?? [];
    const paneId = recoveryPaneId(item.id);
    target.push({
      id: recoveryTabId(item.id),
      title: item.fields.title,
      focusedPaneId: paneId,
      root: { type: "leaf", id: paneId, views: [viewAsWorkspaceView(item)], activeViewId: item.id },
    });
    byWindow.set(targetWindow, target);
    recoveryViewIds.push(item.id);
  }
  if (byWindow.has(recoveryWindowId) && !windows.some((window) => window.id === recoveryWindowId)) {
    windows.push({
      kind: "window",
      id: recoveryWindowId,
      fields: { title: "Recovered tabs", order: 0 },
    });
  }
  const projected = windows.map((window): WorkspaceWindow => {
    const windowTabs = byWindow.get(window.id)!;
    if (!windowTabs.length) {
      const id = `recovery:empty:${window.id}`;
      windowTabs.push({ id, root: emptyPane(id), focusedPaneId: id });
    }
    const selected =
      windowTabs.find((tab) => tab.id === local.activeTabByWindow[window.id]) ??
      neighbor(
        windowTabs,
        local.activeTabByWindow[window.id],
        local.tabOrderByWindow?.[window.id],
      ) ??
      windowTabs[0];
    return {
      id: window.id,
      title: window.fields.title,
      createdAt: 0,
      lastFocusedAt: 0,
      layout: {
        root: selected.root,
        focusedPaneId: selected.focusedPaneId,
        tabs: windowTabs,
        activeTabId: selected.id,
      },
    };
  });
  return {
    windows: projected,
    activeWindowId:
      projected.find((window) => window.id === local.activeWindowId)?.id ??
      projected[0]?.id ??
      null,
    folders: ordered(records(view, "folder")),
    bookmarks: ordered(records(view, "bookmark")),
    recoveryViewIds,
    ...(groups ? { tabGroups: groups.tabGroups } : {}),
  };
}

/** The tab that took a closed tab's place: the next one it was shown beside,
 * else the previous one, as when closing it locally. */
function neighbor(
  tabs: WorkspaceTab[],
  closed: string | undefined,
  shown: string[] | undefined,
): WorkspaceTab | undefined {
  const index = closed && shown ? shown.indexOf(closed) : -1;
  if (index < 0) return undefined;
  const live = (id: string) => tabs.find((tab) => tab.id === id);
  for (const id of shown!.slice(index + 1)) if (live(id)) return live(id);
  for (const id of shown!.slice(0, index).reverse()) if (live(id)) return live(id);
  return undefined;
}
