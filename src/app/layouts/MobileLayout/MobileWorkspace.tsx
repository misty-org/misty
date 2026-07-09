import {
  WorkspaceTabTitleProvider,
  dockLeaves,
  useWorkspaceStore,
} from "@/features/workspace/core";
import { MobileWorkspaceSurface } from "./MobileWorkspaceSurface";

export function MobileWorkspace() {
  const activeTab = useWorkspaceStore((state) => {
    const panes = dockLeaves(state.layout.root);
    const pane = panes.find((candidate) => candidate.id === state.layout.focusedPaneId) ?? panes[0];
    return pane?.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane?.tabs[0] ?? null;
  });

  if (!activeTab) return null;

  return (
    <div className="h-full min-h-0 w-full overflow-hidden bg-charcoal-bg" data-mobile-workspace>
      <WorkspaceTabTitleProvider tabId={activeTab.id}>
        <MobileWorkspaceSurface tab={activeTab} active />
      </WorkspaceTabTitleProvider>
    </div>
  );
}
