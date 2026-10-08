import { beforeEach, describe, expect, it } from "vitest";
import { createDockLeaf, dockLeaves, findDockLeaf, insertDockSplit } from "./dockTree";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { currentWindows } from "./windows";
import { migrateWorkspaceStore } from "./workspaceStorePersistence";
import { allLayoutViews } from "./layoutTabs";

describe("one workspace window per Space", () => {
  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("holds exactly one window, in its Space's scope", () => {
    const state = useWorkspaceStore.getState();
    expect(state.activeScopeKey).toBe("space:personal");
    expect(currentWindows(state)).toHaveLength(1);
    expect(currentWindows(state)[0].id).toBe(state.activeWindowId);
  });

  it("keeps the window's identity through a snapshot", () => {
    const id = useWorkspaceStore.getState().activeWindowId;
    const tab = useWorkspaceStore.getState().openBrowserView({ url: "https://example.com" });
    const snapshot = useWorkspaceStore.getState().createSnapshot("account", "device");
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.getState().replaceSnapshot(snapshot);
    expect(useWorkspaceStore.getState().activeWindowId).toBe(id);
    expect(allLayoutViews(useWorkspaceStore.getState().layout).map((view) => view.id)).toContain(
      tab.id,
    );
  });

  it("turns saved virtual windows into the active window's tabs", () => {
    const layout = (id: string) => {
      const leaf = createDockLeaf([
        {
          id,
          surfaceId: "agents" as const,
          groupKey: "tool:agents" as const,
          instanceKey: id,
          title: "Agents",
          route: "/agents",
          sidebarVisible: false,
          state: {},
          createdAt: 1,
          lastFocusedAt: 1,
        },
      ]);
      return { root: leaf, focusedPaneId: leaf.id };
    };
    const migrated = migrateWorkspaceStore(
      {
        activeScopeKey: "global",
        windowsByScope: {
          global: [
            { id: "window:a", title: "A", layout: layout("tab-a"), createdAt: 1, lastFocusedAt: 1 },
            { id: "window:b", title: "B", layout: layout("tab-b"), createdAt: 1, lastFocusedAt: 2 },
          ],
        },
        activeWindowIdByScope: { global: "window:b" },
        closedWindowsByScope: {},
      },
      17,
    );
    expect(migrated.activeScopeKey).toBe("space:personal");
    expect(migrated.activeWindowId).toBe("window:b");
    expect(allLayoutViews(migrated.layout).map((view) => view.id)).toEqual(["tab-b"]);
    expect("windowsByScope" in migrated).toBe(false);
  });

  it("caps the window at four panes", () => {
    const first = useWorkspaceStore.getState().layout.focusedPaneId;
    const second = useWorkspaceStore.getState().splitPane(first, "right")!;
    const third = useWorkspaceStore.getState().splitPane(second, "down")!;
    const fourth = useWorkspaceStore.getState().splitPane(third, "left")!;
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(4);
    expect(useWorkspaceStore.getState().splitPane(fourth, "down")).toBeNull();
  });

  it("migrates oversized saved layouts into four panes without dropping real tabs", () => {
    const createTestTab = (id: string) => ({
      id,
      surfaceId: "agents" as const,
      groupKey: "tool:agents" as const,
      instanceKey: "agents",
      title: "Agents",
      route: "/agents",
      sidebarVisible: false,
      state: {},
      createdAt: 1,
      lastFocusedAt: 1,
    });
    const first = createDockLeaf([createTestTab("tab-0")]);
    let root = first as ReturnType<typeof insertDockSplit>;
    let target = first.id;
    for (let index = 0; index < 4; index += 1) {
      const leaf = createDockLeaf([createTestTab(`tab-${index + 1}`)]);
      root = insertDockSplit(root, target, leaf, "right");
      target = leaf.id;
    }
    useWorkspaceStore.getState().replaceSnapshot({
      version: 2,
      accountId: "account",
      deviceId: "device",
      savedAt: 1,
      layout: { root, focusedPaneId: target },
      lastUsedViewByGroup: {},
    });

    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(4);
  });

  it("swaps pane views without changing the tab layout", () => {
    const files = useWorkspaceStore.getState().openSurface({
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Files",
      route: "/agents",
      forceNew: true,
    });
    const first = useWorkspaceStore.getState().layout.focusedPaneId;
    const second = useWorkspaceStore.getState().splitPane(first, "right")!;
    const terminal = useWorkspaceStore.getState().openSurface({
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Terminal",
      route: "/terminal",
      forceNew: true,
      paneId: second,
    });

    expect(useWorkspaceStore.getState().swapPanes(first, second)).toBe(true);
    expect(findDockLeaf(useWorkspaceStore.getState().layout.root, first)?.activeViewId).toBe(
      terminal.id,
    );
    expect(findDockLeaf(useWorkspaceStore.getState().layout.root, second)?.activeViewId).toBe(
      files.id,
    );
  });
});
