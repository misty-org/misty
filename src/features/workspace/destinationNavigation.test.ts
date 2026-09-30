import { beforeEach, afterEach, expect, it } from "vitest";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { workspaceSurfaceFromRoute } from "./routeSurface";
import { activeLayoutView, allLayoutViews, layoutTabs } from "./layoutTabs";
import { dockLeaves, findDockLeaf } from "./dockTree";
import { configureWorkspaceDefaultView } from "./workspaceDefaultView";
import { partialWorkspaceStore, migrateWorkspaceStore } from "./workspaceStorePersistence";
import { normalizeWorkspaceLayout } from "./windows";
import { setWorkspaceUnsaved } from "./unsavedChanges";

const store = () => useWorkspaceStore.getState();
const go = (route: string) => store().openDestination(workspaceSurfaceFromRoute(route)!);
beforeEach(() => {
  configureWorkspaceDefaultView(0);
  store().reset();
});
afterEach(() => configureWorkspaceDefaultView(0));

it("returns to the most recently used browser without losing either URL or runtime identity", () => {
  const one = store().openBrowserView({ url: "https://one.example" });
  const two = store().openBrowserView({ url: "https://two.example" });
  store().focusView(one.id);
  go("/home");
  const resumed = go("/browser");
  expect(resumed).toMatchObject({
    id: one.id,
    instanceKey: one.instanceKey,
    state: { url: "https://one.example" },
  });
  expect(allLayoutViews(store().layout).find((view) => view.id === two.id)?.state).toMatchObject({
    url: "https://two.example",
  });
  const before = store();
  expect(go("/browser").id).toBe(one.id);
  expect(store()).toBe(before);
});

it("reuses Files at its last route without mixing navbar selection into Back/Forward", () => {
  const files = go("/files");
  store().updateViewRoute(files.id, "/files?path=Projects");
  go("/home");
  expect(store().navigatePane(-1)).toBeNull();
  expect(go("/files")).toMatchObject({ id: files.id, route: "/files?path=Projects" });
  expect(store().navigatePane(-1)?.route).toBe("/files");
  expect(store().navigatePane(-1)).toBeNull();
  expect(store().navigatePane(1)?.route).toBe("/files?path=Projects");
});

it("fills a fresh tab even when the selected destination is already open", () => {
  const first = go("/files");
  store().newTab();
  const layoutId = store().layout.activeTabId;
  const second = go("/files");
  expect(second.id).not.toBe(first.id);
  expect(store().layout.activeTabId).toBe(layoutId);
  expect(layoutTabs(store().layout)).toHaveLength(2);
  expect(store().navigatePane(-1)).toBeNull();
});

it("fills a fresh split and later restores the whole split without replacing occupied panes", () => {
  const first = go("/browser");
  const splitTabId = store().layout.activeTabId;
  const pane = store().splitPane(store().layout.focusedPaneId, "right")!;
  const second = go("/browser");
  expect(second.id).not.toBe(first.id);
  expect(store().layout.focusedPaneId).toBe(pane);
  expect(store().layout.activeTabId).toBe(splitTabId);
  go("/files");
  expect(dockLeaves(store().layout.root)).toHaveLength(1);
  expect(go("/browser").id).toBe(second.id);
  expect(store().layout.activeTabId).toBe(splitTabId);
  expect(dockLeaves(store().layout.root)).toHaveLength(2);
  expect(findDockLeaf(store().layout.root, pane)?.views[0].id).toBe(second.id);
});

it("treats each Space as one destination and resumes its last section", () => {
  const space = go("/spaces/family/chat");
  store().updateViewRoute(space.id, "/spaces/family/planner?view=week");
  go("/spaces/work/chat");
  expect(go("/spaces/family/chat")).toMatchObject({
    id: space.id,
    route: "/spaces/family/planner?view=week",
  });
});

it("keeps destination reuse inside the current window and excludes private browser tabs", () => {
  const first = go("/browser");
  store().openBrowserView({ url: "https://private.example", private: true });
  expect(go("/browser").id).toBe(first.id);
  store().createWindow();
  expect(go("/browser").id).not.toBe(first.id);
});

it("preserves unsaved work when navigating to another destination", () => {
  const files = go("/files");
  setWorkspaceUnsaved(files.id, true);
  try {
    expect(go("/home").surfaceId).toBe("home");
    expect(go("/files").id).toBe(files.id);
    expect(store().closeView(files.id)).toBe(false);
  } finally {
    setWorkspaceUnsaved(files.id, false);
  }
});

