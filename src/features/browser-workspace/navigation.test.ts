import { beforeEach, describe, expect, it } from "vitest";
import { allLayoutViews, parseBrowserViewState, useWorkspaceStore } from "@/features/workspace";
import {
  addBookmark,
  createBookmarkFolder,
  openBookmark,
  reorderBookmarkFolders,
  bookmarkAddress,
} from "./navigation";
import { workspaceChanges } from "./changes";
import { recordChanges } from "./recordChanges";
import {
  partialWorkspaceStore,
  migrateWorkspaceStore,
} from "@/features/workspace/workspaceStorePersistence";
const state = () => useWorkspaceStore.getState();
beforeEach(() => {
  state().reset();
  createBookmarkFolder("Mail");
  createBookmarkFolder("Social");
});
describe("website groups in a browser workspace", () => {
  it("accepts arbitrary website placement and keeps the launch URL after browsing", () => {
    const group = state().bookmarkFolders.find((group) => group.fields.label === "Social")!;
    const id = addBookmark(group.id, "Drive", "https://drive.google.com/");
    const opened = openBookmark(id);
    expect(opened.surfaceId).toBe("browser");
    expect(parseBrowserViewState(opened.state).bookmarkId).toBe(id);
    state().updateBrowserView(opened.id, { url: "https://drive.google.com/drive/folders/example" });
    const resumed = openBookmark(id);
    expect(resumed.id).toBe(opened.id);
    expect(parseBrowserViewState(resumed.state).url).toContain("/folders/example");
    expect(state().bookmarks.find((website) => website.id === id)?.fields.url).toBe(
      "https://drive.google.com/",
    );
    expect(openBookmark(id, true).id).not.toBe(opened.id);
  });
  it("resumes within the current virtual window and opens a separate view in another", () => {
    const id = addBookmark(state().bookmarkFolders[0].id, "Example", "example.com");
    const first = openBookmark(id);
    const firstWindow = state().activeWindowId;
    state().createWindow();
    const second = openBookmark(id);
    expect(second.id).not.toBe(first.id);
    state().switchWindow(firstWindow);
    expect(openBookmark(id).id).toBe(first.id);
  });
  it("captures the site identity with the tab creation, without a follow-up mutation", () => {
    const id = addBookmark(state().bookmarkFolders[0].id, "Example", "example.com");
    const before = state().windowsByScope.global!;
    const tab = openBookmark(id);
    const changes = workspaceChanges(
      before,
      state().windowsByScope.global!,
      "a".repeat(64),
    ).changes;
    expect(changes).toContainEqual(
      expect.objectContaining({
        action: "create",
        kind: "view",
        id: tab.id,
        fields: expect.objectContaining({
          bookmark_id: id,
          surface: "browser",
          url: "https://example.com/",
        }),
      }),
    );
  });
  it("persists custom groups, pins, and local selection while excluding local focus from shared deltas", () => {
    const id = createBookmarkFolder("Research");
    addBookmark(id, "Papers", "papers.example");
    const before = [...state().bookmarkFolders, ...state().bookmarks];
    useWorkspaceStore.setState({
      expandedBookmarkFolders: { [id]: false },
      selectedBookmarkByFolder: { [id]: "local-only" },
    });
    expect(recordChanges(before, [...state().bookmarkFolders, ...state().bookmarks])).toEqual([]);
    const saved = JSON.parse(JSON.stringify(partialWorkspaceStore(state())));
    const restored = migrateWorkspaceStore(saved, 13);
    expect(restored.bookmarkFolders).toEqual(state().bookmarkFolders);
    expect(restored.bookmarks).toEqual(state().bookmarks);
    expect(restored.expandedBookmarkFolders[id]).toBe(false);
    state().reset();
    expect(state().bookmarks).toEqual([]);
  });
  it("rejects partial reorder lists rather than losing groups", () => {
    const before = state().bookmarkFolders;
    expect(() => reorderBookmarkFolders([before[0].id])).toThrow("changed");
    expect(state().bookmarkFolders).toBe(before);
    reorderBookmarkFolders([...before].reverse().map((group) => group.id));
    expect(state().bookmarkFolders[0].id).toBe(before[before.length - 1].id);
  });
  it("does not treat saved sites as scripts, search queries, or embedded credentials", () => {
    expect(bookmarkAddress("localhost:3000")).toBe("http://localhost:3000/");
    for (const value of [
      "javascript:alert(1)",
      "not a website",
      "https://user:password@example.com",
      "about:blank",
    ])
      expect(() => bookmarkAddress(value)).toThrow();
  });
  it("opens in a requested split pane without replacing its sibling or creating another layout", () => {
    const left = state().openBrowserView({ url: "https://left.example" });
    const layout = state().layout.activeTabId;
    const rightPane = state().splitPane(state().layout.focusedPaneId, "right")!;
    const right = state().openBrowserView({ url: "https://right.example", paneId: rightPane });
    expect(state().layout.activeTabId).toBe(layout);
    expect(allLayoutViews(state().layout).map((tab) => tab.id)).toContain(left.id);
    expect(allLayoutViews(state().layout).map((tab) => tab.id)).toContain(right.id);
    expect(state().layout.root.type).toBe("split");
  });
});
