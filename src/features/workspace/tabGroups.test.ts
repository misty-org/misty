import { mergeRecoveredWorkspace } from "./mergeRecoveredWorkspace";
import { beforeEach, expect, it } from "vitest";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { activeLayoutView, allLayoutViews, layoutTabs } from "./layoutTabs";
import { migrateSavedLinkGroups } from "./tabGroups";
import { createBookmarkFolder, saveBookmark } from "@/features/bookmarks/library";
import { partialWorkspaceStore, migrateWorkspaceStore } from "./workspaceStorePersistence";
import { retainDeviceState } from "@/features/browser-workspace/deviceState";
const state = () => useWorkspaceStore.getState();
const tabs = () => layoutTabs(state().layout);
const add = (title: string) => {
  const view = state().newTab();
  state().renameView(view.id, title);
  return tabs().find((t) => activeLayoutView(t)?.id === view.id)!.id;
};
beforeEach(() => state().reset());
it("groups nonadjacent tabs contiguously and moves the whole block", () => {
  const a = tabs()[0].id,
    b = add("B"),
    c = add("C"),
    d = add("D");
  const group = state().createTabGroup([a, c], "Research")!;
  expect(tabs().map((t) => t.id)).toEqual([a, c, b, d]);
  state().moveTabGroupItem(`group-header:${group}`, d, true);
  expect(tabs().map((t) => t.id)).toEqual([b, d, a, c]);
  state().moveTabGroupItem(c, b, false);
  expect(tabs().find((t) => t.id === c)?.tabGroupId).toBeUndefined();
  expect(tabs().map((t) => t.id)).toEqual([c, b, d, a]);
});
it("collapses the only group without closing its views and expands a focused member", () => {
  const a = tabs()[0].id,
    b = add("B"),
    before = allLayoutViews(state().layout).map((v) => v.id);
  const group = state().createTabGroup([a, b])!;
  state().toggleTabGroup(group);
  expect(state().tabGroups.find((g) => g.id === group)?.collapsed).toBe(true);
  expect(tabs()).toHaveLength(3);
  expect(allLayoutViews(state().layout).map((v) => v.id)).toEqual(expect.arrayContaining(before));
  expect(tabs().find((t) => t.id === state().layout.activeTabId)?.tabGroupId).toBeUndefined();
  state().focusView(before[0]);
  expect(state().tabGroups.find((g) => g.id === group)?.collapsed).toBe(false);
});
it("saves and restores mixed surfaces and split trees with fresh identities only once", () => {
  const first = tabs()[0].id;
  const file = state().addSurface({
    surfaceId: "agents",
    groupKey: "tool:agents",
    title: "Files",
    route: "/agents",
    state: { path: "/example" },
  });
  const second = tabs().find((t) => activeLayoutView(t)?.id === file.id)!.id;
  const group = state().createTabGroup([first, second], "Work", "green")!;
  const original = allLayoutViews(state().layout).map((v) => v.id);
  expect(state().closeTabGroup(group)).toBe(true);
  expect(state().tabGroups[0].savedTabs).toHaveLength(2);
  state().reopenTabGroup(group);
  expect(tabs().filter((t) => t.tabGroupId === group)).toHaveLength(2);
  expect(allLayoutViews(state().layout).some((v) => original.includes(v.id))).toBe(false);
  const count = tabs().length;
  state().reopenTabGroup(group);
  expect(tabs()).toHaveLength(count);
});
it("never persists private pages or their history in saved groups", () => {
  const publicId = tabs()[0].id;
  state().openBrowserView({ url: "https://private.example/", private: true });
  const privateId = state().layout.activeTabId!;
  const group = state().createTabGroup([publicId, privateId])!;
  state().closeTabGroup(group);
  expect(state().tabGroups[0].savedTabs).toHaveLength(1);
  expect(JSON.stringify(partialWorkspaceStore(state()))).not.toContain("private.example");
});
it("migrates old Groups once without opening or losing saved links, and survives restart", () => {
  const folder = createBookmarkFolder("Old reading");
  saveBookmark({ title: "Example", url: "example.com", folderId: folder });
  useWorkspaceStore.setState({ migratedTabGroupIds: [] });
  const before = state().layout,
    migration = migrateSavedLinkGroups(state());
  expect(migration.tabGroups).toHaveLength(1);
  expect(migration.tabGroups[0].savedTabs).toHaveLength(1);
  useWorkspaceStore.setState(migration);
  expect(migrateSavedLinkGroups(state())).toEqual(migration);
  state().deleteSavedTabGroup(migration.tabGroups[0].id);
  expect(migrateSavedLinkGroups(state()).tabGroups).toEqual([]);
  expect(state().layout).toBe(before);
  const id = state().createTabGroup([tabs()[0].id], "Persistent")!;
  const restored = migrateWorkspaceStore(partialWorkspaceStore(state()), 16);
  expect(restored.tabGroups.some((g) => g.id === id)).toBe(true);
  expect(layoutTabs(restored.layout)[0].tabGroupId).toBe(id);
});
it("retains local group membership across a remote page/title update", () => {
  const id = state().createTabGroup([tabs()[0].id])!;
  const before = state().windowsByScope.global!;
  const incoming = before.map((w) => ({
    ...w,
    layout: {
      ...w.layout,
      tabs: layoutTabs(w.layout).map((t) => ({ ...t, tabGroupId: undefined })),
    },
  }));
  expect(layoutTabs(retainDeviceState(incoming, before)[0].layout)[0].tabGroupId).toBe(id);
});
it("moves a group to another window without duplicating live views", () => {
  const first = tabs()[0].id,
    second = add("Second");
  const group = state().createTabGroup([first, second])!;
  const viewIds = allLayoutViews(state().layout).map((v) => v.id);
  const oldWindow = state().activeWindowId;
  state().moveTabGroupToNewWindow(group);
  expect(state().activeWindowId).not.toBe(oldWindow);
  expect(allLayoutViews(state().layout).map((v) => v.id)).toEqual(viewIds);
  const windows = state().windowsByScope.global!;
  expect(
    windows.flatMap((w) => allLayoutViews(w.layout)).filter((v) => viewIds.includes(v.id)),
  ).toHaveLength(2);
  state().switchWindow(oldWindow);
  state().reopenTabGroup(group);
  expect(state().activeWindowId).not.toBe(oldWindow);
  expect(state().windowsByScope.global).toHaveLength(2);
});
it("does not reinterpret new bookmark folders as tab groups on restart", () => {
  const folder = createBookmarkFolder("Bookmarks only");
  saveBookmark({ title: "Example", url: "https://example.com", folderId: folder });
  const migrated = migrateWorkspaceStore(partialWorkspaceStore(state()), 16);
  expect(migrated.tabGroups).toEqual([]);
  expect(migrated.bookmarks).toHaveLength(1);
});

it("keeps saved groups when recovering alongside a temporary workspace", () => {
  const id = state().createTabGroup([tabs()[0].id], "Recovered")!;
  state().closeTabGroup(id);
  const recovered = partialWorkspaceStore(state());
  state().reset();
  const baseline = partialWorkspaceStore(state());
  const temporaryId = state().createTabGroup([tabs()[0].id], "Temporary")!;
  const merged = mergeRecoveredWorkspace(recovered, state(), baseline);
  expect(merged.tabGroups?.map((g) => g.id)).toEqual(expect.arrayContaining([id, temporaryId]));
  useWorkspaceStore.setState(merged);
  const beforeDelete = partialWorkspaceStore(state());
  state().deleteSavedTabGroup(id);
  expect(
    mergeRecoveredWorkspace(recovered, state(), beforeDelete).tabGroups?.some((g) => g.id === id),
  ).toBe(false);
});
