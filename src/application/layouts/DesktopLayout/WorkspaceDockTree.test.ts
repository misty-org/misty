import type { WorkspaceTab } from "@/features/workspace";
import { describe, expect, it } from "vitest";
import { groupTabs, tabForGroupedShortcut } from "./WorkspaceDockTree";

describe("workspace tab groups", () => {
  it("keeps each Space tool in its own tab group", () => {
    const tabs = [
      spaceTab("journal", "Journal", "/spaces/one/notes"),
      spaceTab("planner", "Planner", "/spaces/one/planner/tasks/board"),
      spaceTab("social", "Chat", "/spaces/one/social"),
      spaceTab("library", "Library", "/spaces/one/library"),
    ];

    expect(groupTabs(tabs)).toMatchObject([
      {
        key: "space:one:journal",
        surfaceId: "space",
        label: "Journal",
        contextLabel: "Space · Journal",
        tabs: [{ id: "tab:journal", title: "Journal" }],
      },
      {
        key: "space:one:planner",
        surfaceId: "space",
        label: "Planner",
        contextLabel: "Space · Planner",
        tabs: [{ id: "tab:planner", title: "Planner" }],
      },
      {
        key: "space:one:social",
        surfaceId: "space",
        label: "Social",
        contextLabel: "Space · Social",
        tabs: [{ id: "tab:social", title: "Chat" }],
      },
      {
        key: "space:one:library",
        surfaceId: "space",
        label: "Library",
        contextLabel: "Space · Library",
        tabs: [{ id: "tab:library", title: "Library" }],
      },
    ]);
  });

  it("separates legacy Space tabs that shared one persisted group key", () => {
    const tabs = [
      spaceTab("journal", "Journal", "/spaces/one/notes"),
      spaceTab("planner", "Planner", "/spaces/one/planner/tasks/board"),
      spaceTab("social", "Chat", "/spaces/one/social"),
      spaceTab("library", "Library", "/spaces/one/library"),
    ].map((tab) => ({ ...tab, groupKey: "space:one" as const }));

    expect(groupTabs(tabs).map((group) => group.key)).toEqual([
      "space:one:journal",
      "space:one:planner",
      "space:one:social",
      "space:one:library",
    ]);
  });

  it("groups multiple browser tabs together into a single tab group", () => {
    const tabs: WorkspaceTab[] = [
      browserTab("tab-1", "Google", "https://google.com"),
      browserTab("tab-2", "GitHub", "https://github.com"),
      browserTab("tab-3", "Misty", "https://misty.com"),
    ];

    expect(groupTabs(tabs)).toMatchObject([
      {
        key: "tool:browser",
        surfaceId: "browser",
        label: "Browser",
        tabs: [{ id: "tab-1" }, { id: "tab-2" }, { id: "tab-3" }],
      },
    ]);
  });

  it("labels persisted catalog tabs as Discover", () => {
    const tabs: WorkspaceTab[] = [
      {
        ...browserTab("store", "Legacy catalog", ""),
        surfaceId: "marketplace",
        groupKey: "tool:marketplace",
        route: "/store",
      },
    ];

    expect(groupTabs(tabs)[0]).toMatchObject({
      surfaceId: "marketplace",
      label: "Discover",
      contextLabel: "Discover",
    });
  });

  it("maps numeric shortcuts to visible groups rather than hidden group members", () => {
    const tabs: WorkspaceTab[] = [
      browserTab("browser-a", "A", "https://a.example"),
      browserTab("browser-b", "B", "https://b.example"),
      {
        ...browserTab("terminal-a", "Terminal", ""),
        surfaceId: "terminal",
        groupKey: "tool:terminal",
      },
    ];
    expect(tabForGroupedShortcut(tabs, 0, { "tool:browser": "browser-b" })?.id).toBe("browser-b");
    expect(tabForGroupedShortcut(tabs, 1, {})?.id).toBe("terminal-a");
    expect(tabForGroupedShortcut(tabs, "last", {})?.id).toBe("terminal-a");
  });
});

function browserTab(id: string, title: string, url: string): WorkspaceTab {
  return {
    id,
    surfaceId: "browser",
    groupKey: "tool:browser",
    instanceKey: id,
    title,
    route: "/browser",
    sidebarVisible: true,
    state: { url },
    createdAt: 1,
    lastFocusedAt: 1,
  };
}

function spaceTab(
  tool: "journal" | "planner" | "social" | "library",
  title: string,
  route: string,
): WorkspaceTab {
  return {
    id: `tab:${tool}`,
    surfaceId: "space",
    groupKey: `space:one:${tool}`,
    instanceKey: `one:${tool}`,
    title,
    route,
    sidebarVisible: true,
    state: {},
    createdAt: 1,
    lastFocusedAt: 1,
  };
}
