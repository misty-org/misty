import { describe, expect, it } from "vitest";
import { createDockLeaf, dockTreeViews } from "../panes/dockTree";
import type { WorkspaceView } from "../tabs/workspaceViews";
import {
  collectUnrestoredViews,
  migrateRetiredWorkspaceView,
  migrateRetiredWorkspaceViews,
} from "./workspaceMigrations";
import { allLayoutViews } from "../panes/layoutTabs";
import { migrateWorkspaceStore } from "../tabs/workspaceStorePersistence";

/** A person's web page as old windows saved it. */
const legacyPage = (url: string) => ({ version: 1, url, faviconUrl: null });

/** Saved views may still carry surfaces this build no longer renders. */
type LegacyViewOverrides = Omit<Partial<WorkspaceView>, "surfaceId" | "groupKey"> & {
  surfaceId?: string;
  groupKey?: string;
};

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
  it.each(["home", "code", "terminal", "marketplace", "files", "official-app", "transfers"])(
    "drops a saved %s view, whose tool is gone",
    (surfaceId) => {
      const tab = legacyTab({ surfaceId, state: { savedDocument: "recovery-data" } });
      expect(migrateRetiredWorkspaceView(tab)).toBeNull();
      expect(tab.state).toEqual({ savedDocument: "recovery-data" });
    },
  );
  it("drops a person's saved web page, however old its shape", () => {
    for (const groupKey of ["tool:browser", "app:browser"] as const)
      expect(
        migrateRetiredWorkspaceView(
          legacyTab({
            surfaceId: "browser",
            groupKey,
            route: "/browser",
            state: { ...legacyPage("https://example.com/report"), agentOwned: true },
            title: "Report",
          }),
        ),
      ).toBeNull();
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
  it("loads a layout without its retired views, keeping the rest and its focus", () => {
    const files = legacyTab({
      id: "files",
      surfaceId: "files",
      groupKey: "app:files",
      state: { path: "/Users/ada" },
      route: "/apps/files",
    });
    const web = legacyTab({
      id: "web",
      surfaceId: "browser",
      groupKey: "tool:browser",
      route: "/browser",
      state: legacyPage("https://example.com/"),
    });
    const agents = legacyTab({
      id: "agents",
      surfaceId: "agents",
      groupKey: "tool:agents",
      route: "/agents?run=run-1",
    });
    const kept = { ...createDockLeaf([agents]), id: "pane:kept" };
    const gone = { ...createDockLeaf([web]), id: "pane:gone" };
    const split = {
      type: "split" as const,
      id: "split",
      direction: "horizontal" as const,
      ratio: 0.5,
      first: gone,
      second: { ...kept, history: { entries: [web, agents], index: 1 } },
    };
    const layout = {
      root: split,
      focusedPaneId: gone.id,
      tabs: [
        { id: "layout:files", root: createDockLeaf([files]), focusedPaneId: "x" },
        { id: "layout:split", root: split, focusedPaneId: gone.id },
      ],
      activeTabId: "layout:files",
    };
    const migrated = migrateWorkspaceStore(
      {
        layout,
        closedItems: [
          { view: web, windowId: "w", paneId: "p" },
          { view: agents, windowId: "w", paneId: "p", tab: layout.tabs[0] },
          { view: agents, windowId: "w", paneId: "pane:kept", tab: layout.tabs[1] },
        ],
      },
      18,
    );
    // The tab that held only Files is gone, so the one left is in front, as one pane.
    expect(migrated.layout.tabs!.map((tab) => tab.id)).toEqual(["layout:split"]);
    expect(migrated.layout.activeTabId).toBe("layout:split");
    expect(migrated.layout.root).toMatchObject({ type: "leaf", id: "pane:kept" });
    expect(migrated.layout.focusedPaneId).toBe("pane:kept");
    expect(allLayoutViews(migrated.layout).map((view) => view.id)).toEqual(["agents"]);
    expect(JSON.stringify(migrated.layout)).not.toContain("example.com");
    // Only what can still be reopened stays in the closed list.
    expect(migrated.closedItems).toHaveLength(1);
    expect(dockTreeViews(migrated.closedItems[0].tab!.root).map((view) => view.id)).toEqual([
      "agents",
    ]);
  });
  it("leaves a window that held only web pages with no tabs", () => {
    const web = legacyTab({
      surfaceId: "browser",
      groupKey: "tool:browser",
      route: "/browser",
      state: legacyPage("https://example.com/"),
    });
    const pane = createDockLeaf([web]);
    const layout = { root: pane, focusedPaneId: pane.id };
    const migrated = migrateWorkspaceStore(
      {
        activeScopeKey: "global",
        layout,
        layoutsByScope: { global: layout },
        virtualWindowsByScope: {},
        closedTabs: [web],
        closedVirtualWindowsByScope: {},
      },
      6,
    );
    expect(allLayoutViews(migrated.layout)).toEqual([]);
    expect(migrated.layout.tabs).toHaveLength(1);
    expect(migrated.closedItems).toEqual([]);
    expect(allLayoutViews(migrateRetiredWorkspaceViews(layout))).toEqual([]);
    // What it saves next loads the same way.
    expect(allLayoutViews(migrateWorkspaceStore({ layout: migrated.layout }, 19).layout)).toEqual(
      [],
    );
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

it.each(["/extensions", "/extensions/installed", "/extensions/addon/607454"])(
  "drops a saved Extensions page at %s",
  (route) => {
    expect(
      migrateRetiredWorkspaceView(
        legacyTab({ surfaceId: "extensions", groupKey: "tool:extensions", title: "Ext", route }),
      ),
    ).toBeNull();
  },
);

it("migrates a saved Scheduled tab into Agents", () => {
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
    route: "/agents",
  });
});

it("drops retired views that lost their route instead of failing the whole workspace", () => {
  expect(
    migrateRetiredWorkspaceView(legacyTab({ route: undefined as unknown as string })),
  ).toBeNull();
  const agents = legacyTab({
    surfaceId: "agents",
    groupKey: "tool:agents",
    route: undefined as unknown as string,
  });
  expect(migrateRetiredWorkspaceView(agents)).toMatchObject({
    surfaceId: "agents",
    route: "/agents",
  });
});

it("puts an Agents placeholder where a damaged view was, and reports it", () => {
  const damaged = legacyTab({
    id: "damaged",
    title: "Broken",
    surfaceId: "agents",
    route: "http://[",
  });
  const { result, skipped } = collectUnrestoredViews(() => migrateRetiredWorkspaceView(damaged));
  expect(result).toMatchObject({
    id: "damaged",
    surfaceId: "agents",
    route: "/agents",
    placeholder: true,
  });
  expect(skipped).toMatchObject([{ id: "damaged", title: "Broken" }]);
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
    route: "/agents",
  });
});

