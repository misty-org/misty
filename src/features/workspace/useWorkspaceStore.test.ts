import { beforeEach, describe, expect, it } from "vitest";
import {
  canFitDockSplit,
  createDockLeaf,
  dockLeaves,
  dockTabs,
  findDockLeaf,
  insertDockSplit,
} from "./dockTree";
import {
  blankBrowserUrl,
  defaultBrowserHomeUrl,
  parseBrowserTabState,
  type WorkspaceTab,
} from "./model";
import { workspaceSurfaceFromRoute } from "./routeSurface";
import { useWorkspaceStore } from "./useWorkspaceStore";

const browserRequest = {
  surfaceId: "browser" as const,
  groupKey: "tool:browser" as const,
  title: "Browser",
  route: "/browser",
  instancePolicy: "multiple" as const,
};

describe("desktop dock store", () => {
  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("keeps one default tab in the final pane", () => {
    const tab = useWorkspaceStore.getState().openSurface(browserRequest);
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toHaveLength(2);
    expect(useWorkspaceStore.getState().closeTab(tab.id)).toBe(true);

    const remaining = dockTabs(useWorkspaceStore.getState().layout.root);
    expect(remaining).toMatchObject([{ surfaceId: "home", title: "Home" }]);
    expect(useWorkspaceStore.getState().closeTab(remaining[0].id)).toBe(true);
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toMatchObject([
      { surfaceId: "home", title: "Home" },
    ]);
  });

  it("keeps Space Home open when the final tab closes", () => {
    const store = useWorkspaceStore.getState();
    store.setScope("space:family");
    const homeRequest = workspaceSurfaceFromRoute("/spaces/family/home");
    if (!homeRequest) throw new Error("Expected a Home workspace surface");

    const firstHome = store.openSurface(homeRequest);
    expect(useWorkspaceStore.getState().closeTab(firstHome.id)).toBe(true);
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toMatchObject([
      { surfaceId: "space", title: "Home", route: "/spaces/family/home" },
    ]);
  });

  it("closes non-Home last tab in the last virtual window, remembers it, and keeps Home open", () => {
    const store = useWorkspaceStore.getState();
    const browser = store.openSurface(browserRequest);
    const initialHome = dockTabs(store.layout.root).find((t) => t.id !== browser.id)!;
    expect(store.closeTab(initialHome.id)).toBe(true);
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toMatchObject([
      { id: browser.id, title: "Browser" },
    ]);

    expect(store.closeTab(browser.id)).toBe(true);
    const remaining = dockTabs(useWorkspaceStore.getState().layout.root);
    expect(remaining).toMatchObject([{ surfaceId: "home", title: "Home" }]);
    expect(useWorkspaceStore.getState().closedTabs[0]?.tab.id).toBe(browser.id);
  });

  it("switches to another panel when closing the last tab of a panel in a multi-panel window", () => {
    const store = useWorkspaceStore.getState();
    const firstPane = dockLeaves(store.layout.root)[0];
    const secondPaneId = store.splitPane(firstPane.id, "right");
    if (!secondPaneId) throw new Error("Expected second pane");
    const rightTab = store.openSurface({
      ...browserRequest,
      paneId: secondPaneId,
      forceNew: true,
      title: "Right Browser",
    });
    const secondPane = findDockLeaf(useWorkspaceStore.getState().layout.root, secondPaneId)!;
    const extraInSecond = secondPane.tabs.filter((t) => t.id !== rightTab.id);
    for (const t of extraInSecond) {
      store.closeTab(t.id, secondPaneId);
    }

    const panesBefore = dockLeaves(useWorkspaceStore.getState().layout.root);
    expect(panesBefore).toHaveLength(2);

    expect(store.closeTab(rightTab.id, secondPaneId)).toBe(true);
    const panesAfter = dockLeaves(useWorkspaceStore.getState().layout.root);
    expect(panesAfter).toHaveLength(1);
    expect(panesAfter[0].id).toBe(firstPane.id);
    expect(useWorkspaceStore.getState().layout.focusedPaneId).toBe(firstPane.id);
  });

  it("switches to another window when closing the last tab of a multi-window workspace", () => {
    const store = useWorkspaceStore.getState();
    const firstWindowId = store.activeVirtualWindowId;
    store.createVirtualWindow("Second Window");
    const onlyTabInSecond = dockTabs(useWorkspaceStore.getState().layout.root)[0];

    expect(store.closeTab(onlyTabInSecond.id)).toBe(true);
    expect(useWorkspaceStore.getState().activeVirtualWindowId).toBe(firstWindowId);
    expect(useWorkspaceStore.getState().closedTabs[0]?.tab.id).toBe(onlyTabInSecond.id);
  });

  it("starts the global workspace on Home", () => {
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toMatchObject([
      { surfaceId: "home", title: "Home", route: "/home" },
    ]);
  });

  it("lets a tool be opened in an empty workspace", () => {
    useWorkspaceStore.getState().openSurface({
      surfaceId: "terminal",
      groupKey: "tool:terminal",
      title: "Terminal",
      route: "/terminal",
      instancePolicy: "single",
    });
    expect(dockTabs(useWorkspaceStore.getState().layout.root).map((tab) => tab.surfaceId)).toEqual([
      "home",
      "terminal",
    ]);
  });

  it("keeps Inbox singleton even when opened repeatedly", () => {
    const inbox = workspaceSurfaceFromRoute("/inbox");
    expect(inbox).not.toBeNull();
    useWorkspaceStore.getState().openSurface(inbox!);
    useWorkspaceStore.getState().openSurface(inbox!);

    expect(
      dockTabs(useWorkspaceStore.getState().layout.root).filter(
        (tab) => tab.groupKey === "app:inbox",
      ),
    ).toHaveLength(1);
  });

  it("adds repeated app launches to their existing group", () => {
    const files = workspaceSurfaceFromRoute("/files");
    if (!files) throw new Error("Expected a Files workspace surface");

    const first = useWorkspaceStore.getState().addSurface(files);
    const second = useWorkspaceStore.getState().addSurface(files);
    const fileTabs = dockTabs(useWorkspaceStore.getState().layout.root).filter(
      (tab) => tab.groupKey === "app:files",
    );

    expect(second.id).not.toBe(first.id);
    expect(fileTabs.map((tab) => tab.id)).toEqual([first.id, second.id]);
  });

  it("treats singleton policy as one instance per pane", () => {
    const inboxRequest = workspaceSurfaceFromRoute("/inbox");
    if (!inboxRequest) throw new Error("Expected an Inbox workspace surface");
    const first = useWorkspaceStore.getState().openSurface(inboxRequest);
    const firstPane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    const secondPaneId = useWorkspaceStore.getState().splitPane(firstPane.id, "right");
    if (!secondPaneId) throw new Error("Expected a second pane");

    const second = useWorkspaceStore.getState().openSurface(inboxRequest);

    expect(second.id).not.toBe(first.id);
    expect(
      dockTabs(useWorkspaceStore.getState().layout.root).filter(
        (tab) => tab.groupKey === "app:inbox",
      ),
    ).toHaveLength(2);
    expect(useWorkspaceStore.getState().openSurface(inboxRequest).id).toBe(second.id);
  });

  it("opens and reuses the same app independently in each pane", () => {
    const first = useWorkspaceStore.getState().openSurface(browserRequest);
    const firstPane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    const secondPaneId = useWorkspaceStore.getState().splitPane(firstPane.id, "right");
    if (!secondPaneId) throw new Error("Expected a second pane");

    const second = useWorkspaceStore.getState().openSurface(browserRequest);
    expect(second.id).not.toBe(first.id);
    expect(useWorkspaceStore.getState().openSurface(browserRequest).id).toBe(second.id);

    useWorkspaceStore.getState().focusPane(firstPane.id);
    expect(useWorkspaceStore.getState().openSurface(browserRequest).id).toBe(first.id);
  });

  it("keeps app instances isolated between virtual windows", () => {
    const first = useWorkspaceStore.getState().openSurface(browserRequest);
    const secondWindow = useWorkspaceStore.getState().createVirtualWindow("Window 2");

    const second = useWorkspaceStore.getState().openSurface(browserRequest);

    expect(second.id).not.toBe(first.id);
    expect(useWorkspaceStore.getState().activeVirtualWindowId).toBe(secondWindow.id);
  });

  it("can focus a new pane on its default tab", () => {
    const first = useWorkspaceStore.getState().openSurface(browserRequest);
    const firstPane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    const secondPaneId = useWorkspaceStore.getState().splitPane(firstPane.id, "right");
    if (!secondPaneId) throw new Error("Expected a second pane");
    useWorkspaceStore.getState().focusTab(first.id);

    expect(useWorkspaceStore.getState().focusPane(secondPaneId)).toBe(true);
    expect(useWorkspaceStore.getState().layout.focusedPaneId).toBe(secondPaneId);
  });

  it("does not publish a store update when the active tab is focused again", () => {
    const tab = useWorkspaceStore.getState().openSurface(browserRequest);
    const current = useWorkspaceStore.getState();

    expect(current.focusTab(tab.id)).toBe(true);
    expect(useWorkspaceStore.getState()).toBe(current);
  });

  it("gives each Space its own tabs and restores them on the way back", () => {
    const store = useWorkspaceStore.getState();
    store.setScope("space:family");
    store.openSurface({
      surfaceId: "terminal",
      groupKey: "tool:terminal",
      title: "Terminal",
      route: "/terminal",
      instancePolicy: "single",
    });

    useWorkspaceStore.getState().setScope("space:work");
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toMatchObject([
      { surfaceId: "space", title: "Home", route: "/spaces/work/home" },
    ]);

    useWorkspaceStore.getState().setScope("space:family");
    expect(
      dockTabs(useWorkspaceStore.getState().layout.root).map((tab) => tab.surfaceId),
    ).toContain("terminal");
  });

  it("adopts the default Space once, then leaves the user's choice alone", () => {
    const store = useWorkspaceStore.getState();
    store.openSurface({
      surfaceId: "terminal",
      groupKey: "tool:terminal",
      title: "Terminal",
      route: "/terminal",
      instancePolicy: "single",
    });

    // The bootstrap scope's tabs come along rather than being stranded.
    useWorkspaceStore.getState().adoptDefaultScope("space:misty");
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:misty");
    expect(
      dockTabs(useWorkspaceStore.getState().layout.root).map((tab) => tab.surfaceId),
    ).toContain("terminal");

    useWorkspaceStore.getState().setScope("space:family");
    useWorkspaceStore.getState().adoptDefaultScope("space:misty");
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:family");
  });

  it("restores a saved Transfers tab now that the destination is visible", () => {
    const legacyTab = {
      id: "tab:legacy",
      surfaceId: "transfers",
      groupKey: "tool:transfers",
      instanceKey: "transfers:one",
      title: "Transfers",
      route: "/transfers",
      sidebarVisible: true,
      state: {},
      createdAt: 1,
      lastFocusedAt: 1,
    } as unknown as WorkspaceTab;
    const leaf = createDockLeaf([legacyTab]);

    useWorkspaceStore.getState().replaceSnapshot({
      version: 2,
      accountId: "account",
      deviceId: "device",
      savedAt: 1,
      layout: { root: leaf, focusedPaneId: leaf.id },
      lastUsedTabByGroup: {},
    });

    const restored = dockTabs(useWorkspaceStore.getState().layout.root);
    expect(restored).toHaveLength(1);
    expect(restored[0].surfaceId).toBe("official-app");
    expect(restored[0].route).toBe("/apps/files?view=transfers");
    expect(restored[0].groupKey).toBe("app:files");
  });

  it("restores a legacy Space tab as its concrete tool tab", () => {
    const legacyTab: WorkspaceTab = {
      id: "tab:legacy-space",
      surfaceId: "space",
      groupKey: "space:one",
      instanceKey: "one",
      title: "One",
      route: "/spaces/one/chat",
      sidebarVisible: true,
      state: {},
      createdAt: 1,
      lastFocusedAt: 1,
    };
    const pane = createDockLeaf([legacyTab]);

    useWorkspaceStore.getState().replaceSnapshot({
      version: 2,
      accountId: "account-1",
      deviceId: "device-1",
      savedAt: 1,
      layout: { root: pane, focusedPaneId: pane.id },
      lastUsedTabByGroup: { "space:one": legacyTab.id },
    });

    expect(dockTabs(useWorkspaceStore.getState().layout.root)[0]).toMatchObject({
      id: legacyTab.id,
      groupKey: "app:chat",
      instanceKey: "chat",
      title: "Social",
    });
  });

  it("opens a browser tab on the default homepage when no URL is requested", () => {
    const tab = useWorkspaceStore.getState().openBrowserTab();
    expect(tab.surfaceId).toBe("official-app");
    expect(tab.groupKey).toBe("app:browser");
    expect(new URL(tab.route, "https://misty.local").pathname).toBe("/apps/browser");
    expect(parseBrowserTabState(tab.state).url).toBe(defaultBrowserHomeUrl);
    expect(tab.title).toBe("google.com");
  });

  it("keeps an explicitly requested URL, including a deliberately blank one", () => {
    const requested = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    expect(parseBrowserTabState(requested.state).url).toBe("https://example.com");
    const blank = useWorkspaceStore.getState().openBrowserTab({ url: blankBrowserUrl });
    expect(parseBrowserTabState(blank.state).url).toBe(blankBrowserUrl);
  });

  it("keeps agent ownership when an Agent browser navigates", () => {
    const tab = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    useWorkspaceStore.getState().updateBrowserTab(tab.id, { agentOwned: true });
    useWorkspaceStore.getState().updateBrowserTab(tab.id, { url: "https://example.org" });
    const updated = dockTabs(useWorkspaceStore.getState().layout.root).find(
      (candidate) => candidate.id === tab.id,
    );
    expect(parseBrowserTabState(updated?.state).agentOwned).toBe(true);
  });

  it("focuses the last-used group instance unless a duplicate is requested", () => {
    const first = useWorkspaceStore.getState().openSurface(browserRequest);
    const same = useWorkspaceStore.getState().openSurface(browserRequest);
    const duplicate = useWorkspaceStore
      .getState()
      .openSurface({ ...browserRequest, forceNew: true });
    expect(same.id).toBe(first.id);
    expect(duplicate.id).not.toBe(first.id);
    expect(useWorkspaceStore.getState().lastUsedTabByGroup["tool:browser"]).toBe(duplicate.id);
  });

  it("can keep an embedded dock widget on its owning tool route", () => {
    const terminal = useWorkspaceStore.getState().openSurface({
      surfaceId: "terminal",
      groupKey: "tool:terminal",
      title: "Terminal",
      route: "/terminal",
      instancePolicy: "multiple",
    });

    useWorkspaceStore.getState().updateTabRoute(terminal.id, "/code");

    expect(
      dockTabs(useWorkspaceStore.getState().layout.root).find((tab) => tab.id === terminal.id),
    ).toMatchObject({ route: "/code" });
  });

  it("keeps a separate recursive layout for every Space", () => {
    const first = useWorkspaceStore.getState().openSurface({
      surfaceId: "space",
      groupKey: "space:one",
      instanceKey: "one",
      title: "One",
      route: "/spaces/one",
      instancePolicy: "multiple",
    });
    useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:one");
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)[0].tabs).toHaveLength(2);

    useWorkspaceStore.getState().openSurface({
      surfaceId: "space",
      groupKey: "space:two",
      instanceKey: "two",
      title: "Two",
      route: "/spaces/two",
      instancePolicy: "multiple",
    });
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:two");
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)[0].tabs).toHaveLength(1);

    useWorkspaceStore.getState().setScope("space:one");
    expect(
      dockLeaves(useWorkspaceStore.getState().layout.root)[0].tabs.some(
        (tab) => tab.id === first.id,
      ),
    ).toBe(true);
  });

  it("opens Journal and Planner as separate reusable tabs in one Space", () => {
    const journalRequest = workspaceSurfaceFromRoute("/spaces/one/notes");
    const plannerRequest = workspaceSurfaceFromRoute("/spaces/one/planner/tasks/board");
    expect(journalRequest).not.toBeNull();
    expect(plannerRequest).not.toBeNull();

    const journal = useWorkspaceStore.getState().openSurface(journalRequest!);
    const planner = useWorkspaceStore.getState().openSurface(plannerRequest!);

    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:one");
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: journal.id, groupKey: "app:journal", title: "Journal" }),
        expect.objectContaining({ id: planner.id, groupKey: "app:planner", title: "Planner" }),
      ]),
    );
    const rememberedJournal = useWorkspaceStore
      .getState()
      .openSurface(workspaceSurfaceFromRoute("/spaces/one/drawings/drawing-2?view=list")!);
    expect(rememberedJournal.id).toBe(journal.id);
    expect(rememberedJournal.route).toBe("/apps/journal?space=one&view=drawings&drawing=drawing-2");

    useWorkspaceStore.getState().focusTab(planner.id);
    useWorkspaceStore.getState().focusTab(journal.id);
    expect(
      dockTabs(useWorkspaceStore.getState().layout.root).find((tab) => tab.id === journal.id)
        ?.route,
    ).toBe("/apps/journal?space=one&view=drawings&drawing=drawing-2");
  });

  it("does not reuse a Space tool tab as the Space Home tab", () => {
    const journalRequest = workspaceSurfaceFromRoute("/spaces/one/notes");
    const homeRequest = workspaceSurfaceFromRoute("/spaces/one/home");
    if (!journalRequest || !homeRequest) throw new Error("Expected Space workspace surfaces");
    const journal = useWorkspaceStore.getState().openSurface(journalRequest);

    const home = useWorkspaceStore.getState().openSurface(homeRequest);
    const tabs = dockTabs(useWorkspaceStore.getState().layout.root);

    expect(home.id).not.toBe(journal.id);
    expect(tabs.find((tab) => tab.id === journal.id)).toMatchObject({
      groupKey: "app:journal",
      route: "/apps/journal?space=one&view=notes",
    });
    expect(tabs.find((tab) => tab.id === home.id)).toMatchObject({
      groupKey: "space:one",
      route: "/spaces/one/home",
    });
  });

  it("builds arbitrary nested splits and persists their ratios", () => {
    useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    const firstPane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    const secondId = useWorkspaceStore.getState().splitPane(firstPane.id, "right");
    expect(secondId).toBeTruthy();
    const thirdId = useWorkspaceStore.getState().splitPane(secondId!, "down");
    expect(thirdId).toBeTruthy();
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(3);
    const root = useWorkspaceStore.getState().layout.root;
    expect(root.type).toBe("split");
    if (root.type === "split") {
      useWorkspaceStore.getState().updateSplitRatio(root.id, 0.72);
      const updated = useWorkspaceStore.getState().layout.root;
      expect(updated.type === "split" ? updated.ratio : 0).toBeCloseTo(0.72);
    }
  });

  it("opens the default tab when splitting a tool", () => {
    const browser = useWorkspaceStore.getState().openBrowserTab({
      url: "https://example.com/watch",
    });
    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];

    const splitId = useWorkspaceStore.getState().splitPane(pane.id, "right");
    const leaves = dockLeaves(useWorkspaceStore.getState().layout.root);

    expect(splitId).toBeTruthy();
    expect(leaves).toHaveLength(2);
    expect(leaves[0].tabs.map((tab) => tab.surfaceId)).toEqual(["home", browser.surfaceId]);
    expect(leaves[1].tabs).toMatchObject([{ surfaceId: "home", title: "Home" }]);
  });

  it("opens a tool tab into an empty split panel", () => {
    const first = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    const newPaneId = useWorkspaceStore.getState().splitPane(pane.id, "right")!;

    const second = useWorkspaceStore.getState().openBrowserTab({
      url: "https://example.org",
      paneId: newPaneId,
    });

    const newPane = findDockLeaf(useWorkspaceStore.getState().layout.root, newPaneId);
    expect(newPane?.tabs.map((tab) => tab.id)).toContain(second.id);
    expect(newPane?.tabs.map((tab) => tab.surfaceId)).toContain("home");
    expect(dockTabs(useWorkspaceStore.getState().layout.root).map((tab) => tab.id)).toContain(
      first.id,
    );
  });

  it("opens Browser popups beside their source even when another pane is focused", () => {
    const store = useWorkspaceStore.getState();
    const source = store.openBrowserTab({ url: "https://source.example" });
    const sourcePaneId = dockLeaves(useWorkspaceStore.getState().layout.root)[0].id;
    const otherPaneId = store.splitPane(sourcePaneId, "right")!;
    store.openSurface({
      ...browserRequest,
      paneId: otherPaneId,
      forceNew: true,
      title: "Other",
    });

    const popup = store.openBrowserTab({
      url: "https://popup.example",
      sourceTabId: source.id,
    });
    const leaves = dockLeaves(useWorkspaceStore.getState().layout.root);
    expect(
      leaves
        .find((pane) => pane.id === sourcePaneId)
        ?.tabs.filter(
          (tab) =>
            tab.surfaceId === "browser" ||
            (tab.surfaceId === "official-app" && tab.groupKey === "app:browser"),
        )
        .map((tab) => tab.id),
    ).toEqual([source.id, popup.id]);
    expect(
      leaves.find((pane) => pane.id === otherPaneId)?.tabs.filter((tab) => tab.id !== source.id),
    ).toHaveLength(2);
  });

  it("closes a tab in its source pane without changing the other pane", () => {
    const store = useWorkspaceStore.getState();
    const leftTab = store.openBrowserTab({ url: "https://left.example" });
    const leftPaneId = dockLeaves(useWorkspaceStore.getState().layout.root)[0].id;
    const rightPaneId = store.splitPane(leftPaneId, "right")!;
    const rightTab = store.openBrowserTab({
      url: "https://right.example",
      paneId: rightPaneId,
    });
    store.focusPane(rightPaneId);

    expect(store.closeTab(leftTab.id, leftPaneId)).toBe(true);

    const current = useWorkspaceStore.getState();
    expect(findDockLeaf(current.layout.root, rightPaneId)?.tabs.map((tab) => tab.id)).toContain(
      rightTab.id,
    );
    expect(findDockLeaf(current.layout.root, leftPaneId)?.tabs.map((tab) => tab.id)).not.toContain(
      leftTab.id,
    );
    expect(current.layout.focusedPaneId).toBe(leftPaneId);
  });

  it("repairs legacy empty split leaves with the default tab", () => {
    const browser = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    const empty = createDockLeaf();
    useWorkspaceStore.setState((state) => ({
      layout: {
        ...state.layout,
        root: insertDockSplit(state.layout.root, pane.id, empty, "right"),
      },
    }));

    useWorkspaceStore.getState().fillEmptyPanes();

    const leaves = dockLeaves(useWorkspaceStore.getState().layout.root);
    expect(leaves).toHaveLength(2);
    expect(leaves.flatMap((leaf) => leaf.tabs).map((tab) => tab.id)).toContain(browser.id);
    expect(leaves.every((leaf) => leaf.tabs.length > 0)).toBe(true);
    expect(leaves.flatMap((leaf) => leaf.tabs).map((tab) => tab.surfaceId)).toContain("home");
  });

  it("rejects split geometry that would violate either widget minimum", () => {
    const files = { width: 360, height: 240 };
    const code = { width: 480, height: 280 };
    expect(canFitDockSplit({ width: 840, height: 280 }, "right", files, code)).toBe(true);
    expect(canFitDockSplit({ width: 839, height: 280 }, "right", files, code)).toBe(false);
    expect(canFitDockSplit({ width: 480, height: 520 }, "down", files, code)).toBe(true);
    expect(canFitDockSplit({ width: 480, height: 519 }, "down", files, code)).toBe(false);
  });

  it("moves a tab into an edge split and collapses its empty source", () => {
    const first = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    const second = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.org" });
    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    expect(useWorkspaceStore.getState().dockTab(second.id, pane.id, "right")).toBe(true);
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(2);
    useWorkspaceStore.getState().closeTab(second.id);
    const remaining = dockLeaves(useWorkspaceStore.getState().layout.root);
    expect(remaining).toHaveLength(1);
    expect(
      remaining[0].tabs
        .filter(
          (tab) =>
            tab.surfaceId === "browser" ||
            (tab.surfaceId === "official-app" && tab.groupKey === "app:browser"),
        )
        .map((tab) => tab.id),
    ).toEqual([first.id]);
  });

  it("returns to the previously visited tab when the active tab closes", () => {
    const first = useWorkspaceStore.getState().openBrowserTab({ url: "https://one.example" });
    const closing = useWorkspaceStore.getState().openBrowserTab({ url: "https://two.example" });
    const lastInList = useWorkspaceStore.getState().openBrowserTab({
      url: "https://three.example",
    });

    useWorkspaceStore.getState().focusTab(first.id);
    useWorkspaceStore.getState().focusTab(closing.id);
    useWorkspaceStore.getState().closeTab(closing.id);

    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    expect(pane.activeTabId).toBe(first.id);
    expect(pane.activeTabId).not.toBe(lastInList.id);
  });

  it("does not change the active tab when an inactive tab closes", () => {
    const inactive = useWorkspaceStore.getState().openBrowserTab({
      url: "https://inactive.example",
    });
    const active = useWorkspaceStore.getState().openBrowserTab({ url: "https://active.example" });

    useWorkspaceStore.getState().closeTab(inactive.id);

    expect(dockLeaves(useWorkspaceStore.getState().layout.root)[0].activeTabId).toBe(active.id);
  });

  it("moves tabs between panel tab strips using a center drop", () => {
    const first = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    const second = useWorkspaceStore.getState().openBrowserTab({
      url: "https://example.org",
    });
    const third = useWorkspaceStore.getState().openBrowserTab({
      url: "https://example.net",
    });
    const source = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    useWorkspaceStore.getState().dockTab(second.id, source.id, "right");
    const destination = dockLeaves(useWorkspaceStore.getState().layout.root).find((pane) =>
      pane.tabs.some((tab) => tab.id === second.id),
    )!;
    useWorkspaceStore.getState().moveTab(first.id, destination.id);
    const leaves = dockLeaves(useWorkspaceStore.getState().layout.root);
    expect(leaves).toHaveLength(2);
    expect(
      leaves
        .find((pane) => pane.id === source.id)
        ?.tabs.filter(
          (tab) =>
            tab.surfaceId === "browser" ||
            (tab.surfaceId === "official-app" && tab.groupKey === "app:browser"),
        )
        .map((tab) => tab.id),
    ).toEqual([third.id]);
    expect(leaves.find((pane) => pane.id === destination.id)?.tabs.map((tab) => tab.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it("moves a closed pane's tabs into its adjacent pane instead of the first pane", () => {
    const store = useWorkspaceStore.getState();
    const first = store.openBrowserTab({ url: "https://left.example" });
    const leftPaneId = dockLeaves(useWorkspaceStore.getState().layout.root)[0].id;
    const rightPaneId = store.splitPane(leftPaneId, "right");
    if (!rightPaneId) throw new Error("Expected right pane");
    const right = store.openSurface({
      ...browserRequest,
      paneId: rightPaneId,
      forceNew: true,
      title: "Right",
    });
    const middlePaneId = store.splitPane(leftPaneId, "right");
    if (!middlePaneId) throw new Error("Expected middle pane");
    const middle = store.openSurface({
      ...browserRequest,
      paneId: middlePaneId,
      forceNew: true,
      title: "Middle",
    });

    store.closePane(middlePaneId);
    const panes = dockLeaves(useWorkspaceStore.getState().layout.root);
    expect(panes).toHaveLength(2);
    expect(
      panes
        .find((pane) => pane.id === leftPaneId)
        ?.tabs.filter(
          (tab) =>
            tab.surfaceId === "browser" ||
            (tab.surfaceId === "official-app" && tab.groupKey === "app:browser"),
        )
        .map((tab) => tab.id),
    ).toEqual([first.id]);
    expect(
      panes
        .find((pane) => pane.id === rightPaneId)
        ?.tabs.filter(
          (tab) =>
            tab.surfaceId === "browser" ||
            (tab.surfaceId === "official-app" && tab.groupKey === "app:browser"),
        )
        .map((tab) => tab.id),
    ).toEqual([right.id, middle.id]);
    expect(useWorkspaceStore.getState().layout.focusedPaneId).toBe(rightPaneId);
  });

  it("preserves sidebar visibility in versioned snapshots", () => {
    const tab = useWorkspaceStore.getState().openSurface(browserRequest);
    useWorkspaceStore.getState().toggleSidebar(tab.id);
    const snapshot = useWorkspaceStore.getState().createSnapshot("account-1", "device-1");
    expect(snapshot.version).toBe(3);
    expect(
      findDockLeaf(snapshot.layout.root, snapshot.layout.focusedPaneId)?.tabs.find(
        (candidate) => candidate.id === tab.id,
      )?.sidebarVisible,
    ).toBe(false);
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.getState().replaceSnapshot(snapshot);
    expect(
      dockLeaves(useWorkspaceStore.getState().layout.root)[0].tabs.find(
        (candidate) => candidate.id === tab.id,
      )?.sidebarVisible,
    ).toBe(false);
  });

  it("opens browser pages adjacently and updates their metadata", () => {
    const first = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    const second = useWorkspaceStore.getState().openBrowserTab({
      url: "https://example.org",
      sourceTabId: first.id,
    });
    const tabs = dockLeaves(useWorkspaceStore.getState().layout.root)[0].tabs;
    expect(
      tabs
        .filter(
          (tab) =>
            tab.surfaceId === "browser" ||
            (tab.surfaceId === "official-app" && tab.groupKey === "app:browser"),
        )
        .map((tab) => tab.id),
    ).toEqual([first.id, second.id]);
    useWorkspaceStore
      .getState()
      .updateBrowserTab(second.id, { url: "https://misty.com", title: "Misty" });
    const updated = dockLeaves(useWorkspaceStore.getState().layout.root)[0].tabs.find(
      (tab) => tab.id === second.id,
    )!;
    expect(updated.title).toBe("Misty");
    expect(parseBrowserTabState(updated.state).faviconUrl).toBe("https://misty.com/favicon.ico");

    // Placeholder titles like "Loading..." should be ignored in favor of URL/hostname
    useWorkspaceStore.getState().updateBrowserTab(second.id, { title: "Loading..." });
    const afterLoading = dockLeaves(useWorkspaceStore.getState().layout.root)[0].tabs.find(
      (tab) => tab.id === second.id,
    )!;
    expect(afterLoading.title).toBe("misty.com");

    useWorkspaceStore.getState().updateBrowserTab(second.id, { title: "Loading" });
    const afterLoadingPlain = dockLeaves(useWorkspaceStore.getState().layout.root)[0].tabs.find(
      (tab) => tab.id === second.id,
    )!;
    expect(afterLoadingPlain.title).toBe("misty.com");
  });
});
