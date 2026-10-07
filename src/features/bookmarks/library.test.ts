import { beforeEach, expect, it } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  bookmarkFolders,
  bookmarks,
  createBookmarkFolder,
  bookmarksBarId,
  bookmarkTree,
  moveBookmarkFolder,
  otherBookmarksId,
  removeBookmarkFolder,
  saveBookmark,
} from "./library";
import { recordChanges } from "@/features/browser-workspace/recordChanges";
const state = () => useWorkspaceStore.getState();
beforeEach(() => state().reset());
it("keeps old saved-link identities and encrypted wire records while editing a bookmark", () => {
  const folder = createBookmarkFolder("Research");
  const id = saveBookmark({ title: "Example", url: "example.com", folderId: folder });
  const before = state().bookmarks;
  saveBookmark({ id, title: "Renamed", url: "https://example.com/", folderId: folder });
  expect(bookmarks(state().bookmarks)).toEqual([
    { id, folderId: folder, title: "Renamed", url: "https://example.com/", order: 0 },
  ]);
  expect(recordChanges(before, state().bookmarks)).toEqual([
    { action: "patch", kind: "bookmark", id, fields: { title: "Renamed" } },
  ]);
  expect(bookmarkFolders(state().bookmarkFolders)[0].name).toBe("Research");
});
it("removes a folder without losing its bookmarks or editing open pages", () => {
  const folder = createBookmarkFolder("Reading"),
    layout = state().layout;
  const id = saveBookmark({ title: "Example", url: "example.com", folderId: folder });
  removeBookmarkFolder(folder);
  expect(bookmarks(state().bookmarks)).toMatchObject([{ id, folderId: otherBookmarksId }]);
  expect(state().bookmarkFolders.some((f) => f.id === folder)).toBe(false);
  expect(state().layout).toBe(layout);
});
it("rejects credentials and unsupported URLs before creating a default folder", () => {
  for (const url of ["javascript:alert(1)", "https://user:secret@example.com/"])
    expect(() => saveBookmark({ title: "Bad", url })).toThrow();
  expect(state().bookmarkFolders).toEqual([]);
  expect(state().bookmarks).toEqual([]);
});

const tree = () => bookmarkTree(state().bookmarkFolders, state().bookmarks);
it("nests folders and keeps folders directly in Other bookmarks in the older record shape", () => {
  const work = createBookmarkFolder("Work");
  const clients = createBookmarkFolder("Clients", { parentId: work });
  const onBar = createBookmarkFolder("Daily", { parentId: bookmarksBarId });
  const link = saveBookmark({ title: "Acme", url: "acme.example", folderId: clients });
  expect(state().bookmarkFolders.find((f) => f.id === work)?.fields.parent_id).toBeUndefined();
  expect(state().bookmarkFolders.find((f) => f.id === clients)?.fields.parent_id).toBe(work);
  expect(
    tree()
      .path(clients)
      .map((f) => f.name),
  ).toEqual(["Other bookmarks", "Work", "Clients"]);
  expect(
    tree()
      .children(bookmarksBarId)
      .map((n) => n.id),
  ).toEqual([onBar]);
  expect(
    tree()
      .children(clients)
      .map((n) => n.id),
  ).toEqual([link]);
});
it("shares one order between a folder's subfolders and links", () => {
  const first = saveBookmark({ title: "First", url: "first.example" });
  const folder = createBookmarkFolder("Middle");
  const last = saveBookmark({ title: "Last", url: "last.example" });
  expect(
    tree()
      .children(otherBookmarksId)
      .map((n) => n.id),
  ).toEqual([first, folder, last]);
});
it("refuses to move a folder inside itself and moves contents up on removal", () => {
  const outer = createBookmarkFolder("Outer");
  const inner = createBookmarkFolder("Inner", { parentId: outer });
  const link = saveBookmark({ title: "Deep", url: "deep.example", folderId: inner });
  expect(() => moveBookmarkFolder(outer, inner)).toThrow();
  removeBookmarkFolder(inner);
  expect(
    tree()
      .children(outer)
      .map((n) => n.id),
  ).toEqual([link]);
  removeBookmarkFolder(outer);
  expect(
    tree()
      .children(otherBookmarksId)
      .map((n) => n.id),
  ).toEqual([link]);
});
it("reads a parent loop from two devices as folders in Other bookmarks", () => {
  const a = createBookmarkFolder("A");
  const b = createBookmarkFolder("B", { parentId: a });
  useWorkspaceStore.setState((s) => ({
    bookmarkFolders: s.bookmarkFolders.map((f) =>
      f.id === a ? { ...f, fields: { ...f.fields, parent_id: b } } : f,
    ),
  }));
  const ids = tree()
    .children(otherBookmarksId)
    .map((n) => n.id);
  expect(ids.includes(a) || ids.includes(b)).toBe(true);
  expect(tree().path(a).length).toBeLessThan(5);
});
