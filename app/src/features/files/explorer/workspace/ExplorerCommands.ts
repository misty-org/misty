export { newestUndoableTransfer, transferTypeLabel } from "./explorerCommands/transferLabels";
import { useTransfersStore } from "@/features/transfers";
import { dockLeaves, useMultiPanelStore, useWorkspaceStore } from "@/features/workspace";
import {
  operationQueueRedo,
  operationQueueUndo,
  pluginCommandRun,
  transfersSnapshot,
} from "@/features/files/native";
import type { PluginCommandEntry } from "@/native/contracts";
import { errorText } from "@/shared/lib/format";
import { selectedPathsForPane, useExplorerStore, useOperationQueueStore } from "../store";
import { openCompareWith } from "./ExplorerContextMenu";
import { useSearchStore } from "@/features/files/search";
import { openTransfersTab, toggleActiveTabPanelVisibility } from "./ExplorerDesktopPlugins";
import { applySharedClipboardToSystem } from "./explorerCommands/clipboardPayloads";
import {
  newestUndoableTransfer,
  publishSharedClipboard,
  transferTypeLabel,
} from "./explorerCommands/transferLabels";

const explorerDuplicateFinderEvent = "misty:explorer-duplicate-finder";

export const executableShortcutCommands = [
  "app.toggle_transfers",
  "app.toggle_plugin_launcher",
  "clipboard.publish_shared",
  "clipboard.apply_shared",
  "explorer.new_folder",
  "explorer.search",
  "explorer.copy",
  "explorer.cut",
  "explorer.paste",
  "explorer.copy_path",
  "explorer.undo",
  "explorer.redo",
  "explorer.delete",
  "explorer.download",
  "explorer.rename",
  "explorer.batch_rename",
  "explorer.duplicate_finder",
  "explorer.compare_with",
  "explorer.open_with",
  "explorer.refresh",
  "explorer.toggle_hidden",
  "explorer.preview.toggle",
  "explorer.sidebar.toggle",
] as const;

export function runExplorerCommand(
  commandId: string,
  paneId: string,
  navigateRoute: (path: string) => void,
): void {
  const explorer = useExplorerStore.getState();
  const multi = useMultiPanelStore.getState();
  const activeTab = multi.tabs.find((tab) => tab.id === multi.activeTabId) ?? multi.tabs[0];
  const workspace = useWorkspaceStore.getState();
  const dockPane = dockLeaves(workspace.layout.root).find(
    (pane) => pane.id === workspace.layout.focusedPaneId,
  );
  const dockTab = dockPane?.tabs.find(
    (tab) => tab.id === dockPane.activeTabId && tab.surfaceId === "files",
  );
  const openDockedFiles = (zone?: "right" | "down") => {
    const path = activeTab?.path ?? explorer.panes[paneId]?.listing?.path ?? "/";
    const tab = workspace.openSurface({
      surfaceId: "files",
      groupKey: "tool:files",
      title: activeTab?.title || "Files",
      route: "/files",
      instancePolicy: "multiple",
      forceNew: true,
      paneId: dockPane?.id,
      state: { version: 1, path },
    });
    if (zone && dockPane) workspace.dockTab(tab.id, dockPane.id, zone);
    workspace.focusTab(tab.id);
    navigateRoute(tab.route);
  };
  if (commandId.startsWith("plugin.")) {
    void runPluginCommandById(commandId, paneId, navigateRoute);
    return;
  }
  switch (commandId) {
    case "app.toggle_transfers":
      // Transfers is its own tool now, so this opens a dock tab rather than a
      // panel inside the file manager.
      navigateRoute(openTransfersTab().route);
      break;
    case "app.open_settings":
      navigateRoute("/settings");
      break;
    case "app.toggle_plugin_launcher":
      navigateRoute("/extensions");
      break;
    case "clipboard.publish_shared":
      void publishSharedClipboard();
      break;
    case "clipboard.apply_shared":
      void applySharedClipboardToSystem();
      break;
    case "explorer.new_folder":
      void explorer.createItem(paneId, "folder");
      break;
    case "explorer.search":
      openDeepSearch(paneId);
      break;
    case "explorer.new_tab":
      openDockedFiles();
      break;
    case "explorer.restore_tab":
      multi.restoreTab();
      break;
    case "explorer.close_pane":
      if (dockTab) workspace.closeTab(dockTab.id);
      break;
    case "explorer.restore_pane":
      break;
    case "explorer.split_vertical":
      openDockedFiles("right");
      break;
    case "explorer.split_horizontal":
      openDockedFiles("down");
      break;
    case "explorer.refresh":
      void explorer.refreshPane(paneId);
      break;
    case "explorer.toggle_hidden":
      void explorer.toggleHidden(paneId);
      break;
    case "explorer.rename":
      void explorer.renameSelected(paneId);
      break;
    case "explorer.batch_rename":
      explorer.openBatchRenameDialog(paneId);
      break;
    case "explorer.duplicate_finder":
      openDuplicateFinder(paneId);
      break;
    case "explorer.compare_with":
      openCompareWith(paneId);
      break;
    case "explorer.delete":
      void explorer.deleteSelected(paneId);
      break;
    case "explorer.download":
      void explorer.downloadSelected(paneId);
      break;
    case "explorer.open_with":
      void explorer.openWithSelected(paneId);
      break;
    case "explorer.copy":
      explorer.copySelected(paneId);
      break;
    case "explorer.cut":
      explorer.cutSelected(paneId);
      break;
    case "explorer.paste":
      void explorer.pasteIntoPane(paneId);
      break;
    case "explorer.copy_path": {
      const path = selectedPathsForPane(explorer.panes[paneId])[0];
      if (path) void explorer.copyPath(path);
      break;
    }
    case "explorer.undo":
      void undoLatestTransferOperation();
      break;
    case "explorer.redo":
      void redoLatestTransferOperation();
      break;
    case "explorer.preview.toggle":
      toggleActiveTabPanelVisibility("preview");
      break;
    case "explorer.sidebar.toggle":
      toggleActiveTabPanelVisibility("sidebar");
      break;
    case "explorer.next_workspace": {
      if (multi.tabs.length <= 1) break;
      const activeIndex = Math.max(
        0,
        multi.tabs.findIndex((tab) => tab.id === multi.activeTabId),
      );
      const nextTab = multi.tabs[(activeIndex + 1) % multi.tabs.length];
      if (nextTab) multi.selectTab(nextTab.id);
      break;
    }
    case "explorer.tab_1":
    case "explorer.tab_2":
    case "explorer.tab_3":
    case "explorer.tab_4":
    case "explorer.tab_5":
    case "explorer.tab_6":
    case "explorer.tab_7":
    case "explorer.tab_8":
    case "explorer.tab_9": {
      const index = Number(commandId.slice("explorer.tab_".length)) - 1;
      const tab = multi.tabs[index];
      if (tab) multi.selectTab(tab.id);
      break;
    }
  }
}

