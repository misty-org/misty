import { afterEach, beforeEach, expect, it } from "vitest";
import { activeLayoutView } from "./layoutTabs";
import { workspaceSurfaceFromRoute } from "./routeSurface";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { configureWorkspaceDefaultView } from "./workspaceDefaultView";

const store = () => useWorkspaceStore.getState();
const open = (route: string) => store().openDestination(workspaceSurfaceFromRoute(route)!);

beforeEach(() => {
  configureWorkspaceDefaultView(3);
  store().reset();
});
afterEach(() => configureWorkspaceDefaultView(1));

it("keeps each tab's history to itself, so back in one tab never lands in another", () => {
  const home = open("/spaces/one/home");
  store().updateViewRoute(home.id, "/spaces/one/home?filter=notes");
  store().updateViewRoute(home.id, "/spaces/one/home?filter=drawings");

  store().newTab();
  const chat = open("/spaces/one/library");
  store().updateViewRoute(chat.id, "/spaces/one/library?collection=recent");
  expect(chat.id).not.toBe(home.id);

  // The second tab goes back through its own pages only.
  expect(store().navigatePane(-1)).toMatchObject({ id: chat.id, route: "/spaces/one/library" });
  expect(store().navigatePane(-1)).toBeNull();

  // The first tab still has all of its own history.
  store().focusView(home.id);
  expect(store().navigatePane(-1)).toMatchObject({
    id: home.id,
    route: "/spaces/one/home?filter=notes",
  });
  expect(store().navigatePane(-1)).toMatchObject({ id: home.id, route: "/spaces/one/home" });
  expect(store().navigatePane(-1)).toBeNull();
  expect(store().navigatePane(1)).toMatchObject({ route: "/spaces/one/home?filter=notes" });
});

it("gives each split pane its own history too", () => {
  const first = open("/spaces/one/home");
  const paneId = store().splitPane(store().layout.focusedPaneId, "right")!;
  const second = store().openSurface({
    ...workspaceSurfaceFromRoute("/spaces/two/home")!,
    paneId,
  });
  store().updateViewRoute(first.id, "/spaces/one/home?filter=notes");
  store().updateViewRoute(second.id, "/spaces/two/home?filter=code");

  store().focusPane(paneId);
  expect(store().navigatePane(-1, paneId)).toMatchObject({
    id: second.id,
    route: "/spaces/two/home",
  });
  // Going back in the right pane left the left pane where it was.
  store().focusView(first.id);
  expect(activeLayoutView(store().layout)?.route).toBe("/spaces/one/home?filter=notes");
  expect(store().navigatePane(-1)).toMatchObject({ id: first.id, route: "/spaces/one/home" });
});
