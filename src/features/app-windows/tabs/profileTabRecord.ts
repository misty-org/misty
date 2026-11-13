import { dockTreeViews } from "../panes/dockTree";
import { isEmptyTab } from "../panes/layoutTabs";
import type { WorkspaceDockNode, WorkspaceTab, WorkspaceView } from "./workspaceViews";

/**
 * A tab as a profile keeps it: what's in it and where it sits, never which tab has focus or which
 * window holds it. Encoding the same tab always gives the same text, so only real changes travel.
 */
interface StoredView {
  id: string;
  surface: WorkspaceView["surfaceId"];
  group_key: WorkspaceView["groupKey"];
  instance_key: string;
  group_instance?: string;
  title: string;
  route: string;
  sidebar: boolean;
  state: unknown;
  created_at: number;
  placeholder?: boolean;
}
type StoredNode =
  | { type: "leaf"; id: string; active?: string; views: StoredView[] }
  | {
      type: "split";
      id: string;
      direction: "horizontal" | "vertical";
      ratio: number;
      first: StoredNode;
      second: StoredNode;
    };
export interface TabFields {
  order: number;
  title?: string;
  tree: StoredNode;
}

/** A tab that isn't the profile's to share: a new tab nobody has used. */
export function tabStaysHere(tab: WorkspaceTab): boolean {
  return isEmptyTab(tab) || dockTreeViews(tab.root).every((view) => view.placeholder);
}

function storedView(view: WorkspaceView): StoredView {
  return {
    id: view.id,
    surface: view.surfaceId,
    group_key: view.groupKey,
    instance_key: view.instanceKey,
    ...(view.groupInstanceId ? { group_instance: view.groupInstanceId } : {}),
    title: view.title,
    route: view.route,
    sidebar: view.sidebarVisible,
    state: view.state ?? null,
    created_at: view.createdAt,
    ...(view.placeholder ? { placeholder: true } : {}),
  };
}

function storedNode(node: WorkspaceDockNode): StoredNode {
  if (node.type === "leaf")
    return {
      type: "leaf",
      id: node.id,
      ...(node.activeViewId ? { active: node.activeViewId } : {}),
      views: node.views.map(storedView),
    };
  return {
    type: "split",
    id: node.id,
    direction: node.direction,
    ratio: node.ratio,
    first: storedNode(node.first),
    second: storedNode(node.second),
  };
}

export function tabFields(tab: WorkspaceTab, order: number): TabFields {
  return {
    order,
    ...(tab.title ? { title: tab.title } : {}),
    tree: storedNode(tab.root),
  };
}

/** Text with keys in one order, whichever order they were read in. */
export function encodedFields(value: unknown): string {
  return JSON.stringify(value, (_, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : item,
  );
}

function liveNode(
  node: StoredNode,
  previous: ReadonlyMap<string, WorkspaceView>,
): WorkspaceDockNode {
  if (node.type === "split")
    return {
      type: "split",
      id: node.id,
      direction: node.direction,
      ratio: node.ratio,
      first: liveNode(node.first, previous),
      second: liveNode(node.second, previous),
    };
  return {
    type: "leaf",
    id: node.id,
    activeViewId: node.active ?? node.views[0]?.id ?? null,
    views: node.views.map((view): WorkspaceView => {
      const known = previous.get(view.id);
      return {
        id: view.id,
        surfaceId: view.surface,
        groupKey: view.group_key,
        instanceKey: view.instance_key,
        ...(view.group_instance ? { groupInstanceId: view.group_instance } : {}),
        title: view.title,
        route: view.route,
        sidebarVisible: view.sidebar,
        state: view.state,
        createdAt: view.created_at,
        lastFocusedAt: known?.lastFocusedAt ?? 0,
        ...(view.placeholder ? { placeholder: true } : {}),
      };
    }),
  };
}

function firstLeafId(node: StoredNode): string {
  return node.type === "leaf" ? node.id : firstLeafId(node.first);
}

function nodeHasLeaf(node: WorkspaceDockNode, id: string): boolean {
  return node.type === "leaf"
    ? node.id === id
    : nodeHasLeaf(node.first, id) || nodeHasLeaf(node.second, id);
}

/** The tab a record describes, keeping what's only this window's: which pane has focus. A record
 * from an older version may also say `pinned_url` and `group`, which are left unread. */
export function tabFromFields(
  id: string,
  fields: TabFields,
  previous?: WorkspaceTab,
): WorkspaceTab {
  const known = new Map(
    (previous ? dockTreeViews(previous.root) : []).map((view) => [view.id, view]),
  );
  const root = liveNode(fields.tree, known);
  return {
    id,
    root,
    focusedPaneId:
      previous && nodeHasLeaf(root, previous.focusedPaneId)
        ? previous.focusedPaneId
        : firstLeafId(fields.tree),
    ...(fields.title ? { title: fields.title } : {}),
  };
}

/** Records come from other computers and newer versions: anything unusable is left alone. */
export function usableFields(value: unknown): value is TabFields {
  const fields = value as Partial<TabFields> | null;
  const usableNode = (node: unknown): boolean => {
    const item = node as Partial<StoredNode> | null;
    if (!item || typeof item.id !== "string") return false;
    if (item.type === "leaf") {
      const views = (item as { views?: unknown }).views;
      return (
        Array.isArray(views) &&
        views.every(
          (view: Partial<StoredView> | null) =>
            !!view &&
            typeof view.id === "string" &&
            typeof view.surface === "string" &&
            typeof view.route === "string",
        )
      );
    }
    if (item.type !== "split") return false;
    const split = item as { first?: unknown; second?: unknown };
    return usableNode(split.first) && usableNode(split.second);
  };
  return !!fields && typeof fields.order === "number" && usableNode(fields.tree);
}
