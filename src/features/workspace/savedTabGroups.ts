import type { SharedRecord } from "@/features/workspace/profileRecordModel";
import type { WorkspaceTab } from "./model";
import { tabGroupColors, type MistyTabGroup, type TabGroupColor } from "./tabGroups";
import { upgradeWorkspaceShape } from "./workspaceShapeUpgrade";

/** A closed (saved) tab group as a record of its profile. Open groups stay with their window. */
export function savedGroupRecords(groups: MistyTabGroup[]): SharedRecord<"saved_tab_group">[] {
  return groups
    .filter((group) => group.savedTabs)
    .map((group, order) => ({
      kind: "saved_tab_group" as const,
      id: group.id,
      fields: {
        name: group.name,
        color: group.color,
        order,
        tabs: JSON.stringify(group.savedTabs),
      },
    }));
}

const color = (value: string): TabGroupColor =>
  value in tabGroupColors ? (value as TabGroupColor) : "gray";

/** The profile's saved groups, keeping whether each is collapsed here. */
export function savedGroupsFromRecords(
  records: SharedRecord[],
  local: MistyTabGroup[],
): MistyTabGroup[] {
  const previous = new Map(local.map((group) => [group.id, group]));
  return records
    .filter(
      (record): record is SharedRecord<"saved_tab_group"> => record.kind === "saved_tab_group",
    )
    .sort((a, b) => a.fields.order - b.fields.order || (a.id < b.id ? -1 : 1))
    .filter((record) => {
      // A group this window reopened meanwhile stays open.
      const here = previous.get(record.id);
      return !here || here.savedTabs;
    })
    .map((record) => {
      let savedTabs: WorkspaceTab[] = [];
      try {
        // Saved by any window, possibly before the Tab/View field names.
        const parsed: unknown = upgradeWorkspaceShape(JSON.parse(record.fields.tabs));
        if (Array.isArray(parsed)) savedTabs = parsed as WorkspaceTab[];
      } catch {
        // A saved group that cannot be read reopens empty.
      }
      return {
        id: record.id,
        name: record.fields.name,
        color: color(record.fields.color),
        collapsed: previous.get(record.id)?.collapsed ?? false,
        savedTabs,
      };
    });
}
