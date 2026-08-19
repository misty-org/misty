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
import type { ShortcutMap } from "@/shared/lib/model/types/shortcuts";
import { shortcutMatchesEvent } from "@/shared/lib/shortcuts";
import { selectedPathsForPane, useExplorerStore, useOperationQueueStore } from "../store";
import { useSearchStore } from "@/features/files/search";
import { openCompareWith } from "./ExplorerContextMenu";
import { openTransfersTab, toggleActiveTabPanelVisibility } from "./ExplorerDesktopPlugins";
import { applySharedClipboardToSystem } from "./explorerCommands/clipboardPayloads";
import {
  newestUndoableTransfer,
  publishSharedClipboard,
  transferTypeLabel,
} from "./explorerCommands/transferLabels";

const explorerDuplicateFinderEvent = "misty:explorer-duplicate-finder";

export const executableShortcutCommands = [
  "app.open_settings",
  "app.toggle_transfers",
  "app.toggle_plugin_launcher",
  "clipboard.publish_shared",
  "clipboard.apply_shared",
  "search.toggle",
  "explorer.copy",
  "explorer.cut",
  "explorer.paste",
  "explorer.undo",
  "explorer.redo",
  "explorer.delete",
  "explorer.download",
  "explorer.rename",
  "explorer.batch_rename",
  "explorer.duplicate_finder",
  "explorer.compare_with",
  "explorer.refresh",
  "explorer.new_tab",
  "explorer.restore_tab",
  "explorer.close_pane",
  "explorer.restore_pane",
  "explorer.split_vertical",
  "explorer.split_horizontal",
  "explorer.next_workspace",
  "explorer.tab_1",
  "explorer.tab_2",
  "explorer.tab_3",
  "explorer.tab_4",
  "explorer.tab_5",
  "explorer.tab_6",
  "explorer.tab_7",
  "explorer.tab_8",
  "explorer.tab_9",
] as const;
const defaultMacExplorerShortcuts: ShortcutMap = {
  "app.open_settings": "Cmd+Comma",
  "app.toggle_transfers": "Cmd+Shift+Y",
  "app.toggle_plugin_launcher": "Cmd+Shift+P",
  "clipboard.publish_shared": "Cmd+Alt+C",
  "clipboard.apply_shared": "Cmd+Alt+V",
  "search.toggle": "Cmd+K",
  "explorer.copy": "Cmd+C",
  "explorer.cut": "Cmd+X",
  "explorer.paste": "Cmd+V",
  "explorer.undo": "Cmd+Z",
  "explorer.redo": "Cmd+Shift+Z",
  "explorer.delete": "Delete",
  "explorer.rename": "F2",
  "explorer.refresh": "Cmd+R",
  "explorer.next_workspace": "Cmd+Shift+Grave",
  "explorer.new_tab": "Cmd+T",
  "explorer.restore_tab": "Cmd+Shift+T",
  "explorer.close_pane": "Cmd+W",
  "explorer.restore_pane": "Cmd+Ctrl+Backslash",
  "explorer.split_vertical": "Cmd+Backslash",
  "explorer.split_horizontal": "Cmd+Shift+Backslash",
  "explorer.tab_1": "Cmd+1",
  "explorer.tab_2": "Cmd+2",
  "explorer.tab_3": "Cmd+3",
  "explorer.tab_4": "Cmd+4",
  "explorer.tab_5": "Cmd+5",
  "explorer.tab_6": "Cmd+6",
  "explorer.tab_7": "Cmd+7",
  "explorer.tab_8": "Cmd+8",
  "explorer.tab_9": "Cmd+9",
};
const defaultNonMacExplorerShortcuts: ShortcutMap = {
  "app.open_settings": "Ctrl+Comma",
  "app.toggle_transfers": "Ctrl+Shift+Y",
  "app.toggle_plugin_launcher": "Ctrl+Shift+P",
  "clipboard.publish_shared": "Ctrl+Alt+C",
  "clipboard.apply_shared": "Ctrl+Alt+V",
  "search.toggle": "Ctrl+K",
  "explorer.copy": "Ctrl+C",
  "explorer.cut": "Ctrl+X",
  "explorer.paste": "Ctrl+V",
  "explorer.undo": "Ctrl+Z",
  "explorer.redo": "Ctrl+Shift+Z",
  "explorer.delete": "Delete",
  "explorer.rename": "F2",
  "explorer.refresh": "Ctrl+R",
  "explorer.next_workspace": "Ctrl+Shift+Grave",
  "explorer.new_tab": "Ctrl+T",
  "explorer.restore_tab": "Ctrl+Shift+T",
  "explorer.close_pane": "Ctrl+W",
  "explorer.restore_pane": "Ctrl+Ctrl+Backslash",
  "explorer.split_vertical": "Ctrl+Backslash",
  "explorer.split_horizontal": "Ctrl+Shift+Backslash",
  "explorer.tab_1": "Ctrl+1",
  "explorer.tab_2": "Ctrl+2",
  "explorer.tab_3": "Ctrl+3",
  "explorer.tab_4": "Ctrl+4",
  "explorer.tab_5": "Ctrl+5",
  "explorer.tab_6": "Ctrl+6",
  "explorer.tab_7": "Ctrl+7",
  "explorer.tab_8": "Ctrl+8",
  "explorer.tab_9": "Ctrl+9",
};

const vscodeExplorerShortcutOverrides: ShortcutMap = {
  "search.toggle": "Primary+P",
};

const finderExplorerShortcutOverrides: ShortcutMap = {
  "search.toggle": "Primary+F",
  "explorer.delete": "Primary+Backspace",
  "explorer.rename": "Enter",
};

export function shortcutCommandForEvent(
  event: KeyboardEvent,
  shortcuts: ShortcutMap,
  commandIds: readonly string[],
): string | null {
  for (const commandId of commandIds) {
    if (shortcutMatchesEvent(shortcuts[commandId], event)) return commandId;
  }
  return null;
}

export function defaultExplorerShortcutMap(keymapIndex = 0): ShortcutMap {
  const base = /mac|iphone|ipad|ipod/i.test(navigator.platform)
    ? defaultMacExplorerShortcuts
    : defaultNonMacExplorerShortcuts;
  if (keymapIndex === 1) {
    return { ...base, ...vscodeExplorerShortcutOverrides };
  }
  if (keymapIndex === 2) {
    return { ...base, ...finderExplorerShortcutOverrides };
  }
  return { ...base };
}

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
    case "search.toggle":
      openDeepSearch(paneId);
      break;
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

function openDeepSearch(paneId: string): void {
  const pane = useExplorerStore.getState().panes[paneId];
  const currentPath = pane?.listing?.path ?? "";
  void useSearchStore.getState().openSearch(currentPath);
}

function openDuplicateFinder(paneId: string): void {
  window.dispatchEvent(new CustomEvent(explorerDuplicateFinderEvent, { detail: { paneId } }));
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
