import type {
  AnalysisResult,
  AndroidAllFilesAccessStatus,
  AndroidGrantedFolder,
  CreateItemRequest,
  DeleteItemsRequest,
  DeviceSnapshot,
  ConnectedDevicesSnapshot,
  DirectoryListing,
  PeerResponse,
  PeerRoot,
  DirectorySizeRecord,
  DirectorySizeRequest,
  ExplorerLibraryItem,
  ExplorerLibrarySnapshot,
  ExplorerOperationResult,
  ExplorerPreviewPayload,
  FileMetadataSnapshot,
  FolderLibraryStatus,
  GeneratedImageThumbnail,
  ListDirectoryRequest,
  MediaSearchSnapshot,
  NativeWorkspaceDocument,
  OperationQueueSnapshot,
  PasteBlobRequest,
  PasteItemsRequest,
  PasteTextRequest,
  PrepareDragItemsRequest,
  PrepareOpenItemRequest,
  PreparedDragItemsResult,
  PreparedMediaChunk,
  PreparedOpenItem,
  PreparedSmartLibraryPreview,
  RenameItemRequest,
  RenameItemsRequest,
  ResolvedMediaAsset,
  ResolvedSmartLibraryAsset,
  SavePreviewRequest,
  SearchQueryRequest,
  SearchResult,
  SearchScanRequest,
  SearchStatus,
  SettingsSnapshot,
  SmartLibraryAsset,
  SmartLibraryAssetsPage,
  SmartLibraryAssetsPageRequest,
  SmartLibraryImportPreflight,
  SmartLibraryImportResult,
  SmartLibrarySnapshot,
} from "@/native/contracts";

import { invoke } from "@tauri-apps/api/core";

// Files owns the native filesystem command surface. It also composes the
// shared clipboard, transfer, provider, and extension commands it needs.
export * from "@/native/runtime";
export * from "@/native/settings-plugins";
export * from "@/native/transfers-tools";

export function devicesSnapshot(): Promise<DeviceSnapshot> {
  return invoke("devices_snapshot");
}

export function devicesUnmount(request: {
  volumeId: string;
  mountPath: string;
}): Promise<DeviceSnapshot> {
  return invoke("devices_unmount", { request });
}

export function connectedDevicesInitialize(request: {
  accountId: string;
  deviceId: string;
  deviceName?: string;
  developmentTicketKeys?: Record<string, string>;
}): Promise<ConnectedDevicesSnapshot> {
  return invoke("connected_devices_initialize", { request });
}

export function connectedDevicesSnapshot(): Promise<ConnectedDevicesSnapshot> {
  return invoke("connected_devices_snapshot");
}

export function connectedDevicesSubscribeDirectory(path: string): Promise<void> {
  return invoke("connected_devices_subscribe_directory", { path });
}

export function connectedDevicesConnect(request: {
  deviceId: string;
  address: unknown;
  ticket: string;
}): Promise<ConnectedDevicesSnapshot> {
  return invoke("connected_devices_connect", { request });
}

export function connectedDevicesRoots(deviceId: string): Promise<PeerRoot[]> {
  return invoke("connected_devices_roots", { deviceId });
}

export function connectedDevicesListDirectory(request: {
  deviceId: string;
  path: string;
  showHidden?: boolean;
}): Promise<PeerResponse> {
  return invoke("connected_devices_list_directory", { request });
}

export function connectedDevicesReadFile(request: {
  deviceId: string;
  path: string;
  offset: number;
  length?: number | null;
  expectedSnapshot?: string | null;
}): Promise<number[]> {
  return invoke("connected_devices_read_file", { request });
}

export function connectedDevicesMediaUrl(path: string): Promise<string> {
  return invoke("connected_devices_media_url", { path });
}

export function connectedDevicesPrepareClipboardFiles(deviceId: string): Promise<boolean> {
  return invoke("connected_devices_prepare_clipboard_files", { deviceId });
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
