import { createHomeWorkspaceTab } from "./workspaceDefaultTab";
import { setAppUnsaved } from "@/features/apps/appUpdateSafety";
import { beforeEach, describe, expect, it } from "vitest";
import { createDockLeaf, dockLeaves, dockTabs, insertDockSplit } from "./dockTree";
import { activeLayoutView, allLayoutViews, layoutTabs, layoutTabLabel } from "./layoutTabs";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { migrateWorkspaceStore, partialWorkspaceStore } from "./workspaceStorePersistence";
import { normalizeWorkspaceLayout } from "./virtualWindows";
import type { WorkspaceTab } from "./model";

const state = () => useWorkspaceStore.getState();
const browser = (url: string) => state().openBrowserTab({ url });
const owner = (viewId: string) =>
  layoutTabs(state().layout).find((tab) => dockTabs(tab.root).some((view) => view.id === viewId))!;

beforeEach(() => {
  state().reset();
});

describe("window → tabs → panes", () => {
  it("opens apps in separate tabs and keeps one view per pane", () => {
    const first = browser("https://one.example");
    const second = browser("https://two.example");
    expect(owner(first.id).id).not.toBe(owner(second.id).id);
    expect(activeLayoutView(state().layout)?.id).toBe(second.id);
    expect(
      layoutTabs(state().layout).every((tab) =>
        dockLeaves(tab.root).every((pane) => pane.tabs.length === 1),
      ),
    ).toBe(true);
  });

  it("switches entire split arrangements and restores focus, sizes, and background state", () => {
    const first = browser("https://one.example");
    const firstTab = owner(first.id).id;
    const pane = state().splitPane(state().layout.focusedPaneId, "right")!;
    const beside = state().openBrowserTab({ url: "https://beside.example", paneId: pane });
    const root = state().layout.root;
    if (root.type !== "split") throw new Error("Expected split");
    state().updateSplitRatio(root.id, 0.63);
    const second = browser("https://two.example");
    expect(dockLeaves(state().layout.root)).toHaveLength(1);
    state().updateBrowserTab(beside.id, { title: "Background title" });
    state().selectLayoutTab(firstTab);
    expect(dockLeaves(state().layout.root)).toHaveLength(2);
    expect(state().layout.root).toMatchObject({ id: root.id, ratio: 0.63 });
    expect(state().layout.focusedPaneId).toBe(pane);
    expect(activeLayoutView(state().layout)?.title).toBe("Background title");
    expect(allLayoutViews(state().layout).some((view) => view.id === second.id)).toBe(true);
  });

  it("cycles window tabs instead of panes, and honors reordered positions", () => {
    const first = browser("https://one.example"),
      second = browser("https://two.example");
    const firstTab = owner(first.id).id,
      secondTab = owner(second.id).id;
    state().splitPane(state().layout.focusedPaneId, "down");
    const ids = layoutTabs(state().layout).map((tab) => tab.id);
    state().reorderLayoutTabs([
      secondTab,
      firstTab,
      ...ids.filter((id) => id !== firstTab && id !== secondTab),
    ]);
    expect(state().selectTab(0)?.id).toBe(activeLayoutView(owner(second.id))?.id);
    expect(state().cycleTab(1)?.id).toBe(first.id);
    expect(state().layout.activeLayoutTabId).toBe(firstTab);
  });

  it("closes and reopens a complete tab with all panes and its custom name", () => {
    const first = browser("https://one.example"),
      id = owner(first.id).id;
    const pane = state().splitPane(state().layout.focusedPaneId, "down")!;
    const second = state().openBrowserTab({ url: "https://two.example", paneId: pane });
    state().renameLayoutTab(id, "Research");
    const saved = owner(first.id);
    expect(state().closeLayoutTab(id)).toBe(true);
    expect(
      allLayoutViews(state().layout).some((view) => view.id === first.id || view.id === second.id),
    ).toBe(false);
    state().reopenClosedTab();
    expect(owner(first.id)).toMatchObject(saved);
    expect(state().layout.activeLayoutTabId).toBe(id);
  });

  it("closes a pane without hiding its contents in another pane and can reopen it", () => {
    const first = browser("https://one.example");
    const pane = state().splitPane(state().layout.focusedPaneId, "right")!;
    const second = state().openBrowserTab({ url: "https://two.example", paneId: pane });
    state().closePane(pane);
    expect(dockTabs(state().layout.root).map((view) => view.id)).toEqual([first.id]);
    state().reopenClosedTab();
    expect(dockLeaves(state().layout.root)).toHaveLength(2);
    expect(dockTabs(state().layout.root).map((view) => view.id)).toEqual([first.id, second.id]);
  });

  it("moves a view from another tab into a split and removes its empty source tab", () => {
    const first = browser("https://one.example"),
      second = browser("https://two.example");
    const sourceId = owner(second.id).id;
    state().focusTab(first.id);
    expect(state().dockTab(second.id, state().layout.focusedPaneId, "right")).toBe(true);
    expect(dockTabs(state().layout.root).map((view) => view.id)).toEqual([first.id, second.id]);
    expect(layoutTabs(state().layout).some((tab) => tab.id === sourceId)).toBe(false);
  });

  it("exchanges views on a center drop rather than creating nested tabs", () => {
    const first = browser("https://one.example");
    const pane = state().splitPane(state().layout.focusedPaneId, "right")!;
    const second = state().openBrowserTab({ url: "https://two.example", paneId: pane });
    expect(state().dockTab(first.id, pane, "center")).toBe(true);
    expect(dockTabs(state().layout.root).map((view) => view.id)).toEqual([second.id, first.id]);
    expect(dockLeaves(state().layout.root).every((pane) => pane.tabs.length === 1)).toBe(true);
  });

  it("keeps tab collections and background metadata independent between windows", () => {
    const firstWindow = state().activeVirtualWindowId;
    const first = browser("https://one.example");
    const second = browser("https://two.example");
    state().createVirtualWindow("Other work");
    state().updateBrowserTab(first.id, { title: "Updated while hidden" });
    expect(allLayoutViews(state().layout).some((view) => view.id === second.id)).toBe(false);
    state().focusTab(first.id);
    expect(state().activeVirtualWindowId).toBe(firstWindow);
    expect(activeLayoutView(state().layout)?.title).toBe("Updated while hidden");
    expect(allLayoutViews(state().layout).some((view) => view.id === second.id)).toBe(true);
  });

  it("round-trips all layouts, selected tabs, and custom labels through persistence and snapshots", () => {
    const first = browser("https://one.example"),
      id = owner(first.id).id;
    state().splitPane(state().layout.focusedPaneId, "right");
    state().renameLayoutTab(id, "Research");
    browser("https://two.example");
    const persisted = JSON.parse(JSON.stringify(partialWorkspaceStore(state())));
    const saved = JSON.parse(JSON.stringify(state().createSnapshot("account", "device")));
    const expectedIds = allLayoutViews(state().layout).map((view) => view.id);
    state().reset();
    useWorkspaceStore.setState(migrateWorkspaceStore(persisted, 11));
    expect(allLayoutViews(state().layout).map((view) => view.id)).toEqual(expectedIds);
    state().reset();
    state().replaceSnapshot(saved);
    expect(allLayoutViews(state().layout).map((view) => view.id)).toEqual(expectedIds);
    state().selectLayoutTab(id);
    expect(dockLeaves(state().layout.root)).toHaveLength(2);
    expect(owner(first.id).title).toBe("Research");
  });

  it("migrates old splits without losing hidden tabs, view identities, state, or proportions", () => {
    const view = (id: string): WorkspaceTab => ({
      id,
      surfaceId: "official-app",
      groupKey: "app:browser",
      instanceKey: id,
      title: id,
      route: "/apps/browser",
      state: { text: id },
      sidebarVisible: true,
      createdAt: 1,
      lastFocusedAt: 1,
    });
    const left = createDockLeaf([view("a"), view("b")]);
    const right = createDockLeaf([view("c"), view("d")]);
    left.activeTabId = "b";
    right.activeTabId = "c";
    const root = insertDockSplit(left, left.id, right, "right");
    if (root.type === "split") root.ratio = 0.7;
    const migrated = normalizeWorkspaceLayout({ root, focusedPaneId: right.id });
    expect(dockTabs(migrated.root).map((view) => view.id)).toEqual(["b", "c"]);
    expect(migrated.root).toMatchObject({ ratio: 0.7 });
    expect(
      allLayoutViews(migrated)
        .map((view) => view.id)
        .sort(),
    ).toEqual(["a", "b", "c", "d"]);
    expect(layoutTabs(migrated)).toHaveLength(3);
    expect(normalizeWorkspaceLayout(migrated)).toEqual(migrated);
  });
});

