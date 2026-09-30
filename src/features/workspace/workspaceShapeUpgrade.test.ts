import { expect, it } from "vitest";
import { upgradeWorkspaceShape } from "./workspaceShapeUpgrade";

const browserState = { version: 1, url: "https://a.test", faviconUrl: null, websiteId: "b1" };

it("renames pre-rename workspace state to the Window → Tab → Pane → View names", () => {
  const leaf = {
    type: "leaf",
    id: "p1",
    tabs: [{ id: "v1", state: browserState }],
    activeTabId: "v1",
  };
  const layout = {
    root: leaf,
    focusedPaneId: "p1",
    tabs: [{ id: "t1", root: leaf, focusedPaneId: "p1" }],
    activeLayoutTabId: "t1",
  };
  const upgraded = upgradeWorkspaceShape({
    layout,
    virtualWindowsByScope: { global: [{ id: "w1", title: "", layout }] },
    activeVirtualWindowId: "w1",
    activeVirtualWindowIdByScope: { global: "w1" },
    closedVirtualWindowsByScope: {},
    lastUsedTabByGroup: { "tool:browser": "v1" },
    websiteGroups: [],
    savedWebsites: [],
    expandedWebsiteGroups: {},
    selectedWebsiteByGroup: {},
    closedTabs: [
      {
        tab: { id: "v2" },
        layoutTab: { id: "t2" },
        layoutTabId: "t2",
        windowId: "w1",
        paneId: "p1",
      },
    ],
  });
  const pane = {
    type: "leaf",
    id: "p1",
    views: [
      {
        id: "v1",
        state: { version: 1, url: "https://a.test", faviconUrl: null, bookmarkId: "b1" },
      },
    ],
    activeViewId: "v1",
  };
  const expectedLayout = {
    root: pane,
    focusedPaneId: "p1",
    tabs: [{ id: "t1", root: pane, focusedPaneId: "p1" }],
    activeTabId: "t1",
  };
  expect(upgraded).toEqual({
    layout: expectedLayout,
    windowsByScope: { global: [{ id: "w1", title: "", layout: expectedLayout }] },
    activeWindowId: "w1",
    activeWindowIdByScope: { global: "w1" },
    closedWindowsByScope: {},
    lastUsedViewByGroup: { "tool:browser": "v1" },
    bookmarkFolders: [],
    bookmarks: [],
    expandedBookmarkFolders: {},
    selectedBookmarkByFolder: {},
    closedItems: [
      { view: { id: "v2" }, tab: { id: "t2" }, tabId: "t2", windowId: "w1", paneId: "p1" },
    ],
  });
});

it("leaves current state unchanged, so every load path can call it", () => {
  const current = {
    layout: {
      root: { type: "leaf", id: "p", views: [], activeViewId: null },
      focusedPaneId: "p",
      tabs: [],
      activeTabId: "t",
    },
    closedItems: [{ view: { id: "v" }, tab: { id: "t" }, tabId: "t", windowId: "w", paneId: "p" }],
    windowsByScope: {},
  };
  expect(upgradeWorkspaceShape(current)).toEqual(current);
  expect(upgradeWorkspaceShape(upgradeWorkspaceShape(current))).toEqual(current);
});
