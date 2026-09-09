import { describe, expect, it } from "vitest";
import type { WorkspaceDockNode, WorkspaceTab, WorkspaceVirtualWindow } from "./model";
import { flattenWorkspaceTabs, groupWorkspaceTabsByWindow } from "./mobileWorkspaceProjection";

describe("flattenWorkspaceTabs", () => {
  it("projects every pane and window by recency without changing the source layouts", () => {
    const first = tab("first", "space", 10);
    const newest = tab("newest", "browser", 30);
    const hidden = tab("hidden", "extension", 40);
    const root: WorkspaceDockNode = {
      type: "split",
      id: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "leaf", id: "pane-a", tabs: [first], activeTabId: first.id },
      second: { type: "leaf", id: "pane-b", tabs: [hidden], activeTabId: hidden.id },
    };
    const windows: WorkspaceVirtualWindow[] = [
      {
        id: "window-a",
        title: "Window 1",
        createdAt: 1,
        lastFocusedAt: 1,
        layout: { root, focusedPaneId: "pane-a" },
      },
      {
        id: "window-b",
        title: "Window 2",
        createdAt: 2,
        lastFocusedAt: 2,
        layout: {
          root: { type: "leaf", id: "pane-c", tabs: [newest], activeTabId: newest.id },
          focusedPaneId: "pane-c",
        },
      },
    ];
    const before = structuredClone(windows);

    const projected = flattenWorkspaceTabs(
      { activeScopeKey: "space:one", virtualWindowsByScope: { "space:one": windows } },
      { excludeSurfaceIds: new Set(["extension", "marketplace"]) },
    );

    expect(projected.map((entry) => [entry.tab.id, entry.paneId, entry.windowId])).toEqual([
      ["newest", "pane-c", "window-b"],
      ["first", "pane-a", "window-a"],
    ]);
    expect(windows).toEqual(before);
  });

  it("groups projected tabs by virtual window while preserving window order", () => {
    const older = tab("older", "space", 10);
    const newer = tab("newer", "browser", 20);
    const hidden = tab("hidden", "marketplace", 30);
    const windows: WorkspaceVirtualWindow[] = [
      {
        id: "window-a",
        title: "Window 1",
        createdAt: 1,
        lastFocusedAt: 1,
        layout: {
          root: { type: "leaf", id: "pane-a", tabs: [older, newer], activeTabId: newer.id },
          focusedPaneId: "pane-a",
        },
      },
      {
        id: "window-b",
        title: "Research",
        createdAt: 2,
        lastFocusedAt: 2,
        layout: {
          root: { type: "leaf", id: "pane-b", tabs: [hidden], activeTabId: hidden.id },
          focusedPaneId: "pane-b",
        },
      },
    ];

    const grouped = groupWorkspaceTabsByWindow(
      { activeScopeKey: "space:one", virtualWindowsByScope: { "space:one": windows } },
      { excludeSurfaceIds: new Set(["extension", "marketplace"]) },
    );

    expect(grouped.map((group) => group.window.title)).toEqual(["Window 1", "Research"]);
    expect(grouped[0].tabs.map((entry) => entry.tab.id)).toEqual(["newer", "older"]);
    expect(grouped[1].tabs).toEqual([]);
  });
});

function tab(
  id: string,
  surfaceId: WorkspaceTab["surfaceId"],
  lastFocusedAt: number,
): WorkspaceTab {
  return {
    id,
    surfaceId,
    groupKey: surfaceId === "space" ? "space:one" : `tool:${surfaceId}`,
    instanceKey: id,
    title: id,
    route: surfaceId === "space" ? "/spaces/one/home" : `/${surfaceId}`,
    sidebarVisible: true,
    state: {},
    createdAt: lastFocusedAt,
    lastFocusedAt,
  };
}
