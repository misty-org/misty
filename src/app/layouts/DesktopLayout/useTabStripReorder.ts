import { useWorkspaceStore } from "@/features/workspace";
import type { WorkspaceTab } from "@/features/workspace/model";
import type { MistyTabGroup } from "@/features/workspace/tabGroups";
import { tabLabel } from "@/features/workspace/layoutTabs";
import { usePointerReorder } from "@/shared/hooks/usePointerReorder";
import { useCallback, type RefObject } from "react";
import { groupName } from "./MistyTabGroups";

/** Drag and keyboard reordering of tabs and group headers in the strip. */
export function useTabStripReorder({
  groups,
  tabs,
  allTabs,
  tabListRef,
}: {
  groups: MistyTabGroup[];
  tabs: WorkspaceTab[];
  allTabs: WorkspaceTab[];
  tabListRef: RefObject<HTMLDivElement | null>;
}) {
  const reorder = usePointerReorder({
    scope: "workspace-layout-tabs",
    animate: true,
    axis: "y",
    getDrag: (id) => {
      if (id.startsWith("group-header:")) {
        const group = groups.find((g) => `group-header:${g.id}` === id);
        return group
          ? {
              id,
              label: groupName(group),
              ids: [id, ...tabs.filter((tab) => tab.tabGroupId === group.id).map((tab) => tab.id)],
            }
          : null;
      }
      const tab = allTabs.find((tab) => tab.id === id);
      return tab ? { id, label: tabLabel(tab) } : null;
    },
    onDrop: (drag, target, after) =>
      useWorkspaceStore.getState().moveTabGroupItem(drag.id, target, after),
    onKeyboardMove: (id, direction) => {
      const items = Array.from(
        tabListRef.current?.querySelectorAll<HTMLElement>("[data-reorder-item]") ?? [],
      ).map((item) => item.dataset.reorderItem!);
      const members = new Set(
        id.startsWith("group-header:")
          ? allTabs.filter((tab) => `group-header:${tab.tabGroupId}` === id).map((tab) => tab.id)
          : [],
      );
      let index = items.indexOf(id) + direction;
      while (members.has(items[index])) index += direction;
      const target = items[index];
      if (target) useWorkspaceStore.getState().moveTabGroupItem(id, target, direction > 0);
    },
  });
  const reorderRef = reorder.ref;
  const bindTabList = useCallback(
    (node: HTMLDivElement | null) => {
      tabListRef.current = node;
      reorderRef(node);
    },
    [reorderRef, tabListRef],
  );
  return { reorder, bindTabList };
}
