import { describe, expect, it } from "vitest";
import { createDockLeaf, dockTreeViews } from "./dockTree";
import { createBrowserViewState, type WorkspaceView } from "./model";
import { migrateRetiredWorkspaceView, migrateRetiredWorkspaceViews } from "./workspaceMigrations";
import { migrateWorkspaceStore } from "./workspaceStorePersistence";

/** Saved views may still carry surfaces this build no longer renders. */
type LegacyViewOverrides = Omit<Partial<WorkspaceView>, "surfaceId"> & { surfaceId?: string };

function legacyTab(overrides: LegacyViewOverrides = {}): WorkspaceView {
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
  } as WorkspaceView;
}

describe("browser workspace migration", () => {
  it.each(["space", "code", "terminal", "marketplace"] as const)(
    "replaces retired %s views without changing tab identity",
    (surfaceId) => {
      const tab = legacyTab({ surfaceId, state: { savedDocument: "recovery-data" } });
      expect(migrateRetiredWorkspaceView(tab, "space:family")).toMatchObject({
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
      const migrated = migrateRetiredWorkspaceView(tab);
      expect(migrated).toMatchObject({
        ...tab,
        surfaceId: "files",
        groupKey: "tool:files",
        route: "/files?path=%2FUsers%2Fada&select=notes.txt",
      });
      expect(migrateRetiredWorkspaceView(migrated)).toEqual(migrated);
    },
  );
  it("preserves browser URLs and website identity", () => {
    const tab = legacyTab({
      surfaceId: "browser",
      groupKey: "app:browser",
      state: {
        ...createBrowserViewState("https://example.com/report"),
        websiteId: "saved-website",
      },
      title: "Report",
    });
    expect(migrateRetiredWorkspaceView(tab)).toMatchObject({
      id: tab.id,
      state: {
        ...createBrowserViewState("https://example.com/report"),
        bookmarkId: "saved-website",
      },
      title: "Report",
    });
  });
  it("preserves saved agent run links", () => {
    expect(
      migrateRetiredWorkspaceView(
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
    expect(dockTreeViews(migrated.layout.root)[0]).toMatchObject({
      id: tab.id,
      surfaceId: "files",
      state: tab.state,
    });
    expect(migrated.layout.focusedPaneId).toBe(pane.id);
    expect(dockTreeViews(migrateRetiredWorkspaceViews(layout).root)[0].surfaceId).toBe("files");
  });
});

it("preserves restored Space tabs during persistence migration", () => {
  const tab = legacyTab({
    surfaceId: "space",
    route: "/spaces/project/notes?note=one",
    groupKey: "space:project:notes",
  });
  expect(migrateRetiredWorkspaceView(tab)).toEqual(tab);
});

it("preserves Home as a supported workspace surface", () => {
  const home = legacyTab();
  expect(migrateRetiredWorkspaceView(home)).toEqual(home);
});

it("migrates a saved Scheduled tab into Agents without losing its selected task", () => {
  const migrated = migrateRetiredWorkspaceView(
    legacyTab({
      surfaceId: "scheduled",
      groupKey: "tool:scheduled",
      route: "/scheduled?task=weekly",
    }),
  );
  expect(migrated).toMatchObject({
    id: "saved-tab",
    surfaceId: "agents",
    groupKey: "tool:agents",
    route: "/agents?task=weekly&view=scheduled",
  });
});

it("restores saved views that lost their route instead of failing the whole workspace", () => {
  const home = legacyTab({ route: undefined as unknown as string });
  expect(migrateRetiredWorkspaceView(home)).toMatchObject({ surfaceId: "home", route: "/home" });
  const files = legacyTab({
    surfaceId: "files",
    groupKey: "tool:files",
    title: "Files",
    route: undefined as unknown as string,
  });
  expect(migrateRetiredWorkspaceView(files)).toMatchObject({ surfaceId: "files", route: "/files" });
});

it("restores a route-less Scheduled view into the current Agents collection", () => {
  expect(
    migrateRetiredWorkspaceView(
      legacyTab({
        surfaceId: "scheduled",
        groupKey: "tool:scheduled",
        route: undefined as unknown as string,
      }),
    ),
  ).toMatchObject({
    surfaceId: "agents",
    groupKey: "tool:agents",
    route: "/agents?view=scheduled",
  });
});
