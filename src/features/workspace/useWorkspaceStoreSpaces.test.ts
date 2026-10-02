import { beforeEach, describe, expect, it } from "vitest";
import { allLayoutViews } from "./layoutTabs";
import { useWorkspaceStore } from "./useWorkspaceStore";

describe("legacy workspace scope restoration", () => {
  beforeEach(() => {
    useWorkspaceStore.getState().reset();
  });

  it("maintains separate tab collections for each space", () => {
    const store = useWorkspaceStore.getState();

    // 1. Open tabs in Space A
    store.setScope("space:space-a");
    const spaceATab1 = store.openSurface({
      surfaceId: "space",
      groupKey: "space:space-a:journal",
      title: "Journal",
      route: "/spaces/space-a/notes",
      scopeKey: "space:space-a",
    });
    const spaceATab2 = store.openSurface({
      surfaceId: "browser",
      groupKey: "tool:browser",
      title: "Browser",
      route: "/browser",
      scopeKey: "space:space-a",
    });

    expect(allLayoutViews(useWorkspaceStore.getState().layout).map((t) => t.id)).toEqual([
      spaceATab1.id,
      spaceATab2.id,
    ]);

    // 2. Switch to Space B and open different tabs
    useWorkspaceStore.getState().setScope("space:space-b");
    const spaceBTab1 = useWorkspaceStore.getState().openSurface({
      surfaceId: "space",
      groupKey: "space:space-b:planner",
      title: "Planner",
      route: "/spaces/space-b/planner",
      scopeKey: "space:space-b",
    });
    const spaceBTab2 = useWorkspaceStore.getState().addSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: "Terminal",
      route: "/terminal",
    });

    expect(allLayoutViews(useWorkspaceStore.getState().layout).map((t) => t.id)).toEqual([
      spaceBTab1.id,
      spaceBTab2.id,
    ]);

    // 3. Switch back to Space A - Space A's tabs are restored
    useWorkspaceStore.getState().setScope("space:space-a");
    expect(allLayoutViews(useWorkspaceStore.getState().layout).map((t) => t.id)).toEqual([
      spaceATab1.id,
      spaceATab2.id,
    ]);

    // 4. Switch back to Space B - Space B's tabs are restored
    useWorkspaceStore.getState().setScope("space:space-b");
    expect(allLayoutViews(useWorkspaceStore.getState().layout).map((t) => t.id)).toEqual([
      spaceBTab1.id,
      spaceBTab2.id,
    ]);
  });

  it("preserves an Agents tab in a space when switching back and forth", () => {
    const store = useWorkspaceStore.getState();

    // 1. Space A has only an Agents tab
    store.setScope("space:space-a");
    const agentsTab = store.addSurface({
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Agents",
      route: "/agents",
    });
    expect(allLayoutViews(useWorkspaceStore.getState().layout).map((t) => t.surfaceId)).toEqual([
      "home",
      "agents",
    ]);

    // 2. Switch to Space B and open Journal
    useWorkspaceStore.getState().setScope("space:space-b");
    useWorkspaceStore.getState().addSurface({
      surfaceId: "space",
      groupKey: "space:space-b:journal",
      title: "Journal",
      route: "/spaces/space-b/notes",
      scopeKey: "space:space-b",
    });

    // 3. Switch back to Space A
    useWorkspaceStore.getState().setScope("space:space-a");
    const tabsInA = allLayoutViews(useWorkspaceStore.getState().layout);
    expect(tabsInA.map((t) => t.surfaceId)).toEqual(["home", "agents"]);
    expect(tabsInA.find((tab) => tab.surfaceId === "agents")?.id).toBe(agentsTab.id);
  });
});