it("keeps cross-app and route history in its pane with restorable state", () => {
  state().newLayoutTab();
  const initial = state().openSurface(createHomeWorkspaceTab("global"));
  const paneId = state().layout.focusedPaneId;
  const first = state().openSurface({
    surfaceId: "official-app",
    groupKey: "app:planner",
    title: "Planner",
    route: "/apps/planner",
    state: { viewport: 3 },
  });
  state().updateTabRoute(first.id, "/apps/planner?view=agenda");
  state().updateTabState(first.id, { viewport: 9 });
  const second = state().openSurface({
    surfaceId: "marketplace",
    groupKey: "tool:marketplace",
    title: "Discover",
    route: "/discover",
  });
  expect(state().layout.focusedPaneId).toBe(paneId);
  expect(allLayoutViews(state().layout).some((view) => view.id === first.id)).toBe(false);
  expect(state().navigatePane(-1)).toMatchObject({
    id: first.id,
    route: "/apps/planner?view=agenda",
    state: { viewport: 9 },
  });
  expect(state().navigatePane(-1)).toMatchObject({ id: first.id, route: "/apps/planner" });
  expect(state().navigatePane(-1)?.id).toBe(initial.id);
  expect(state().navigatePane(3)?.id).toBe(second.id);
  const split = state().splitPane(paneId, "right")!;
  expect(state().canNavigatePane(-1, split)).toBe(false);
  expect(state().canNavigatePane(-1, paneId)).toBe(true);
});

