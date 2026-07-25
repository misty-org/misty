use std::{
    collections::HashSet,
    env,
    path::Path,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

#[cfg(target_os = "android")]
use sha2::{Digest, Sha256};
#[cfg(target_os = "android")]
use tauri_plugin_document_tree::{DocumentTreeExt, PickTreeRequest};

use crate::core::clipboard::{
    ClipboardImage, ClipboardPayload, ClipboardPayloadKind, SharedClipboardClient,
};
use crate::core::explorer::{
    CreateItemRequest, DeleteItemsRequest, DirectoryListing, ExplorerOperationResult,
    ExplorerPreviewPayload, GeneratedImageThumbnail, ListDirectoryRequest, PasteBlobRequest,
    PasteItem, PasteItemsRequest, PasteTextRequest, PrepareDragItemsRequest,
    PrepareOpenItemRequest, PreparedDragItemsResult, PreparedOpenItem, RenameItemRequest,
    RenameItemsRequest,
};
use crate::core::file_sync::FileSyncPair;
use crate::core::operation_queue::{ConflictPolicy, OperationQueueSnapshot};
use crate::core::workspace::WorkspaceDocument;
use crate::error::{ApiError, ApiResult};
use crate::runtime::MistyRuntime;
use crate::services::agents::{
    OpenAgentCitationRequest, PrepareScopedAgentDocumentRequest, RegisterFolderScopeRequest,
};
use crate::services::autostart::LaunchOnLoginSnapshot;
use crate::services::claude::{ClaudeSendRequest, ClaudeStatus, ClaudeStreamEvent};
use crate::services::commands::{SaveShortcutsRequest, ShortcutsSnapshot};
use crate::services::devices::DeviceSnapshot;
use crate::services::directory_size::{DirectorySizeRecord, DirectorySizeRequest};
use crate::services::document_intelligence::{PrepareAgentDocumentRequest, PreparedAgentDocument};
use crate::services::environment::AppEnvironmentSnapshot;
use crate::services::explorer::SavePreviewRequest;
use crate::services::explorer_library::{
    ExplorerLibrarySnapshot, RecordLastOpenedRequest, RecordRecentRequest, SetTagsRequest,
};
use crate::services::file_sync::{
    FileSyncApplyRequest, FileSyncApplyResult, FileSyncCompareRequest,
};
#[cfg(desktop)]
use crate::services::media_search::{
    AcknowledgeRemovedMediaAssetsRequest, ApproveMediaAssetsRequest, CompleteMediaAssetRequest,
    CompleteMediaLegacyAdoptionRequest, MediaSearchSnapshot, PrepareMediaChunkRequest,
    PreparedMediaChunk, RecordMediaChunkRequest, ResolveMediaAssetsRequest, ResolvedMediaAsset,
    SetMediaAssetStateRequest,
};
use crate::services::metadata::FileMetadataSnapshot;
#[cfg(desktop)]
use crate::services::plugin_commands::{
    PluginCommandRunResult, PluginCommandsSnapshot, PluginDiagnosticsSnapshot,
    PluginPanelRenderResult, RenderPluginPanelRequest, RunPluginCommandRequest,
};
use crate::services::power_pack::{
    ArchiveActionResult, ArchiveCreateRequest, ArchiveExtractRequest, ArchiveListRequest,
    ArchiveListResult, CompareFilesRequest, CompareFilesResult, CompareFoldersRequest,
    CompareFoldersResult, DuplicateScanRequest, DuplicateScanResult, FileToolsActionResult,
    FileToolsChecksumRequest, FileToolsChecksumResult, FileToolsChmodRequest,
    FileToolsReadonlyRequest, FileToolsSymlinkRequest, FileToolsSymlinkTargetRequest,
    FileToolsSymlinkTargetResult, SavedSearch, SavedSearchesSnapshot,
};
use crate::services::providers::{
    BackendAction, BackendActionResult, BackendRunRequest, ConfigSecurityStatus,
    ProviderConfigRequest, ProviderConfigStep, ProviderJobStart, ProviderJobStatus,
    ProvidersSnapshot, RcloneConfigPaths, RemoteEditDraft, RemoteTestResult, SaveRemoteRequest,
    VerifyResult, VerifyStartRequest,
};
use crate::services::search::{SearchQueryRequest, SearchResult, SearchScanRequest, SearchStatus};
use crate::services::settings::{OpenWithAssociation, SaveSettingsRequest, SettingsSnapshot};
use crate::services::smart_library::{
    ApplySmartLibraryResultsRequest, FolderLibraryStatus, PrepareSmartLibraryPreviewsRequest,
    PreparedSmartLibraryPreview, ResolveSmartLibraryAssetsRequest, ResolvedSmartLibraryAsset,
    SmartLibraryAssetsPage, SmartLibraryAssetsPageRequest, SmartLibraryImportFilesRequest,
    SmartLibraryImportPreflight, SmartLibraryImportResult, SmartLibraryScanRequest, SmartLibrarySearchRequest,
    SmartLibrarySnapshot,
};
use crate::services::storage::StorageSnapshot;
use crate::services::storage_runtime::StorageRuntimeSnapshot;
use crate::services::transfers::{TransferFilter, TransferPage};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    app_name: &'static str,
    version: &'static str,
    migration_stage: &'static str,
    storage_runtime: StorageRuntimeSnapshot,
    environment: AppEnvironmentSnapshot,
}

