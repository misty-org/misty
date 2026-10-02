import type { WorkspaceStore } from "./useWorkspaceStore";
import type { WorkspaceScopeKey } from "./model";
import { partialWorkspaceStore } from "./workspaceStorePersistence";

/** Keep the live temporary workspace selected, with restored windows alongside
 * it. Never replace tabs the user opened while the recovery store was offline. */
export function mergeRecoveredWorkspace(
  recovered: Partial<WorkspaceStore>,
  current: WorkspaceStore,
  baseline: Partial<WorkspaceStore>,
): Partial<WorkspaceStore> {
  const live = partialWorkspaceStore(current);
  const windows = { ...recovered.windowsByScope };
  for (const scope of Object.keys(live.windowsByScope ?? {}) as WorkspaceScopeKey[]) {
    const added = live.windowsByScope?.[scope] ?? [];
    const ids = new Set(added.map((window) => window.id));
    windows[scope] = [...(windows[scope] ?? []).filter((window) => !ids.has(window.id)), ...added];
  }
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
    layoutsByScope: { ...recovered.layoutsByScope, ...live.layoutsByScope },
    windowsByScope: windows,
    activeWindowIdByScope: {
      ...recovered.activeWindowIdByScope,
      ...live.activeWindowIdByScope,
    },
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
    closedWindowsByScope: {
      ...recovered.closedWindowsByScope,
      ...current.closedWindowsByScope,
    },
  };
}
