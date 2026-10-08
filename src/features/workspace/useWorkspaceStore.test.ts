import { allLayoutViews } from "./layoutTabs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  canFitDockSplit,
  createDockLeaf,
  dockLeaves,
  dockTreeViews,
  findDockLeaf,
  insertDockSplit,
} from "./dockTree";
import {
  blankBrowserUrl,
  defaultBrowserHomeUrl,
  parseBrowserViewState,
  type WorkspaceView,
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

  it("keeps the final pane empty until a new tab is requested", () => {
    const store = useWorkspaceStore.getState();
    const view = store.openSurface(browserRequest);
    expect(store.closeView(view.id)).toBe(true);
    const empty = useWorkspaceStore.getState().layout;
    expect(allLayoutViews(empty)).toEqual([]);
    expect(findDockLeaf(empty.root, empty.focusedPaneId)?.activeViewId).toBeNull();
    const next = store.newTab();
    expect(allLayoutViews(useWorkspaceStore.getState().layout)).toMatchObject([
      { id: next.id, surfaceId: "browser", title: "google.com", placeholder: true },
    ]);
  });

  it("keeps a closed Space page recoverable without opening another page", () => {
    const store = useWorkspaceStore.getState();
    const page = store.openSurface(workspaceSurfaceFromRoute("/spaces/family/notes")!);
    expect(store.closeView(page.id)).toBe(true);
    expect(allLayoutViews(useWorkspaceStore.getState().layout)).toEqual([]);
    expect(useWorkspaceStore.getState().closedItems[0].view).toMatchObject({
      id: page.id,
      route: "/spaces/family/notes",
      surfaceId: "space",
    });
  });

  it("closes the last tab in the last virtual window, remembers it, and leaves no tabs", () => {
    const store = useWorkspaceStore.getState();
    const browser = store.addSurface(browserRequest);
    const initialHome = dockTreeViews(store.layout.root).find((t) => t.id !== browser.id)!;
    expect(store.closeView(initialHome.id)).toBe(true);
    expect(dockTreeViews(useWorkspaceStore.getState().layout.root)).toMatchObject([
      { id: browser.id, title: "Browser" },
    ]);

    expect(store.closeView(browser.id)).toBe(true);
    expect(allLayoutViews(useWorkspaceStore.getState().layout)).toEqual([]);
    expect(useWorkspaceStore.getState().closedItems[0]?.view.id).toBe(browser.id);
    // Opening something again replaces the empty workspace with a single tab.
    const reopened = useWorkspaceStore.getState().openSurface(browserRequest);
    expect(allLayoutViews(useWorkspaceStore.getState().layout).map((tab) => tab.id)).toEqual([
      reopened.id,
    ]);
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
    const extraInSecond = secondPane.views.filter((t) => t.id !== rightTab.id);
    for (const t of extraInSecond) {
      store.closeView(t.id, secondPaneId);
    }

    const panesBefore = dockLeaves(useWorkspaceStore.getState().layout.root);
    expect(panesBefore).toHaveLength(2);

    expect(store.closeView(rightTab.id, secondPaneId)).toBe(true);
    const panesAfter = dockLeaves(useWorkspaceStore.getState().layout.root);
    expect(panesAfter).toHaveLength(1);
    expect(panesAfter[0].id).toBe(firstPane.id);
    expect(useWorkspaceStore.getState().layout.focusedPaneId).toBe(firstPane.id);
  });

  it("switches to another window when closing the last tab of a multi-window workspace", () => {
    const store = useWorkspaceStore.getState();
    const firstWindowId = store.activeWindowId;
    store.createWindow("Second Window");
    const onlyTabInSecond = dockTreeViews(useWorkspaceStore.getState().layout.root)[0];

    expect(store.closeView(onlyTabInSecond.id)).toBe(true);
    expect(useWorkspaceStore.getState().activeWindowId).toBe(firstWindowId);
    expect(useWorkspaceStore.getState().closedItems[0]?.view.id).toBe(onlyTabInSecond.id);
  });

  it("starts the global workspace in Browser", () => {
    expect(dockTreeViews(useWorkspaceStore.getState().layout.root)).toMatchObject([
      { surfaceId: "browser", title: "google.com", route: "/browser", placeholder: true },
    ]);
  });

  it("lets a tool be opened in an empty workspace", () => {
    useWorkspaceStore.getState().openSurface({
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Agents",
      route: "/agents",
      instancePolicy: "single",
    });
    expect(allLayoutViews(useWorkspaceStore.getState().layout).map((tab) => tab.surfaceId)).toEqual(
      ["agents"],
    );
  });

  it("keeps Agents singleton even when opened repeatedly", () => {
    const inbox = workspaceSurfaceFromRoute("/agents");
    expect(inbox).not.toBeNull();
    useWorkspaceStore.getState().openSurface(inbox!);
    useWorkspaceStore.getState().openSurface(inbox!);

    expect(
      dockTreeViews(useWorkspaceStore.getState().layout.root).filter(
        (tab) => tab.groupKey === "tool:agents",
      ),
    ).toHaveLength(1);
  });

  it("adds repeated app launches as separate window tabs", () => {
    const files = workspaceSurfaceFromRoute("/agents");
    if (!files) throw new Error("Expected an Agents workspace surface");

    const first = useWorkspaceStore.getState().addSurface(files);
    const second = useWorkspaceStore.getState().addSurface(files);
    const fileTabs = allLayoutViews(useWorkspaceStore.getState().layout).filter(
      (tab) => tab.groupKey === "tool:agents",
    );

    expect(second.id).not.toBe(first.id);
    expect(fileTabs.map((tab) => tab.id)).toEqual([first.id, second.id]);
  });

  it("treats singleton policy as one instance per pane", () => {
    const inboxRequest = workspaceSurfaceFromRoute("/agents");
    if (!inboxRequest) throw new Error("Expected an Agents workspace surface");
    const first = useWorkspaceStore.getState().openSurface(inboxRequest);
    const firstPane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    const secondPaneId = useWorkspaceStore.getState().splitPane(firstPane.id, "right");
    if (!secondPaneId) throw new Error("Expected a second pane");

    const second = useWorkspaceStore.getState().openSurface(inboxRequest);

    expect(second.id).not.toBe(first.id);
    expect(
      dockTreeViews(useWorkspaceStore.getState().layout.root).filter(
        (tab) => tab.groupKey === "tool:agents",
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
    const secondWindow = useWorkspaceStore.getState().createWindow("Window 2");

    const second = useWorkspaceStore.getState().openSurface(browserRequest);

    expect(second.id).not.toBe(first.id);
    expect(useWorkspaceStore.getState().activeWindowId).toBe(secondWindow.id);
  });

  it("can focus a new pane on its default tab", () => {
    const first = useWorkspaceStore.getState().openSurface(browserRequest);
    const firstPane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    const secondPaneId = useWorkspaceStore.getState().splitPane(firstPane.id, "right");
    if (!secondPaneId) throw new Error("Expected a second pane");
    useWorkspaceStore.getState().focusView(first.id);

    expect(useWorkspaceStore.getState().focusPane(secondPaneId)).toBe(true);
    expect(useWorkspaceStore.getState().layout.focusedPaneId).toBe(secondPaneId);
  });

  it("does not publish a store update when the active tab is focused again", () => {
    const tab = useWorkspaceStore.getState().openSurface(browserRequest);
    const current = useWorkspaceStore.getState();

    expect(current.focusView(tab.id)).toBe(true);
    expect(useWorkspaceStore.getState()).toBe(current);
  });

  it("gives each Space its own tabs and restores them on the way back", () => {
    const store = useWorkspaceStore.getState();
    store.setScope("space:family");
    store.openSurface({
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Agents",
      route: "/agents",
      instancePolicy: "single",
    });

    useWorkspaceStore.getState().setScope("space:work");
    expect(dockTreeViews(useWorkspaceStore.getState().layout.root)).toMatchObject([
      { surfaceId: "browser", title: "google.com", route: "/browser", placeholder: true },
    ]);

    useWorkspaceStore.getState().setScope("space:family");
    expect(
      dockTreeViews(useWorkspaceStore.getState().layout.root).map((tab) => tab.surfaceId),
    ).toContain("agents");
  });

  it("adopts the default Space once, then leaves the user's choice alone", () => {
    const store = useWorkspaceStore.getState();
    store.openSurface({
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Agents",
      route: "/agents",
      instancePolicy: "single",
    });

    // The bootstrap scope's tabs come along rather than being stranded.
    useWorkspaceStore.getState().adoptDefaultScope("space:misty");
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:misty");
    expect(
      dockTreeViews(useWorkspaceStore.getState().layout.root).map((tab) => tab.surfaceId),
    ).toContain("agents");

    useWorkspaceStore.getState().setScope("space:family");
    useWorkspaceStore.getState().adoptDefaultScope("space:misty");
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:family");
  });

  it("migrates a saved Transfers tab to a browser tab", () => {
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
    } as unknown as WorkspaceView;
    const leaf = createDockLeaf([legacyTab]);

    useWorkspaceStore.getState().replaceSnapshot({
      version: 2,
      accountId: "account",
      deviceId: "device",
      savedAt: 1,
      layout: { root: leaf, focusedPaneId: leaf.id },
      lastUsedViewByGroup: {},
    });

    const restored = dockTreeViews(useWorkspaceStore.getState().layout.root);
    expect(restored).toHaveLength(1);
    // Transfers moved to Kura; the saved tab reopens as a browser tab.
    expect(restored[0].surfaceId).toBe("browser");
    expect(restored[0].route).toBe("/browser");
  });

  it("preserves a legacy Space page and its identity", () => {
    const legacyTab: WorkspaceView = {
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
      lastUsedViewByGroup: { "space:one": legacyTab.id },
    });

    expect(dockTreeViews(useWorkspaceStore.getState().layout.root)[0]).toMatchObject({
      id: legacyTab.id,
      groupKey: "space:one",
      instanceKey: "one",
      title: "One",
      route: "/spaces/one/chat",
    });
  });

  it("opens a browser tab on the default homepage when no URL is requested", () => {
    const tab = useWorkspaceStore.getState().openBrowserView();
    expect(tab.surfaceId).toBe("browser");
    expect(tab.groupKey).toBe("tool:browser");
    expect(new URL(tab.route, "https://misty.local").pathname).toBe("/browser");
    expect(parseBrowserViewState(tab.state).url).toBe(defaultBrowserHomeUrl);
    expect(tab.title).toBe("google.com");
  });

  it("keeps an explicitly requested URL, including a deliberately blank one", () => {
    const requested = useWorkspaceStore.getState().openBrowserView({ url: "https://example.com" });
    expect(parseBrowserViewState(requested.state).url).toBe("https://example.com");
    const blank = useWorkspaceStore.getState().openBrowserView({ url: blankBrowserUrl });
    expect(parseBrowserViewState(blank.state).url).toBe(blankBrowserUrl);
  });

  it("keeps agent ownership when an Agent browser navigates", () => {
    const tab = useWorkspaceStore.getState().openBrowserView({ url: "https://example.com" });
    useWorkspaceStore.getState().updateBrowserView(tab.id, { agentOwned: true });
    useWorkspaceStore.getState().updateBrowserView(tab.id, { url: "https://example.org" });
    const updated = dockTreeViews(useWorkspaceStore.getState().layout.root).find(
      (candidate) => candidate.id === tab.id,
    );
    expect(parseBrowserViewState(updated?.state).agentOwned).toBe(true);
  });

  it("focuses the last-used group instance unless a duplicate is requested", () => {
    const first = useWorkspaceStore.getState().openSurface(browserRequest);
    const same = useWorkspaceStore.getState().openSurface(browserRequest);
    const duplicate = useWorkspaceStore
      .getState()
      .openSurface({ ...browserRequest, forceNew: true });
    expect(same.id).toBe(first.id);
    expect(duplicate.id).not.toBe(first.id);
    expect(useWorkspaceStore.getState().lastUsedViewByGroup["tool:browser"]).toBe(duplicate.id);
  });

  it("can keep an embedded dock widget on its owning tool route", () => {
    const terminal = useWorkspaceStore.getState().openSurface({
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Agents",
      route: "/agents",
      instancePolicy: "multiple",
    });

    useWorkspaceStore.getState().updateViewRoute(terminal.id, "/code");

    expect(
      dockTreeViews(useWorkspaceStore.getState().layout.root).find((tab) => tab.id === terminal.id),
    ).toMatchObject({ route: "/code" });
  });

  it("keeps Space pages and browser pages together in the global workspace", () => {
    const store = useWorkspaceStore.getState();
    const first = store.openSurface(workspaceSurfaceFromRoute("/spaces/one/notes")!);
    const browser = store.openBrowserView({ url: "https://example.com" });
    const second = store.openSurface(workspaceSurfaceFromRoute("/spaces/two/notes")!);
    expect(useWorkspaceStore.getState().activeScopeKey).toBe("global");
    expect(allLayoutViews(useWorkspaceStore.getState().layout).map((view) => view.id)).toEqual([
      first.id,
      browser.id,
      second.id,
    ]);
    expect(store.openSurface(workspaceSurfaceFromRoute("/spaces/one/notes")!).id).toBe(first.id);
  });

  it("opens Journal and Planner as separate reusable tabs in one Space", () => {
    const journalRequest = workspaceSurfaceFromRoute("/spaces/one/notes");
    const plannerRequest = workspaceSurfaceFromRoute("/spaces/one/planner/tasks/board");
    expect(journalRequest).not.toBeNull();
    expect(plannerRequest).not.toBeNull();

    const journal = useWorkspaceStore.getState().addSurface(journalRequest!);
    const planner = useWorkspaceStore.getState().addSurface(plannerRequest!);

    expect(useWorkspaceStore.getState().activeScopeKey).toBe("global");
    expect(allLayoutViews(useWorkspaceStore.getState().layout)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: journal.id,
          groupKey: "space:one:journal",
          title: "Journal",
        }),
        expect.objectContaining({
          id: planner.id,
          groupKey: "space:one:planner",
          title: "Planner",
        }),
      ]),
    );
    useWorkspaceStore.getState().focusView(journal.id);
    const rememberedJournal = useWorkspaceStore
      .getState()
      .openSurface(workspaceSurfaceFromRoute("/spaces/one/drawings/drawing-2?view=list")!);
    expect(rememberedJournal.id).toBe(journal.id);
    expect(rememberedJournal.route).toBe("/spaces/one/drawings/drawing-2?view=list");

    useWorkspaceStore.getState().focusView(planner.id);
    useWorkspaceStore.getState().focusView(journal.id);
    expect(
      allLayoutViews(useWorkspaceStore.getState().layout).find((tab) => tab.id === journal.id)
        ?.route,
    ).toBe("/spaces/one/drawings/drawing-2?view=list");
  });

  it("does not reuse a Space tool tab as the Space Home tab", () => {
    const journalRequest = workspaceSurfaceFromRoute("/spaces/one/notes");
    const homeRequest = workspaceSurfaceFromRoute("/spaces/one/home");
    if (!journalRequest || !homeRequest) throw new Error("Expected Space workspace surfaces");
    const journal = useWorkspaceStore.getState().openSurface(journalRequest);

    const home = useWorkspaceStore.getState().addSurface(homeRequest);
    const tabs = allLayoutViews(useWorkspaceStore.getState().layout);

    expect(home.id).not.toBe(journal.id);
    expect(tabs.find((tab) => tab.id === journal.id)).toMatchObject({
      groupKey: "space:one:journal",
      route: "/spaces/one/notes",
    });
    expect(tabs.find((tab) => tab.id === home.id)).toMatchObject({
      groupKey: "space:one:space",
      route: "/spaces/one/home",
    });
  });

  it("builds arbitrary nested splits and persists their ratios", () => {
    useWorkspaceStore.getState().openBrowserView({ url: "https://example.com" });
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

  it("creates a blank pane when splitting a tool", () => {
    const browser = useWorkspaceStore.getState().openBrowserView({
      url: "https://example.com/watch",
    });
    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];

    const splitId = useWorkspaceStore.getState().splitPane(pane.id, "right");
    const leaves = dockLeaves(useWorkspaceStore.getState().layout.root);

    expect(splitId).toBeTruthy();
    expect(leaves).toHaveLength(2);
    expect(leaves[0].views.map((tab) => tab.surfaceId)).toEqual([browser.surfaceId]);
    expect(leaves[1].views).toMatchObject([{ placeholder: true, title: "google.com" }]);
  });

  it("opens a tool tab into an empty split panel", () => {
    const first = useWorkspaceStore.getState().openBrowserView({ url: "https://example.com" });
    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    const newPaneId = useWorkspaceStore.getState().splitPane(pane.id, "right")!;

    const second = useWorkspaceStore.getState().openBrowserView({
      url: "https://example.org",
      paneId: newPaneId,
    });

    const newPane = findDockLeaf(useWorkspaceStore.getState().layout.root, newPaneId);
    expect(newPane?.views.map((tab) => tab.id)).toContain(second.id);
    expect(newPane?.views).toHaveLength(1);
    expect(dockTreeViews(useWorkspaceStore.getState().layout.root).map((tab) => tab.id)).toContain(
      first.id,
    );
  });

  it("closes a tab in its source pane without changing the other pane", () => {
    const store = useWorkspaceStore.getState();
    const leftTab = store.openBrowserView({ url: "https://left.example" });
    const leftPaneId = dockLeaves(useWorkspaceStore.getState().layout.root)[0].id;
    const rightPaneId = store.splitPane(leftPaneId, "right")!;
    const rightTab = store.openBrowserView({
      url: "https://right.example",
      paneId: rightPaneId,
    });
    store.focusPane(rightPaneId);

    expect(store.closeView(leftTab.id, leftPaneId)).toBe(true);

    const current = useWorkspaceStore.getState();
    expect(findDockLeaf(current.layout.root, rightPaneId)?.views.map((tab) => tab.id)).toContain(
      rightTab.id,
    );
    expect(findDockLeaf(current.layout.root, leftPaneId)).toBeNull();
    expect(current.layout.focusedPaneId).toBe(rightPaneId);
  });

  it("repairs legacy empty split leaves with the default tab", () => {
    const browser = useWorkspaceStore.getState().openBrowserView({ url: "https://example.com" });
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
    expect(leaves.flatMap((leaf) => leaf.views).map((tab) => tab.id)).toContain(browser.id);
    expect(leaves.every((leaf) => leaf.views.length > 0)).toBe(true);
    expect(findDockLeaf(useWorkspaceStore.getState().layout.root, empty.id)?.views).toMatchObject([
      { surfaceId: "browser", route: "/browser", placeholder: true },
    ]);
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
    const first = useWorkspaceStore.getState().openBrowserView({ url: "https://example.com" });
    const second = useWorkspaceStore.getState().openBrowserView({ url: "https://example.org" });
    useWorkspaceStore.getState().focusView(first.id);
    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    expect(useWorkspaceStore.getState().dockView(second.id, pane.id, "right")).toBe(true);
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(2);
    useWorkspaceStore.getState().closeView(second.id);
    const remaining = dockLeaves(useWorkspaceStore.getState().layout.root);
    expect(remaining).toHaveLength(1);
    expect(
      remaining[0].views.filter((tab) => tab.surfaceId === "browser").map((tab) => tab.id),
    ).toEqual([first.id]);
  });

  it("returns to the previously visited tab when the active tab closes", () => {
    const first = useWorkspaceStore.getState().openBrowserView({ url: "https://one.example" });
    const closing = useWorkspaceStore.getState().openBrowserView({ url: "https://two.example" });
    const lastInList = useWorkspaceStore.getState().openBrowserView({
      url: "https://three.example",
    });

    useWorkspaceStore.getState().focusView(first.id);
    useWorkspaceStore.getState().focusView(closing.id);
    useWorkspaceStore.getState().closeView(closing.id);

    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    expect(pane.activeViewId).toBe(first.id);
    expect(pane.activeViewId).not.toBe(lastInList.id);
  });

  it("does not change the active tab when an inactive tab closes", () => {
    const inactive = useWorkspaceStore.getState().openBrowserView({
      url: "https://inactive.example",
    });
    const active = useWorkspaceStore.getState().openBrowserView({ url: "https://active.example" });

    useWorkspaceStore.getState().closeView(inactive.id);

    expect(dockLeaves(useWorkspaceStore.getState().layout.root)[0].activeViewId).toBe(active.id);
  });

  it("preserves sidebar visibility in versioned snapshots", () => {
    const tab = useWorkspaceStore.getState().openSurface(browserRequest);
    useWorkspaceStore.getState().toggleSidebar(tab.id);
    const snapshot = useWorkspaceStore.getState().createSnapshot("account-1", "device-1");
    expect(snapshot.version).toBe(4);
    expect(
      findDockLeaf(snapshot.layout.root, snapshot.layout.focusedPaneId)?.views.find(
        (candidate) => candidate.id === tab.id,
      )?.sidebarVisible,
    ).toBe(false);
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.getState().replaceSnapshot(snapshot);
    expect(
      dockLeaves(useWorkspaceStore.getState().layout.root)[0].views.find(
        (candidate) => candidate.id === tab.id,
      )?.sidebarVisible,
    ).toBe(false);
  });

  it("opens browser pages adjacently and updates their metadata", () => {
    const first = useWorkspaceStore.getState().openBrowserView({ url: "https://example.com" });
    const second = useWorkspaceStore.getState().openBrowserView({
      url: "https://example.org",
      sourceViewId: first.id,
    });
    const tabs = allLayoutViews(useWorkspaceStore.getState().layout);
    const firstIndex = tabs.findIndex((tab) => tab.id === first.id);
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(tabs[firstIndex + 1].id).toBe(second.id);
    useWorkspaceStore
      .getState()
      .updateBrowserView(second.id, { url: "https://misty.com", title: "Misty" });
    const updated = dockLeaves(useWorkspaceStore.getState().layout.root)[0].views.find(
      (tab) => tab.id === second.id,
    )!;
    expect(updated.title).toBe("Misty");
    expect(parseBrowserViewState(updated.state).faviconUrl).toBe("https://misty.com/favicon.ico");

    // Placeholder titles like "Loading..." should be ignored in favor of URL/hostname
    useWorkspaceStore.getState().updateBrowserView(second.id, { title: "Loading..." });
    const afterLoading = dockLeaves(useWorkspaceStore.getState().layout.root)[0].views.find(
      (tab) => tab.id === second.id,
    )!;
    expect(afterLoading.title).toBe("misty.com");

    useWorkspaceStore.getState().updateBrowserView(second.id, { title: "Loading" });
    const afterLoadingPlain = dockLeaves(useWorkspaceStore.getState().layout.root)[0].views.find(
      (tab) => tab.id === second.id,
    )!;
    expect(afterLoadingPlain.title).toBe("misty.com");
  });
});

it("rejects invalid window tab reordering without changing the layout", () => {
  const store = useWorkspaceStore.getState();
  store.reset();
  store.openBrowserView({ url: "https://example.com" });
  const before = useWorkspaceStore.getState().layout;
  store.reorderTabs(["missing"]);
  expect(useWorkspaceStore.getState().layout).toBe(before);
});
