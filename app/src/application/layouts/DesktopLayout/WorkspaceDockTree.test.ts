import type { WorkspaceTab } from "@/features/workspace";
import { describe, expect, it } from "vitest";
import { groupTabs } from "./WorkspaceDockTree";

describe("workspace tab groups", () => {
  it("shows Space tools as independent Journal, Planner, Chat, and Library tabs", () => {
    const tabs = [
      spaceTab("journal", "Journal", "/spaces/one/notes"),
      spaceTab("planner", "Planner", "/spaces/one/planner/tasks/board"),
      spaceTab("chat", "Chat", "/spaces/one/chat"),
      spaceTab("library", "Library", "/spaces/one/library"),
    ];

    expect(groupTabs(tabs)).toMatchObject([
      { key: "space:one:journal", label: "Journal", tabs: [{ id: "tab:journal" }] },
      { key: "space:one:planner", label: "Planner", tabs: [{ id: "tab:planner" }] },
      { key: "space:one:chat", label: "Chat", tabs: [{ id: "tab:chat" }] },
      { key: "space:one:library", label: "Library", tabs: [{ id: "tab:library" }] },
    ]);
  });
});

function spaceTab(
  tool: "journal" | "planner" | "chat" | "library",
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
