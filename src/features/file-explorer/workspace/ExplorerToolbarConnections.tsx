import { useTransfersStore } from "@/features/transfers";
import { maxMultiPanelPanes, useMultiPanelStore } from "@/features/workspace";
import type { FileEntry, PluginCommandEntry } from "@/services/misty/model/misty-api";
import { Button } from "@/shared/ui";
import { Columns2, PanelTopClose, Rows2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ExplorerLocationResult } from "../components/ExplorerToolbar";
import { ExplorerPaneToolbarActions, ExplorerToolbar } from "../components/ExplorerToolbar";
import { FileInspector } from "../components/FileInspector";
import type { ExplorerSearchNavigationTarget } from "../model/interfaces/utils/searchNavigation";
import type { ExplorerSortColumn } from "../store";
import {
  selectedEntriesForPane,
  selectedEntryForPane,
  useExplorerStore,
  useOperationQueueStore,
} from "../store";
import { revealSearchResultInPane } from "../utils/searchNavigation";
import {
  newestUndoableTransfer,
  redoLatestTransferOperation,
  runExplorerCommand,
  runPluginCommand,
  transferTypeLabel,
  undoLatestTransferOperation,
} from "./ExplorerCommands";
import { explorerShellStyles } from "./ExplorerShellStyles";

export const ConnectedExplorerToolbar = memo(function ConnectedExplorerToolbar(props: {
  paneId: string;
  fallbackPath: string;
  locationResults: ExplorerLocationResult[];
  pluginCommands: PluginCommandEntry[];
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
        hasRemoteSelection: selectedEntries.some((entry) => entry.location.kind === "remote"),
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
    })),
  );
  const transfers = useTransfersStore((transferState) => transferState.transfers);
  const latestUndoable = useMemo(
    () => newestUndoableTransfer(transfers?.rows ?? []),
    [transfers?.rows],
  );
  const canUndo = Boolean(latestUndoable) && !operationQueue.working;
  const canRedo = Boolean(operationQueue.snapshot?.redoAvailable) && !operationQueue.working;
  const undoTitle = latestUndoable
    ? `Undo ${latestUndoable.fileName || transferTypeLabel(latestUndoable.transferType)}`
    : "Undo";

  useEffect(() => {
    const refreshHistory = () => {
      void useTransfersStore.getState().load(undefined, { silent: true });
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
  const pluginCommandById = useMemo(
    () => new Map(props.pluginCommands.map((command) => [command.id, command])),
    [props.pluginCommands],
  );
  const onRunCommand = useCallback(
    (commandId: string) => {
      const pluginCommand = pluginCommandById.get(commandId);
      if (pluginCommand) {
        void runPluginCommand(pluginCommand, props.paneId, props.onNavigateRoute);
        return;
      }
      runExplorerCommand(commandId, props.paneId, props.onNavigateRoute);
    },
    [pluginCommandById, props.onNavigateRoute, props.paneId],
  );

  return (
    <ExplorerToolbar
      {...state}
      paneId={props.paneId}
      locationResults={props.locationResults}
      pluginCommands={props.pluginCommands}
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

export const ExplorerPaneHeaderActions = memo(function ExplorerPaneHeaderActions(props: {
  paneId: string;
}) {
  return (
    <div className={explorerShellStyles.paneHeaderActions}>
      <div className={explorerShellStyles.paneHeaderActionSection}>
        <ExplorerPaneControls paneId={props.paneId} />
      </div>
      <ConnectedExplorerPaneToolbarActions paneId={props.paneId} />
    </div>
  );
});

const ConnectedExplorerPaneToolbarActions = memo(
  function ConnectedExplorerPaneToolbarActions(props: { paneId: string }) {
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
          hasRemoteSelection: selectedEntries.some((entry) => entry.location.kind === "remote"),
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
  },
);

const ExplorerPaneControls = memo(function ExplorerPaneControls(props: { paneId: string }) {
  const { tabs, activeTabId, splitPane, closePane } = useMultiPanelStore(
    useShallow((state) => ({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      splitPane: state.splitPane,
      closePane: state.closePane,
    })),
  );
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const paneCount = activeTab?.panes.length ?? 0;
  const paneIsInActiveTab = Boolean(activeTab?.panes.some((pane) => pane.id === props.paneId));
  const canSplit = paneIsInActiveTab && paneCount < maxMultiPanelPanes();
  const canClose = paneIsInActiveTab && paneCount > 1;

  return (
    <>
      <Button
        className={explorerShellStyles.paneActionButton}
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Split vertically"
        onClick={() => splitPane(props.paneId, "vertical")}
        disabled={!canSplit}
      >
        <Columns2 size={15} />
      </Button>
      <Button
        className={explorerShellStyles.paneActionButton}
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Split horizontally"
        onClick={() => splitPane(props.paneId, "horizontal")}
        disabled={!canSplit}
      >
        <Rows2 size={15} />
      </Button>
      <Button
        className={explorerShellStyles.paneActionButton}
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Close pane"
        onClick={() => closePane(props.paneId)}
        disabled={!canClose}
      >
        <PanelTopClose size={15} />
      </Button>
    </>
  );
});

export const ConnectedFileInspector = memo(function ConnectedFileInspector() {
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
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
