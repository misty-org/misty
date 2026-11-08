import { describe, expect, it } from "vitest";
import { createDockLeaf } from "../panes/dockTree";
import { createBrowserViewState, type WorkspaceTab, type WorkspaceView } from "./workspaceViews";
import {
  browserUrls,
  encodedFields,
  tabFields,
  tabFromFields,
  tabStaysHere,
  usableFields,
} from "./profileTabRecord";
import type { MistyTabGroup } from "../tab-groups/tabGroups";

function view(id: string, url: string, extra: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    id,
    surfaceId: "browser",
    groupKey: "tool:browser",
    instanceKey: id,
    title: "Example",
    route: "/browser",
    sidebarVisible: true,
    state: createBrowserViewState(url),
    createdAt: 5,
    lastFocusedAt: 9,
    ...extra,
  } as WorkspaceView;
}

function tab(views: WorkspaceView[], extra: Partial<WorkspaceTab> = {}): WorkspaceTab {
  const pane = createDockLeaf(views);
  return { id: "layout:one", root: pane, focusedPaneId: pane.id, ...extra };
}

const group: MistyTabGroup = { id: "g", name: "Work", color: "purple", collapsed: true };

describe("a tab as the profile keeps it", () => {
  it("reads back as the same record", () => {
    const original = tab([view("v", "https://example.test/")], {
      pinnedUrl: "https://example.test/",
      tabGroupId: "g",
    });
    const fields = tabFields(original, 3, [group]);
    expect(fields.order).toBe(3);
    expect(fields.group).toEqual({ id: "g", name: "Work", color: "purple" });
    const decoded = tabFromFields(original.id, JSON.parse(JSON.stringify(fields)));
    expect(encodedFields(tabFields(decoded, 3, [group]))).toBe(encodedFields(fields));
  });

  it("doesn't change when only focus does", () => {
    const original = tab([view("v", "https://example.test/")]);
    const root = {
      ...original.root,
      views: [view("v", "https://example.test/", { lastFocusedAt: 100 })],
    } as WorkspaceTab["root"];
    const refocused = { ...original, root, focusedPaneId: "elsewhere" };
    expect(encodedFields(tabFields(refocused, 0, []))).toBe(
      encodedFields(tabFields(original, 0, [])),
    );
  });

  it("leaves out which store and which window a page was in", () => {
    const state = { ...createBrowserViewState("https://example.test/"), profileId: "a".repeat(64) };
    const fields = tabFields(tab([view("v", "https://example.test/", { state })]), 0, []);
    expect(JSON.stringify(fields)).not.toContain("a".repeat(64));
  });

  it("keeps this window's focus and timestamps when an update arrives", () => {
    const here = tab([view("v", "https://example.test/")]);
    const fields = tabFields(tab([view("v", "https://example.test/next")]), 0, []);
    const updated = tabFromFields(here.id, fields, here);
    expect(browserUrls(updated).get("v")).toBe("https://example.test/next");
    const first = updated.root.type === "leaf" ? updated.root.views[0] : undefined;
    expect(first?.lastFocusedAt).toBe(9);
  });

  it("keeps agents' tabs and untouched new tabs to itself", () => {
    const agents = { ...createBrowserViewState("https://example.test/"), agentOwned: true };
    expect(tabStaysHere(tab([view("v", "https://example.test/", { state: agents })]))).toBe(true);
    expect(tabStaysHere(tab([view("v", "about:blank", { placeholder: true })]))).toBe(true);
    expect(tabStaysHere(tab([]))).toBe(true);
    expect(tabStaysHere(tab([view("v", "https://example.test/")]))).toBe(false);
  });

  it("leaves alone a record it can't use", () => {
    expect(usableFields(null)).toBe(false);
    expect(usableFields({ order: 0 })).toBe(false);
    expect(usableFields({ order: 0, tree: { type: "leaf", id: "p", views: [{ id: 1 }] } })).toBe(
      false,
    );
    expect(usableFields({ order: 0, tree: { type: "future", id: "p" } })).toBe(false);
    expect(usableFields(tabFields(tab([view("v", "https://example.test/")]), 0, []))).toBe(true);
  });
});
