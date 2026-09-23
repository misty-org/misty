import { describe, expect, it } from "vitest";
import { createDockLeaf, dockTabs } from "./dockTree";
import { createBrowserTabState, type WorkspaceTab } from "./model";
import { migrateRetiredWorkspaceTab, migrateRetiredWorkspaceTabs } from "./workspaceMigrations";
import { migrateWorkspaceStore } from "./workspaceStorePersistence";

function legacyTab(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    id: "saved-tab",
    instanceKey: "saved-tab",
    surfaceId: "home",
    groupKey: "tool:home",
    title: "Home",
    route: "/home",
    sidebarVisible: false,
    state: {},
    createdAt: 1,
    lastFocusedAt: 2,
    ...overrides,
  };
}

describe("browser workspace migration", () => {
  it.each(["home", "space", "code", "terminal", "marketplace"] as const)(
    "replaces retired %s views without changing tab identity",
    (surfaceId) => {
      const tab = legacyTab({ surfaceId, state: { savedDocument: "recovery-data" } });
      expect(migrateRetiredWorkspaceTab(tab, "space:family")).toMatchObject({
        id: tab.id,
        surfaceId: "browser",
        route: "/browser",
        groupKey: "tool:browser",
        state: { url: "https://www.google.com" },
        createdAt: 1,
        lastFocusedAt: 2,
      });
      expect(tab.state).toEqual({ savedDocument: "recovery-data" });
    },
  );
  it.each(["files", "official-app"] as const)(
    "preserves %s Files state and selections",
    (surfaceId) => {
      const tab = legacyTab({
        surfaceId,
        groupKey: "app:files",
        route: "/apps/files?path=%2FUsers%2Fada&select=notes.txt",
        title: "Documents",
        state: { directory: "/Users/ada", selected: ["notes.txt"] },
      });
      const migrated = migrateRetiredWorkspaceTab(tab);
      expect(migrated).toMatchObject({
        ...tab,
        surfaceId: "files",
        groupKey: "tool:files",
        route: "/files?path=%2FUsers%2Fada&select=notes.txt",
      });
      expect(migrateRetiredWorkspaceTab(migrated)).toEqual(migrated);
    },
  );
  it("preserves browser URLs and website identity", () => {
    const tab = legacyTab({
      surfaceId: "browser",
      groupKey: "app:browser",
      state: { ...createBrowserTabState("https://example.com/report"), websiteId: "saved-website" },
      title: "Report",
    });
    expect(migrateRetiredWorkspaceTab(tab)).toMatchObject({
      id: tab.id,
      state: tab.state,
      title: "Report",
    });
  });
  it("preserves saved agent run links", () => {
    expect(
      migrateRetiredWorkspaceTab(
        legacyTab({
          surfaceId: "official-app",
          groupKey: "app:agents",
          route: "/apps/agents?run=run-1",
        }),
      ),
    ).toMatchObject({ surfaceId: "agents", route: "/agents?run=run-1" });
  });
  it("upgrades persisted layout contents while preserving focus and Files data", () => {
    const tab = legacyTab({
      surfaceId: "files",
      groupKey: "app:files",
      state: { path: "/Users/ada" },
      route: "/apps/files",
    });
    const pane = createDockLeaf([tab]);
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
    expect(dockTabs(migrated.layout.root)[0]).toMatchObject({
      id: tab.id,
      surfaceId: "files",
      state: tab.state,
    });
    expect(migrated.layout.focusedPaneId).toBe(pane.id);
    expect(dockTabs(migrateRetiredWorkspaceTabs(layout).root)[0].surfaceId).toBe("files");
  });
});

it("preserves restored Space tabs during persistence migration", () => {
  const tab = legacyTab({
    surfaceId: "space",
    route: "/spaces/project/notes?note=one",
    groupKey: "space:project:notes",
  });
  expect(migrateRetiredWorkspaceTab(tab)).toEqual(tab);
});