it("creates blank tabs and splits, replacing the blank when choosing an app", () => {
  expect(state().newLayoutTab()).toMatchObject({ title: "New Tab", placeholder: true });
  const tabId = state().layout.activeLayoutTabId;
  const paneId = state().splitPane(state().layout.focusedPaneId, "right")!;
  expect(activeLayoutView(state().layout)).toMatchObject({ title: "New Tab", placeholder: true });
  const view = state().openSurface({
    surfaceId: "marketplace",
    groupKey: "tool:marketplace",
    title: "Discover",
    route: "/discover",
    paneId,
    forceNew: true,
  });
  expect(state().layout.activeLayoutTabId).toBe(tabId);
  expect(dockTabs(state().layout.root)).toHaveLength(2);
  expect(activeLayoutView(state().layout)?.id).toBe(view.id);
  expect(state().canNavigatePane(-1)).toBe(false);
});

it("updates automatic titles live while preserving custom names through history and reload", () => {
  const view = state().openSurface(createHomeWorkspaceTab("global")),
    id = state().layout.activeLayoutTabId!;
  state().renameTab(view.id, "Updated content");
  expect(layoutTabLabel(owner(view.id))).toBe("Updated content");
  state().renameLayoutTab(id, "Research");
  state().renameTab(view.id, "Later content");
  expect(layoutTabLabel(owner(view.id))).toBe("Research");
  const saved = JSON.parse(JSON.stringify(partialWorkspaceStore(state())));
  const restored = migrateWorkspaceStore(saved, 11);
  expect(layoutTabLabel(layoutTabs(restored.layout).find((tab) => tab.id === id)!)).toBe(
    "Research",
  );
  state().renameLayoutTab(id, "");
  expect(layoutTabLabel(owner(view.id))).toBe("Later content");
});

it("restores a closed pane's cross-app history and split proportions", () => {
  state().newLayoutTab();
  const paneId = state().splitPane(state().layout.focusedPaneId, "right")!;
  const one = state().openSurface({
    surfaceId: "home",
    groupKey: "tool:home",
    title: "Home",
    route: "/home",
    paneId,
  });
  state().openSurface({
    surfaceId: "marketplace",
    groupKey: "tool:marketplace",
    title: "Discover",
    route: "/discover",
  });
  state().closePane(paneId);
  state().reopenClosedTab();
  expect(state().layout.focusedPaneId).toBe(paneId);
  expect(state().navigatePane(-1)?.id).toBe(one.id);
});

it("blocks replacement, tab closing, and cross-app Back while work is unsaved", () => {
  state().newLayoutTab();
  const first = state().openSurface(createHomeWorkspaceTab("global"));
  const code = state().openSurface({
    surfaceId: "official-app",
    groupKey: "app:code",
    title: "Code",
    route: "/apps/code",
  });
  setAppUnsaved(code.id, true);
  try {
    expect(
      state().openSurface({
        surfaceId: "marketplace",
        groupKey: "tool:marketplace",
        title: "Discover",
        route: "/discover",
      }).id,
    ).toBe(code.id);
    expect(state().navigatePane(-1)).toBeNull();
    expect(state().closeLayoutTab(state().layout.activeLayoutTabId!)).toBe(false);
  } finally {
    setAppUnsaved(code.id, false);
  }
  expect(state().navigatePane(-1)?.id).toBe(first.id);
});
