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

  it("keeps a Home tab instead of ever emptying the workspace", () => {
    const store = useWorkspaceStore.getState();
    store.openSurface({
      surfaceId: "terminal",
      groupKey: "tool:terminal",
      title: "Terminal",
      route: "/terminal",
      instancePolicy: "single",
    });
    for (const tab of dockTabs(useWorkspaceStore.getState().layout.root)) {
      useWorkspaceStore.getState().closeTab(tab.id);
    }

    // Closing everything leaves Home behind, so no part of the app has to
    // handle a zero-tab workspace.
    const remaining = dockTabs(useWorkspaceStore.getState().layout.root);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ surfaceId: "home", route: "/home" });
  });

  it("stacks Home tabs on request but never from a route", () => {
    const home = {
      surfaceId: "home" as const,
      groupKey: "tool:home" as const,
      title: "Home",
      route: "/home",
    };
    // Reset already leaves one Home tab behind.
    const store = useWorkspaceStore.getState();
    store.openSurface({ ...home, forceNew: true });
    expect(
      dockTabs(useWorkspaceStore.getState().layout.root).filter((tab) => tab.surfaceId === "home"),
    ).toHaveLength(2);

    // Navigating to /home lands on a Home tab you already have. The fallback
    // Home is created outside openSurface, so this must not depend on
    // lastUsedTabByGroup being populated.
    useWorkspaceStore.getState().openSurface(home);
    expect(
      dockTabs(useWorkspaceStore.getState().layout.root).filter((tab) => tab.surfaceId === "home"),
    ).toHaveLength(2);
  });

  it("lets a real tab take the filler Home's place", () => {
    // The counterpart to stacking: a pane showing only the fallback Home is
    // showing a placeholder, so the first real tab replaces it.
    useWorkspaceStore.getState().openSurface({
      surfaceId: "terminal",
      groupKey: "tool:terminal",
      title: "Terminal",
      route: "/terminal",
      instancePolicy: "single",
    });
    expect(dockTabs(useWorkspaceStore.getState().layout.root).map((tab) => tab.surfaceId)).toEqual([
      "terminal",
    ]);
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
    expect(dockTabs(useWorkspaceStore.getState().layout.root).map((tab) => tab.surfaceId)).toEqual([
      "home",
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

  it("restores a saved transfers tab as its own tool", () => {
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
    expect(restored[0].surfaceId).toBe("transfers");
    expect(restored[0].groupKey).toBe("tool:transfers");
    expect(restored[0].route).toBe("/transfers");
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
      groupKey: "space:one:chat",
      instanceKey: "one:chat",
      title: "Chat",
    });
  });

  it("opens a browser tab on the default homepage when no URL is requested", () => {
    const tab = useWorkspaceStore.getState().openBrowserTab();
    expect(parseBrowserTabState(tab.state).url).toBe(defaultBrowserHomeUrl);
    expect(tab.title).toBe("google.com");
  });

  it("keeps an explicitly requested URL, including a deliberately blank one", () => {
    const requested = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    expect(parseBrowserTabState(requested.state).url).toBe("https://example.com");
    const blank = useWorkspaceStore.getState().openBrowserTab({ url: blankBrowserUrl });
    expect(parseBrowserTabState(blank.state).url).toBe(blankBrowserUrl);
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
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toMatchObject([
      { id: journal.id, groupKey: "space:one:journal", title: "Journal" },
      { id: planner.id, groupKey: "space:one:planner", title: "Planner" },
    ]);
    expect(
      useWorkspaceStore.getState().openSurface(workspaceSurfaceFromRoute("/spaces/one/notes/2")!)
        .id,
    ).toBe(journal.id);
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

  it("opens an explicit Home template when splitting a tool", () => {
    const browser = useWorkspaceStore.getState().openBrowserTab({
      url: "https://example.com/watch",
    });
    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];

    const splitId = useWorkspaceStore.getState().splitPane(pane.id, "right");
    const leaves = dockLeaves(useWorkspaceStore.getState().layout.root);

    expect(splitId).toBeTruthy();
    expect(leaves).toHaveLength(2);
    expect(leaves.every((leaf) => leaf.tabs.length === 1)).toBe(true);
    expect(leaves.flatMap((leaf) => leaf.tabs).map((tab) => tab.surfaceId)).toEqual([
      browser.surfaceId,
      "home",
    ]);
  });

  it("fills legacy empty split leaves with Home templates", () => {
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
    expect(leaves[0].tabs[0]?.id).toBe(browser.id);
    expect(leaves[1].tabs[0]?.surfaceId).toBe("home");
  });

  it("replaces a Home template when a tool opens in that panel", () => {
    const first = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    const homePaneId = useWorkspaceStore.getState().splitPane(pane.id, "right")!;

    const second = useWorkspaceStore.getState().openBrowserTab({
      url: "https://example.org",
      paneId: homePaneId,
    });

    const homePane = findDockLeaf(useWorkspaceStore.getState().layout.root, homePaneId);
    expect(homePane?.tabs.map((tab) => tab.id)).toEqual([second.id]);
    expect(dockTabs(useWorkspaceStore.getState().layout.root).map((tab) => tab.id)).toContain(
      first.id,
    );
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
    expect(remaining[0].tabs.map((tab) => tab.id)).toEqual([first.id]);
  });

  it("moves tabs between panel tab strips using a center drop", () => {
    const first = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    const second = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.org" });
    const source = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    useWorkspaceStore.getState().dockTab(second.id, source.id, "right");
    const destination = dockLeaves(useWorkspaceStore.getState().layout.root).find((pane) =>
      pane.tabs.some((tab) => tab.id === second.id),
    )!;
    useWorkspaceStore.getState().moveTab(first.id, destination.id);
    const leaves = dockLeaves(useWorkspaceStore.getState().layout.root);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].tabs.map((tab) => tab.id)).toEqual([second.id, first.id]);
  });

  it("preserves sidebar visibility in versioned snapshots", () => {
    const tab = useWorkspaceStore.getState().openSurface(browserRequest);
    useWorkspaceStore.getState().toggleSidebar(tab.id);
    const snapshot = useWorkspaceStore.getState().createSnapshot("account-1", "device-1");
    expect(snapshot.version).toBe(2);
    expect(
      findDockLeaf(snapshot.layout.root, snapshot.layout.focusedPaneId)?.tabs[0]?.sidebarVisible,
    ).toBe(false);
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.getState().replaceSnapshot(snapshot);
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)[0].tabs[0]?.sidebarVisible).toBe(
      false,
    );
  });

  it("opens browser pages adjacently and updates their metadata", () => {
    const first = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    const second = useWorkspaceStore.getState().openBrowserTab({
      url: "https://example.org",
      sourceTabId: first.id,
    });
    const tabs = dockLeaves(useWorkspaceStore.getState().layout.root)[0].tabs;
    expect(tabs.map((tab) => tab.id)).toEqual([first.id, second.id]);
    useWorkspaceStore
      .getState()
      .updateBrowserTab(second.id, { url: "https://misty.com", title: "Misty" });
    const updated = dockLeaves(useWorkspaceStore.getState().layout.root)[0].tabs[1];
    expect(updated.title).toBe("Misty");
    expect(parseBrowserTabState(updated.state).faviconUrl).toBe("https://misty.com/favicon.ico");
  });
});
