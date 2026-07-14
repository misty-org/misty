import { useNavigate } from "react-router-dom";
import type { SearchResult } from "../../api/types";
import { useAppStore } from "../../stores/useAppStore";
import { useExplorerStore } from "../../stores/useExplorerStore";
import { useMultiPanelStore } from "../../shared/multipanel/useMultiPanelStore";
import { LibraryWorkspace } from "../Files/components/LibraryWorkspace";
import { revealSearchResultInPane } from "../Files/utils/searchNavigation";
import { searchResultNavigationTarget } from "../Files/utils/searchNavigation";

export default function LibraryPage() {
  const navigate = useNavigate();
  const homePath = useAppStore((state) => state.app?.environment.homeDir ?? "");
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);

  const openResult = async (result: SearchResult) => {
    const paneId = activePaneId || Object.keys(useExplorerStore.getState().panes)[0];
    if (paneId) await revealSearchResultInPane(paneId, searchResultNavigationTarget(result));
    navigate("/files");
  };

  return (
    <div className="h-full min-h-0 overflow-hidden bg-[var(--misty-app-page-bg,#07090b)]">
      <LibraryWorkspace paneId={activePaneId} workingDirectory={homePath} onOpenResult={openResult} />
    </div>
  );
}
