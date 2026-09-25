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
  const windows = { ...recovered.virtualWindowsByScope };
  for (const scope of Object.keys(live.virtualWindowsByScope ?? {}) as WorkspaceScopeKey[]) {
    const added = live.virtualWindowsByScope?.[scope] ?? [];
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
    virtualWindowsByScope: windows,
    activeVirtualWindowIdByScope: {
      ...recovered.activeVirtualWindowIdByScope,
      ...live.activeVirtualWindowIdByScope,
    },
    websiteGroups: records(
      recovered.websiteGroups ?? [],
      current.websiteGroups,
      baseline.websiteGroups ?? [],
    ),
    savedWebsites: records(
      recovered.savedWebsites ?? [],
      current.savedWebsites,
      baseline.savedWebsites ?? [],
    ),
    expandedWebsiteGroups: { ...recovered.expandedWebsiteGroups, ...current.expandedWebsiteGroups },
    selectedWebsiteByGroup: {
      ...recovered.selectedWebsiteByGroup,
      ...current.selectedWebsiteByGroup,
    },
    closedTabs: [...(recovered.closedTabs ?? []), ...current.closedTabs],
    closedVirtualWindowsByScope: {
      ...recovered.closedVirtualWindowsByScope,
      ...current.closedVirtualWindowsByScope,
    },
  };
}
