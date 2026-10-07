import { beforeEach, expect, it } from "vitest";
import {
  bookmarksBarId,
  bookmarkTree,
  createBookmarkFolder,
  otherBookmarksId,
  saveBookmark,
} from "@/features/bookmarks/library";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { importBookmarks, libraryRoots, needsNestedFolders } from "./bookmarks";
import type { ImportedBookmarkRoots } from "./native";

const state = () => useWorkspaceStore.getState();
const tree = () => bookmarkTree(state().bookmarkFolders, state().bookmarks);
beforeEach(() => state().reset());

const chrome: ImportedBookmarkRoots = {
  bar: [
    { kind: "link", title: "GitHub", url: "https://github.com/", addedAt: 1_700_000_000_000 },
    {
      kind: "folder",
      title: "Work",
      children: [
        {
          kind: "folder",
          title: "Clients",
          children: [{ kind: "link", title: "Acme", url: "https://acme.example/" }],
        },
      ],
    },
  ],
  other: [
    {
      kind: "folder",
      title: "Reading",
      children: [{ kind: "link", title: "Blog", url: "https://blog.example/" }],
    },
  ],
  mobile: [],
};

it("places each root in Misty's matching root and keeps dates", () => {
  const result = importBookmarks(chrome);
  expect(result.added).toEqual({ links: 3, folders: 3 });
  const bar = tree().children(bookmarksBarId);
  expect(bar.map((n) => (n.kind === "folder" ? n.name : n.title))).toEqual(["GitHub", "Work"]);
  expect(bar[0]).toMatchObject({ addedAt: 1_700_000_000_000 });
  const reading = state().bookmarkFolders.find((f) => f.fields.label === "Reading")!;
  // Folders directly in Other bookmarks keep the record shape older versions read.
  expect(reading.fields.parent_id).toBeUndefined();
  expect(state().bookmarkFolders.find((f) => f.fields.label === "Clients")?.fields.parent_id).toBe(
    state().bookmarkFolders.find((f) => f.fields.label === "Work")!.id,
  );
});

it("changes nothing when the same import runs twice", () => {
  importBookmarks(chrome);
  const before = { folders: state().bookmarkFolders, bookmarks: state().bookmarks };
  const again = importBookmarks(chrome);
  expect(again.added).toEqual({ links: 0, folders: 0 });
  expect(again.duplicates).toBe(3);
  expect(state().bookmarkFolders).toEqual(before.folders);
  expect(state().bookmarks).toEqual(before.bookmarks);
});

it("merges into existing folders and exports the same tree back", () => {
  const reading = createBookmarkFolder("Reading");
  saveBookmark({ title: "Blog", url: "https://blog.example/", folderId: reading });
  saveBookmark({ title: "Mine", url: "https://mine.example/" });
  importBookmarks(chrome);
  expect(tree().children(reading)).toHaveLength(1);
  const roots = libraryRoots(tree());
  expect(roots.bar).toEqual(chrome.bar);
  expect(roots.other.map((n) => n.title)).toEqual(["Reading", "Mine"]);
  expect(tree().children(otherBookmarksId)).toHaveLength(2);
});

it("knows when an import needs nested folders", () => {
  expect(needsNestedFolders(chrome)).toBe(true);
  expect(needsNestedFolders({ bar: [], mobile: [], other: chrome.other })).toBe(false);
});