it("loads a window saved with tab groups, pinned tabs and bookmarks, without them", () => {
  const agents = (id: string) =>
    legacyTab({
      id,
      instanceKey: id,
      surfaceId: "agents",
      groupKey: "tool:agents",
      route: "/agents",
    });
  const pane = (id: string) => ({ ...createDockLeaf([agents(id)]), id: `pane:${id}` });
  const tab = (id: string, extra: object) => ({
    id: `layout:${id}`,
    root: pane(id),
    focusedPaneId: `pane:${id}`,
    ...extra,
  });
  const tabs = [
    tab("pinned", { pinnedUrl: "https://example.com/" }),
    tab("grouped", { tabGroupId: "tabgroup:work", title: "Kept name" }),
    tab("plain", {}),
  ];
  const saved = {
    layout: {
      root: tabs[1].root,
      focusedPaneId: "pane:grouped",
      tabs,
      activeTabId: "layout:grouped",
    },
    activeWindowId: "w1",
    tabGroups: [
      { id: "tabgroup:work", name: "Work", color: "blue", collapsed: true },
      {
        id: "tabgroup:closed",
        name: "Closed",
        color: "red",
        collapsed: false,
        savedTabs: [tabs[2]],
      },
    ],
    migratedTabGroupIds: ["group:bookmarks"],
    bookmarkFolders: [
      {
        kind: "folder",
        id: "f",
        fields: { label: "Reading", icon: "folder", order: 0, hidden: false },
      },
    ],
    bookmarks: [
      {
        kind: "bookmark",
        id: "b",
        fields: {
          folder_id: "f",
          title: "Example",
          url: "https://example.com/",
          order: 0,
          pinned: true,
        },
      },
    ],
    expandedBookmarkFolders: { f: true },
    selectedBookmarkByFolder: { f: "b" },
    lastUsedViewByGroup: { "tool:agents": "grouped" },
    closedItems: [
      {
        view: agents("closed"),
        windowId: "w1",
        paneId: "pane:closed",
        tab: tab("closed", { pinnedUrl: "https://example.com/", tabGroupId: "tabgroup:work" }),
      },
    ],
  };
  const migrated = migrateWorkspaceStore(JSON.parse(JSON.stringify(saved)), 18);
  for (const retired of [
    "tabGroups",
    "migratedTabGroupIds",
    "bookmarkFolders",
    "bookmarks",
    "expandedBookmarkFolders",
    "selectedBookmarkByFolder",
  ])
    expect(retired in migrated).toBe(false);
  const loaded = migrated.layout.tabs!;
  expect(loaded.map((item) => item.id)).toEqual([
    "layout:pinned",
    "layout:grouped",
    "layout:plain",
  ]);
  expect(loaded.map((item) => dockTreeViews(item.root).map((view) => view.id))).toEqual([
    ["pinned"],
    ["grouped"],
    ["plain"],
  ]);
  expect(loaded[1].title).toBe("Kept name");
  expect(migrated.layout.activeTabId).toBe("layout:grouped");
  expect(migrated.lastUsedViewByGroup).toEqual({ "tool:agents": "grouped" });
  expect(migrated.closedItems).toHaveLength(1);
  const text = JSON.stringify(migrated);
  expect(text).not.toContain("pinnedUrl");
  expect(text).not.toContain("tabGroupId");
  // Loading what it saved again changes nothing.
  expect(migrateWorkspaceStore(JSON.parse(text), 19)).toEqual(JSON.parse(text));
});
