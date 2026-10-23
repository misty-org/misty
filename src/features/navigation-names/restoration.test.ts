import { dockTreeViews } from "@/features/workspace/dockTree";
import { allLayoutViews } from "@/features/workspace/layoutTabs";
import { beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { normalizeWorkspaceLayout } from "@/features/workspace/windows";
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
  const persisted = allLayoutViews(useWorkspaceStore.getState().layout).find(
    (t) => t.id === tab.id,
  )!;
  useNavigationNames.setState({
    names: {
      [tabNameKey(tab.id)]: "School",
      [groupNameKey(persisted.groupInstanceId!)]: "Research",
    },
  });
  store.renameView(tab.id, "Latest page");
  expect(navigationName(tabNameKey(tab.id), "Latest page")).toBe("School");
  store.setScope("space:family");
  store.setScope("space:personal");
  expect(navigationName(tabNameKey(tab.id), "Latest page")).toBe("School");
  const migrated = normalizeWorkspaceLayout(
    JSON.parse(JSON.stringify(useWorkspaceStore.getState().layout)),
  );
  expect(dockTreeViews(migrated.root).find((t) => t.id === tab.id)?.groupInstanceId).toBe(
    persisted.groupInstanceId,
  );
  store.closeView(tab.id);
  expect(store.reopenClosedView()?.id).toBe(tab.id);
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
