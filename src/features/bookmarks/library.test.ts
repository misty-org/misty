import { beforeEach, expect, it } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  bookmarkFolders,
  bookmarks,
  createBookmarkFolder,
  removeBookmarkFolder,
  saveBookmark,
  unfiledFolderId,
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
  expect(bookmarks(state().bookmarks)).toMatchObject([{ id, folderId: unfiledFolderId }]);
  expect(state().bookmarkFolders.some((f) => f.id === folder)).toBe(false);
  expect(state().layout).toBe(layout);
});
it("rejects credentials and unsupported URLs before creating a default folder", () => {
  for (const url of ["javascript:alert(1)", "https://user:secret@example.com/"])
    expect(() => saveBookmark({ title: "Bad", url })).toThrow();
  expect(state().bookmarkFolders).toEqual([]);
  expect(state().bookmarks).toEqual([]);
});
