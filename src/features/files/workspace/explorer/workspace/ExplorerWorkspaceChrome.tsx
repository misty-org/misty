import { transfersPath } from "../../../transfers/transferModel";
import type { MultiPanelTab } from "@/features/workspace";
import { useMultiPanelStore } from "@/features/workspace";
import { useMultiPanelStoreContext } from "@/features/workspace/MultiPanelWorkspace";
import { ExplorerBottomBar } from "./ExplorerWorkspaceUtils";

export function resolveExplorerBottomBarRenderer(_embedded?: boolean) {
  // The outer dock owns tabs, but does not supply Files panel controls.
  return renderExplorerBottomBar;
}

export function renderExplorerBottomBar(tab: MultiPanelTab) {
  return tab.path === transfersPath ? null : <ExplorerTabBottomBar tab={tab} />;
}

function ExplorerTabBottomBar({ tab }: { tab: MultiPanelTab }) {
  const store = useMultiPanelStoreContext() ?? useMultiPanelStore;
  return (
    <ExplorerBottomBar
      sidebarVisible={tab.sidebarVisible ?? true}
      previewVisible={tab.previewVisible ?? true}
      onToggleSidebar={() =>
        store
          .getState()
          .setTabPanelVisibility(tab.id, { sidebarVisible: !(tab.sidebarVisible ?? true) })
      }
      onTogglePreview={() =>
        store
          .getState()
          .setTabPanelVisibility(tab.id, { previewVisible: !(tab.previewVisible ?? true) })
      }
    />
  );
}
