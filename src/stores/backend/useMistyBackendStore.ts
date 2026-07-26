import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { OperationConflictPolicy, OperationStatus } from "@/models/types/services/misty-api";
import type {
  AndroidAllFilesAccessStatus,
  AndroidGrantedFolder,
  ArchiveActionResult,
  ArchiveCreateRequest,
  ArchiveExtractRequest,
  ArchiveListRequest,
  ArchiveListResult,
  AppSnapshot,
  AppEnvironmentSnapshot,
  ClaudeSendRequest,
  ClaudeStatus,
  ClaudeStreamEvent,
  ClipboardPayload,
  ClipboardSnapshot,
  CreateItemRequest,
  DeleteItemsRequest,
  DeviceSnapshot,
  DirectorySizeRecord,
  DirectorySizeRequest,
  DirectoryListing,
  ExplorerOperationResult,
  ExplorerPreviewPayload,
  GeneratedImageThumbnail,
  ExplorerLibraryItem,
  ExplorerLibrarySnapshot,
  FileEntry,
  FileMetadataSnapshot,
  FileToolsActionResult,
  FileToolsChecksumRequest,
  FileToolsChecksumResult,
  FileToolsChmodRequest,
  FileToolsReadonlyRequest,
  FileToolsSymlinkRequest,
  FileToolsSymlinkTargetRequest,
  FileToolsSymlinkTargetResult,
  FileSyncApplyRequest,
  FileSyncApplyResult,
  FileSyncCompareRequest,
  FileSyncCompareResult,
  FileSyncPair,
  LaunchOnLoginSnapshot,
  ListDirectoryRequest,
  NativeWorkspaceDocument,
  NoteAssetStoreRequest,
  NoteAssetStoreResult,
  OpenWithAssociation,
  OperationDescriptor,
  OperationQueueSnapshot,
  PasteBlobRequest,
  SavePreviewRequest,
  PasteItem,
  PasteItemsRequest,
  PasteTextRequest,
  PrepareDragItemsRequest,
  PreparedDragItemsResult,
  PluginPanelRenderResult,
  PluginCommandRunResult,
  PluginCommandsSnapshot,
  PluginDiagnosticsSnapshot,
  ExtensionCommandRequest,
  PrepareOpenItemRequest,
  PreparedOpenItem,
  ProviderJobStart,
  ProviderJobStatus,
  ProviderRemote,
  ProviderWorkflow,
  ProviderConfigRequest,
  ProviderConfigStep,
  ProvidersSnapshot,
  StorageSnapshot,
  RcloneConfigPaths,
  RemoteEditDraft,
  RemoteTestResult,
  RenameItemRequest,
  RenameItemsRequest,
  RenderPluginPanelRequest,
  RunPluginCommandRequest,
  SaveSettingsRequest,
  SavedSearch,
  SavedSearchesSnapshot,
  SaveRemoteRequest,
  SaveShortcutsRequest,
  SearchQueryRequest,
  SearchResult,
  SearchScanRequest,
  SearchStatus,
  SettingsSnapshot,
  ShortcutsSnapshot,
  TransferFilter,
  TransferPage,
  TransferRecord,
  VerifyResult,
  VerifyStartRequest,
  CompareFilesRequest,
  CompareFilesResult,
  CompareFoldersRequest,
  CompareFoldersResult,
  DuplicateScanRequest,
  DuplicateScanResult,
  AnalysisResult,
  FolderLibraryStatus,
  PreparedSmartLibraryPreview,
  SmartLibraryAsset,
  SmartLibraryAssetsPage,
  SmartLibraryAssetsPageRequest,
  SmartLibraryImportResult,
  SmartLibraryImportPreflight,
  SmartLibrarySnapshot,
  ResolvedSmartLibraryAsset,
  MediaSearchSnapshot,
  PreparedMediaChunk,
  ResolvedMediaAsset,
} from "@/models/interfaces/services/misty-api";
import { hasTauriInternals } from "@/platform/tauri";

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriInternals()) {
    return Promise.reject(
      new Error(`Native command "${command}" is only available in the Misty app runtime.`),
    );
  }
  return tauriInvoke<T>(command, args);
}

export function telemetrySetErrorReportingEnabled(enabled: boolean): Promise<void> {
  return invoke("telemetry_set_error_reporting_enabled", { enabled });
}

export function enableModernWindowStyle(window: unknown): Promise<void> {
  return invoke("enable_modern_window_style", { window, offsetX: -6, offsetY: -12 });
}

export function setNativeWallpaperVideo(window: unknown, path: string | null): Promise<boolean> {
  return invoke("set_native_wallpaper_video", { window, path });
}

