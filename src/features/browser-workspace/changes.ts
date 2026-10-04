import { dockLeaves } from "@/features/workspace/dockTree";
import { layoutTabs } from "@/features/workspace/layoutTabs";
import {
  parseBrowserViewState,
  type WorkspaceDockNode,
  type WorkspaceWindow,
} from "@/features/workspace/model";
import type { DeviceSelection, SharedRecord, SplitTree, WorkspaceChange } from "./model";

const recovered = (id: string) => id.startsWith("recovery:");
const key = (record: { kind: string; id: string }) => `${record.kind}/${record.id}`;
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameValue(value, b[index]))
    );
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((name) => name in right && sameValue(left[name], right[name]))
  );
}
function tree(node: WorkspaceDockNode): SplitTree {
  return node.type === "leaf"
    ? { type: "leaf", id: node.id }
    : {
        type: "split",
        id: node.id,
        direction: node.direction,
        ratio: node.ratio,
        first: tree(node.first),
        second: tree(node.second),
      };
}

/** Encode shared fields only. Focus, history, local paths, browser viewport,
 * favicon cache, and physical window geometry are not workspace mutations. */
export function workspaceRecords(windows: WorkspaceWindow[], profileId: string): SharedRecord[] {
  const records: SharedRecord[] = [];
  const seen = new Set<string>();
  const add = (record: SharedRecord) => {
    if (seen.has(key(record))) throw new Error("Workspace contains duplicate identities");
    seen.add(key(record));
    records.push(record);
  };
  windows.forEach((window, order) => {
    add({ kind: "window", id: window.id, fields: { title: window.title, order } });
    layoutTabs(window.layout).forEach((tab, order) => {
      add({
        kind: "tab",
        id: tab.id,
        fields: { window_id: window.id, title: tab.title ?? "", order, tree: tree(tab.root) },
      });
      for (const pane of dockLeaves(tab.root))
        // A pane's content in the workspace UI is a synced view.
        pane.views.forEach((view, order) => {
          if (
            !["browser", "files", "agents", "space", "home", "extensions"].includes(view.surfaceId)
          )
            throw new Error("Retired workspace views must be migrated before enabling sync");
          const browser = view.surfaceId === "browser" ? parseBrowserViewState(view.state) : null;
          // Files paths remain device-local until their authorized device/root
          // references are resolved by the Files handoff adapter.
          const toolRoute =
            view.surfaceId === "space" || view.surfaceId === "extensions"
              ? view.route
              : view.surfaceId === "agents"
                ? view.route.replace(/^\/apps\/agents(?=[/?#]|$)/, "/agents")
                : view.surfaceId === "home"
                  ? "/home"
                  : "/files";
          add({
            kind: "view",
            id: view.id,
            fields: {
              surface: view.surfaceId as
                "browser" | "files" | "agents" | "space" | "home" | "extensions",
              title: view.title,
              placement: { tab_id: tab.id, pane_id: pane.id, order },
              url: browser?.url ?? null,
              profile_id: browser?.profileId ?? (browser ? profileId : null),
              bookmark_id: browser?.bookmarkId ?? null,
              tool_route: browser ? null : toolRoute,
              agent_owned: browser?.agentOwned === true,
            },
          });
        });
    });
  });
  return records;
}

export function deviceSelection(
  windows: WorkspaceWindow[],
  activeWindowId: string,
): DeviceSelection {
  const local: DeviceSelection = {
    activeWindowId,
    activeTabByWindow: {},
    focusedPaneByTab: {},
    activeViewByPane: {},
    tabOrderByWindow: {},
  };
  for (const window of windows) {
    const tabs = layoutTabs(window.layout);
    local.activeTabByWindow[window.id] = window.layout.activeTabId ?? tabs[0]?.id;
    local.tabOrderByWindow![window.id] = tabs.map((tab) => tab.id);
    for (const tab of tabs) {
      local.focusedPaneByTab[tab.id] = tab.focusedPaneId;
      for (const pane of dockLeaves(tab.root))
        if (pane.activeViewId) local.activeViewByPane[pane.id] = pane.activeViewId;
    }
  }
  return local;
}

/** Diff the actual user edit, not the whole current view against server state.
 * This avoids writing back projections, remote edits, or local-only focus. */
export function workspaceChanges(
  before: WorkspaceWindow[],
  after: WorkspaceWindow[],
  profileId: string,
  newId: (kind: "window" | "tab") => string = (kind) => `${kind}:${crypto.randomUUID()}`,
): {
  windows: WorkspaceWindow[];
  changes: WorkspaceChange[];
  remapped: Map<string, string>;
} {
  const oldRecords = workspaceRecords(before, profileId);
  const nextRecords = workspaceRecords(after, profileId);
  const old = new Map(oldRecords.map((record) => [key(record), record]));
  const remapped = new Map<string, string>();
  const containerChanged = (
    record: SharedRecord<"window"> | SharedRecord<"tab">,
    was: SharedRecord | undefined,
  ) => {
    if (!was || !sameValue({ ...was.fields, order: 0 }, { ...record.fields, order: 0 }))
      return true;
    const peers = nextRecords.filter(
      (peer) =>
        peer.kind === record.kind &&
        peer.id !== record.id &&
        (record.kind !== "tab" ||
          (peer as SharedRecord<"tab">).fields.window_id === record.fields.window_id),
    );
    return peers.some((peer) => {
      const previous = old.get(key(peer));
      if (!previous) return false;
      return (
        Math.sign(
          (was.fields as { order: number }).order - (previous.fields as { order: number }).order,
        ) !== Math.sign(record.fields.order - (peer.fields as { order: number }).order)
      );
    });
  };

  // Recovery containers are projections, not shared entities. Materialize one
  // only when the user changes its structure, names it, or adds/moves a view in it.
  for (const record of nextRecords) {
    if (record.kind !== "tab" || !recovered(record.id)) continue;
    const was = old.get(key(record));
    const changed =
      containerChanged(record, was) ||
      nextRecords.some(
        (view) =>
          view.kind === "view" &&
          view.fields.placement.tab_id === record.id &&
          !sameValue(
            (old.get(key(view)) as SharedRecord<"view"> | undefined)?.fields.placement,
            view.fields.placement,
          ),
      );
    if (changed) remapped.set(record.id, newId("tab"));
  }
  for (const record of nextRecords) {
    if (record.kind !== "window" || !recovered(record.id)) continue;
    const was = old.get(key(record));
    if (
      containerChanged(record, was) ||
      nextRecords.some(
        (tab) =>
          tab.kind === "tab" &&
          tab.fields.window_id === record.id &&
          (!recovered(tab.id) || remapped.has(tab.id)),
      )
    )
      remapped.set(record.id, newId("window"));
  }
  const mapId = (id: string) => remapped.get(id) ?? id;
  const windows = remapped.size
    ? after.map((window) => ({
        ...window,
        id: mapId(window.id),
        layout: {
          ...window.layout,
          activeTabId: window.layout.activeTabId && mapId(window.layout.activeTabId),
          tabs: layoutTabs(window.layout).map((tab) => ({ ...tab, id: mapId(tab.id) })),
        },
      }))
    : after;
  const next = new Map(workspaceRecords(windows, profileId).map((record) => [key(record), record]));
  const changes: WorkspaceChange[] = [];
  for (const [id, record] of next) {
    if ((record.kind === "tab" || record.kind === "window") && recovered(record.id)) continue;
    const previous = old.get(id);
    if (!previous) {
      changes.push({ action: "create", ...record } as WorkspaceChange);
      continue;
    }
    const fields = Object.fromEntries(
      Object.entries(record.fields).filter(
        ([name, value]) =>
          !sameValue((previous.fields as unknown as Record<string, unknown>)[name], value),
      ),
    );
    if (Object.keys(fields).length)
      changes.push({
        action: "patch",
        kind: record.kind,
        id: record.id,
        fields,
      } as WorkspaceChange);
  }
  for (const [id, record] of old) {
    if ((record.kind === "tab" || record.kind === "window") && recovered(record.id)) continue;
    if (!next.has(id)) changes.push({ action: "delete", kind: record.kind, id: record.id });
  }
  return { windows, changes, remapped };
}
