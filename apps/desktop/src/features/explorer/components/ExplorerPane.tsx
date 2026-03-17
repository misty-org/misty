import { useEffect } from "react";
import { FileBrowser } from "./FileBrowser";
import { useExplorerStore } from "../state/useExplorerStore";

interface ExplorerPaneProps {
  paneId: string;
  path: string;
}

export function ExplorerPane(props: ExplorerPaneProps) {
  const {
    panes,
    viewMode,
    navigatePane,
    selectEntry,
    openEntry,
  } = useExplorerStore();
  const pane = panes[props.paneId];
  const listing = pane?.listing ?? null;

  useEffect(() => {
    if (!listing || listing.path !== props.path) {
      void navigatePane(props.paneId, props.path);
    }
  }, [listing, navigatePane, props.paneId, props.path]);

  return (
    <div className="explorer-pane-shell">
      <FileBrowser
        listing={listing}
        selectedIds={pane?.selectedIds ?? []}
        loading={pane?.loading ?? false}
        error={pane?.error ?? null}
        viewMode={viewMode}
        onSelect={(entryId) => selectEntry(props.paneId, entryId)}
        onOpen={(entry) => void openEntry(props.paneId, entry)}
      />
    </div>
  );
}
