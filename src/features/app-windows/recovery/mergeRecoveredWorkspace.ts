import type { WorkspaceStore } from "../tabs/useWorkspaceStore";
import { layoutTabs } from "../panes/layoutTabs";
import { partialWorkspaceStore } from "../tabs/workspaceStorePersistence";

/** Keep the live temporary workspace selected, with the restored tabs added beside
 * it. Never replace tabs the user opened while the recovery store was offline. */
export function mergeRecoveredWorkspace(
  recovered: Partial<WorkspaceStore>,
  current: WorkspaceStore,
): Partial<WorkspaceStore> {
  const live = partialWorkspaceStore(current);
  const liveTabs = layoutTabs(current.layout);
  const ids = new Set(liveTabs.map((tab) => tab.id));
  const restoredTabs = recovered.layout
    ? layoutTabs(recovered.layout).filter((tab) => !ids.has(tab.id))
    : [];
  const layout = { ...current.layout, tabs: [...restoredTabs, ...liveTabs] };
  return {
    ...recovered,
    ...live,
    layout,
    activeWindowId: current.activeWindowId,
    closedItems: [...(recovered.closedItems ?? []), ...current.closedItems],
  };
}
