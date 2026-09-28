import { beforeEach, expect, it } from "vitest";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { workspaceSurfaceFromRoute } from "./routeSurface";
import { allLayoutViews } from "./layoutTabs";
import { migrateRetiredWorkspaceTab } from "./workspaceMigrations";
beforeEach(() => useWorkspaceStore.getState().reset());
it("selects one Home tab alongside other tabs and preserves it on restore", () => {
  const store = useWorkspaceStore.getState();
  store.openBrowserTab({ url: "https://example.com" });
  const request = workspaceSurfaceFromRoute("/home")!;
  const home = store.openSurface(request);
  expect(home.surfaceId).toBe("home");
  expect(store.openSurface(request).id).toBe(home.id);
  expect(
    allLayoutViews(useWorkspaceStore.getState().layout).some((t) => t.surfaceId === "browser"),
  ).toBe(true);
  expect(migrateRetiredWorkspaceTab(home)).toEqual(home);
  expect(store.closeTab(home.id)).toBe(true);
  expect(allLayoutViews(useWorkspaceStore.getState().layout).some((t) => t.id === home.id)).toBe(
    false,
  );
});
