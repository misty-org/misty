import { beforeEach, describe, expect, it } from "vitest";
import { dockLeaves, findDockLeaf } from "./dockTree";
import { useWorkspaceStore } from "./useWorkspaceStore";

describe("workspace shortcut actions", () => {
  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("cycles window tabs and wraps", () => {
    const store = useWorkspaceStore.getState();
    const defaultTab = findDockLeaf(store.layout.root, store.layout.focusedPaneId)?.views[0];
    const first = store.addSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Files",
      route: "/files",
      instancePolicy: "single",
    });
    store.addSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Code",
      route: "/code",
      instancePolicy: "multiple",
      forceNew: true,
    });
    expect(useWorkspaceStore.getState().cycleView(1)?.id).toBe(defaultTab?.id);
    expect(useWorkspaceStore.getState().cycleView(1)?.id).toBe(first.id);
    expect(useWorkspaceStore.getState().cycleView(-1)?.id).toBe(defaultTab?.id);
  });

  it("selects the last tab for slot nine", () => {
    const store = useWorkspaceStore.getState();
    store.addSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Files",
      route: "/files",
      instancePolicy: "single",
    });
    const last = store.addSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Browser",
      route: "/browser",
      forceNew: true,
    });
    expect(useWorkspaceStore.getState().selectView("last")?.id).toBe(last.id);
  });

  it("reopens the most recently closed tab in the focused pane", () => {
    const store = useWorkspaceStore.getState();
    const tab = store.addSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Code",
      route: "/code",
      forceNew: true,
      state: { rootPath: "/project" },
    });
    store.addSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Browser",
      route: "/browser",
      forceNew: true,
    });
    store.closeView(tab.id);
    const restored = useWorkspaceStore.getState().reopenClosedView();
    expect(restored).toMatchObject({ id: tab.id, state: { rootPath: "/project" } });
    const layout = useWorkspaceStore.getState().layout;
    expect(findDockLeaf(layout.root, layout.focusedPaneId)?.activeViewId).toBe(tab.id);
  });

  it("recreates a collapsed panel when reopening its last tab", () => {
    const store = useWorkspaceStore.getState();
    store.addSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Files",
      route: "/files",
      instancePolicy: "single",
    });
    const sourcePaneId = useWorkspaceStore.getState().layout.focusedPaneId;
    const browser = store.addSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Browser",
      route: "/browser",
      forceNew: true,
    });
    const firstPane = { id: sourcePaneId };
    expect(store.dockView(browser.id, firstPane.id, "right")).toBe(true);
    const browserPane = dockLeaves(useWorkspaceStore.getState().layout.root).find((pane) =>
      pane.views.some((tab) => tab.id === browser.id),
    )!;
    const split = useWorkspaceStore.getState().layout.root;
    if (split.type === "split") store.updateSplitRatio(split.id, 0.38);

    expect(useWorkspaceStore.getState().closeView(browser.id)).toBe(true);
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(1);

    const restored = useWorkspaceStore.getState().reopenClosedView();
    const restoredLayout = useWorkspaceStore.getState().layout;
    expect(restored?.id).toBe(browser.id);
    expect(dockLeaves(restoredLayout.root)).toHaveLength(2);
    expect(findDockLeaf(restoredLayout.root, browserPane.id)?.activeViewId).toBe(browser.id);
    expect(restoredLayout.root).toMatchObject({ direction: "horizontal", ratio: 0.38 });
  });

  it("returns a tab to its existing source panel instead of the focused panel", () => {
    const store = useWorkspaceStore.getState();
    const files = store.addSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Files",
      route: "/files",
      instancePolicy: "single",
    });
    const sourcePaneId = useWorkspaceStore.getState().layout.focusedPaneId;
    const browser = store.addSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Browser",
      route: "/browser",
      forceNew: true,
    });
    const firstPane = { id: sourcePaneId };
    store.dockView(browser.id, firstPane.id, "right");
    const browserPane = dockLeaves(useWorkspaceStore.getState().layout.root).find((pane) =>
      pane.views.some((tab) => tab.id === browser.id),
    )!;
    store.addSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Code",
      route: "/code",
      forceNew: true,
      paneId: browserPane.id,
    });

    store.closeView(browser.id);
    store.focusView(files.id);
    store.reopenClosedView();

    expect(findDockLeaf(useWorkspaceStore.getState().layout.root, browserPane.id)?.views).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: browser.id })]),
    );
  });
});
