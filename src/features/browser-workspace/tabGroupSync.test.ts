import { describe, expect, it } from "vitest";
import type { WorkspaceTab, WorkspaceWindow } from "@/features/workspace/model";
import type { MistyTabGroup } from "@/features/workspace/tabGroups";
import { projectTabGroups, tabGroupRecords } from "./tabGroupSync";

const layout = (id: string, tabGroupId?: string): WorkspaceTab => ({
  id,
  root: { type: "leaf", id: `pane:${id}`, views: [], activeViewId: null },
  focusedPaneId: `pane:${id}`,
  tabGroupId,
});
const window = (layouts: WorkspaceTab[]): WorkspaceWindow => ({
  id: "window:a",
  title: "Work",
  createdAt: 0,
  lastFocusedAt: 0,
  layout: {
    root: layouts[0].root,
    focusedPaneId: layouts[0].focusedPaneId,
    tabs: layouts,
    activeTabId: layouts[0].id,
  },
});
const group = (id: string, extra: Partial<MistyTabGroup> = {}): MistyTabGroup => ({
  id,
  name: id,
  color: "blue",
  scopeKey: "global",
  collapsed: false,
  ...extra,
});

describe("tab group sync", () => {
  it("records open groups with their tabs and closed groups with their saved tabs", () => {
    const windows = [window([layout("l1", "g1"), layout("l2"), layout("l3", "g1")])];
    const saved = [layout("saved-1")];
    const records = tabGroupRecords(windows, [group("g1"), group("g2", { savedTabs: saved })]);
    expect(records).toEqual([
      {
        kind: "tab_group",
        id: "g1",
        fields: { name: "g1", color: "blue", order: 0, tab_ids: ["l1", "l3"] },
      },
      {
        kind: "saved_tab_group",
        id: "g2",
        fields: { name: "g2", color: "blue", order: 1, tabs: JSON.stringify(saved) },
      },
    ]);
  });

  it("projects synced groups back, keeping each machine's collapsed state", () => {
    const windows = [window([layout("l1", "g1"), layout("l2", "g1")])];
    const saved = [layout("saved-1")];
    const records = tabGroupRecords(windows, [group("g1"), group("g2", { savedTabs: saved })]);
    const { tabGroups, groupOfTab } = projectTabGroups(records, [group("g1", { collapsed: true })]);
    expect(tabGroups.map((g) => [g.id, g.collapsed])).toEqual([
      ["g1", true],
      ["g2", false],
    ]);
    expect(tabGroups[1].savedTabs).toEqual(saved);
    expect(Object.fromEntries(groupOfTab)).toEqual({ l1: "g1", l2: "g1" });
  });

  it("reopens an unreadable saved group empty instead of failing", () => {
    const { tabGroups } = projectTabGroups(
      [
        {
          kind: "saved_tab_group",
          id: "g",
          fields: { name: "g", color: "violet", order: 0, tabs: "{" },
        },
      ],
      [],
    );
    expect(tabGroups[0]).toMatchObject({ savedTabs: [], color: "gray" });
  });
});
