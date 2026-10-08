import type { WorkspaceStore } from "./useWorkspaceStore";
import { layoutTabs } from "./layoutTabs";
import { partialWorkspaceStore } from "./workspaceStorePersistence";

/** Keep the live temporary workspace selected, with the restored tabs added beside
 * it. Never replace tabs the user opened while the recovery store was offline. */
export function mergeRecoveredWorkspace(
  recovered: Partial<WorkspaceStore>,
  current: WorkspaceStore,
  baseline: Partial<WorkspaceStore>,
): Partial<WorkspaceStore> {
  const live = partialWorkspaceStore(current);
  const liveTabs = layoutTabs(current.layout);
  const ids = new Set(liveTabs.map((tab) => tab.id));
  const restoredTabs = recovered.layout
    ? layoutTabs(recovered.layout).filter((tab) => !ids.has(tab.id))
    : [];
  const layout = { ...current.layout, tabs: [...restoredTabs, ...liveTabs] };
  const records = <T extends { id: string }>(saved: T[], live: T[], initial: T[]) => {
    const result = new Map(saved.map((record) => [record.id, record]));
    for (const record of live) {
      const before = initial.find((item) => item.id === record.id);
      if (!result.has(record.id) || JSON.stringify(before) !== JSON.stringify(record))
        result.set(record.id, record);
    }
    return [...result.values()];
  };
  return {
    ...recovered,
    ...live,
    layout,
    layoutsByScope: {
      ...recovered.layoutsByScope,
      ...live.layoutsByScope,
      [current.activeScopeKey]: layout,
    },
    activeWindowId: current.activeWindowId,
    tabGroups: records(
      recovered.tabGroups ?? [],
      current.tabGroups,
      baseline.tabGroups ?? [],
    ).filter(
      (group) =>
        !baseline.tabGroups?.some((old) => old.id === group.id) ||
        current.tabGroups.some((live) => live.id === group.id),
    ),
    migratedTabGroupIds: [
      ...new Set([...(recovered.migratedTabGroupIds ?? []), ...current.migratedTabGroupIds]),
    ],
    bookmarkFolders: records(
      recovered.bookmarkFolders ?? [],
      current.bookmarkFolders,
      baseline.bookmarkFolders ?? [],
    ),
    bookmarks: records(recovered.bookmarks ?? [], current.bookmarks, baseline.bookmarks ?? []),
    expandedBookmarkFolders: {
      ...recovered.expandedBookmarkFolders,
      ...current.expandedBookmarkFolders,
    },
    selectedBookmarkByFolder: {
      ...recovered.selectedBookmarkByFolder,
      ...current.selectedBookmarkByFolder,
    },
    closedItems: [...(recovered.closedItems ?? []), ...current.closedItems],
  };
}
