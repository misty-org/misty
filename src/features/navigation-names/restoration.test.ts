import { beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { dockTabs } from "@/features/workspace/dockTree";
import { normalizeWorkspaceLayout } from "@/features/workspace/virtualWindows";
import { clearNavigationRestoreHistory } from "./clearHistory";
import { navigationName, tabNameKey, groupNameKey, useNavigationNames } from "./store";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command, args) => {
    if (command === "navigation_names_update") {
      const names = { ...useNavigationNames.getState().names };
      delete names[args.key];
      useNavigationNames.setState({ names });
    }
    return { names: useNavigationNames.getState().names, error: null };
  }),
}));
beforeEach(() => {
  useWorkspaceStore.persist.clearStorage();
  useWorkspaceStore.getState().reset();
  useNavigationNames.setState({ account: "backend/account", ready: true, names: {}, error: null });
});
it("retains names through automatic updates, navigation, Spaces, restoration and migration; fresh tabs are independent", () => {
  const store = useWorkspaceStore.getState();
  const tab = store.addSurface({
    surfaceId: "browser",
    groupKey: "tool:browser",
    title: "Browser",
    route: "/browser",
    instancePolicy: "multiple",
  });
  const persisted = dockTabs(useWorkspaceStore.getState().layout.root).find(
    (t) => t.id === tab.id,
  )!;
  useNavigationNames.setState({
    names: {
      [tabNameKey(tab.id)]: "School",
      [groupNameKey(persisted.groupInstanceId!)]: "Research",
    },
  });
  store.renameTab(tab.id, "Latest page");
  expect(navigationName(tabNameKey(tab.id), "Latest page")).toBe("School");
  store.setScope("space:family");
  store.setScope("global");
  expect(navigationName(tabNameKey(tab.id), "Latest page")).toBe("School");
  const migrated = normalizeWorkspaceLayout(
    JSON.parse(JSON.stringify(useWorkspaceStore.getState().layout)),
  );
  expect(dockTabs(migrated.root).find((t) => t.id === tab.id)?.groupInstanceId).toBe(
    persisted.groupInstanceId,
  );
  store.closeTab(tab.id);
  expect(store.reopenClosedTab()?.id).toBe(tab.id);
  expect(navigationName(tabNameKey(tab.id), "Latest page")).toBe("School");
  const fresh = store.addSurface({
    surfaceId: "browser",
    groupKey: "tool:browser",
    title: "Browser",
    route: "/browser",
    instancePolicy: "multiple",
  });
  expect(navigationName(tabNameKey(fresh.id), "Browser")).toBe("Browser");
});
it("only prunes discarded restore aliases and keeps open group and sidebar aliases", async () => {
  const store = useWorkspaceStore.getState();
  const open = store.addSurface({
    surfaceId: "browser",
    groupKey: "tool:browser",
    title: "Browser",
    route: "/browser",
    instancePolicy: "multiple",
  });
  const closed = store.addSurface({
    surfaceId: "browser",
    groupKey: "tool:browser",
    title: "Browser",
    route: "/browser",
    instancePolicy: "multiple",
  });
  const group = dockTabs(useWorkspaceStore.getState().layout.root).find(
    (t) => t.id === open.id,
  )!.groupInstanceId!;
  useNavigationNames.setState({
    names: {
      [tabNameKey(open.id)]: "Open",
      [tabNameKey(closed.id)]: "Closed",
      [groupNameKey(group)]: "Research",
      "section:browser": "Web",
    },
  });
  store.closeTab(closed.id);
  await clearNavigationRestoreHistory();
  expect(useNavigationNames.getState().names).toEqual({
    [tabNameKey(open.id)]: "Open",
    [groupNameKey(group)]: "Research",
    "section:browser": "Web",
  });
  expect(useWorkspaceStore.getState().closedTabs).toEqual([]);
});