export async function fetchPreviewBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The file reader returned ${response.status}.`);
  return response.arrayBuffer();
}
export function appSnapshot(): Promise<AppSnapshot> {
  return invoke("app_snapshot");
}

export function appEnvironmentSnapshot(): Promise<AppEnvironmentSnapshot> {
  return invoke("app_environment_snapshot");
}

export function storageSnapshot(): Promise<StorageSnapshot> {
  return invoke("storage_snapshot");
}

export function claudeStatus(): Promise<ClaudeStatus> {
  return invoke("claude_status");
}

export function claudeSendMessage(request: ClaudeSendRequest): Promise<ClaudeStatus> {
  return invoke("claude_send_message", { request });
}

export function claudeDrainEvents(): Promise<ClaudeStreamEvent[]> {
  return invoke("claude_drain_events");
}

export function claudeAbort(): Promise<ClaudeStatus> {
  return invoke("claude_abort");
}

export function clipboardSnapshot(): Promise<ClipboardSnapshot> {
  return invoke("clipboard_snapshot");
}

export function clipboardSetLocal(payload: ClipboardPayload): Promise<ClipboardPayload> {
  return invoke("clipboard_set_local", { payload });
}

export function clipboardPublishShared(): Promise<boolean> {
  return invoke("clipboard_publish_shared");
}

export function clipboardPublishImageBytes(request: {
  bytes: number[];
  width: number;
  height: number;
  mimeType?: string;
}): Promise<boolean> {
  return invoke("clipboard_publish_image_bytes", request);
}

export function clipboardApplyShared(): Promise<ClipboardPayload> {
  return invoke("clipboard_apply_shared");
}

export function clipboardSharedImageBytes(blobId: string): Promise<number[]> {
  return invoke("clipboard_shared_image_bytes", { blobId });
}

export function clipboardNativeFileRefs(): Promise<PasteItem[]> {
  return invoke("clipboard_native_file_refs");
}

export function clipboardWriteFileRefs(items: PasteItem[]): Promise<boolean> {
  return invoke("clipboard_write_file_refs", { items });
}

export function clipboardWriteFileBytes(
  items: Array<{ name: string; bytes: number[] }>,
): Promise<boolean> {
  return invoke("clipboard_write_file_bytes", { items });
}

export function notesStoreAsset(request: NoteAssetStoreRequest): Promise<NoteAssetStoreResult> {
  return invoke("notes_store_asset", { request });
}

export function devicesSnapshot(): Promise<DeviceSnapshot> {
  return invoke("devices_snapshot");
}

export function explorerListDirectory(request: ListDirectoryRequest): Promise<DirectoryListing> {
  return invoke("explorer_list_directory", { request });
}

export function androidGrantLocalFolder(request?: {
  initialDirectory?: string | null;
}): Promise<AndroidGrantedFolder> {
  return invoke("android_grant_local_folder", { request: request ?? null });
}

export function androidAllFilesAccessStatus(): Promise<AndroidAllFilesAccessStatus> {
  return invoke("android_all_files_access_status");
}

export function androidOpenAllFilesAccessSettings(): Promise<AndroidAllFilesAccessStatus> {
  return invoke("android_open_all_files_access_settings");
}

export function explorerDirectorySizeSnapshot(paths: string[]): Promise<DirectorySizeRecord[]> {
  return invoke("explorer_directory_size_snapshot", { paths });
}

export function explorerCalculateDirectorySizes(
  request: DirectorySizeRequest,
): Promise<DirectorySizeRecord[]> {
  return invoke("explorer_calculate_directory_sizes", { request });
}

export function searchInit(): Promise<SearchStatus> {
  return invoke("search_init");
}

export function searchGetStatus(): Promise<SearchStatus> {
  return invoke("search_get_status");
}

export function searchStartScan(request: SearchScanRequest): Promise<SearchStatus> {
  return invoke("search_start_scan", { request });
}

export function searchCancelScan(): Promise<SearchStatus> {
  return invoke("search_cancel_scan");
}

export function searchQuery(request: SearchQueryRequest): Promise<SearchResult[]> {
  return invoke("search_query", { request });
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

export function explorerPrepareOpenItem(
  request: PrepareOpenItemRequest,
): Promise<PreparedOpenItem> {
  return invoke("explorer_prepare_open_item", { request });
}

export function explorerPrepareDragItems(
  request: PrepareDragItemsRequest,
): Promise<PreparedDragItemsResult> {
  return invoke("explorer_prepare_drag_items", { request });
}

export function explorerCancelDragPreparation(sessionId: string): Promise<void> {
  return invoke("explorer_cancel_drag_preparation", { sessionId });
}

export function explorerPreviewItem(path: string): Promise<ExplorerPreviewPayload> {
  return invoke("explorer_preview_item", { path });
}

export function explorerSavePreviewItem(
  request: SavePreviewRequest,
): Promise<ExplorerOperationResult> {
  return invoke("explorer_save_preview_item", { request });
}

export function explorerGenerateImageThumbnail(
  path: string,
  maxDimension: number,
  options: {
    modifiedMs?: number | null;
    remoteModified?: string | null;
    sizeBytes?: number | null;
  } = {},
): Promise<GeneratedImageThumbnail> {
  return invoke("explorer_generate_image_thumbnail", {
    path,
    maxDimension,
    modifiedMs: options.modifiedMs ?? null,
    remoteModified: options.remoteModified ?? null,
    sizeBytes: options.sizeBytes ?? null,
  });
}

export function fileMetadataSnapshot(path: string): Promise<FileMetadataSnapshot> {
  return invoke("file_metadata_snapshot", { path });
}

export function explorerPathIsDirectory(path: string): Promise<boolean> {
  return invoke("explorer_path_is_directory", { path });
}

export function explorerPathExists(path: string): Promise<boolean> {
  return invoke("explorer_path_exists", { path });
}

export function explorerLibrarySnapshot(): Promise<ExplorerLibrarySnapshot> {
  return invoke("explorer_library_snapshot");
}

export function explorerLibraryRecordRecent(
  item: ExplorerLibraryItem,
): Promise<ExplorerLibrarySnapshot> {
  return invoke("explorer_library_record_recent", { request: { item } });
}

export function explorerLibraryRecordLastOpened(path: string): Promise<ExplorerLibrarySnapshot> {
  return invoke("explorer_library_record_last_opened", { request: { path } });
}

export function smartLibrarySnapshot(): Promise<SmartLibrarySnapshot> {
  return invoke("smart_library_snapshot");
}

export function smartLibraryScan(rootPath: string): Promise<FolderLibraryStatus> {
  return invoke("smart_library_scan", { request: { rootPath } });
}

export function smartLibraryImportFiles(paths: string[]): Promise<SmartLibraryImportResult> {
  return invoke("smart_library_import_files", { request: { paths } });
}

export function smartLibraryPreflightImport(paths: string[]): Promise<SmartLibraryImportPreflight> {
  return invoke("smart_library_preflight_import", { request: { paths } });
}

export function smartLibraryPreparePreviews(
  assetIds: string[],
  maxDimension = 512,
): Promise<PreparedSmartLibraryPreview[]> {
  return invoke("smart_library_prepare_previews", { request: { assetIds, maxDimension } });
}

export function smartLibraryApplyResults(results: AnalysisResult[]): Promise<SmartLibrarySnapshot> {
  return invoke("smart_library_apply_results", { request: { results } });
}

export function smartLibrarySetServerFolderId(
  serverFolderId: string,
): Promise<SmartLibrarySnapshot> {
  return invoke("smart_library_set_server_folder_id", { serverFolderId });
}

export function smartLibrarySearch(
  query: string,
  collection?: string,
  limit = 100,
): Promise<SmartLibraryAsset[]> {
  return invoke("smart_library_search", { request: { query, collection, limit } });
}

export function smartLibraryDelete(): Promise<SmartLibrarySnapshot> {
  return invoke("smart_library_delete");
}

export function smartLibraryResolveAssets(
  assetIds: string[],
): Promise<ResolvedSmartLibraryAsset[]> {
  return invoke("smart_library_resolve_assets", { request: { assetIds } });
}

export function smartLibraryAssetsPage(
  request: SmartLibraryAssetsPageRequest = {},
): Promise<SmartLibraryAssetsPage> {
  return invoke("smart_library_assets_page", { request });
}

export function mediaSearchScanMovies(): Promise<MediaSearchSnapshot> {
  return invoke("media_search_scan_movies");
}
export function mediaSearchSnapshot(): Promise<MediaSearchSnapshot> {
  return invoke("media_search_snapshot");
}
export function mediaSearchPrepareChunk(
  assetId: string,
  chunkIndex: number,
): Promise<PreparedMediaChunk> {
  return invoke("media_search_prepare_chunk", { request: { assetId, chunkIndex } });
}
export function mediaSearchComplete(
  assetId: string,
  fingerprint: string,
  failureCode?: string | null,
): Promise<MediaSearchSnapshot> {
  return invoke("media_search_complete", {
    request: { assetId, fingerprint, failureCode: failureCode ?? null },
  });
}
export function mediaSearchApproveAssets(assetIds: string[]): Promise<MediaSearchSnapshot> {
  return invoke("media_search_approve_assets", { request: { assetIds } });
}
export function mediaSearchAcknowledgeRemovedAssets(
  assetIds: string[],
): Promise<MediaSearchSnapshot> {
  return invoke("media_search_acknowledge_removed_assets", { request: { assetIds } });
}
export function mediaSearchRecordChunk(
  assetId: string,
  fingerprint: string,
  chunkIndex: number,
): Promise<MediaSearchSnapshot> {
  return invoke("media_search_record_chunk", { request: { assetId, fingerprint, chunkIndex } });
}
export function mediaSearchSetAssetState(
  assetId: string,
  state: "paused" | "queued" | "reset",
): Promise<MediaSearchSnapshot> {
  return invoke("media_search_set_asset_state", { request: { assetId, state } });
}
export function mediaSearchResetDeviceIndex(): Promise<MediaSearchSnapshot> {
  return invoke("media_search_reset_device_index");
}
export function mediaSearchCompleteLegacyAdoption(ready: boolean): Promise<MediaSearchSnapshot> {
  return invoke("media_search_complete_legacy_adoption", { request: { ready } });
}
export function mediaSearchResolveAssets(assetIds: string[]): Promise<ResolvedMediaAsset[]> {
  return invoke("media_search_resolve_assets", { request: { assetIds } });
}

export function explorerOpenWith(applicationPath: string, filePath: string): Promise<void> {
  return invoke("explorer_open_with", { applicationPath, filePath });
}

export function explorerOpenPath(filePath: string): Promise<void> {
  return invoke("explorer_open_path", { filePath });
}

export function openTerminalAtPath(path: string): Promise<void> {
  return invoke("open_terminal_at_path", { path });
}

export function explorerOpenAssociation(filePath: string): Promise<string | null> {
  return invoke("explorer_open_association", { filePath });
}

export function explorerSetOpenAssociation(
  filePath: string,
  applicationPath: string,
): Promise<SettingsSnapshot> {
  return invoke("explorer_set_open_association", { filePath, applicationPath });
}

export function explorerQueuePasteItems(
  request: PasteItemsRequest,
): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_paste_items", { request });
}

export function explorerQueuePasteText(request: PasteTextRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_paste_text", { request });
}

export function explorerQueuePasteBlob(request: PasteBlobRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_paste_blob", { request });
}

export function explorerQueueCreateItem(
  request: CreateItemRequest,
): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_create_item", { request });
}

export function explorerQueueRenameItem(
  request: RenameItemRequest,
): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_rename_item", { request });
}

export function explorerQueueRenameItems(
  request: RenameItemsRequest,
): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_rename_items", { request });
}

export function explorerQueueDeleteItems(
  request: DeleteItemsRequest,
): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_delete_items", { request });
}

export function workspacesSnapshot(): Promise<NativeWorkspaceDocument> {
  return invoke("workspaces_snapshot");
}

export function workspacesSave(
  document: NativeWorkspaceDocument,
): Promise<NativeWorkspaceDocument> {
  return invoke("workspaces_save", { document });
}

export function settingsSnapshot(): Promise<SettingsSnapshot> {
  return invoke("settings_snapshot");
}

export function settingsSave(request: SaveSettingsRequest): Promise<SettingsSnapshot> {
  return invoke("settings_save", { request });
}

export function settingsLaunchOnLoginSnapshot(): Promise<LaunchOnLoginSnapshot> {
  return invoke("settings_launch_on_login_snapshot");
}

export function settingsApplyLaunchOnLogin(enabled: boolean): Promise<LaunchOnLoginSnapshot> {
  return invoke("settings_apply_launch_on_login", { enabled });
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

export function pluginCommandsSnapshot(): Promise<PluginCommandsSnapshot> {
  return invoke("plugin_commands_snapshot");
}

export function pluginCommandRun(
  request: RunPluginCommandRequest,
): Promise<PluginCommandRunResult> {
  return invoke("plugin_command_run", { request });
}

export function pluginPanelRender(
  request: RenderPluginPanelRequest,
): Promise<PluginPanelRenderResult> {
  return invoke("plugin_panel_render", { request });
}

export function extensionCommandRun<T = unknown>(request: ExtensionCommandRequest): Promise<T> {
  return invoke("extension_command_run", { request });
}

export function pluginDiagnosticsSnapshot(): Promise<PluginDiagnosticsSnapshot> {
  return invoke("plugin_diagnostics_snapshot");
}

export function openExternalUrl(url: string): Promise<void> {
  return invoke("open_external_url", { url });
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

export function providersConfigureRemote(
  request: ProviderConfigRequest,
): Promise<ProviderConfigStep> {
  return invoke("providers_configure_remote", { request });
}

export function providersVerifyStart(request: VerifyStartRequest): Promise<ProviderJobStart> {
  return invoke("providers_verify_start", { request });
}

export function providersJobStatus(jobId: string): Promise<ProviderJobStatus> {
  return invoke("providers_job_status", { jobId });
}

export function providersJobCancel(jobId: string): Promise<unknown> {
  return invoke("providers_job_cancel", { jobId });
}

export function providersVerifyResult(jobId: string): Promise<VerifyResult> {
  return invoke("providers_verify_result", { jobId });
}

export function providersDisconnectRemote(name: string): Promise<ProvidersSnapshot> {
  return invoke("providers_disconnect_remote", { name });
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

export function operationQueueCancelBatch(batchId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_cancel_batch", { batchId });
}

export function operationQueueRetry(operationId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_retry", { operationId });
}

export function operationQueueRetryTransfer(transferId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_retry_transfer", { transferId });
}

export function operationQueuePause(operationId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_pause", { operationId });
}

export function operationQueueResume(operationId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_resume", { operationId });
}

export function operationQueuePauseBatch(batchId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_pause_batch", { batchId });
}

export function operationQueueResumeBatch(batchId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_resume_batch", { batchId });
}

export function operationQueuePauseAll(): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_pause_all");
}

export function operationQueueResumeAll(): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_resume_all");
}

export function operationQueueSetBandwidthLimit(limit: string): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_set_bandwidth_limit", { limit });
}

export function operationQueueSetTransferProfile(
  profileId: string,
  profileName: string,
  maxConcurrent: number,
  bandwidthLimit: string,
): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_set_transfer_profile", {
    profileId,
    profileName,
    maxConcurrent,
    bandwidthLimit,
  });
}

export function operationQueueUndo(undoTokenId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_undo", { undoTokenId });
}

export function operationQueueRedo(): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_redo");
}

export function archiveList(request: ArchiveListRequest): Promise<ArchiveListResult> {
  return invoke("archive_list", { request });
}

export function archiveCreate(request: ArchiveCreateRequest): Promise<ArchiveActionResult> {
  return invoke("archive_create", { request });
}

export function archiveExtract(request: ArchiveExtractRequest): Promise<ArchiveActionResult> {
  return invoke("archive_extract", { request });
}

export function duplicatesScan(request: DuplicateScanRequest): Promise<DuplicateScanResult> {
  return invoke("duplicates_scan", { request });
}

export function duplicatesCancel(scanId: string): Promise<boolean> {
  return invoke("duplicates_cancel", { scanId });
}

export function duplicatesHashRemoteCandidates(scanId: string): Promise<DuplicateScanResult> {
  return invoke("duplicates_hash_remote_candidates", { scanId });
}

export function savedSearchesSnapshot(): Promise<SavedSearchesSnapshot> {
  return invoke("saved_searches_snapshot");
}

export function savedSearchesSave(search: SavedSearch): Promise<SavedSearchesSnapshot> {
  return invoke("saved_searches_save", { search });
}

export function savedSearchesDelete(id: string): Promise<SavedSearchesSnapshot> {
  return invoke("saved_searches_delete", { id });
}

export function compareFiles(request: CompareFilesRequest): Promise<CompareFilesResult> {
  return invoke("compare_files", { request });
}

export function compareFolders(request: CompareFoldersRequest): Promise<CompareFoldersResult> {
  return invoke("compare_folders", { request });
}

export function compareApplyTextMerge(
  mergedText: string,
  targetPath: string,
): Promise<FileToolsActionResult> {
  return invoke("compare_apply_text_merge", { mergedText, targetPath });
}

export function fileToolsChecksum(
  request: FileToolsChecksumRequest,
): Promise<FileToolsChecksumResult> {
  return invoke("file_tools_checksum", { request });
}

export function fileToolsSetReadonly(
  request: FileToolsReadonlyRequest,
): Promise<FileToolsActionResult> {
  return invoke("file_tools_set_readonly", { request });
}

export function fileToolsChmod(request: FileToolsChmodRequest): Promise<FileToolsActionResult> {
  return invoke("file_tools_chmod", { request });
}

export function fileToolsCreateSymlink(
  request: FileToolsSymlinkRequest,
): Promise<FileToolsActionResult> {
  return invoke("file_tools_create_symlink", { request });
}

export function fileToolsReadSymlink(
  request: FileToolsSymlinkTargetRequest,
): Promise<FileToolsSymlinkTargetResult> {
  return invoke("file_tools_read_symlink", { request });
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
