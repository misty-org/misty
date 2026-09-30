import { layoutTabs } from "@/features/workspace/layoutTabs";
import type { WorkspaceTab, WorkspaceWindow } from "@/features/workspace/model";
import {
  tabGroupColors,
  type MistyTabGroup,
  type TabGroupColor,
} from "@/features/workspace/tabGroups";
import { upgradeWorkspaceShape } from "@/features/workspace/workspaceShapeUpgrade";
import type { SharedRecord } from "./model";

/** Tab groups as sync records. An open group lives in its workspace with the
 * tabs it holds; a closed (saved) group is kept in the vault's collections so
 * it can be reopened on any device. Collapsing is local to each machine. */
export function tabGroupRecords(
  windows: WorkspaceWindow[],
  groups: MistyTabGroup[],
): SharedRecord[] {
  const members = new Map<string, string[]>();
  for (const window of windows)
    for (const tab of layoutTabs(window.layout))
      if (tab.tabGroupId)
        members.set(tab.tabGroupId, [...(members.get(tab.tabGroupId) ?? []), tab.id]);
  return groups.map((group, order): SharedRecord =>
    group.savedTabs
      ? {
          kind: "saved_tab_group",
          id: group.id,
          fields: {
            name: group.name,
            color: group.color,
            order,
            tabs: JSON.stringify(group.savedTabs),
          },
        }
      : {
          kind: "tab_group",
          id: group.id,
          fields: {
            name: group.name,
            color: group.color,
            order,
            tab_ids: members.get(group.id) ?? [],
          },
        },
  );
}

const color = (value: string): TabGroupColor =>
  value in tabGroupColors ? (value as TabGroupColor) : "gray";

/** The synced groups, keeping each one's local collapsed state, and which
 * group each tab belongs to. */
export function projectTabGroups(
  records: SharedRecord[],
  local: MistyTabGroup[],
): { tabGroups: MistyTabGroup[]; groupOfTab: Map<string, string> } {
  const previous = new Map(local.map((group) => [group.id, group]));
  const groupOfTab = new Map<string, string>();
  const synced = records
    .filter(
      (record): record is SharedRecord<"tab_group" | "saved_tab_group"> =>
        record.kind === "tab_group" || record.kind === "saved_tab_group",
    )
    .sort((a, b) => a.fields.order - b.fields.order || (a.id < b.id ? -1 : 1));
  const tabGroups = synced.map((record): MistyTabGroup => {
    const base = {
      id: record.id,
      name: record.fields.name,
      color: color(record.fields.color),
      scopeKey: previous.get(record.id)?.scopeKey ?? "global",
      collapsed: previous.get(record.id)?.collapsed ?? false,
    };
    if (record.kind === "tab_group") {
      for (const tab of record.fields.tab_ids) groupOfTab.set(tab, record.id);
      return base;
    }
    let savedTabs: WorkspaceTab[] = [];
    try {
      // Saved by any device, possibly before the Tab/View field names.
      const parsed: unknown = upgradeWorkspaceShape(JSON.parse(record.fields.tabs));
      if (Array.isArray(parsed)) savedTabs = parsed as WorkspaceTab[];
    } catch {
      // A saved group that cannot be read reopens empty rather than failing sync.
    }
    return { ...base, savedTabs };
  });
  return { tabGroups, groupOfTab };
}
