import { beforeEach, expect, it } from "vitest";
import {
  allLayoutViews,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/app-windows";
import { closeSavedWebPages } from "./spaceNavigation";

beforeEach(() => {
  useWorkspaceStore.persist.clearStorage();
  useWorkspaceStore.getState().reset();
});

it("closes a person's saved web pages and keeps an agent's pages and the window's own", () => {
  const store = useWorkspaceStore.getState();
  const agents = store.openSurface(workspaceSurfaceFromRoute("/agents")!);
  store.openBrowserView({ url: "https://person.example/" });
  const owned = store.openBrowserView({ url: "https://agent.example/" });
  store.updateBrowserView(owned.id, { agentOwned: true });

  closeSavedWebPages();

  expect(
    allLayoutViews(useWorkspaceStore.getState().layout)
      .map((view) => view.id)
      .sort(),
  ).toEqual([agents.id, owned.id].sort());
});
