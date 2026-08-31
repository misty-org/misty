import { beforeEach, describe, expect, it } from "vitest";
import { dockTabs } from "./dockTree";
import { useWorkspaceStore } from "./useWorkspaceStore";

describe("useWorkspaceStore - space scoping", () => {
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
    const spaceATab2 = store.openBrowserTab({ url: "https://example-a.com" });

    expect(dockTabs(useWorkspaceStore.getState().layout.root).map((t) => t.id)).toEqual([
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
    const spaceBTab2 = useWorkspaceStore.getState().openSurface({
      surfaceId: "terminal",
      groupKey: "tool:terminal",
      title: "Terminal",
      route: "/terminal",
    });

    expect(dockTabs(useWorkspaceStore.getState().layout.root).map((t) => t.id)).toEqual([
      spaceBTab1.id,
      spaceBTab2.id,
    ]);

    // 3. Switch back to Space A - Space A's tabs are restored
    useWorkspaceStore.getState().setScope("space:space-a");
    expect(dockTabs(useWorkspaceStore.getState().layout.root).map((t) => t.id)).toEqual([
      spaceATab1.id,
      spaceATab2.id,
    ]);

    // 4. Switch back to Space B - Space B's tabs are restored
    useWorkspaceStore.getState().setScope("space:space-b");
    expect(dockTabs(useWorkspaceStore.getState().layout.root).map((t) => t.id)).toEqual([
      spaceBTab1.id,
      spaceBTab2.id,
    ]);
  });

  it("preserves an Inbox tab in a space when switching back and forth", () => {
    const store = useWorkspaceStore.getState();

    // 1. Space A has only an Inbox tab
    store.setScope("space:space-a");
    const inboxTab = store.openSurface({
      surfaceId: "inbox",
      groupKey: "tool:inbox",
      title: "Inbox",
      route: "/inbox",
    });
    expect(dockTabs(useWorkspaceStore.getState().layout.root).map((t) => t.surfaceId)).toEqual([
      "inbox",
    ]);

    // 2. Switch to Space B and open Journal
    useWorkspaceStore.getState().setScope("space:space-b");
    useWorkspaceStore.getState().openSurface({
      surfaceId: "space",
      groupKey: "space:space-b:journal",
      title: "Journal",
      route: "/spaces/space-b/notes",
      scopeKey: "space:space-b",
    });

    // 3. Switch back to Space A
    useWorkspaceStore.getState().setScope("space:space-a");
    const tabsInA = dockTabs(useWorkspaceStore.getState().layout.root);
    expect(tabsInA.map((t) => t.surfaceId)).toEqual(["inbox"]);
    expect(tabsInA[0].id).toBe(inboxTab.id);
  });
});
