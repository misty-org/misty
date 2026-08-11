import { expect, it } from "vitest";
import { createBrowserViewState, type WorkspaceView } from "@/features/workspace/model";
import { createDockLeaf } from "@/features/workspace/dockTree";
import { initialWorkspaceWindow } from "@/features/workspace/windows";
import type { UnsyncedRecord } from "./native";
import { unsyncedTabRows } from "./unsyncedTabs";

function windowWith(view: WorkspaceView) {
  const window = initialWorkspaceWindow().windowsByScope.global![0];
  const tab = window.layout.tabs![0];
  return {
    ...window,
    layout: { ...window.layout, tabs: [{ ...tab, root: createDockLeaf([view]) }] },
  };
}
const docs: WorkspaceView = {
  id: "v-docs",
  instanceKey: "v-docs",
  surfaceId: "browser",
  groupKey: "tool:browser",
  title: "Docs",
  route: "/browser",
  sidebarVisible: false,
  state: createBrowserViewState("https://docs.example"),
  createdAt: 1,
  lastFocusedAt: 1,
};
const record = (overrides: Partial<UnsyncedRecord>): UnsyncedRecord => ({
  workspace_id: "w",
  kind: "view",
  id: "v-docs",
  deleted: false,
  title: null,
  ...overrides,
});

it("names each waiting tab, closed tabs, arrangement and kept edits", () => {
  const rows = unsyncedTabRows(
    {
      unsynced: [
        record({}),
        record({ id: "v-gone", deleted: true, title: "Mail" }),
        record({ kind: "tab", id: "t1" }),
        record({ kind: "window", id: "w1" }),
      ],
      retired_edits: 2,
    },
    [windowWith(docs)],
  );
  expect(rows).toEqual([
    { id: "v-docs", title: "Docs", state: "waiting" },
    { id: "v-gone", title: "Mail", state: "closed" },
    { id: "arrangement", title: "Tab arrangement", state: "arrangement" },
    { id: "kept", title: "2 earlier sets of changes", state: "kept" },
  ]);
});

it("has nothing to list when everything synced", () => {
  expect(unsyncedTabRows({ unsynced: [], retired_edits: 0 }, [windowWith(docs)])).toEqual([]);
  expect(unsyncedTabRows(null, [])).toEqual([]);
});
