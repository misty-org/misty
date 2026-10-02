import { beforeEach, describe, expect, it } from "vitest";
import { createDockLeaf, dockLeaves, dockTreeViews, insertDockSplit } from "./dockTree";
import { activeLayoutView, allLayoutViews, layoutTabs } from "./layoutTabs";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { migrateWorkspaceStore, partialWorkspaceStore } from "./workspaceStorePersistence";
import { normalizeWorkspaceLayout } from "./windows";
import type { WorkspaceView } from "./model";

const state = () => useWorkspaceStore.getState();
const browser = (url: string) => state().openBrowserView({ url });
const owner = (viewId: string) =>
  layoutTabs(state().layout).find((tab) =>
    dockTreeViews(tab.root).some((view) => view.id === viewId),
  )!;

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
        dockLeaves(tab.root).every((pane) => pane.views.length === 1),
      ),
    ).toBe(true);
  });

  it("switches entire split arrangements and restores focus, sizes, and background state", () => {
    const first = browser("https://one.example");
    const firstTab = owner(first.id).id;
    const pane = state().splitPane(state().layout.focusedPaneId, "right")!;
    const beside = state().openBrowserView({ url: "https://beside.example", paneId: pane });
    const root = state().layout.root;
    if (root.type !== "split") throw new Error("Expected split");
    state().updateSplitRatio(root.id, 0.63);
    const second = browser("https://two.example");
    expect(dockLeaves(state().layout.root)).toHaveLength(1);
    state().updateBrowserView(beside.id, { title: "Background title" });
    state().selectTab(firstTab);
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
    state().reorderTabs([
      secondTab,
      firstTab,
      ...ids.filter((id) => id !== firstTab && id !== secondTab),
    ]);
    expect(state().selectView(0)?.id).toBe(activeLayoutView(owner(second.id))?.id);
    expect(state().cycleView(1)?.id).toBe(first.id);
    expect(state().layout.activeTabId).toBe(firstTab);
  });

  it("closes and reopens a complete tab with all panes and its custom name", () => {
    const first = browser("https://one.example"),
      id = owner(first.id).id;
    const pane = state().splitPane(state().layout.focusedPaneId, "down")!;
    const second = state().openBrowserView({ url: "https://two.example", paneId: pane });
    state().renameTab(id, "Research");
    const saved = owner(first.id);
    expect(state().closeTab(id)).toBe(true);
    expect(
      allLayoutViews(state().layout).some((view) => view.id === first.id || view.id === second.id),
    ).toBe(false);
    state().reopenClosedView();
    expect(owner(first.id)).toMatchObject(saved);
    expect(state().layout.activeTabId).toBe(id);
  });

  it("closes a pane without hiding its contents in another pane and can reopen it", () => {
    const first = browser("https://one.example");
    const pane = state().splitPane(state().layout.focusedPaneId, "right")!;
    const second = state().openBrowserView({ url: "https://two.example", paneId: pane });
    state().closePane(pane);
    expect(dockTreeViews(state().layout.root).map((view) => view.id)).toEqual([first.id]);
    state().reopenClosedView();
    expect(dockLeaves(state().layout.root)).toHaveLength(2);
    expect(dockTreeViews(state().layout.root).map((view) => view.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("moves a view from another tab into a split and removes its empty source tab", () => {
    const first = browser("https://one.example"),
      second = browser("https://two.example");
    const sourceId = owner(second.id).id;
    state().focusView(first.id);
    expect(state().dockView(second.id, state().layout.focusedPaneId, "right")).toBe(true);
    expect(dockTreeViews(state().layout.root).map((view) => view.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(layoutTabs(state().layout).some((tab) => tab.id === sourceId)).toBe(false);
  });

  it("exchanges views on a center drop rather than creating nested tabs", () => {
    const first = browser("https://one.example");
    const pane = state().splitPane(state().layout.focusedPaneId, "right")!;
    const second = state().openBrowserView({ url: "https://two.example", paneId: pane });
    expect(state().dockView(first.id, pane, "center")).toBe(true);
    expect(dockTreeViews(state().layout.root).map((view) => view.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(dockLeaves(state().layout.root).every((pane) => pane.views.length === 1)).toBe(true);
  });

  it("keeps tab collections and background metadata independent between windows", () => {
    const firstWindow = state().activeWindowId;
    const first = browser("https://one.example");
    const second = browser("https://two.example");
    state().createWindow("Other work");
    state().updateBrowserView(first.id, { title: "Updated while hidden" });
    expect(allLayoutViews(state().layout).some((view) => view.id === second.id)).toBe(false);
    state().focusView(first.id);
    expect(state().activeWindowId).toBe(firstWindow);
    expect(activeLayoutView(state().layout)?.title).toBe("Updated while hidden");
    expect(allLayoutViews(state().layout).some((view) => view.id === second.id)).toBe(true);
  });

  it("round-trips all layouts, selected tabs, and custom labels through persistence and snapshots", () => {
    const first = browser("https://one.example"),
      id = owner(first.id).id;
    state().splitPane(state().layout.focusedPaneId, "right");
    state().renameTab(id, "Research");
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
    state().selectTab(id);
    expect(dockLeaves(state().layout.root)).toHaveLength(2);
    expect(owner(first.id).title).toBe("Research");
  });

  it("migrates old splits without losing hidden tabs, view identities, state, or proportions", () => {
    const view = (id: string): WorkspaceView => ({
      id,
      surfaceId: "browser",
      groupKey: "tool:browser",
      instanceKey: id,
      title: id,
      route: "/browser",
      state: { text: id },
      sidebarVisible: true,
      createdAt: 1,
      lastFocusedAt: 1,
    });
    const left = createDockLeaf([view("a"), view("b")]);
    const right = createDockLeaf([view("c"), view("d")]);
    left.activeViewId = "b";
    right.activeViewId = "c";
    const root = insertDockSplit(left, left.id, right, "right");
    if (root.type === "split") root.ratio = 0.7;
    const migrated = normalizeWorkspaceLayout({ root, focusedPaneId: right.id });
    expect(dockTreeViews(migrated.root).map((view) => view.id)).toEqual(["b", "c"]);
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

it("opens replaceable Home in new tabs and splits and navigates inside the selected split", () => {
  expect(state().newTab()).toMatchObject({
    title: "Home",
    surfaceId: "home",
    placeholder: true,
  });
  const tabId = state().layout.activeTabId;
  const paneId = state().splitPane(state().layout.focusedPaneId, "right")!;
  expect(activeLayoutView(state().layout)).toMatchObject({
    title: "Home",
    surfaceId: "home",
    placeholder: true,
  });
  const view = state().openBrowserView({ url: "https://example.com", paneId });
  expect(state().layout.activeTabId).toBe(tabId);
  expect(dockTreeViews(state().layout.root)).toHaveLength(2);
  expect(activeLayoutView(state().layout)?.id).toBe(view.id);
});

it("restores a closed pane's own history and split proportions", () => {
  state().newTab();
  const paneId = state().splitPane(state().layout.focusedPaneId, "right")!;
  const one = state().openSurface({
    surfaceId: "files",
    groupKey: "tool:files",
    title: "Files",
    route: "/files",
    paneId,
  });
  state().updateViewRoute(one.id, "/files?path=Downloads");
  state().closePane(paneId);
  state().reopenClosedView();
  expect(state().layout.focusedPaneId).toBe(paneId);
  expect(activeLayoutView(state().layout)?.route).toBe("/files?path=Downloads");
  expect(state().navigatePane(-1)).toMatchObject({ id: one.id, route: "/files" });
});
