import { useOperationQueueStore } from "../store/useOperationQueueStore";
import { useMultiPanelStore } from "@/features/workspace";
import type { FileEntry } from "@/native/ipc";
import { memo, useCallback, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ExplorerLocationResult } from "../components/ExplorerToolbar";
import { ExplorerPaneToolbarActions, ExplorerToolbar } from "../components/ExplorerToolbar";
import { FileInspector } from "../components/FileInspector";
import type { ExplorerSearchNavigationTarget } from "../model/interfaces/utils/searchNavigation";
import type { ExplorerSortColumn } from "../store";
import { selectedEntriesForPane, selectedEntryForPane, useExplorerStore } from "../store";
import { revealSearchResultInPane } from "../utils/searchNavigation";
import {
  redoLatestTransferOperation,
  runExplorerCommand,
  transferTypeLabel,
  undoLatestTransferOperation,
} from "./ExplorerCommands";

export const ConnectedExplorerToolbar = memo(function ConnectedExplorerToolbar(props: {
  paneId: string;
  fallbackPath: string;
  locationResults: ExplorerLocationResult[];
  onNavigateRoute: (path: string) => void;
}) {
  const state = useExplorerStore(
    useShallow((explorer) => {
      const pane = explorer.panes[props.paneId];
      const selectedEntries = selectedEntriesForPane(pane).filter((entry) => !entry.isDeleted);
      const selectedEntry = selectedEntries.length === 1 ? selectedEntries[0] : null;
      return {
        path: pane?.listing?.path ?? props.fallbackPath,
        commandQuery: pane?.commandQuery ?? "",
        commandQueryMode: pane?.commandQueryMode ?? "search",
        viewMode: explorer.paneViewModes[props.paneId] ?? explorer.viewMode,
        sort: explorer.paneSorts[props.paneId] ?? explorer.sort,
        showHidden: explorer.paneShowHidden[props.paneId] ?? explorer.showHidden,
        selectedCount: selectedEntries.length,
        selectedEntryPath: selectedEntry?.path ?? null,
        hasRemoteSelection: selectedEntries.some((entry) => entry.location.kind === "peer_device"),
        canOpenWithSelected: Boolean(
          selectedEntry && selectedEntry.kind !== "folder" && selectedEntry.kind !== "symlink",
        ),
        canCalculateDirectorySizes: Boolean(pane?.hasFolderEntries),
        backPath: pane?.backHistory[pane.backHistory.length - 1] ?? null,
        forwardPath: pane?.forwardHistory[pane.forwardHistory.length - 1] ?? null,
        parentPath: pane?.listing?.parentPath ?? null,
        canCreateFile: explorer.canCreateItem(props.paneId, "file"),
        canCreateFolder: explorer.canCreateItem(props.paneId, "folder"),
      };
    }),
  );
  const operationQueue = useOperationQueueStore(
    useShallow((queue) => ({
      snapshot: queue.snapshot,
      working: queue.working,
      latestUndoable: queue.latestUndoable,
    })),
  );
  const latestUndoable = operationQueue.latestUndoable;
  const canUndo = Boolean(latestUndoable) && !operationQueue.working;
  const canRedo = Boolean(operationQueue.snapshot?.redoAvailable) && !operationQueue.working;
  const undoTitle = latestUndoable
    ? `Undo ${latestUndoable.fileName || transferTypeLabel(latestUndoable.transferType)}`
    : "Undo";

  useEffect(() => {
    const refreshHistory = () => {
      void useOperationQueueStore.getState().load({ silent: true });
    };
    refreshHistory();
    const interval = window.setInterval(refreshHistory, 5000);
    return () => window.clearInterval(interval);
  }, []);

  const onNavigate = useCallback(
    (path: string) => {
      void useExplorerStore.getState().navigatePane(props.paneId, path);
    },
    [props.paneId],
  );
  const onNavigateLocation = useCallback(
    (path: string) => {
      void useExplorerStore.getState().navigatePane(props.paneId, path);
    },
    [props.paneId],
  );
  const onNavigateSearchResult = useCallback(
    (target: ExplorerSearchNavigationTarget) => {
      void revealSearchResultInPane(props.paneId, target);
    },
    [props.paneId],
  );
  const onBack = useCallback(() => {
    void useExplorerStore.getState().navigateBack(props.paneId);
  }, [props.paneId]);
  const onForward = useCallback(() => {
    void useExplorerStore.getState().navigateForward(props.paneId);
  }, [props.paneId]);
  const onParent = useCallback(() => {
    void useExplorerStore.getState().navigateParent(props.paneId);
  }, [props.paneId]);
  const onCommandQuery = useCallback(
    (query: string) => {
      useExplorerStore.getState().setCommandQuery(props.paneId, query);
    },
    [props.paneId],
  );
  const onCommandQueryMode = useCallback(
    (mode: "search" | "filter") => {
      useExplorerStore.getState().setCommandQueryMode(props.paneId, mode);
    },
    [props.paneId],
  );
  const onViewMode = useCallback(
    (mode: "grid" | "list") => {
      useExplorerStore.getState().setViewMode(mode, props.paneId);
    },
    [props.paneId],
  );
  const onSort = useCallback(
    (column: ExplorerSortColumn) => {
      useExplorerStore.getState().setSort(column, props.paneId);
    },
    [props.paneId],
  );
  const onToggleHidden = useCallback(() => {
    void useExplorerStore.getState().toggleHidden(props.paneId);
  }, [props.paneId]);
  const onRefresh = useCallback(() => {
    void useExplorerStore.getState().refreshPane(props.paneId);
  }, [props.paneId]);
  const onCalculateDirectorySizes = useCallback(() => {
    void useExplorerStore
      .getState()
      .calculatePaneDirectorySizes(props.paneId, { force: true, notify: true });
  }, [props.paneId]);
  const onCreateFile = useCallback(() => {
    void useExplorerStore.getState().createItem(props.paneId, "file");
  }, [props.paneId]);
  const onCreateFolder = useCallback(() => {
    void useExplorerStore.getState().createItem(props.paneId, "folder");
  }, [props.paneId]);
  const onCut = useCallback(() => {
    useExplorerStore.getState().cutSelected(props.paneId);
  }, [props.paneId]);
  const onCopy = useCallback(() => {
    useExplorerStore.getState().copySelected(props.paneId);
  }, [props.paneId]);
  const onPaste = useCallback(() => {
    void useExplorerStore.getState().pasteIntoPane(props.paneId);
  }, [props.paneId]);
  const onRename = useCallback(() => {
    void useExplorerStore.getState().renameSelected(props.paneId);
  }, [props.paneId]);
  const onDelete = useCallback(() => {
    void useExplorerStore.getState().deleteSelected(props.paneId);
  }, [props.paneId]);
  const onDownload = useCallback(() => {
    void useExplorerStore.getState().downloadSelected(props.paneId);
  }, [props.paneId]);
  const onOpenWith = useCallback(() => {
    void useExplorerStore.getState().openWithSelected(props.paneId);
  }, [props.paneId]);
  const onCopyPath = useCallback((path: string) => {
    void useExplorerStore.getState().copyPath(path);
  }, []);
  const onUndo = useCallback(() => {
    void undoLatestTransferOperation();
  }, []);
  const onRedo = useCallback(() => {
    void redoLatestTransferOperation();
  }, []);
  const onRunCommand = useCallback(
    (commandId: string) => {
      runExplorerCommand(commandId, props.paneId, props.onNavigateRoute);
    },
    [props.onNavigateRoute, props.paneId],
  );

  return (
    <ExplorerToolbar
      {...state}
      paneId={props.paneId}
      locationResults={props.locationResults}
      trailingActions={<ConnectedExplorerToolbarActions paneId={props.paneId} />}
      onNavigate={onNavigate}
      onNavigateLocation={onNavigateLocation}
      onNavigateSearchResult={onNavigateSearchResult}
      onBack={onBack}
      onForward={onForward}
      canUndo={canUndo}
      canRedo={canRedo}
      undoTitle={undoTitle}
      redoTitle="Redo"
      onParent={onParent}
      onCommandQuery={onCommandQuery}
      onCommandQueryMode={onCommandQueryMode}
      onViewMode={onViewMode}
      onSort={onSort}
      onToggleHidden={onToggleHidden}
      onRefresh={onRefresh}
      onCalculateDirectorySizes={onCalculateDirectorySizes}
      onCreateFile={onCreateFile}
      onCreateFolder={onCreateFolder}
      onCut={onCut}
      onCopy={onCopy}
      onPaste={onPaste}
      onRename={onRename}
      onDelete={onDelete}
      onDownload={onDownload}
      onOpenWith={onOpenWith}
      onCopyPath={onCopyPath}
      onUndo={onUndo}
      onRedo={onRedo}
      onRunCommand={onRunCommand}
    />
  );
});

