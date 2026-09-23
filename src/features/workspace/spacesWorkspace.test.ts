import { beforeEach, expect, it } from "vitest";
import { dockLeaves } from "./dockTree";
import { workspaceSurfaceFromRoute } from "./routeSurface";
import { useWorkspaceStore } from "./useWorkspaceStore";

beforeEach(() => {
  useWorkspaceStore.persist.clearStorage();
  useWorkspaceStore.getState().reset();
});
it("opens Spaces beside a browser and keeps both pane identities while changing tools", () => {
  const store = useWorkspaceStore.getState();
  const browser = store.openSurface(workspaceSurfaceFromRoute("/browser")!);
  const browserPane = useWorkspaceStore.getState().layout.focusedPaneId;
  const spacePane = store.splitPane(browserPane, "right");
  expect(spacePane).toBeTruthy();
  const space = useWorkspaceStore
    .getState()
    .openSurface(workspaceSurfaceFromRoute("/spaces/project/social")!);
  const before = dockLeaves(useWorkspaceStore.getState().layout.root);
  expect(before).toHaveLength(2);
  expect(
    before.find((pane) => pane.id === browserPane)?.tabs.some((tab) => tab.id === browser.id),
  ).toBe(true);
  expect(
    before.find((pane) => pane.id === spacePane)?.tabs.some((tab) => tab.id === space.id),
  ).toBe(true);
  useWorkspaceStore.getState().updateTabRoute(space.id, "/spaces/project/planner");
  const after = dockLeaves(useWorkspaceStore.getState().layout.root);
  expect(after.map((pane) => pane.id)).toEqual(before.map((pane) => pane.id));
  expect(after.find((pane) => pane.id === browserPane)?.tabs).toEqual(
    before.find((pane) => pane.id === browserPane)?.tabs,
  );
  expect(useWorkspaceStore.getState().activeScopeKey).toBe("global");
});
