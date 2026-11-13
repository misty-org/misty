import { describe, expect, it } from "vitest";
import { createDockLeaf, dockTreeViews } from "../panes/dockTree";
import type { WorkspaceTab, WorkspaceView } from "./workspaceViews";
import {
  encodedFields,
  tabFields,
  tabFromFields,
  tabStaysHere,
  usableFields,
} from "./profileTabRecord";

function view(id: string, chat: string, extra: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    id,
    surfaceId: "agents",
    groupKey: "tool:agents",
    instanceKey: id,
    title: "Agents",
    route: `/agents?conversation=${chat}`,
    sidebarVisible: true,
    state: { draft: chat },
    createdAt: 5,
    lastFocusedAt: 9,
    ...extra,
  } as WorkspaceView;
}

function tab(views: WorkspaceView[], extra: Partial<WorkspaceTab> = {}): WorkspaceTab {
  const pane = createDockLeaf(views);
  return { id: "layout:one", root: pane, focusedPaneId: pane.id, ...extra };
}

describe("a tab as the profile keeps it", () => {
  it("reads back as the same record", () => {
    const original = tab([view("v", "one")], { title: "Named" });
    const fields = tabFields(original, 3);
    expect(fields.order).toBe(3);
    const decoded = tabFromFields(original.id, JSON.parse(JSON.stringify(fields)));
    expect(encodedFields(tabFields(decoded, 3))).toBe(encodedFields(fields));
  });

  it("reads a record an older version pinned or grouped as a plain tab", () => {
    const fields = {
      ...tabFields(tab([view("v", "one")]), 0),
      pinned_url: "https://example.test/",
      group: { id: "g", name: "Work", color: "purple" },
    };
    expect(usableFields(fields)).toBe(true);
    const decoded = tabFromFields("layout:one", fields);
    expect(Object.keys(decoded).sort()).toEqual(["focusedPaneId", "id", "root"]);
  });

  it("doesn't change when only focus does", () => {
    const original = tab([view("v", "one")]);
    const root = {
      ...original.root,
      views: [view("v", "one", { lastFocusedAt: 100 })],
    } as WorkspaceTab["root"];
    const refocused = { ...original, root, focusedPaneId: "elsewhere" };
    expect(encodedFields(tabFields(refocused, 0))).toBe(encodedFields(tabFields(original, 0)));
  });

  it("keeps this window's focus and timestamps when an update arrives", () => {
    const here = tab([view("v", "one")]);
    const fields = tabFields(tab([view("v", "two")]), 0);
    const updated = tabFromFields(here.id, fields, here);
    const first = dockTreeViews(updated.root)[0];
    expect(first.route).toBe("/agents?conversation=two");
    expect(first.state).toEqual({ draft: "two" });
    expect(first.lastFocusedAt).toBe(9);
  });

  it("keeps untouched new tabs to itself", () => {
    expect(tabStaysHere(tab([view("v", "new", { placeholder: true })]))).toBe(true);
    expect(tabStaysHere(tab([]))).toBe(true);
    expect(tabStaysHere(tab([view("v", "one")]))).toBe(false);
  });

  it("leaves alone a record it can't use", () => {
    expect(usableFields(null)).toBe(false);
    expect(usableFields({ order: 0 })).toBe(false);
    expect(usableFields({ order: 0, tree: { type: "leaf", id: "p", views: [{ id: 1 }] } })).toBe(
      false,
    );
    expect(usableFields({ order: 0, tree: { type: "future", id: "p" } })).toBe(false);
    expect(usableFields(tabFields(tab([view("v", "one")]), 0))).toBe(true);
  });
});