const ConnectedExplorerToolbarActions = memo(function ConnectedExplorerToolbarActions(props: {
  paneId: string;
}) {
  const state = useExplorerStore(
    useShallow((explorer) => {
      const pane = explorer.panes[props.paneId];
      const selectedEntries = selectedEntriesForPane(pane).filter((entry) => !entry.isDeleted);
      const selectedEntry = selectedEntries.length === 1 ? selectedEntries[0] : null;
      return {
        path: pane?.listing?.path ?? "",
        viewMode: explorer.paneViewModes[props.paneId] ?? explorer.viewMode,
        itemScale: explorer.paneFileItemScales[props.paneId] ?? explorer.fileItemScale,
        sort: explorer.paneSorts[props.paneId] ?? explorer.sort,
        showHidden: explorer.paneShowHidden[props.paneId] ?? explorer.showHidden,
        selectedCount: selectedEntries.length,
        selectedEntryPath: selectedEntry?.path ?? null,
        hasRemoteSelection: selectedEntries.some((entry) => entry.location.kind === "peer_device"),
        canOpenWithSelected: Boolean(
          selectedEntry && selectedEntry.kind !== "folder" && selectedEntry.kind !== "symlink",
        ),
        canCalculateDirectorySizes: Boolean(pane?.hasFolderEntries),
      };
    }),
  );
  const onViewMode = useCallback(
    (mode: "grid" | "list") => {
      useExplorerStore.getState().setViewMode(mode, props.paneId);
    },
    [props.paneId],
  );
  const onItemScale = useCallback(
    (scale: number) => {
      useExplorerStore.getState().setFileItemScale(scale, props.paneId);
    },
    [props.paneId],
  );
  const onSort = useCallback(
    (column: ExplorerSortColumn) => {
      useExplorerStore.getState().setSort(column, props.paneId);
    },
    [props.paneId],
  );
  const onToggleHidden = useCallback(() => {
    void useExplorerStore.getState().toggleHidden(props.paneId);
  }, [props.paneId]);
  const onRefresh = useCallback(() => {
    void useExplorerStore.getState().refreshPane(props.paneId);
  }, [props.paneId]);
  const onCalculateDirectorySizes = useCallback(() => {
    void useExplorerStore
      .getState()
      .calculatePaneDirectorySizes(props.paneId, { force: true, notify: true });
  }, [props.paneId]);
  const onDownload = useCallback(() => {
    void useExplorerStore.getState().downloadSelected(props.paneId);
  }, [props.paneId]);
  const onOpenWith = useCallback(() => {
    void useExplorerStore.getState().openWithSelected(props.paneId);
  }, [props.paneId]);
  const onCopyPath = useCallback((path: string) => {
    void useExplorerStore.getState().copyPath(path);
  }, []);

  return (
    <ExplorerPaneToolbarActions
      {...state}
      onViewMode={onViewMode}
      onItemScale={onItemScale}
      onSort={onSort}
      onToggleHidden={onToggleHidden}
      onRefresh={onRefresh}
      onCalculateDirectorySizes={onCalculateDirectorySizes}
      onDownload={onDownload}
      onOpenWith={onOpenWith}
      onCopyPath={onCopyPath}
    />
  );
});

