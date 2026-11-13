import { allLayoutViews } from "../panes/layoutTabs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  canFitDockSplit,
  createDockLeaf,
  dockLeaves,
  dockTreeViews,
  findDockLeaf,
  insertDockSplit,
} from "../panes/dockTree";
import type { WorkspaceView } from "./workspaceViews";
import { workspaceSurfaceFromRoute } from "./routeSurface";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { parseWorkspaceRecord } from "./workspaceRecord";
import { partialWorkspaceStore } from "./workspaceStorePersistence";
import { openPage } from "@/tests/workspacePage";

/** A page a window can hold several of. */
const pageRequest = {
  surfaceId: "agents" as const,
  groupKey: "tool:agents" as const,
  title: "Agents",
  route: "/agents",
  instancePolicy: "multiple" as const,
};

describe("desktop dock store", () => {
  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("keeps the final pane empty until a new tab is requested", () => {
    const store = useWorkspaceStore.getState();
    const view = store.openSurface(pageRequest);
    expect(store.closeView(view.id)).toBe(true);
    const empty = useWorkspaceStore.getState().layout;
    expect(allLayoutViews(empty)).toEqual([]);
    expect(findDockLeaf(empty.root, empty.focusedPaneId)?.activeViewId).toBeNull();
    const next = store.newTab();
    expect(allLayoutViews(useWorkspaceStore.getState().layout)).toMatchObject([
      { id: next.id, surfaceId: "agents", title: "Agents", placeholder: true },
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
    const browser = store.addSurface(pageRequest);
    const initialHome = dockTreeViews(store.layout.root).find((t) => t.id !== browser.id)!;
    expect(store.closeView(initialHome.id)).toBe(true);
    expect(dockTreeViews(useWorkspaceStore.getState().layout.root)).toMatchObject([
      { id: browser.id, title: "Agents" },
    ]);

    expect(store.closeView(browser.id)).toBe(true);
    expect(allLayoutViews(useWorkspaceStore.getState().layout)).toEqual([]);
    expect(useWorkspaceStore.getState().closedItems[0]?.view.id).toBe(browser.id);
    // Opening something again replaces the empty workspace with a single tab.
    const reopened = useWorkspaceStore.getState().openSurface(pageRequest);
    expect(allLayoutViews(useWorkspaceStore.getState().layout).map((tab) => tab.id)).toEqual([
      reopened.id,
    ]);
  });

  it("switches to another pane when closing the last tab of a pane in a multi-pane window", () => {
    const store = useWorkspaceStore.getState();
    const firstPane = dockLeaves(store.layout.root)[0];
    const secondPaneId = store.splitPane(firstPane.id, "right");
    if (!secondPaneId) throw new Error("Expected second pane");
    const rightTab = store.openSurface({
      ...pageRequest,
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

  it("starts the global workspace in Agents", () => {
    expect(dockTreeViews(useWorkspaceStore.getState().layout.root)).toMatchObject([
      { surfaceId: "agents", title: "Agents", route: "/agents", placeholder: true },
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
    // The window's own first tab is an Agents placeholder, so only launched ones are counted.
    const fileTabs = allLayoutViews(useWorkspaceStore.getState().layout).filter(
      (tab) => tab.groupKey === "tool:agents" && !tab.placeholder,
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
    const first = useWorkspaceStore.getState().openSurface(pageRequest);
    const firstPane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    const secondPaneId = useWorkspaceStore.getState().splitPane(firstPane.id, "right");
    if (!secondPaneId) throw new Error("Expected a second pane");

    const second = useWorkspaceStore.getState().openSurface(pageRequest);
    expect(second.id).not.toBe(first.id);
    expect(useWorkspaceStore.getState().openSurface(pageRequest).id).toBe(second.id);

    useWorkspaceStore.getState().focusPane(firstPane.id);
    expect(useWorkspaceStore.getState().openSurface(pageRequest).id).toBe(first.id);
  });

  it("can focus a new pane on its default tab", () => {
    const first = useWorkspaceStore.getState().openSurface(pageRequest);
    const firstPane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    const secondPaneId = useWorkspaceStore.getState().splitPane(firstPane.id, "right");
    if (!secondPaneId) throw new Error("Expected a second pane");
    useWorkspaceStore.getState().focusView(first.id);

    expect(useWorkspaceStore.getState().focusPane(secondPaneId)).toBe(true);
    expect(useWorkspaceStore.getState().layout.focusedPaneId).toBe(secondPaneId);
  });

  it("does not publish a store update when the active tab is focused again", () => {
    const tab = useWorkspaceStore.getState().openSurface(pageRequest);
    const current = useWorkspaceStore.getState();

    expect(current.focusView(tab.id)).toBe(true);
    expect(useWorkspaceStore.getState()).toBe(current);
  });

  it("loads a saved Transfers tab as no tab at all", () => {
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

    useWorkspaceStore.setState(
      parseWorkspaceRecord(
        JSON.stringify({ layout: { root: leaf, focusedPaneId: leaf.id }, lastUsedViewByGroup: {} }),
      ),
    );

    // Transfers moved to Kura, and a window opens no web page in its place.
    expect(dockTreeViews(useWorkspaceStore.getState().layout.root)).toEqual([]);
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

    useWorkspaceStore.setState(
      parseWorkspaceRecord(
        JSON.stringify({
          layout: { root: pane, focusedPaneId: pane.id },
          lastUsedViewByGroup: { "space:one": legacyTab.id },
        }),
      ),
    );

    expect(dockTreeViews(useWorkspaceStore.getState().layout.root)[0]).toMatchObject({
      id: legacyTab.id,
      groupKey: "space:one",
      instanceKey: "one",
      title: "One",
      route: "/spaces/one/chat",
    });
  });

  it("focuses the last-used group instance unless a duplicate is requested", () => {
    const first = useWorkspaceStore.getState().openSurface(pageRequest);
    const same = useWorkspaceStore.getState().openSurface(pageRequest);
    const duplicate = useWorkspaceStore.getState().openSurface({ ...pageRequest, forceNew: true });
    expect(same.id).toBe(first.id);
    expect(duplicate.id).not.toBe(first.id);
    expect(useWorkspaceStore.getState().lastUsedViewByGroup["tool:agents"]).toBe(duplicate.id);
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

  it("keeps Space pages and other pages together in the global workspace", () => {
    const store = useWorkspaceStore.getState();
    const first = store.openSurface(workspaceSurfaceFromRoute("/spaces/one/notes")!);
    const browser = openPage(store, { url: "https://example.com" });
    const second = store.openSurface(workspaceSurfaceFromRoute("/spaces/two/notes")!);
    expect(allLayoutViews(useWorkspaceStore.getState().layout).map((view) => view.id)).toEqual([
      first.id,
      browser.id,
      second.id,
    ]);
    expect(store.openSurface(workspaceSurfaceFromRoute("/spaces/one/notes")!).id).toBe(first.id);
  });

  it("opens Docs and Files as separate reusable tabs in one Space", () => {
    const journalRequest = workspaceSurfaceFromRoute("/spaces/one/notes");
    const plannerRequest = workspaceSurfaceFromRoute("/spaces/one/library");
    expect(journalRequest).not.toBeNull();
    expect(plannerRequest).not.toBeNull();

    const journal = useWorkspaceStore.getState().addSurface(journalRequest!);
    const planner = useWorkspaceStore.getState().addSurface(plannerRequest!);

    expect(allLayoutViews(useWorkspaceStore.getState().layout)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: journal.id,
          groupKey: "space:one:journal",
          title: "Docs",
        }),
        expect.objectContaining({
          id: planner.id,
          groupKey: "space:one:library",
          title: "Library",
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
    openPage(useWorkspaceStore.getState(), { url: "https://example.com" });
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
    const browser = openPage(useWorkspaceStore.getState(), { url: "https://example.com/watch" });
    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];

    const splitId = useWorkspaceStore.getState().splitPane(pane.id, "right");
    const leaves = dockLeaves(useWorkspaceStore.getState().layout.root);

    expect(splitId).toBeTruthy();
    expect(leaves).toHaveLength(2);
    expect(leaves[0].views.map((tab) => tab.surfaceId)).toEqual([browser.surfaceId]);
    expect(leaves[1].views).toMatchObject([{ placeholder: true, title: "Agents" }]);
  });

  it("opens a tool tab into an empty split pane", () => {
    const first = openPage(useWorkspaceStore.getState(), { url: "https://example.com" });
    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    const newPaneId = useWorkspaceStore.getState().splitPane(pane.id, "right")!;

    const second = openPage(useWorkspaceStore.getState(), {
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
    const leftTab = openPage(store, { url: "https://left.example" });
    const leftPaneId = dockLeaves(useWorkspaceStore.getState().layout.root)[0].id;
    const rightPaneId = store.splitPane(leftPaneId, "right")!;
    const rightTab = openPage(store, { url: "https://right.example", paneId: rightPaneId });
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
    const browser = openPage(useWorkspaceStore.getState(), { url: "https://example.com" });
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
      { surfaceId: "agents", route: "/agents", placeholder: true },
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
    const first = openPage(useWorkspaceStore.getState(), { url: "https://example.com" });
    const second = openPage(useWorkspaceStore.getState(), { url: "https://example.org" });
    useWorkspaceStore.getState().focusView(first.id);
    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    expect(useWorkspaceStore.getState().dockView(second.id, pane.id, "right")).toBe(true);
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(2);
    useWorkspaceStore.getState().closeView(second.id);
    const remaining = dockLeaves(useWorkspaceStore.getState().layout.root);
    expect(remaining).toHaveLength(1);
    expect(
      remaining[0].views.filter((tab) => tab.surfaceId === "agents").map((tab) => tab.id),
    ).toEqual([first.id]);
  });

  it("returns to the previously visited tab when the active tab closes", () => {
    const first = openPage(useWorkspaceStore.getState(), { url: "https://one.example" });
    const closing = openPage(useWorkspaceStore.getState(), { url: "https://two.example" });
    const lastInList = openPage(useWorkspaceStore.getState(), { url: "https://three.example" });

    useWorkspaceStore.getState().focusView(first.id);
    useWorkspaceStore.getState().focusView(closing.id);
    useWorkspaceStore.getState().closeView(closing.id);

    const pane = dockLeaves(useWorkspaceStore.getState().layout.root)[0];
    expect(pane.activeViewId).toBe(first.id);
    expect(pane.activeViewId).not.toBe(lastInList.id);
  });

  it("does not change the active tab when an inactive tab closes", () => {
    const inactive = openPage(useWorkspaceStore.getState(), { url: "https://inactive.example" });
    const active = openPage(useWorkspaceStore.getState(), { url: "https://active.example" });

    useWorkspaceStore.getState().closeView(inactive.id);

    expect(dockLeaves(useWorkspaceStore.getState().layout.root)[0].activeViewId).toBe(active.id);
  });

  it("preserves sidebar visibility in saved workspaces", () => {
    const tab = useWorkspaceStore.getState().openSurface(pageRequest);
    useWorkspaceStore.getState().toggleSidebar(tab.id);
    const saved = JSON.stringify(partialWorkspaceStore(useWorkspaceStore.getState()));
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.setState(parseWorkspaceRecord(saved));
    expect(
      dockLeaves(useWorkspaceStore.getState().layout.root)[0].views.find(
        (candidate) => candidate.id === tab.id,
      )?.sidebarVisible,
    ).toBe(false);
  });

  it("opens pages adjacently", () => {
    const first = openPage(useWorkspaceStore.getState(), { url: "https://example.com" });
    const second = openPage(useWorkspaceStore.getState(), { url: "https://example.org" });
    const tabs = allLayoutViews(useWorkspaceStore.getState().layout);
    const firstIndex = tabs.findIndex((tab) => tab.id === first.id);
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(tabs[firstIndex + 1].id).toBe(second.id);
  });
});

it("rejects invalid window tab reordering without changing the layout", () => {
  const store = useWorkspaceStore.getState();
  store.reset();
  openPage(store, { url: "https://example.com" });
  const before = useWorkspaceStore.getState().layout;
  store.reorderTabs(["missing"]);
  expect(useWorkspaceStore.getState().layout).toBe(before);
});
