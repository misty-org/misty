import { readText, writeHtml, writeImage, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { clipboardApplyShared, clipboardPublishImageBytes, clipboardPublishShared, clipboardSetLocal, clipboardSharedImageBytes, clipboardWriteFileRefs, explorerPrepareDragItems, operationQueueRedo, operationQueueUndo, pluginCommandRun, transfersSnapshot } from "../../../api/misty";
import type { ClipboardPayload, PluginCommandEntry, TransferRecord } from "../../../api/types";
import { useAppStore } from "../../../stores/useAppStore";
import { selectedPathsForPane, useExplorerStore } from "../../../stores/useExplorerStore";
import { useOperationQueueStore } from "../../../stores/useOperationQueueStore";
import { useSearchStore } from "../../../stores/useSearchStore";
import { useTransfersStore } from "../../../stores/useTransfersStore";
import { useMultiPanelStore } from "../../../shared/multipanel/useMultiPanelStore";
import { selectAdvancedPreferences, useSettingsStore } from "../../../stores/useSettingsStore";
import { shortcutMatchesEvent } from "../../../shared/shortcuts";
import type { ShortcutMap } from "../../../shared/shortcuts";
import { errorText } from "../../../shared/format";
import { publishPluginNotifications } from "../../../plugins/pluginNotifications";
import { clipboardImagePng } from "../utils/clipboardImage";
import { openCompareWith } from "./ExplorerContextMenu";
import { openTransfersTab, toggleActiveTabPanelVisibility } from "./ExplorerDesktopPlugins";

const explorerSearchFocusEvent = "misty:explorer-search-focus";
const explorerDuplicateFinderEvent = "misty:explorer-duplicate-finder";

export const executableShortcutCommands = [
  "app.open_settings",
  "app.toggle_transfers",
  "app.toggle_plugin_launcher",
  "clipboard.publish_shared",
  "clipboard.apply_shared",
  "search.toggle",
  "explorer.open_palette",
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
  "explorer.automation_rules",
  "explorer.refresh",
  "explorer.new_tab",
  "explorer.restore_tab",
  "explorer.close_pane",
  "explorer.restore_pane",
  "explorer.split_vertical",
  "explorer.split_horizontal",
  "explorer.toggle_chat",
  "explorer.toggle_mika",
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
  "explorer.open_palette": "Cmd+P",
  "explorer.copy": "Cmd+C",
  "explorer.cut": "Cmd+X",
  "explorer.paste": "Cmd+V",
  "explorer.undo": "Cmd+Z",
  "explorer.redo": "Cmd+Shift+Z",
  "explorer.delete": "Delete",
  "explorer.rename": "F2",
  "explorer.refresh": "Cmd+R",
  "explorer.toggle_chat": "Cmd+J",
  "explorer.toggle_mika": "Cmd+Shift+A",
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
  "explorer.open_palette": "Ctrl+P",
  "explorer.copy": "Ctrl+C",
  "explorer.cut": "Ctrl+X",
  "explorer.paste": "Ctrl+V",
  "explorer.undo": "Ctrl+Z",
  "explorer.redo": "Ctrl+Shift+Z",
  "explorer.delete": "Delete",
  "explorer.rename": "F2",
  "explorer.refresh": "Ctrl+R",
  "explorer.toggle_chat": "Ctrl+J",
  "explorer.toggle_mika": "Ctrl+Shift+A",
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
  "explorer.open_palette": "Primary+Shift+P",
  "search.toggle": "Primary+P",
};

const finderExplorerShortcutOverrides: ShortcutMap = {
  "explorer.open_palette": "Primary+Shift+P",
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

export function runExplorerCommand(commandId: string, paneId: string, navigateRoute: (path: string) => void): void {
  const explorer = useExplorerStore.getState();
  const multi = useMultiPanelStore.getState();
  const activeTab = multi.tabs.find((tab) => tab.id === multi.activeTabId) ?? multi.tabs[0];
  if (commandId.startsWith("plugin.")) {
    void runPluginCommandById(commandId, paneId, navigateRoute);
    return;
  }
  switch (commandId) {
    case "search.toggle":
      openDeepSearch(paneId);
      break;
    case "explorer.open_palette":
      focusExplorerSearch(paneId, "command");
      break;
    case "app.toggle_transfers":
      openTransfersTab();
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
      multi.addTab(activeTab?.path ?? explorer.panes[paneId]?.listing?.path ?? "/", activeTab?.title);
      break;
    case "explorer.restore_tab":
      multi.restoreTab();
      break;
    case "explorer.close_pane":
      if (activeTab && activeTab.panes.length > 1) multi.closePane(paneId);
      else if (activeTab) multi.closeTab(activeTab.id);
      break;
    case "explorer.restore_pane":
      multi.restorePane();
      break;
    case "explorer.split_vertical":
      multi.splitPane(paneId, "vertical");
      break;
    case "explorer.split_horizontal":
      multi.splitPane(paneId, "horizontal");
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
    case "explorer.automation_rules":
      useExplorerStore.getState().pushNotification("coming soon...", "info", 3000);
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
    case "explorer.toggle_chat":
    case "explorer.toggle_mika":
      explorer.toggleMikaPanel();
      break;
    case "explorer.next_workspace": {
      if (multi.tabs.length <= 1) break;
      const activeIndex = Math.max(0, multi.tabs.findIndex((tab) => tab.id === multi.activeTabId));
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
      publishPluginNotifications(result.notifications, result.message);
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
      publishPluginNotifications(result.notifications, result.message);
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

function focusExplorerSearch(paneId: string, mode: "search" | "command"): void {
  useExplorerStore.getState().setCommandQueryMode(paneId, "search");
  useExplorerStore.getState().setCommandQuery(paneId, mode === "command" ? ">" : "");
  window.dispatchEvent(new CustomEvent(explorerSearchFocusEvent, { detail: { paneId, mode } }));
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
    explorer.pushNotification(`Undo queued for ${latest.fileName || transferTypeLabel(latest.transferType)}.`, "success", 3500);
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

export function newestUndoableTransfer(rows: readonly TransferRecord[]): TransferRecord | null {
  return rows
    .filter((row) => row.undoable && row.undoTokenId > 0 && row.status === "completed")
    .sort((left, right) => transferRecencyMs(right) - transferRecencyMs(left) || right.id - left.id)[0] ?? null;
}

function transferRecencyMs(row: TransferRecord): number {
  return row.completedAtMs || row.startedAtMs || row.queuedAtMs || row.id;
}

export function transferTypeLabel(type: TransferRecord["transferType"]): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

async function publishSharedClipboard(): Promise<void> {
  try {
    let published = await clipboardPublishShared();
    if (!published) {
      const systemText = await readText().catch(() => "");
      if (systemText.trim()) {
        await clipboardSetLocal(textClipboardPayload(systemText));
        published = await clipboardPublishShared();
      }
    }
    if (!published) {
      const image = await clipboardImagePng();
      if (image) {
        published = await clipboardPublishImageBytes({
          bytes: [...image.bytes],
          width: image.width,
          height: image.height,
          mimeType: "image/png",
        });
      }
    }
    if (!published) {
      useExplorerStore.setState({
        operationError: "Shared clipboard publish failed. Check that the local clipboard has content.",
      });
    }
  } catch (error) {
    useExplorerStore.setState({ operationError: `Shared clipboard publish failed: ${errorText(error)}` });
  }
}

function textClipboardPayload(text: string): ClipboardPayload {
  return {
    kind: text ? "text" : "empty",
    origin: "local_system",
    payload_id: "",
    source_device_id: "",
    source_device_name: "",
    revision: 0,
    created_unix_ms: 0,
    text,
    html: "",
    file_refs: [],
    images: [],
  };
}

async function applySharedClipboardToSystem(): Promise<void> {
  try {
    const payload = await clipboardApplyShared();
    await writeSharedClipboardPayload(payload);
  } catch (error) {
    useExplorerStore.setState({ operationError: `Shared clipboard apply failed: ${errorText(error)}` });
  }
}

async function writeSharedClipboardPayload(payload: ClipboardPayload): Promise<void> {
  switch (payload.kind) {
    case "text":
      if (!payload.text) break;
      await writeText(payload.text);
      return;
    case "html":
      if (!payload.html && !payload.text) break;
      if (payload.html) await writeHtml(payload.html, payload.text || undefined);
      else await writeText(payload.text);
      return;
    case "file_refs": {
      const localItems = sharedClipboardLocalPasteItems(payload);
      const remoteItems = await sharedClipboardRemotePasteItems(payload);
      const nativeItems = [...localItems, ...remoteItems];
      if (nativeItems.length > 0 && await clipboardWriteFileRefs(nativeItems)) {
        if (remoteItems.length > 0) {
          useExplorerStore.getState().pushNotification(
            `Prepared ${remoteItems.length} shared remote ${remoteItems.length === 1 ? "item" : "items"} for clipboard.`,
            "success",
            3500,
            false,
          );
        }
        return;
      }
      const text = sharedClipboardText(payload);
      if (!text) break;
      await writeText(text);
      return;
    }
    case "image": {
      const image = payload.images.find((candidate) => candidate.blob_id);
      if (!image) break;
      const bytes = await clipboardSharedImageBytes(image.blob_id);
      await writeImage(new Uint8Array(bytes));
      return;
    }
    case "empty":
      break;
  }
  throw new Error("This shared clipboard payload cannot be applied to the system clipboard yet.");
}

function sharedClipboardText(payload: ClipboardPayload): string {
  switch (payload.kind) {
    case "text":
      return payload.text;
    case "html":
      return payload.html || payload.text;
    case "file_refs":
      return payload.file_refs
        .map((ref) => ref.local_path || sharedClipboardRemoteLabel(ref))
        .filter(Boolean)
        .join("\n");
    default:
      return "";
  }
}

function sharedClipboardRemoteLabel(ref: ClipboardPayload["file_refs"][number]): string {
  const providerType = clipboardRefValue(ref.provider_type);
  const remoteName = clipboardRefValue(ref.remote_name);
  const remotePath = clipboardRefValue(ref.remote_path);
  if (!remoteName && !remotePath) return "";
  const provider = providerType ? `${providerType}/` : "";
  return `${provider}${remoteName}:${remotePath}`;
}

function sharedClipboardLocalPasteItems(payload: ClipboardPayload) {
  return payload.file_refs
    .map((ref) => ({
      path: clipboardRefValue(ref.local_path),
      remoteName: clipboardRefValue(ref.remote_name),
      remotePath: clipboardRefValue(ref.remote_path),
      isDirectory: ref.is_dir,
    }))
    .filter((ref) => ref.path && !ref.remoteName && !ref.remotePath)
    .map((ref) => ({ path: ref.path, isDirectory: ref.isDirectory }));
}

async function sharedClipboardRemotePasteItems(payload: ClipboardPayload) {
  const remoteRefs = payload.file_refs
    .map((ref) => ({
      providerType: clipboardRefValue(ref.provider_type),
      remoteName: clipboardRefValue(ref.remote_name),
      remotePath: clipboardRefValue(ref.remote_path),
      localPath: clipboardRefValue(ref.local_path),
      isDirectory: ref.is_dir,
    }))
    .filter((ref) => !ref.localPath && ref.providerType && ref.remoteName && ref.remotePath);
  if (remoteRefs.length === 0) return [];
  useExplorerStore.getState().pushNotification(
    `Preparing ${remoteRefs.length} shared remote ${remoteRefs.length === 1 ? "item" : "items"} for clipboard...`,
    "info",
    3500,
    false,
  );
  try {
    const prepared = await explorerPrepareDragItems({
      items: remoteRefs.map((ref) => ({
        path: remoteClipboardMountPath(ref),
        isDirectory: ref.isDirectory,
      })),
    });
    if (prepared.skipped.length > 0) {
      useExplorerStore.getState().pushNotification(
        `Skipped ${prepared.skipped.length} shared remote ${prepared.skipped.length === 1 ? "item" : "items"} while preparing clipboard.`,
        "error",
        4500,
        false,
      );
    }
    return prepared.items.map((item) => ({ path: item.localPath, isDirectory: item.isDirectory }));
  } catch (error) {
    useExplorerStore.getState().pushNotification(
      `Shared remote clipboard preparation failed: ${errorText(error)}`,
      "error",
      5500,
      false,
    );
    return [];
  }
}

function remoteClipboardMountPath(ref: {
  providerType: string;
  remoteName: string;
  remotePath: string;
}): string {
  const app = useAppStore.getState().app;
  const homePath = app?.environment.homeDir ?? "/";
  const settingsMountPath = selectAdvancedPreferences(useSettingsStore.getState().settings?.document).mountPath;
  const mountRoot = resolveMountRoot(homePath, settingsMountPath || app?.environment.mountPath || ".misty/mnt");
  return joinPath(mountRoot, ref.remoteName, ref.remotePath);
}

function clipboardRefValue(value: string): string {
  return value.trim();
}

function resolveMountRoot(homePath: string, configuredPath: string): string {
  if (configuredPath.startsWith("/")) return configuredPath;
  return joinPath(homePath, configuredPath);
}

function joinPath(...parts: string[]): string {
  const [first, ...rest] = parts.filter(Boolean);
  if (!first) return "/";
  return [first.replace(/\/+$/, ""), ...rest.map((part) => part.replace(/^\/+|\/+$/g, ""))].filter(Boolean).join("/") || "/";
}
