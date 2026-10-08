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
  it.each(["home", "space", "code", "terminal", "marketplace"] as const)(
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
    "replaces retired %s Files views with a browser tab without changing identity",
    (surfaceId) => {
      const tab = legacyTab({
        surfaceId,
        groupKey: "app:files",
        route: "/apps/files?path=%2FUsers%2Fada&select=notes.txt",
        title: "Documents",
        state: { directory: "/Users/ada", selected: ["notes.txt"] },
      });
      // Files moved to Kura, a separate app.
      const migrated = migrateRetiredWorkspaceView(tab);
      expect(migrated).toMatchObject({
        id: tab.id,
        surfaceId: "browser",
        groupKey: "tool:browser",
        route: "/browser",
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
  it("upgrades persisted layout contents while preserving focus", () => {
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
      surfaceId: "browser",
    });
    expect(migrated.layout.focusedPaneId).toBe(pane.id);
    expect(dockTreeViews(migrateRetiredWorkspaceViews(layout).root)[0].surfaceId).toBe("browser");
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

it.each([
  "/extensions",
  "/extensions?category=privacy-security",
  "/extensions?category=tabs#results",
  "/extensions#results",
  "/extensions/installed",
  "/extensions/addon/607454",
])("preserves the Extensions workspace at %s instead of opening Google", (route) => {
  const tab = legacyTab({
    surfaceId: "extensions",
    groupKey: "tool:extensions",
    title: "Extensions",
    route,
  });
  expect(migrateRetiredWorkspaceView(tab)).toEqual(tab);
  const pane = createDockLeaf([tab]);
  const migrated = migrateRetiredWorkspaceViews({ root: pane, focusedPaneId: pane.id });
  expect(dockTreeViews(migrated.root)).toEqual([tab]);
});

it("restores Extensions views that lost their route", () => {
  expect(
    migrateRetiredWorkspaceView(
      legacyTab({
        surfaceId: "extensions",
        groupKey: "tool:extensions",
        route: undefined as unknown as string,
      }),
    ),
  ).toMatchObject({ surfaceId: "extensions", route: "/extensions" });
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
  expect(migrateRetiredWorkspaceView(home)).toMatchObject({
    surfaceId: "browser",
    route: "/browser",
  });
  const files = legacyTab({
    surfaceId: "files" as WorkspaceView["surfaceId"],
    groupKey: "tool:files" as WorkspaceView["groupKey"],
    title: "Files",
    route: undefined as unknown as string,
  });
  // Files moved to Kura; a saved Files view becomes a new browser tab.
  expect(migrateRetiredWorkspaceView(files)).toMatchObject({
    surfaceId: "browser",
    route: "/browser",
  });
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

it("restores retired Transfers views as browser tabs without losing their identity", () => {
  const tab = legacyTab({
    surfaceId: "transfers",
    groupKey: "tool:transfers" as WorkspaceView["groupKey"],
    route: "/transfers",
    title: "Transfers",
  });
  const restored = migrateRetiredWorkspaceView(tab);
  expect(restored).toMatchObject({ id: tab.id, surfaceId: "browser", route: "/browser" });
  expect(migrateRetiredWorkspaceView(restored)).toEqual(restored);
});