export async function runPluginCommand(
  command: PluginCommandEntry,
  paneId: string,
  navigateRoute: (path: string) => void,
): Promise<void> {
  try {
    const selectedPaths = selectedPathsForPane(useExplorerStore.getState().panes[paneId]);
    const result = await pluginCommandRun({ commandId: command.id, selectedPaths });
    if (result.targetRoute) navigateRoute(result.targetRoute);
    if (result.handled) {
      if (result.message) {
        useExplorerStore.getState().pushNotification(result.message, "success", 4500);
      }
      return;
    }
    useExplorerStore.setState({
      operationError: `Extension command "${result.label}" could not run: ${result.message}`,
    });
  } catch (error) {
    useExplorerStore.setState({
      operationError: `Extension command "${command.label}" failed: ${errorText(error)}`,
    });
  }
}

async function runPluginCommandById(
  commandId: string,
  paneId: string,
  navigateRoute: (path: string) => void,
): Promise<void> {
  try {
    const selectedPaths = selectedPathsForPane(useExplorerStore.getState().panes[paneId]);
    const result = await pluginCommandRun({ commandId, selectedPaths });
    if (result.targetRoute) navigateRoute(result.targetRoute);
    if (result.handled) {
      if (result.message) {
        useExplorerStore.getState().pushNotification(result.message, "success", 4500);
      }
      return;
    }
    useExplorerStore.setState({
      operationError: `Extension command "${result.label}" could not run: ${result.message}`,
    });
  } catch (error) {
    useExplorerStore.setState({
      operationError: `Extension command "${commandId}" failed: ${errorText(error)}`,
    });
  }
}

function openDuplicateFinder(paneId: string): void {
  window.dispatchEvent(new CustomEvent(explorerDuplicateFinderEvent, { detail: { paneId } }));
}

function openDeepSearch(paneId: string): void {
  const currentPath = useExplorerStore.getState().panes[paneId]?.listing?.path ?? "";
  void useSearchStore.getState().openSearch(currentPath);
}

export async function undoLatestTransferOperation(): Promise<void> {
  const explorer = useExplorerStore.getState();
  try {
    const loadedRows = useTransfersStore.getState().transfers?.rows;
    const rows = loadedRows ?? (await transfersSnapshot({ limit: 500 })).rows;
    const latest = newestUndoableTransfer(rows);
    if (!latest) {
      explorer.pushNotification("No completed rename or move is available to undo.", "info", 3500);
      return;
    }

    const snapshot = await operationQueueUndo(latest.undoTokenId);
    useOperationQueueStore.setState({ snapshot, error: null });
    await useTransfersStore.getState().load(undefined, { silent: true });
    explorer.pushNotification(
      `Undo queued for ${latest.fileName || transferTypeLabel(latest.transferType)}.`,
      "success",
      3500,
    );
  } catch (error) {
    explorer.pushNotification(`Undo failed: ${errorText(error)}`, "error", 4500);
  }
}

export async function redoLatestTransferOperation(): Promise<void> {
  const explorer = useExplorerStore.getState();
  try {
    const snapshot = await operationQueueRedo();
    useOperationQueueStore.setState({ snapshot, error: null });
    await useTransfersStore.getState().load(undefined, { silent: true });
    explorer.pushNotification("Redo queued.", "success", 3500);
  } catch (error) {
    explorer.pushNotification(`Redo failed: ${errorText(error)}`, "error", 4500);
  }
}
