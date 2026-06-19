import { invoke } from "@tauri-apps/api/core";
import type {
  AppSnapshot,
  AppEnvironmentSnapshot,
  ClipboardPayload,
  ClipboardSnapshot,
  CreateItemRequest,
  DeleteItemsRequest,
  DirectoryListing,
  ExplorerOperationResult,
  FileSyncApplyRequest,
  FileSyncApplyResult,
  FileSyncCompareRequest,
  FileSyncCompareResult,
  FileSyncPair,
  ListDirectoryRequest,
  NativeWorkspaceDocument,
  OpenWithAssociation,
  OperationConflictPolicy,
  OperationQueueSnapshot,
  PasteItemsRequest,
  PasteTextRequest,
  PrepareOpenItemRequest,
  PreparedOpenItem,
  ProviderRemote,
  ProvidersSnapshot,
  ProxySnapshot,
  RcloneConfigPaths,
  RemoteEditDraft,
  RemoteTestResult,
  RenameItemRequest,
  RenameItemsRequest,
  SaveSettingsRequest,
  SaveRemoteRequest,
  SaveShortcutsRequest,
  SettingsSnapshot,
  ShortcutsSnapshot,
  TransferFilter,
  TransferPage,
} from "./types";

export function appSnapshot(): Promise<AppSnapshot> {
  return invoke("app_snapshot");
}

export function appEnvironmentSnapshot(): Promise<AppEnvironmentSnapshot> {
  return invoke("app_environment_snapshot");
}

export function proxySnapshot(): Promise<ProxySnapshot> {
  return invoke("proxy_snapshot");
}

export function clipboardSnapshot(): Promise<ClipboardSnapshot> {
  return invoke("clipboard_snapshot");
}

export function clipboardSetLocal(payload: ClipboardPayload): Promise<ClipboardPayload> {
  return invoke("clipboard_set_local", { payload });
}

export function explorerListDirectory(request: ListDirectoryRequest): Promise<DirectoryListing> {
  return invoke("explorer_list_directory", { request });
}

export function explorerCreateItem(request: CreateItemRequest): Promise<ExplorerOperationResult> {
  return invoke("explorer_create_item", { request });
}

export function explorerRenameItem(request: RenameItemRequest): Promise<ExplorerOperationResult> {
  return invoke("explorer_rename_item", { request });
}

export function explorerDeleteItems(request: DeleteItemsRequest): Promise<ExplorerOperationResult> {
  return invoke("explorer_delete_items", { request });
}

export function explorerPasteItems(request: PasteItemsRequest): Promise<ExplorerOperationResult> {
  return invoke("explorer_paste_items", { request });
}

export function explorerPrepareOpenItem(request: PrepareOpenItemRequest): Promise<PreparedOpenItem> {
  return invoke("explorer_prepare_open_item", { request });
}

export function explorerPathIsDirectory(path: string): Promise<boolean> {
  return invoke("explorer_path_is_directory", { path });
}

export function explorerPathExists(path: string): Promise<boolean> {
  return invoke("explorer_path_exists", { path });
}

export function explorerOpenWith(applicationPath: string, filePath: string): Promise<void> {
  return invoke("explorer_open_with", { applicationPath, filePath });
}

export function explorerOpenAssociation(filePath: string): Promise<string | null> {
  return invoke("explorer_open_association", { filePath });
}

export function explorerSetOpenAssociation(filePath: string, applicationPath: string): Promise<SettingsSnapshot> {
  return invoke("explorer_set_open_association", { filePath, applicationPath });
}

export function explorerQueuePasteItems(request: PasteItemsRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_paste_items", { request });
}

export function explorerQueuePasteText(request: PasteTextRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_paste_text", { request });
}

export function explorerQueueCreateItem(request: CreateItemRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_create_item", { request });
}

export function explorerQueueRenameItem(request: RenameItemRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_rename_item", { request });
}

export function explorerQueueRenameItems(request: RenameItemsRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_rename_items", { request });
}

export function explorerQueueDeleteItems(request: DeleteItemsRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_delete_items", { request });
}

export function workspacesSnapshot(): Promise<NativeWorkspaceDocument> {
  return invoke("workspaces_snapshot");
}

export function workspacesSave(document: NativeWorkspaceDocument): Promise<NativeWorkspaceDocument> {
  return invoke("workspaces_save", { document });
}

export function settingsSnapshot(): Promise<SettingsSnapshot> {
  return invoke("settings_snapshot");
}

export function settingsSave(request: SaveSettingsRequest): Promise<SettingsSnapshot> {
  return invoke("settings_save", { request });
}

export function settingsOpenWithAssociations(): Promise<OpenWithAssociation[]> {
  return invoke("settings_open_with_associations");
}

export function settingsRemoveOpenWithAssociation(key: string): Promise<SettingsSnapshot> {
  return invoke("settings_remove_open_with_association", { key });
}

export function shortcutsSnapshot(): Promise<ShortcutsSnapshot> {
  return invoke("shortcuts_snapshot");
}

export function shortcutsSave(request: SaveShortcutsRequest): Promise<ShortcutsSnapshot> {
  return invoke("shortcuts_save", { request });
}

export function providersSnapshot(): Promise<ProvidersSnapshot> {
  return invoke("providers_snapshot");
}

export function providersRefresh(): Promise<ProvidersSnapshot> {
  return invoke("providers_refresh");
}

export function providersSelectRemote(name: string): Promise<RemoteEditDraft> {
  return invoke("providers_select_remote", { name });
}

export function providersSaveRemote(request: SaveRemoteRequest): Promise<RemoteEditDraft> {
  return invoke("providers_save_remote", { request });
}

export function providersTestRemote(name: string): Promise<RemoteTestResult> {
  return invoke("providers_test_remote", { name });
}

export function providersConfigPaths(): Promise<RcloneConfigPaths> {
  return invoke("providers_config_paths");
}

export function transfersSnapshot(filter: TransferFilter = {}): Promise<TransferPage> {
  return invoke("transfers_snapshot", { filter });
}

export function transfersDeleteSelected(ids: number[]): Promise<void> {
  return invoke("transfers_delete_selected", { ids });
}

export function transfersDeleteAll(): Promise<void> {
  return invoke("transfers_delete_all");
}

export function operationQueueSnapshot(): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_snapshot");
}

export function operationQueueCancel(operationId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_cancel", { operationId });
}

export function operationQueueRetry(operationId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_retry", { operationId });
}

export function operationQueueResolveConflict(
  operationId: number,
  policy: OperationConflictPolicy,
  applyToBatch: boolean,
): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_resolve_conflict", { operationId, policy, applyToBatch });
}

export function operationQueueClearTerminal(): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_clear_terminal");
}

export function fileSyncPairsSnapshot(): Promise<FileSyncPair[]> {
  return invoke("file_sync_pairs_snapshot");
}

export function fileSyncPairSave(pair: FileSyncPair): Promise<FileSyncPair> {
  return invoke("file_sync_pair_save", { pair });
}

export function fileSyncPairRemove(pairId: number): Promise<void> {
  return invoke("file_sync_pair_remove", { pairId });
}

export function fileSyncCompare(request: FileSyncCompareRequest): Promise<FileSyncCompareResult> {
  return invoke("file_sync_compare", { request });
}

export function fileSyncApply(request: FileSyncApplyRequest): Promise<FileSyncApplyResult> {
  return invoke("file_sync_apply", { request });
}

export function remoteDisplayName(remote: ProviderRemote): string {
  return remote.name || "(unnamed remote)";
}