export const ConnectedFileInspector = memo(function ConnectedFileInspector(props: {
  paneId?: string;
}) {
  const fallbackPaneId = useMultiPanelStore((state) => state.activePaneId);
  const activePaneId = props.paneId ?? fallbackPaneId;
  const { directorySizes, listing, selectedEntry, selectedCount } = useExplorerStore(
    useShallow((state) => {
      const pane = state.panes[activePaneId];
      const selectedCount = pane?.selectedIds.length ?? 0;
      const selectedEntry = selectedCount === 1 ? selectedEntryForPane(pane) : null;
      return {
        directorySizes: state.directorySizes,
        listing: pane?.listing ?? null,
        selectedEntry,
        selectedCount,
      };
    }),
  );
  const onOpenEntry = useCallback(
    (entry: FileEntry) => {
      if (!activePaneId) return;
      void useExplorerStore.getState().openEntry(activePaneId, entry);
    },
    [activePaneId],
  );
  const onPreviewSaved = useCallback(() => {
    if (!activePaneId) return;
    void useExplorerStore.getState().refreshPane(activePaneId);
  }, [activePaneId]);
  return (
    <FileInspector
      directorySizes={directorySizes}
      listing={listing}
      selectedEntry={selectedEntry}
      selectedCount={selectedCount}
      onOpenEntry={onOpenEntry}
      onPreviewSaved={onPreviewSaved}
    />
  );
});