it("starts configured fresh tabs and stops replacing them after interaction", () => {
  configureWorkspaceDefaultView(2);
  const fresh = store().newTab();
  expect(fresh).toMatchObject({ surfaceId: "files", placeholder: true });
  store().commitPlaceholder(fresh.id);
  go("/home");
  expect(allLayoutViews(store().layout).find((view) => view.id === fresh.id)).toMatchObject({
    placeholder: false,
  });
  expect(go("/files").id).toBe(fresh.id);
});

it("preserves established and fresh tabs across persistence", () => {
  const files = go("/files");
  const fresh = store().newTab();
  const saved = JSON.parse(JSON.stringify(partialWorkspaceStore(store())));
  useWorkspaceStore.setState(migrateWorkspaceStore(saved, 11));
  expect(activeLayoutView(store().layout)).toMatchObject({
    id: fresh.id,
    surfaceId: "home",
    placeholder: true,
  });
  expect(allLayoutViews(store().layout).find((view) => view.id === files.id)?.placeholder).not.toBe(
    true,
  );
});

it("recovers views hidden by old cross-app history as visible tabs", () => {
  const browser = go("/browser");
  const files = go("/files");
  const current = store().layout;
  const pane = dockLeaves(current.root)[0];
  const root = { ...pane, history: { entries: [browser, files], index: 1 } };
  const migrated = normalizeWorkspaceLayout({
    ...current,
    root,
    tabs: [{ id: "legacy", root, focusedPaneId: pane.id }],
    activeTabId: "legacy",
  });
  expect(
    allLayoutViews(migrated)
      .map((view) => view.id)
      .sort(),
  ).toEqual([browser.id, files.id].sort());
  expect(dockLeaves(migrated.root)[0].history?.entries.map((view) => view.id)).toEqual([files.id]);
  expect(normalizeWorkspaceLayout(migrated)).toEqual(migrated);
});

it("preserves an occupied split when an explicit browser open targets it", () => {
  const browser = go("/browser");
  const paneId = store().layout.focusedPaneId;
  const opened = store().openBrowserView({ paneId, url: "https://new.example" });
  expect(opened.id).not.toBe(browser.id);
  expect(allLayoutViews(store().layout).map((view) => view.id)).toEqual(
    expect.arrayContaining([browser.id, opened.id]),
  );
  expect(store().layout.focusedPaneId).not.toBe(paneId);
});

it("keeps a default browser replaceable through metadata updates, then commits navigation", () => {
  configureWorkspaceDefaultView(1);
  const fresh = store().newTab();
  store().updateBrowserView(fresh.id, { title: "Loaded default" });
  expect(activeLayoutView(store().layout)?.placeholder).toBe(true);
  store().updateBrowserView(fresh.id, { url: "https://work.example" });
  expect(activeLayoutView(store().layout)?.placeholder).toBe(false);
  go("/files");
  expect(allLayoutViews(store().layout).some((view) => view.id === fresh.id)).toBe(true);
});

it("restores Scheduled task selection independently of Agents and persists its identity", () => {
  const agents = go("/agents");
  const scheduled = go("/scheduled");
  store().updateViewRoute(scheduled.id, "/scheduled?task=weekly");
  expect(go("/agents").id).toBe(agents.id);
  expect(go("/scheduled")).toMatchObject({ id: scheduled.id, route: "/scheduled?task=weekly" });
  const saved = JSON.parse(JSON.stringify(partialWorkspaceStore(store())));
  useWorkspaceStore.setState(migrateWorkspaceStore(saved, 11));
  expect(activeLayoutView(store().layout)).toMatchObject({
    id: scheduled.id,
    surfaceId: "scheduled",
    route: "/scheduled?task=weekly",
  });
});

it("migrates saved Scheduled views out of Agents without losing the selected task", () => {
  const agents = go("/agents");
  store().updateViewRoute(agents.id, "/agents?view=scheduled&task=weekly");
  const saved = JSON.parse(JSON.stringify(partialWorkspaceStore(store())));
  useWorkspaceStore.setState(migrateWorkspaceStore(saved, 11));
  expect(activeLayoutView(store().layout)).toMatchObject({
    id: agents.id,
    surfaceId: "scheduled",
    groupKey: "tool:scheduled",
    route: "/scheduled?task=weekly",
  });
});
