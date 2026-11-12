import { beforeEach, afterEach, expect, it } from "vitest";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { workspaceSurfaceFromRoute } from "./routeSurface";
import { activeLayoutView, allLayoutViews, layoutTabs } from "../panes/layoutTabs";
import { dockLeaves, findDockLeaf } from "../panes/dockTree";
import { configureWorkspaceDefaultView } from "./workspaceDefaultView";
import { partialWorkspaceStore, migrateWorkspaceStore } from "./workspaceStorePersistence";
import { normalizeWorkspaceLayout } from "../profiles/windows";
import { openPage } from "@/tests/workspacePage";

const store = () => useWorkspaceStore.getState();
const go = (route: string) => store().openDestination(workspaceSurfaceFromRoute(route)!);
beforeEach(() => {
  configureWorkspaceDefaultView(3);
  store().reset();
});
afterEach(() => configureWorkspaceDefaultView(1));

it("returns to the most recently used page of a destination, keeping each one's route", () => {
  const one = openPage(store(), { url: "https://one.example" });
  const two = openPage(store(), { url: "https://two.example" });
  store().focusView(one.id);
  go("/spaces/family/chat");
  const resumed = go("/agents");
  expect(resumed).toMatchObject({
    id: one.id,
    instanceKey: one.instanceKey,
    route: "/agents?conversation=one.example",
  });
  expect(allLayoutViews(store().layout).find((view) => view.id === two.id)?.route).toBe(
    "/agents?conversation=two.example",
  );
  const before = store();
  expect(go("/agents").id).toBe(one.id);
  expect(store()).toBe(before);
});

it("fills a fresh tab even when the selected destination is already open", () => {
  const first = go("/agents");
  store().newTab();
  const layoutId = store().layout.activeTabId;
  const second = go("/agents");
  expect(second.id).not.toBe(first.id);
  expect(store().layout.activeTabId).toBe(layoutId);
  expect(layoutTabs(store().layout)).toHaveLength(2);
  expect(store().navigatePane(-1)).toBeNull();
});

it("fills a fresh split and later restores the whole split without replacing occupied panes", () => {
  const first = go("/spaces/family/chat");
  const splitTabId = store().layout.activeTabId;
  const pane = store().splitPane(store().layout.focusedPaneId, "right")!;
  const second = go("/spaces/family/chat");
  expect(second.id).not.toBe(first.id);
  expect(store().layout.focusedPaneId).toBe(pane);
  expect(store().layout.activeTabId).toBe(splitTabId);
  go("/agents");
  expect(dockLeaves(store().layout.root)).toHaveLength(1);
  expect(go("/spaces/family/chat").id).toBe(second.id);
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

it("keeps destination reuse inside the current window", () => {
  const first = go("/spaces/family/chat");
  expect(go("/spaces/family/chat").id).toBe(first.id);
});

it("starts configured fresh tabs and stops replacing them after interaction", () => {
  configureWorkspaceDefaultView(3);
  const fresh = store().newTab();
  expect(fresh).toMatchObject({ surfaceId: "agents", placeholder: true });
  store().commitPlaceholder(fresh.id);
  go("/agents");
  expect(allLayoutViews(store().layout).find((view) => view.id === fresh.id)).toMatchObject({
    placeholder: false,
  });
  expect(go("/agents").id).toBe(fresh.id);
});

it("preserves established and fresh tabs across persistence", () => {
  const files = go("/agents");
  const fresh = store().newTab();
  const saved = JSON.parse(JSON.stringify(partialWorkspaceStore(store())));
  useWorkspaceStore.setState(migrateWorkspaceStore(saved, 11));
  expect(activeLayoutView(store().layout)).toMatchObject({
    id: fresh.id,
    surfaceId: "agents",
    placeholder: true,
  });
  expect(allLayoutViews(store().layout).find((view) => view.id === files.id)?.placeholder).not.toBe(
    true,
  );
});

it("recovers views hidden by old cross-app history as visible tabs", () => {
  const space = go("/spaces/family/chat");
  const files = go("/agents");
  const current = store().layout;
  const pane = dockLeaves(current.root)[0];
  const root = { ...pane, history: { entries: [space, files], index: 1 } };
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
  ).toEqual([space.id, files.id].sort());
  expect(dockLeaves(migrated.root)[0].history?.entries.map((view) => view.id)).toEqual([files.id]);
  expect(normalizeWorkspaceLayout(migrated)).toEqual(migrated);
});

it("preserves an occupied split when an explicit open targets it", () => {
  const space = go("/spaces/family/chat");
  const paneId = store().layout.focusedPaneId;
  const opened = openPage(store(), { paneId, url: "https://new.example" });
  expect(opened.id).not.toBe(space.id);
  expect(allLayoutViews(store().layout).map((view) => view.id)).toEqual(
    expect.arrayContaining([space.id, opened.id]),
  );
  expect(store().layout.focusedPaneId).not.toBe(paneId);
});

it("opens the retired Scheduled link in the Agents tab", () => {
  const agents = go("/agents");
  expect(go("/scheduled")).toMatchObject({ id: agents.id, surfaceId: "agents" });
});

it("migrates saved legacy Scheduled routes into Agents", () => {
  const agents = go("/agents");
  store().updateViewRoute(agents.id, "/scheduled?task=weekly");
  const saved = JSON.parse(JSON.stringify(partialWorkspaceStore(store())));
  useWorkspaceStore.setState(migrateWorkspaceStore(saved, 11));
  expect(activeLayoutView(store().layout)).toMatchObject({
    id: agents.id,
    surfaceId: "agents",
    groupKey: "tool:agents",
    route: "/agents?task=weekly",
  });
});
