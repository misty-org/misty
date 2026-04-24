import type { MultiPanelTab } from "@/models/interfaces/workspace";
import { useMultiPanelStore } from "@/features/workspace";
import { isChromeTabPath } from "./explorerPlugins/tabPaths";
import { ExplorerBottomBar } from "./ExplorerWorkspaceUtils";

export function resolveExplorerBottomBarRenderer(embedded?: boolean) {
  return embedded ? undefined : renderExplorerBottomBar;
}

export function renderExplorerBottomBar(tab: MultiPanelTab) {
  if (isChromeTabPath(tab.path)) return null;
  return (
    <ExplorerBottomBar
      sidebarVisible={tab.sidebarVisible ?? true}
      previewVisible={tab.previewVisible ?? true}
      onToggleSidebar={() =>
        useMultiPanelStore
          .getState()
          .setTabPanelVisibility(tab.id, { sidebarVisible: !(tab.sidebarVisible ?? true) })
      }
      onTogglePreview={() =>
        useMultiPanelStore
          .getState()
          .setTabPanelVisibility(tab.id, { previewVisible: !(tab.previewVisible ?? true) })
      }
    />
  );
}
