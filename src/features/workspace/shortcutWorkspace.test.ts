import { beforeEach, describe, expect, it } from "vitest";
import { dockLeaves, findDockLeaf } from "./dockTree";
import { useWorkspaceStore } from "./useWorkspaceStore";

describe("workspace shortcut actions", () => {
  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("cycles only within the focused pane and wraps", () => {
    const store = useWorkspaceStore.getState();
    const first = store.openSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Files",
      route: "/files",
      instancePolicy: "single",
    });
    const second = store.openSurface({
      surfaceId: "code",
      groupKey: "tool:code",
      title: "Code",
      route: "/code",
      instancePolicy: "multiple",
      forceNew: true,
    });
    expect(useWorkspaceStore.getState().cycleTab(1)?.id).toBe(first.id);
    expect(useWorkspaceStore.getState().cycleTab(-1)?.id).toBe(second.id);
  });

  it("selects the last tab for slot nine", () => {
    const store = useWorkspaceStore.getState();
    store.openSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Files",
      route: "/files",
      instancePolicy: "single",
    });
    const last = store.openSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Browser",
      route: "/browser",
      forceNew: true,
    });
    expect(useWorkspaceStore.getState().selectTab("last")?.id).toBe(last.id);
  });

  it("reopens the most recently closed tab in the focused pane", () => {
    const store = useWorkspaceStore.getState();
    const tab = store.openSurface({
      surfaceId: "code",
      groupKey: "tool:code",
      title: "Code",
      route: "/code",
      forceNew: true,
      state: { rootPath: "/project" },
    });
    store.openSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Browser",
      route: "/browser",
      forceNew: true,
    });
    store.closeTab(tab.id);
    const restored = useWorkspaceStore.getState().reopenClosedTab();
    expect(restored).toMatchObject({ id: tab.id, state: { rootPath: "/project" } });
    const layout = useWorkspaceStore.getState().layout;
    expect(findDockLeaf(layout.root, layout.focusedPaneId)?.activeTabId).toBe(tab.id);
  });

  it("recreates a collapsed panel when reopening its last tab", () => {
    const store = useWorkspaceStore.getState();
    store.openSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Files",
      route: "/files",
      instancePolicy: "single",
    });
    const browser = store.openSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Browser",
      route: "/browser",
      forceNew: true,
    });
    const firstPane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    expect(store.dockTab(browser.id, firstPane.id, "right")).toBe(true);
    const browserPane = dockLeaves(useWorkspaceStore.getState().layout.root).find((pane) =>
      pane.tabs.some((tab) => tab.id === browser.id),
    )!;
    const split = useWorkspaceStore.getState().layout.root;
    if (split.type === "split") store.updateSplitRatio(split.id, 0.38);

    expect(useWorkspaceStore.getState().closeTab(browser.id)).toBe(true);
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(1);

    const restored = useWorkspaceStore.getState().reopenClosedTab();
    const restoredLayout = useWorkspaceStore.getState().layout;
    expect(restored?.id).toBe(browser.id);
    expect(dockLeaves(restoredLayout.root)).toHaveLength(2);
    expect(findDockLeaf(restoredLayout.root, browserPane.id)?.activeTabId).toBe(browser.id);
    expect(restoredLayout.root).toMatchObject({ direction: "horizontal", ratio: 0.38 });
  });

  it("returns a tab to its existing source panel instead of the focused panel", () => {
    const store = useWorkspaceStore.getState();
    const files = store.openSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Files",
      route: "/files",
      instancePolicy: "single",
    });
    const browser = store.openSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Browser",
      route: "/browser",
      forceNew: true,
    });
    const firstPane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    store.dockTab(browser.id, firstPane.id, "right");
    const browserPane = dockLeaves(useWorkspaceStore.getState().layout.root).find((pane) =>
      pane.tabs.some((tab) => tab.id === browser.id),
    )!;
    store.openSurface({
      surfaceId: "code",
      groupKey: "tool:code",
      title: "Code",
      route: "/code",
      forceNew: true,
      paneId: browserPane.id,
    });

    store.closeTab(browser.id);
    store.focusTab(files.id);
    store.reopenClosedTab();

    expect(findDockLeaf(useWorkspaceStore.getState().layout.root, browserPane.id)?.tabs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: browser.id })]),
    );
  });
});