#[derive(Debug, Serialize)]
pub struct ClipboardSnapshot {
    pub local: ClipboardPayload,
    pub shared: ClipboardPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFileBytes {
    pub name: String,
    pub bytes: Vec<u8>,
}

const NOTE_ASSET_MAX_BYTES: usize = 15 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteAssetStoreRequest {
    pub account_id: String,
    pub space_id: String,
    pub note_id: String,
    pub file_name: String,
    pub mime_type: Option<String>,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteAssetStoreResult {
    pub path: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub byte_size: u64,
}

#[tauri::command]
pub async fn app_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<AppSnapshot> {
    Ok(AppSnapshot {
        app_name: "Misty",
        version: env!("CARGO_PKG_VERSION"),
        migration_stage: "Tauri migration shell",
        storage_runtime: state.storage_runtime.snapshot(),
        environment: state.environment.snapshot(),
    })
}

#[tauri::command]
pub async fn app_environment_snapshot(
    state: State<'_, MistyRuntime>,
) -> ApiResult<AppEnvironmentSnapshot> {
    Ok(state.environment.snapshot())
}

#[tauri::command]
pub async fn agents_device_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<serde_json::Value> {
    state.agents.device_snapshot().await
}

#[tauri::command]
pub async fn agents_register_folder_scope(
    request: RegisterFolderScopeRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<serde_json::Value> {
    state.agents.register_folder_scope(request).await
}

#[tauri::command]
pub async fn agents_open_citation(
    request: OpenAgentCitationRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<()> {
    state.agents.open_citation(request).await
}

#[tauri::command]
pub async fn agents_prepare_document(
    request: PrepareAgentDocumentRequest,
) -> ApiResult<PreparedAgentDocument> {
    crate::services::document_intelligence::prepare_document(request).await
}

#[tauri::command]
pub async fn agents_prepare_scoped_document(
    request: PrepareScopedAgentDocumentRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<PreparedAgentDocument> {
    state.agents.prepare_scoped_document(request).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn agents_device_identity_load(local_device_id: String) -> ApiResult<Option<String>> {
    crate::services::agent_device_identity::load(&local_device_id)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn agents_device_identity_store(
    local_device_id: String,
    encoded_identity: String,
) -> ApiResult<()> {
    crate::services::agent_device_identity::store(&local_device_id, &encoded_identity)
}

#[tauri::command]
pub fn claude_status(state: State<'_, MistyRuntime>) -> ClaudeStatus {
    state.claude.status()
}

#[tauri::command]
pub fn claude_send_message(
    request: ClaudeSendRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ClaudeStatus> {
    state.claude.send_message(request)
}

#[tauri::command]
pub fn claude_drain_events(state: State<'_, MistyRuntime>) -> Vec<ClaudeStreamEvent> {
    state.claude.drain_events()
}

#[tauri::command]
pub fn claude_abort(state: State<'_, MistyRuntime>) -> ApiResult<ClaudeStatus> {
    state.claude.abort()
}

#[tauri::command]
pub async fn storage_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<StorageSnapshot> {
    Ok(state.storage.snapshot().await)
}

#[tauri::command]
pub async fn file_metadata_snapshot(
    path: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<FileMetadataSnapshot> {
    state.metadata.snapshot(path).await
}

#[tauri::command]
pub fn clipboard_snapshot(state: State<'_, MistyRuntime>) -> ClipboardSnapshot {
    ClipboardSnapshot {
        local: state.clipboard.current_local(),
        shared: state.clipboard.latest_shared(),
    }
}

#[tauri::command]
pub fn clipboard_set_local(
    payload: ClipboardPayload,
    state: State<'_, MistyRuntime>,
) -> ClipboardPayload {
    state.clipboard.set_local_misty_payload(payload)
}

#[tauri::command]
pub fn clipboard_publish_shared(state: State<'_, MistyRuntime>) -> ApiResult<bool> {
    Ok(state.clipboard.publish_current_to_shared())
}

#[tauri::command]
pub fn clipboard_publish_image_bytes(
    bytes: Vec<u8>,
    width: i32,
    height: i32,
    mime_type: Option<String>,
    state: State<'_, MistyRuntime>,
) -> ApiResult<bool> {
    if bytes.is_empty() {
        return Err(ApiError::Message("Clipboard image is empty.".to_owned()));
    }
    if width <= 0 || height <= 0 {
        return Err(ApiError::Message(
            "Clipboard image dimensions are invalid.".to_owned(),
        ));
    }
    let size_bytes = bytes.len() as u64;
    let payload = ClipboardPayload {
        kind: ClipboardPayloadKind::Image,
        images: vec![ClipboardImage {
            mime_type: mime_type
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "image/png".to_owned()),
            size_bytes,
            width,
            height,
            bytes,
            ..ClipboardImage::default()
        }],
        ..ClipboardPayload::default()
    };
    Ok(state
        .clipboard
        .publish_local_system_payload_to_shared(payload))
}

#[tauri::command]
pub fn clipboard_apply_shared(state: State<'_, MistyRuntime>) -> ApiResult<ClipboardPayload> {
    let payload = state.clipboard.latest_shared();
    if payload.empty() {
        Err(ApiError::Message(
            "No shared clipboard payload is available.".to_owned(),
        ))
    } else {
        Ok(payload)
    }
}

#[tauri::command]
pub fn clipboard_shared_image_bytes(
    blob_id: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<u8>> {
    if blob_id.trim().is_empty() {
        return Err(ApiError::Message(
            "Shared clipboard image is missing a blob id.".to_owned(),
        ));
    }
    let payload = state.clipboard.latest_shared();
    if payload.kind != ClipboardPayloadKind::Image || payload.images.is_empty() {
        return Err(ApiError::Message(
            "No shared clipboard image is available.".to_owned(),
        ));
    }
    payload
        .images
        .into_iter()
        .find(|image| image.blob_id == blob_id)
        .and_then(|image| (!image.bytes.is_empty()).then_some(image.bytes))
        .ok_or_else(|| ApiError::Message("Shared clipboard image data is unavailable.".to_owned()))
}

#[tauri::command]
pub fn clipboard_native_file_refs() -> ApiResult<Vec<PasteItem>> {
    crate::services::native_clipboard::native_clipboard_file_refs()
}

#[tauri::command]
pub fn clipboard_write_file_refs(items: Vec<PasteItem>) -> ApiResult<bool> {
    crate::services::native_clipboard::write_native_clipboard_file_refs(&items)
}

#[tauri::command]
pub async fn clipboard_write_file_bytes(items: Vec<ClipboardFileBytes>) -> ApiResult<bool> {
    if items.is_empty() {
        return Err(ApiError::Message("No Library items were selected to copy.".to_owned()));
    }
    let copy_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let staging = env::temp_dir()
        .join("misty-library-clipboard")
        .join(copy_id.to_string());
    tokio::fs::create_dir_all(&staging).await.map_err(|error| {
        ApiError::Message(format!("The Library clipboard staging folder could not be created: {error}"))
    })?;

    let mut references = Vec::with_capacity(items.len());
    let mut used_names = HashSet::with_capacity(items.len());
    for (index, item) in items.into_iter().enumerate() {
        if item.bytes.is_empty() {
            return Err(ApiError::Message("A selected Library item is empty.".to_owned()));
        }
        let original_name = Path::new(item.name.trim())
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty() && *name != "." && *name != "..")
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Library item {}", index + 1));
        let original_path = Path::new(&original_name);
        let stem = original_path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("Library item")
            .to_owned();
        let extension = original_path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| format!(".{value}"))
            .unwrap_or_default();
        let mut file_name = original_name;
        let mut suffix = 2;
        while !used_names.insert(file_name.clone()) {
            file_name = format!("{stem} {suffix}{extension}");
            suffix += 1;
        }
        let path = staging.join(file_name);
        tokio::fs::write(&path, &item.bytes).await.map_err(|error| {
            ApiError::Message(format!("A Library item could not be prepared for the clipboard: {error}"))
        })?;
        references.push(PasteItem {
            path: path.to_string_lossy().into_owned(),
            is_directory: false,
            size_bytes: Some(item.bytes.len() as i64),
            remote_modified: None,
        });
    }
    crate::services::native_clipboard::write_native_clipboard_file_refs(&references)
}

#[tauri::command]
pub async fn notes_store_asset(
    request: NoteAssetStoreRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<NoteAssetStoreResult> {
    if request.bytes.is_empty() {
        return Err(ApiError::Message("The selected note file is empty.".to_owned()));
    }
    if request.bytes.len() > NOTE_ASSET_MAX_BYTES {
        return Err(ApiError::Message(
            "Note files must be 15 MB or smaller for this beta.".to_owned(),
        ));
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let original_name = safe_file_name(&request.file_name, "note-asset");
    let original_path = Path::new(&original_name);
    let stem = original_path
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("note-asset");
    let extension = original_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", safe_path_segment(value, "file")))
        .unwrap_or_default();
    let file_name = format!("{stem}-{timestamp}{extension}");
    let directory = state
        .environment
        .assets_dir()
        .join("notes")
        .join(safe_path_segment(&request.account_id, "account"))
        .join(safe_path_segment(&request.space_id, "space"))
        .join(safe_path_segment(&request.note_id, "note"));

    tokio::fs::create_dir_all(&directory).await.map_err(|error| {
        ApiError::Message(format!("Misty could not prepare note asset storage: {error}"))
    })?;
    let path = directory.join(&file_name);
    tokio::fs::write(&path, &request.bytes).await.map_err(|error| {
        ApiError::Message(format!("Misty could not save this note file: {error}"))
    })?;

    Ok(NoteAssetStoreResult {
        path: path.to_string_lossy().into_owned(),
        name: original_name,
        mime_type: request
            .mime_type
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
        byte_size: request.bytes.len() as u64,
    })
}

fn safe_file_name(value: &str, fallback: &str) -> String {
    let name = Path::new(value.trim())
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(fallback);
    safe_path_segment(name, fallback)
}

fn safe_path_segment(value: &str, fallback: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric()
                || matches!(character, '.' | '-' | '_' | ' ')
            {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches([' ', '.', '-'])
        .to_owned();
    if sanitized.is_empty() {
        fallback.to_owned()
    } else {
        sanitized
    }
}

#[tauri::command]
pub async fn explorer_list_directory(
    request: ListDirectoryRequest,
    app: AppHandle,
    state: State<'_, MistyRuntime>,
) -> ApiResult<DirectoryListing> {
    #[cfg(target_os = "android")]
    if state
        .explorer
        .is_android_local_virtual_path(request.path.as_deref())
    {
        return state
            .explorer
            .list_android_local_directory(&app, request)
            .await;
    }
    state.explorer.list_directory(request).await
}

#[cfg(target_os = "android")]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidGrantedFolder {
    pub uri: String,
    pub name: String,
    pub document_id: String,
    pub can_write: bool,
    pub path: String,
}

#[cfg(target_os = "android")]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidAllFilesAccessStatus {
    pub granted: bool,
    pub can_request: bool,
    pub storage_root: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidGrantLocalFolderRequest {
    pub initial_directory: Option<String>,
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn android_grant_local_folder(
    app: AppHandle,
    request: Option<AndroidGrantLocalFolderRequest>,
) -> ApiResult<AndroidGrantedFolder> {
    let folder = app
        .document_tree()
        .pick_tree(PickTreeRequest {
            initial_directory: request.and_then(|value| value.initial_directory),
        })
        .map_err(|error| ApiError::Message(error.to_string()))?;
    let digest = Sha256::digest(folder.uri.as_bytes());
    let location_id = hex::encode(&digest[..8]);
    Ok(AndroidGrantedFolder {
        uri: folder.uri,
        name: folder.name,
        document_id: folder.document_id,
        can_write: folder.can_write,
        path: format!("misty://local/{location_id}"),
    })
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn android_all_files_access_status(app: AppHandle) -> ApiResult<AndroidAllFilesAccessStatus> {
    let status = app
        .document_tree()
        .all_files_access_status()
        .map_err(|error| ApiError::Message(error.to_string()))?;
    Ok(AndroidAllFilesAccessStatus {
        granted: status.granted,
        can_request: status.can_request,
        storage_root: status.storage_root,
    })
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn android_open_all_files_access_settings(
    app: AppHandle,
) -> ApiResult<AndroidAllFilesAccessStatus> {
    let status = app
        .document_tree()
        .open_all_files_access_settings()
        .map_err(|error| ApiError::Message(error.to_string()))?;
    Ok(AndroidAllFilesAccessStatus {
        granted: status.granted,
        can_request: status.can_request,
        storage_root: status.storage_root,
    })
}

#[tauri::command]
pub async fn explorer_directory_size_snapshot(
    paths: Vec<String>,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<DirectorySizeRecord>> {
    state.directory_size.snapshot(paths).await
}

#[tauri::command]
pub async fn explorer_calculate_directory_sizes(
    request: DirectorySizeRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<DirectorySizeRecord>> {
    state.directory_size.calculate(request).await
}

#[tauri::command]
pub async fn search_init(state: State<'_, MistyRuntime>) -> ApiResult<SearchStatus> {
    state.search.init().await
}

#[tauri::command]
pub async fn search_get_status(state: State<'_, MistyRuntime>) -> ApiResult<SearchStatus> {
    state.search.status().await
}

#[tauri::command]
pub async fn search_start_scan(
    request: SearchScanRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<SearchStatus> {
    state.search.start_scan(request).await
}

#[tauri::command]
pub async fn search_cancel_scan(state: State<'_, MistyRuntime>) -> ApiResult<SearchStatus> {
    state.search.cancel_scan().await
}

#[tauri::command]
pub async fn search_query(
    request: SearchQueryRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<SearchResult>> {
    state.search.query(request).await
}

#[tauri::command]
pub async fn explorer_create_item(
    request: CreateItemRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerOperationResult> {
    state.explorer.create_item(request).await
}

#[tauri::command]
pub async fn explorer_rename_item(
    request: RenameItemRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerOperationResult> {
    state.explorer.rename_item(request).await
}

#[tauri::command]
pub async fn explorer_delete_items(
    request: DeleteItemsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerOperationResult> {
    state.explorer.delete_items(request).await
}

#[tauri::command]
pub async fn explorer_paste_items(
    request: PasteItemsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerOperationResult> {
    state.explorer.paste_items(request).await
}

#[tauri::command]
pub async fn explorer_prepare_open_item(
    request: PrepareOpenItemRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<PreparedOpenItem> {
    state.explorer.prepare_open_item(request).await
}

#[tauri::command]
pub async fn explorer_prepare_drag_items(
    request: PrepareDragItemsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<PreparedDragItemsResult> {
    state.explorer.prepare_drag_items(request).await
}

#[tauri::command]
pub async fn explorer_cancel_drag_preparation(
    session_id: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<()> {
    state.explorer.cancel_drag_preparation(&session_id).await;
    Ok(())
}

#[tauri::command]
pub async fn explorer_preview_item(
    path: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerPreviewPayload> {
    state.explorer.preview_item(&path).await
}

#[tauri::command]
pub async fn explorer_save_preview_item(
    request: SavePreviewRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerOperationResult> {
    state.explorer.save_preview_item(request).await
}

#[tauri::command]
pub async fn explorer_generate_image_thumbnail(
    path: String,
    max_dimension: u32,
    modified_ms: Option<u64>,
    remote_modified: Option<String>,
    size_bytes: Option<u64>,
    state: State<'_, MistyRuntime>,
) -> ApiResult<GeneratedImageThumbnail> {
    state
        .explorer
        .generate_image_thumbnail(
            &path,
            max_dimension,
            modified_ms,
            remote_modified.as_deref(),
            size_bytes,
        )
        .await
}

#[tauri::command]
pub async fn explorer_path_is_directory(
    path: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<bool> {
    Ok(state
        .explorer
        .item_is_directory(&path)
        .await?
        .unwrap_or(false))
}

#[tauri::command]
pub async fn explorer_path_exists(path: String, state: State<'_, MistyRuntime>) -> ApiResult<bool> {
    Ok(state.explorer.item_is_directory(&path).await?.is_some())
}

#[tauri::command]
pub async fn explorer_library_snapshot(
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerLibrarySnapshot> {
    state.explorer_library.snapshot().await
}

#[tauri::command]
pub async fn explorer_library_record_recent(
    request: RecordRecentRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerLibrarySnapshot> {
    state.explorer_library.record_recent(request).await
}

#[tauri::command]
pub async fn explorer_library_record_last_opened(
    request: RecordLastOpenedRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerLibrarySnapshot> {
    state.explorer_library.record_last_opened(request).await
}

#[tauri::command]
pub async fn explorer_library_set_tags(
    request: SetTagsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerLibrarySnapshot> {
    state.explorer_library.set_tags(request).await
}

#[tauri::command]
pub async fn smart_library_snapshot(
    state: State<'_, MistyRuntime>,
) -> ApiResult<SmartLibrarySnapshot> {
    state.smart_library.snapshot().await
}

#[tauri::command]
pub async fn smart_library_scan(
    request: SmartLibraryScanRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<FolderLibraryStatus> {
    state.smart_library.scan(request).await
}

#[tauri::command]
pub async fn smart_library_import_files(
    request: SmartLibraryImportFilesRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<SmartLibraryImportResult> {
    state.smart_library.import_files(request).await
}

#[tauri::command]
pub async fn smart_library_preflight_import(
    request: SmartLibraryImportFilesRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<SmartLibraryImportPreflight> {
    state.smart_library.preflight_import(request).await
}

#[tauri::command]
pub async fn smart_library_prepare_previews(
    request: PrepareSmartLibraryPreviewsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<PreparedSmartLibraryPreview>> {
    state.smart_library.prepare_previews(request).await
}

#[tauri::command]
pub async fn smart_library_apply_results(
    request: ApplySmartLibraryResultsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<SmartLibrarySnapshot> {
    state.smart_library.apply_results(request).await
}

#[tauri::command]
pub async fn smart_library_set_server_folder_id(
    server_folder_id: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<SmartLibrarySnapshot> {
    state
        .smart_library
        .set_server_folder_id(server_folder_id)
        .await
}

#[tauri::command]
pub async fn smart_library_search(
    request: SmartLibrarySearchRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<crate::services::smart_library::SmartLibraryAsset>> {
    state.smart_library.search(request).await
}

#[tauri::command]
pub async fn smart_library_resolve_assets(
    request: ResolveSmartLibraryAssetsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<ResolvedSmartLibraryAsset>> {
    state.smart_library.resolve_assets(request).await
}

#[tauri::command]
pub async fn smart_library_assets_page(
    request: SmartLibraryAssetsPageRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<SmartLibraryAssetsPage> {
    state.smart_library.assets_page(request).await
}

#[tauri::command]
pub async fn smart_library_delete(
    state: State<'_, MistyRuntime>,
) -> ApiResult<SmartLibrarySnapshot> {
    state.smart_library.delete().await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn media_search_scan_movies(
    state: State<'_, MistyRuntime>,
) -> ApiResult<MediaSearchSnapshot> {
    let service = state.media_search.clone();
    tokio::task::spawn_blocking(move || service.scan_movies())
        .await
        .map_err(|e| ApiError::Message(e.to_string()))?
}

#[cfg(desktop)]
#[tauri::command]
pub async fn media_search_snapshot(
    state: State<'_, MistyRuntime>,
) -> ApiResult<MediaSearchSnapshot> {
    state.media_search.snapshot()
}

#[cfg(desktop)]
#[tauri::command]
pub async fn media_search_prepare_chunk(
    request: PrepareMediaChunkRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<PreparedMediaChunk> {
    let service = state.media_search.clone();
    tokio::task::spawn_blocking(move || service.prepare_chunk(request))
        .await
        .map_err(|e| ApiError::Message(e.to_string()))?
}

#[cfg(desktop)]
#[tauri::command]
pub async fn media_search_complete(
    request: CompleteMediaAssetRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<MediaSearchSnapshot> {
    state.media_search.complete(request)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn media_search_approve_assets(
    request: ApproveMediaAssetsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<MediaSearchSnapshot> {
    state.media_search.approve_assets(request)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn media_search_acknowledge_removed_assets(
    request: AcknowledgeRemovedMediaAssetsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<MediaSearchSnapshot> {
    state.media_search.acknowledge_removed_assets(request)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn media_search_record_chunk(
    request: RecordMediaChunkRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<MediaSearchSnapshot> {
    state.media_search.record_chunk(request)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn media_search_set_asset_state(
    request: SetMediaAssetStateRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<MediaSearchSnapshot> {
    state.media_search.set_asset_state(request)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn media_search_reset_device_index(
    state: State<'_, MistyRuntime>,
) -> ApiResult<MediaSearchSnapshot> {
    state.media_search.reset_device_index()
}

#[cfg(desktop)]
#[tauri::command]
pub async fn media_search_complete_legacy_adoption(
    request: CompleteMediaLegacyAdoptionRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<MediaSearchSnapshot> {
    state.media_search.complete_legacy_adoption(request)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn media_search_resolve_assets(
    request: ResolveMediaAssetsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<ResolvedMediaAsset>> {
    state.media_search.resolve_assets(request)
}

#[tauri::command]
pub async fn explorer_open_with(application_path: String, file_path: String) -> ApiResult<()> {
    tokio::task::spawn_blocking(move || open_with_application(&application_path, &file_path))
        .await
        .map_err(|err| ApiError::Message(format!("Open With worker failed: {err}")))?
}

#[tauri::command]
pub async fn explorer_open_path(file_path: String) -> ApiResult<()> {
    tokio::task::spawn_blocking(move || open_path_default(&file_path))
        .await
        .map_err(|err| ApiError::Message(format!("Open file worker failed: {err}")))?
}

#[tauri::command]
pub async fn open_terminal_at_path(path: String) -> ApiResult<()> {
    tokio::task::spawn_blocking(move || open_terminal_default(&path))
        .await
        .map_err(|err| ApiError::Message(format!("Open terminal worker failed: {err}")))?
}

#[tauri::command]
pub async fn explorer_open_association(
    file_path: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Option<String>> {
    state
        .settings
        .open_with_association_for_path(file_path)
        .await
}

#[tauri::command]
pub async fn explorer_set_open_association(
    file_path: String,
    application_path: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<SettingsSnapshot> {
    state
        .settings
        .set_open_with_association_for_path(file_path, application_path)
        .await
}

#[tauri::command]
pub async fn settings_open_with_associations(
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<OpenWithAssociation>> {
    state.settings.open_with_associations().await
}

#[tauri::command]
pub async fn settings_remove_open_with_association(
    key: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<SettingsSnapshot> {
    state.settings.remove_open_with_association(key).await
}

#[tauri::command]
pub async fn explorer_queue_paste_items(
    request: PasteItemsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.enqueue_paste_items(request).await
}

#[tauri::command]
pub async fn explorer_queue_paste_text(
    request: PasteTextRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    let paste_request = state.explorer.stage_clipboard_text_paste(request).await?;
    state
        .operation_queue
        .enqueue_paste_items(paste_request)
        .await
}

#[tauri::command]
pub async fn explorer_queue_paste_blob(
    request: PasteBlobRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    let paste_request = state.explorer.stage_clipboard_blob_paste(request).await?;
    state
        .operation_queue
        .enqueue_paste_items(paste_request)
        .await
}

#[tauri::command]
pub async fn explorer_queue_create_item(
    request: CreateItemRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.enqueue_create_item(request).await
}

#[tauri::command]
pub async fn explorer_queue_rename_item(
    request: RenameItemRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.enqueue_rename_item(request).await
}

#[tauri::command]
pub async fn explorer_queue_rename_items(
    request: RenameItemsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.enqueue_rename_items(request).await
}

#[tauri::command]
pub async fn explorer_queue_delete_items(
    request: DeleteItemsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.enqueue_delete_items(request).await
}

#[tauri::command]
pub async fn workspaces_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<WorkspaceDocument> {
    state.workspaces.snapshot().await
}

#[tauri::command]
pub async fn workspaces_save(
    document: WorkspaceDocument,
    state: State<'_, MistyRuntime>,
) -> ApiResult<WorkspaceDocument> {
    state.workspaces.save(document).await
}

#[tauri::command]
pub async fn settings_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<SettingsSnapshot> {
    state.settings.snapshot().await
}

#[tauri::command]
pub async fn settings_save(
    request: SaveSettingsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<SettingsSnapshot> {
    state.settings.save(request).await
}

#[tauri::command]
pub fn settings_launch_on_login_snapshot() -> ApiResult<LaunchOnLoginSnapshot> {
    Ok(crate::services::autostart::snapshot())
}

#[tauri::command]
pub fn settings_apply_launch_on_login(enabled: bool) -> ApiResult<LaunchOnLoginSnapshot> {
    crate::services::autostart::apply(enabled).map_err(ApiError::Message)
}

#[tauri::command]
pub async fn shortcuts_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<ShortcutsSnapshot> {
    state.commands.snapshot().await
}

#[tauri::command]
pub async fn shortcuts_save(
    request: SaveShortcutsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ShortcutsSnapshot> {
    state.commands.save(request).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn plugin_commands_snapshot(
    state: State<'_, MistyRuntime>,
) -> ApiResult<PluginCommandsSnapshot> {
    state.plugin_commands.snapshot().await
}

#[cfg(mobile)]
#[tauri::command]
pub async fn plugin_commands_snapshot() -> ApiResult<serde_json::Value> {
    Err(mobile_plugins_unavailable())
}

#[cfg(desktop)]
#[tauri::command]
pub async fn plugin_command_run(
    request: RunPluginCommandRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<PluginCommandRunResult> {
    state.plugin_commands.run_command(request).await
}

#[cfg(mobile)]
#[tauri::command]
pub async fn plugin_command_run(_request: serde_json::Value) -> ApiResult<serde_json::Value> {
    Err(mobile_plugins_unavailable())
}

#[cfg(desktop)]
#[tauri::command]
pub async fn plugin_panel_render(
    request: RenderPluginPanelRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<PluginPanelRenderResult> {
    state.plugin_commands.render_panel(request).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn extension_command_run(
    request: crate::services::extension_runtime::ExtensionCommandRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<serde_json::Value> {
    state.extension_runtime.execute(request).await
}

#[cfg(mobile)]
#[tauri::command]
pub async fn extension_command_run(_request: serde_json::Value) -> ApiResult<serde_json::Value> {
    Err(mobile_plugins_unavailable())
}

#[cfg(mobile)]
#[tauri::command]
pub async fn plugin_panel_render(_request: serde_json::Value) -> ApiResult<serde_json::Value> {
    Err(mobile_plugins_unavailable())
}

#[cfg(desktop)]
#[tauri::command]
pub async fn plugin_diagnostics_snapshot(
    state: State<'_, MistyRuntime>,
) -> ApiResult<PluginDiagnosticsSnapshot> {
    state.plugin_commands.diagnostics().await
}

#[cfg(mobile)]
#[tauri::command]
pub async fn plugin_diagnostics_snapshot() -> ApiResult<serde_json::Value> {
    Err(mobile_plugins_unavailable())
}

#[cfg(mobile)]
fn mobile_plugins_unavailable() -> ApiError {
    ApiError::Unavailable("Extensions are not available in Misty mobile.".to_owned())
}

#[tauri::command]
pub async fn devices_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<DeviceSnapshot> {
    let devices = state.devices.clone();
    tokio::task::spawn_blocking(move || devices.snapshot())
        .await
        .map_err(|err| ApiError::Message(format!("Device scan failed: {err}")))
}

#[tauri::command]
pub async fn providers_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<ProvidersSnapshot> {
    state.providers.snapshot().await
}

#[tauri::command]
pub async fn providers_refresh(state: State<'_, MistyRuntime>) -> ApiResult<ProvidersSnapshot> {
    state.providers.refresh().await
}

#[tauri::command]
pub async fn providers_select_remote(
    name: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<RemoteEditDraft> {
    state.providers.select_remote(name).await
}

#[tauri::command]
pub async fn providers_save_remote(
    request: SaveRemoteRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<RemoteEditDraft> {
    state.providers.save_remote(request).await
}

#[tauri::command]
pub async fn providers_test_remote(
    name: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<RemoteTestResult> {
    state.providers.test_remote(name).await
}

#[tauri::command]
pub async fn providers_config_paths(
    state: State<'_, MistyRuntime>,
) -> ApiResult<RcloneConfigPaths> {
    state.providers.config_paths().await
}

#[tauri::command]
pub async fn providers_configure_remote(
    request: ProviderConfigRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ProviderConfigStep> {
    state.providers.configure_remote(request).await
}

#[tauri::command]
pub async fn providers_verify_start(
    request: VerifyStartRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ProviderJobStart> {
    state.providers.start_verify(request).await
}

#[tauri::command]
pub async fn providers_job_status(
    job_id: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ProviderJobStatus> {
    state.providers.job_status(job_id).await
}

#[tauri::command]
pub async fn providers_job_cancel(
    job_id: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<serde_json::Value> {
    state.providers.cancel_job(job_id).await
}

#[tauri::command]
pub async fn providers_verify_result(
    job_id: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<VerifyResult> {
    state.providers.verify_result(job_id).await
}

#[tauri::command]
pub async fn providers_backend_actions(
    remote: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<BackendAction>> {
    state.providers.backend_actions(remote).await
}

#[tauri::command]
pub async fn providers_run_backend_action(
    request: BackendRunRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<BackendActionResult> {
    state.providers.run_backend_action(request).await
}

#[tauri::command]
pub async fn providers_config_security(
    state: State<'_, MistyRuntime>,
) -> ApiResult<ConfigSecurityStatus> {
    state.providers.config_security().await
}

#[tauri::command]
pub async fn providers_harden_config(
    state: State<'_, MistyRuntime>,
) -> ApiResult<ConfigSecurityStatus> {
    state.providers.harden_config().await
}

#[tauri::command]
pub async fn providers_repair_config_security(
    password: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ConfigSecurityStatus> {
    state.providers.repair_config_security(password).await
}

#[tauri::command]
pub async fn providers_disconnect_remote(
    name: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ProvidersSnapshot> {
    state.providers.disconnect_remote(name).await
}

#[tauri::command]
pub async fn transfers_snapshot(
    filter: Option<TransferFilter>,
    state: State<'_, MistyRuntime>,
) -> ApiResult<TransferPage> {
    state.transfers.snapshot(filter.unwrap_or_default()).await
}

#[tauri::command]
pub async fn transfers_delete_selected(
    ids: Vec<u64>,
    state: State<'_, MistyRuntime>,
) -> ApiResult<()> {
    state.transfers.delete_selected(ids).await
}

#[tauri::command]
pub async fn transfers_delete_all(state: State<'_, MistyRuntime>) -> ApiResult<()> {
    state.transfers.delete_all().await
}

fn open_with_application(application_path: &str, file_path: &str) -> ApiResult<()> {
    if application_path.trim().is_empty() || file_path.trim().is_empty() {
        return Err(ApiError::Message(
            "Application path and file path are required.".to_owned(),
        ));
    }

    #[cfg(target_os = "macos")]
    let spawn_result = Command::new("open")
        .arg("-a")
        .arg(application_path)
        .arg(file_path)
        .spawn();

    #[cfg(not(target_os = "macos"))]
    let spawn_result = Command::new(application_path).arg(file_path).spawn();

    spawn_result
        .map(|_| ())
        .map_err(|err| ApiError::Message(format!("Failed to open file with application: {err}")))
}

fn open_path_default(file_path: &str) -> ApiResult<()> {
    if file_path.trim().is_empty() {
        return Err(ApiError::Message("File path is required.".to_owned()));
    }

    #[cfg(target_os = "macos")]
    let spawn_result = Command::new("open").arg(file_path).spawn();

    #[cfg(target_os = "windows")]
    let spawn_result = Command::new("cmd")
        .args(["/C", "start", "", file_path])
        .spawn();

    #[cfg(all(unix, not(any(target_os = "macos", target_os = "ios"))))]
    let spawn_result = Command::new("xdg-open").arg(file_path).spawn();

    #[cfg(any(target_os = "ios", target_os = "android"))]
    let spawn_result: Result<std::process::Child, std::io::Error> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "opening local files with the default app is not supported on this platform",
    ));

    spawn_result
        .map(|_| ())
        .map_err(|err| ApiError::Message(format!("Failed to open file: {err}")))
}

fn open_terminal_default(path: &str) -> ApiResult<()> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(ApiError::Message("Folder path is required.".to_owned()));
    }
    let folder = Path::new(trimmed);
    if !folder.is_dir() {
        return Err(ApiError::Message(format!("{trimmed} is not a folder.")));
    }

    #[cfg(target_os = "macos")]
    {
        return Command::new("open")
            .arg("-a")
            .arg("Terminal")
            .arg(trimmed)
            .spawn()
            .map(|_| ())
            .map_err(|err| ApiError::Message(format!("Failed to open Terminal: {err}")));
    }

    #[cfg(target_os = "windows")]
    {
        match Command::new("wt").arg("-d").arg(trimmed).spawn() {
            Ok(_) => return Ok(()),
            Err(wt_err) => {
                return Command::new("cmd")
                    .args(["/C", "start", "", "cmd", "/K", "cd", "/d"])
                    .arg(trimmed)
                    .spawn()
                    .map(|_| ())
                    .map_err(|cmd_err| {
                        ApiError::Message(format!(
                            "Failed to open Windows Terminal ({wt_err}) or Command Prompt ({cmd_err})."
                        ))
                    });
            }
        }
    }

    #[cfg(all(
        unix,
        not(any(target_os = "macos", target_os = "ios", target_os = "android"))
    ))]
    {
        let mut candidates = Vec::<String>::new();
        if let Ok(terminal) = env::var("TERMINAL") {
            let terminal = terminal.trim();
            if !terminal.is_empty() {
                candidates.push(terminal.to_owned());
            }
        }
        candidates.extend([
            "x-terminal-emulator".to_owned(),
            "gnome-terminal".to_owned(),
            "konsole".to_owned(),
            "xfce4-terminal".to_owned(),
            "alacritty".to_owned(),
            "kitty".to_owned(),
            "xterm".to_owned(),
        ]);

        let mut errors = Vec::new();
        for candidate in candidates {
            match Command::new(&candidate).current_dir(folder).spawn() {
                Ok(_) => return Ok(()),
                Err(err) => errors.push(format!("{candidate}: {err}")),
            }
        }
        return Err(ApiError::Message(format!(
            "Failed to open a terminal for {trimmed}. Tried: {}",
            errors.join("; ")
        )));
    }

    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        Err(ApiError::Message(
            "Opening a terminal is not supported on this platform.".to_owned(),
        ))
    }
}

#[tauri::command]
pub async fn operation_queue_snapshot(
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    Ok(state.operation_queue.snapshot().await)
}

#[tauri::command]
pub async fn operation_queue_cancel(
    operation_id: u64,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.cancel(operation_id).await
}

#[tauri::command]
pub async fn operation_queue_cancel_batch(
    batch_id: u64,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.cancel_batch(batch_id).await
}

#[tauri::command]
pub async fn operation_queue_retry(
    operation_id: u64,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.retry(operation_id).await
}

#[tauri::command]
pub async fn operation_queue_retry_transfer(
    transfer_id: u64,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.retry_transfer(transfer_id).await
}

#[tauri::command]
pub async fn operation_queue_pause(
    operation_id: u64,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.pause(operation_id).await
}

#[tauri::command]
pub async fn operation_queue_resume(
    operation_id: u64,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.resume(operation_id).await
}

#[tauri::command]
pub async fn operation_queue_pause_batch(
    batch_id: u64,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.pause_batch(batch_id).await
}

#[tauri::command]
pub async fn operation_queue_resume_batch(
    batch_id: u64,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.resume_batch(batch_id).await
}

#[tauri::command]
pub async fn operation_queue_pause_all(
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    Ok(state.operation_queue.pause_all().await)
}

#[tauri::command]
pub async fn operation_queue_resume_all(
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    Ok(state.operation_queue.resume_all().await)
}

#[tauri::command]
pub async fn operation_queue_set_bandwidth_limit(
    limit: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    Ok(state.operation_queue.set_bandwidth_limit(limit).await)
}

#[tauri::command]
pub async fn operation_queue_set_transfer_profile(
    profile_id: String,
    profile_name: String,
    max_concurrent: usize,
    bandwidth_limit: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    Ok(state
        .operation_queue
        .set_transfer_profile(profile_id, profile_name, max_concurrent, bandwidth_limit)
        .await)
}

#[tauri::command]
pub async fn operation_queue_undo(
    undo_token_id: u64,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.undo(undo_token_id).await
}

#[tauri::command]
pub async fn operation_queue_redo(
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.redo().await
}

#[tauri::command]
pub async fn operation_queue_resolve_conflict(
    operation_id: u64,
    policy: ConflictPolicy,
    apply_to_batch: bool,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state
        .operation_queue
        .resolve_conflict(operation_id, policy, apply_to_batch)
        .await
}

#[tauri::command]
pub async fn operation_queue_clear_terminal(
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    Ok(state.operation_queue.clear_terminal().await)
}

#[tauri::command]
pub async fn file_sync_pairs_snapshot(
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<FileSyncPair>> {
    state.file_sync.pairs_snapshot().await
}

#[tauri::command]
pub async fn file_sync_pair_save(
    pair: FileSyncPair,
    state: State<'_, MistyRuntime>,
) -> ApiResult<FileSyncPair> {
    state.file_sync.save_pair(pair).await
}

#[tauri::command]
pub async fn file_sync_pair_remove(pair_id: i64, state: State<'_, MistyRuntime>) -> ApiResult<()> {
    state.file_sync.remove_pair(pair_id).await
}

#[tauri::command]
pub async fn file_sync_compare(
    request: FileSyncCompareRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<crate::core::file_sync::FileSyncCompareResult> {
    Ok(state.file_sync.compare(request).await)
}

#[tauri::command]
pub async fn file_sync_apply(
    request: FileSyncApplyRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<FileSyncApplyResult> {
    state.file_sync.apply(request).await
}

#[tauri::command]
pub async fn archive_list(
    request: ArchiveListRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ArchiveListResult> {
    state.power_pack.archive_list(request).await
}

#[tauri::command]
pub async fn archive_create(
    request: ArchiveCreateRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ArchiveActionResult> {
    state.power_pack.archive_create(request).await
}

#[tauri::command]
pub async fn archive_extract(
    request: ArchiveExtractRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ArchiveActionResult> {
    state.power_pack.archive_extract(request).await
}

#[tauri::command]
pub async fn duplicates_scan(
    request: DuplicateScanRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<DuplicateScanResult> {
    state.power_pack.duplicates_scan(request).await
}

#[tauri::command]
pub async fn duplicates_cancel(scan_id: String, state: State<'_, MistyRuntime>) -> ApiResult<bool> {
    state.power_pack.duplicates_cancel(scan_id).await
}

#[tauri::command]
pub async fn duplicates_hash_remote_candidates(
    scan_id: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<DuplicateScanResult> {
    state
        .power_pack
        .duplicates_hash_remote_candidates(scan_id)
        .await
}

#[tauri::command]
pub async fn saved_searches_snapshot(
    state: State<'_, MistyRuntime>,
) -> ApiResult<SavedSearchesSnapshot> {
    state.power_pack.saved_searches_snapshot().await
}

#[tauri::command]
pub async fn saved_searches_save(
    search: SavedSearch,
    state: State<'_, MistyRuntime>,
) -> ApiResult<SavedSearchesSnapshot> {
    state.power_pack.saved_searches_save(search).await
}

#[tauri::command]
pub async fn saved_searches_delete(
    id: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<SavedSearchesSnapshot> {
    state.power_pack.saved_searches_delete(id).await
}

#[tauri::command]
pub async fn compare_files(
    request: CompareFilesRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<CompareFilesResult> {
    state.power_pack.compare_files(request).await
}

#[tauri::command]
pub async fn compare_folders(
    request: CompareFoldersRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<CompareFoldersResult> {
    state.power_pack.compare_folders(request).await
}

#[tauri::command]
pub async fn compare_apply_text_merge(
    merged_text: String,
    target_path: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<FileToolsActionResult> {
    state
        .power_pack
        .compare_apply_text_merge(merged_text, target_path)
        .await
}

#[tauri::command]
pub async fn file_tools_checksum(
    request: FileToolsChecksumRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<FileToolsChecksumResult> {
    state.power_pack.file_tools_checksum(request).await
}

#[tauri::command]
pub async fn file_tools_set_readonly(
    request: FileToolsReadonlyRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<FileToolsActionResult> {
    state.power_pack.file_tools_set_readonly(request).await
}

#[tauri::command]
pub async fn file_tools_chmod(
    request: FileToolsChmodRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<FileToolsActionResult> {
    state.power_pack.file_tools_chmod(request).await
}

#[tauri::command]
pub async fn file_tools_create_symlink(
    request: FileToolsSymlinkRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<FileToolsActionResult> {
    state.power_pack.file_tools_create_symlink(request).await
}

#[tauri::command]
pub async fn file_tools_read_symlink(
    request: FileToolsSymlinkTargetRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<FileToolsSymlinkTargetResult> {
    state.power_pack.file_tools_read_symlink(request).await
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct Placeholder {}
