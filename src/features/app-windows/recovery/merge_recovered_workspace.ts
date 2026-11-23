import type { WorkspaceStore } from "../tabs/use_workspace_store";
import { layoutTabs } from "../panes/layout_tabs";
import { partialWorkspaceStore } from "../tabs/workspace_store_persistence";

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
