import { describe, expect, it } from "vitest";
import { createDockLeaf, dockTabs } from "./dockTree";
import type { WorkspaceTab } from "./model";
import { migrateRetiredWorkspaceTabs, migrateSpaceToolTabs } from "./workspaceMigrations";
import { migrateWorkspaceStore } from "./workspaceStorePersistence";

function legacyHomeTab(): WorkspaceTab {
  return {
    id: "tab:legacy-home",
    surfaceId: "home",
    groupKey: "tool:home",
    instanceKey: "home",
    title: "Home",
    route: "/home",
    sidebarVisible: false,
    state: {},
    createdAt: 1,
    lastFocusedAt: 1,
  };
}

function retiredSearchTab(): WorkspaceTab {
  return {
    ...legacyHomeTab(),
    id: "tab:legacy-search",
    surfaceId: "search",
    groupKey: "tool:search",
    instanceKey: "search",
    title: "Search",
    route: "/search",
  } as unknown as WorkspaceTab;
}

describe("workspace surface migration", () => {
  it("keeps a restored Home tab intact", () => {
    const pane = createDockLeaf([legacyHomeTab()]);
    const migrated = migrateRetiredWorkspaceTabs({ root: pane, focusedPaneId: pane.id }, "global");

    expect(dockTabs(migrated.root)[0]).toMatchObject({
      id: "tab:legacy-home",
      surfaceId: "home",
      groupKey: "tool:home",
      title: "Home",
      route: "/home",
    });
  });

  it("moves an unknown legacy surface in a Space to the Space placeholder", () => {
    const pane = createDockLeaf([retiredSearchTab()]);
    const migrated = migrateRetiredWorkspaceTabs(
      { root: pane, focusedPaneId: pane.id },
      "space:family",
    );

    expect(dockTabs(migrated.root)[0]).toMatchObject({
      id: "tab:legacy-search",
      surfaceId: "space",
      groupKey: "space:family",
      instanceKey: "family",
      title: "Space",
      route: "/spaces/family/notes",
    });
  });

  it("rewrites retired surfaces while upgrading the persisted dock store", () => {
    const pane = createDockLeaf([retiredSearchTab()]);
    const layout = { root: pane, focusedPaneId: pane.id };
    const migrated = migrateWorkspaceStore(
      {
        activeScopeKey: "global",
        layout,
        layoutsByScope: { global: layout },
        virtualWindowsByScope: {},
        closedTabs: [],
        closedVirtualWindowsByScope: {},
      },
      6,
    );

    expect(dockTabs(migrated.layout.root)[0].surfaceId).toBe("inbox");
    expect(dockTabs(migrated.layoutsByScope.global!.root)[0].surfaceId).toBe("inbox");
  });

  it("moves saved Chat tabs into the Social group and canonical route", () => {
    const pane = createDockLeaf([
      {
        ...legacyHomeTab(),
        id: "tab:legacy-chat",
        surfaceId: "space",
        groupKey: "space:family:chat",
        instanceKey: "family:chat",
        title: "Chat",
        route: "/spaces/family/chat?conversation=one",
      },
    ]);
    const migrated = migrateSpaceToolTabs({ root: pane, focusedPaneId: pane.id });
    expect(dockTabs(migrated.root)[0]).toMatchObject({
      groupKey: "space:family:social",
      instanceKey: "family:social",
      title: "Social",
      route: "/spaces/family/social/misty?conversation=one",
    });
  });

  it("moves saved Social provider queries onto separate provider pages", () => {
    const pane = createDockLeaf([
      {
        ...legacyHomeTab(),
        id: "tab:legacy-instagram",
        surfaceId: "space",
        groupKey: "space:family:social",
        instanceKey: "family:social",
        title: "Social",
        route: "/spaces/family/social?provider=instagram&conversation=one",
      },
    ]);
    const migrated = migrateSpaceToolTabs({ root: pane, focusedPaneId: pane.id });
    expect(dockTabs(migrated.root)[0]?.route).toBe(
      "/spaces/family/social/instagram?conversation=one",
    );
  });

  it("preserves prepared Messenger and X provider pages", () => {
    const pane = createDockLeaf([
      {
        ...legacyHomeTab(),
        id: "tab:x",
        surfaceId: "space",
        groupKey: "space:family:social",
        instanceKey: "family:social",
        title: "Social",
        route: "/spaces/family/social/x?conversation=direct-one",
      },
    ]);
    const migrated = migrateSpaceToolTabs({ root: pane, focusedPaneId: pane.id });
    expect(dockTabs(migrated.root)[0]?.route).toBe(
      "/spaces/family/social/x?conversation=direct-one",
    );
  });
});
