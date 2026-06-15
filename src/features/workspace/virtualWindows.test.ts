import { beforeEach, describe, expect, it } from "vitest";
import { createDockLeaf, dockLeaves, dockTabs, findDockLeaf, insertDockSplit } from "./dockTree";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { canCloseWorkspaceWindow } from "./workspaceTabOperations";

describe("workspace virtual windows", () => {
  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("does not offer closing the final virtual window", () => {
    const windows = useWorkspaceStore.getState().virtualWindowsByScope.global ?? [];
    expect(windows).toHaveLength(1);
    expect(canCloseWorkspaceWindow(windows[0], windows)).toBe(false);
  });

  it("gives each Space independently switchable virtual windows", () => {
    const store = useWorkspaceStore.getState();
    store.setScope("space:family");
    const firstWindowId = useWorkspaceStore.getState().activeVirtualWindowId;
    store.openSurface({
      surfaceId: "code",
      groupKey: "tool:code",
      title: "Code",
      route: "/code",
      forceNew: true,
    });
    const secondWindow = useWorkspaceStore.getState().createVirtualWindow("Research");
    useWorkspaceStore.getState().openSurface({
      surfaceId: "terminal",
      groupKey: "tool:terminal",
      title: "Terminal",
      route: "/terminal",
      forceNew: true,
    });

    expect(useWorkspaceStore.getState().switchVirtualWindow(firstWindowId)).toBe(true);
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toContainEqual(
      expect.objectContaining({ surfaceId: "code" }),
    );
    expect(useWorkspaceStore.getState().switchVirtualWindow(secondWindow.id)).toBe(true);
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toContainEqual(
      expect.objectContaining({ surfaceId: "terminal" }),
    );
    useWorkspaceStore.getState().setScope("space:work");
    expect(useWorkspaceStore.getState().virtualWindowsByScope["space:work"]).toHaveLength(1);
    useWorkspaceStore.getState().setScope("space:family");
    expect(useWorkspaceStore.getState().virtualWindowsByScope["space:family"]).toHaveLength(2);
    expect(useWorkspaceStore.getState().activeVirtualWindowId).toBe(secondWindow.id);
  });

  it("creates a Space-local window with its own Home tab", () => {
    const store = useWorkspaceStore.getState();
    store.setScope("space:family");
    const firstWindowId = useWorkspaceStore.getState().activeVirtualWindowId;
    const second = useWorkspaceStore.getState().createVirtualWindow();

    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:family");
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toMatchObject([
      { surfaceId: "space", title: "Home", route: "/spaces/family/home" },
    ]);
    expect(useWorkspaceStore.getState().switchVirtualWindow(firstWindowId)).toBe(true);
    expect(useWorkspaceStore.getState().switchVirtualWindow(second.id)).toBe(true);
  });

  it("applies async tab updates while the owning virtual window is inactive", () => {
    const store = useWorkspaceStore.getState();
    const firstWindowId = store.activeVirtualWindowId;
    const browser = store.openBrowserTab({ url: "https://example.com" });
    const second = store.createVirtualWindow("Second");

    useWorkspaceStore.getState().updateBrowserTab(browser.id, {
      url: "https://updated.example.com/path",
      title: "Updated in background",
    });
    expect(useWorkspaceStore.getState().activeVirtualWindowId).toBe(second.id);
    expect(useWorkspaceStore.getState().switchVirtualWindow(firstWindowId)).toBe(true);
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toContainEqual(
      expect.objectContaining({
        id: browser.id,
        title: "Updated in background",
        state: expect.objectContaining({ url: "https://updated.example.com/path" }),
      }),
    );
  });

  it("reopens the most recently closed virtual window in the same Space", () => {
    const store = useWorkspaceStore.getState();
    store.setScope("space:work");
    const second = useWorkspaceStore.getState().createVirtualWindow("Research");
    expect(useWorkspaceStore.getState().closeVirtualWindow(second.id)).toBe(true);
    expect(useWorkspaceStore.getState().closedVirtualWindowsByScope["space:work"]?.[0].id).toBe(
      second.id,
    );

    const reopened = useWorkspaceStore.getState().reopenClosedVirtualWindow();
    expect(reopened?.id).toBe(second.id);
    expect(useWorkspaceStore.getState().activeVirtualWindowId).toBe(second.id);
    expect(useWorkspaceStore.getState().closedVirtualWindowsByScope["space:work"]).toEqual([]);
  });

  it("closes a virtual window when its final tab closes and another window remains", () => {
    const store = useWorkspaceStore.getState();
    store.setScope("space:work");
    const firstWindowId = useWorkspaceStore.getState().activeVirtualWindowId;
    const second = useWorkspaceStore.getState().createVirtualWindow("Second");
    const onlyTab = dockTabs(useWorkspaceStore.getState().layout.root)[0];

    expect(useWorkspaceStore.getState().closeTab(onlyTab.id)).toBe(true);
    expect(useWorkspaceStore.getState().activeVirtualWindowId).toBe(firstWindowId);
    expect(useWorkspaceStore.getState().virtualWindowsByScope["space:work"]).toHaveLength(1);
    expect(useWorkspaceStore.getState().closedVirtualWindowsByScope["space:work"]?.[0].id).toBe(
      second.id,
    );
  });

  it("closes a virtual window containing Home when another window remains", () => {
    const store = useWorkspaceStore.getState();
    store.setScope("space:family");
    const firstWindowId = useWorkspaceStore.getState().activeVirtualWindowId;
    store.openSurface({
      surfaceId: "space",
      groupKey: "space:family",
      scopeKey: "space:family",
      instanceKey: "family",
      title: "Home",
      route: "/spaces/family/home",
      forceNew: true,
    });
    const second = useWorkspaceStore.getState().createVirtualWindow("Research");
    store.openSurface({
      surfaceId: "code",
      groupKey: "tool:code",
      title: "Code",
      route: "/code",
      forceNew: true,
    });

    expect(useWorkspaceStore.getState().closeVirtualWindow(firstWindowId)).toBe(true);
    expect(useWorkspaceStore.getState().activeVirtualWindowId).toBe(second.id);
    expect(useWorkspaceStore.getState().virtualWindowsByScope["space:family"]).toHaveLength(1);
    expect(useWorkspaceStore.getState().closedVirtualWindowsByScope["space:family"]?.[0].id).toBe(
      firstWindowId,
    );
  });

  it("extracts a complete panel and its tabs into a new virtual window", () => {
    const firstPane = useWorkspaceStore.getState().layout.focusedPaneId;
    const secondPane = useWorkspaceStore.getState().splitPane(firstPane, "right")!;
    const code = useWorkspaceStore.getState().openSurface({
      surfaceId: "code",
      groupKey: "tool:code",
      title: "Code",
      route: "/code",
      forceNew: true,
      paneId: secondPane,
    });
    const sourceWindowId = useWorkspaceStore.getState().activeVirtualWindowId;
    const extracted = useWorkspaceStore.getState().extractPaneToVirtualWindow(secondPane);

    expect(extracted?.title).toBe("Code");
    expect(dockTabs(useWorkspaceStore.getState().layout.root).map((tab) => tab.id)).toContain(
      code.id,
    );
    expect(useWorkspaceStore.getState().switchVirtualWindow(sourceWindowId)).toBe(true);
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(1);
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).not.toContainEqual(
      expect.objectContaining({ id: code.id }),
    );
  });

  it("focuses a known tab by switching to its owning virtual window", () => {
    const firstWindowId = useWorkspaceStore.getState().activeVirtualWindowId;
    const files = useWorkspaceStore.getState().openSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Files",
      route: "/files",
      forceNew: true,
    });
    useWorkspaceStore.getState().createVirtualWindow("Second");

    expect(useWorkspaceStore.getState().focusTab(files.id)).toBe(true);
    expect(useWorkspaceStore.getState().activeVirtualWindowId).toBe(firstWindowId);
    expect(dockTabs(useWorkspaceStore.getState().layout.root).map((tab) => tab.id)).toContain(
      files.id,
    );
  });

  it("caps each virtual window at four panels", () => {
    const first = useWorkspaceStore.getState().layout.focusedPaneId;
    const second = useWorkspaceStore.getState().splitPane(first, "right")!;
    const third = useWorkspaceStore.getState().splitPane(second, "down")!;
    const fourth = useWorkspaceStore.getState().splitPane(third, "left")!;
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(4);
    expect(useWorkspaceStore.getState().splitPane(fourth, "down")).toBeNull();
  });

  it("migrates oversized saved layouts into four panels without dropping real tabs", () => {
    const createTestTab = (id: string) => ({
      id,
      surfaceId: "inbox" as const,
      groupKey: "tool:inbox" as const,
      instanceKey: "inbox",
      title: "Inbox",
      route: "/inbox",
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
      lastUsedTabByGroup: {},
    });

    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(4);
  });

  it("round-trips all virtual windows through workspace snapshots", () => {
    const firstWindowId = useWorkspaceStore.getState().activeVirtualWindowId;
    const second = useWorkspaceStore.getState().createVirtualWindow("Research");
    const snapshot = useWorkspaceStore.getState().createSnapshot("account", "device");

    useWorkspaceStore.getState().reset();
    useWorkspaceStore.getState().replaceSnapshot(snapshot);
    expect(useWorkspaceStore.getState().virtualWindowsByScope.global).toHaveLength(2);
    expect(useWorkspaceStore.getState().activeVirtualWindowId).toBe(second.id);
    expect(
      useWorkspaceStore.getState().virtualWindowsByScope.global?.map((window) => window.id),
    ).toContain(firstWindowId);
  });

  it("swaps complete panel tab groups without changing the dock shape", () => {
    const first = useWorkspaceStore.getState().layout.focusedPaneId;
    const files = useWorkspaceStore.getState().openSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Files",
      route: "/files",
      forceNew: true,
      paneId: first,
    });
    const second = useWorkspaceStore.getState().splitPane(first, "right")!;
    const terminal = useWorkspaceStore.getState().openSurface({
      surfaceId: "terminal",
      groupKey: "tool:terminal",
      title: "Terminal",
      route: "/terminal",
      forceNew: true,
      paneId: second,
    });

    expect(useWorkspaceStore.getState().swapPanes(first, second)).toBe(true);
    expect(findDockLeaf(useWorkspaceStore.getState().layout.root, first)?.activeTabId).toBe(
      terminal.id,
    );
    expect(findDockLeaf(useWorkspaceStore.getState().layout.root, second)?.activeTabId).toBe(
      files.id,
    );
  });
});
