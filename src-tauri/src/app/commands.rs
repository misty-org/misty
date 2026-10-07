use std::{
    collections::HashSet,
    env,
    path::Path,
    process::Command,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::app::runtime::MistyRuntime;
use crate::domain::clipboard::{ClipboardImage, ClipboardPayload, ClipboardPayloadKind};
use crate::domain::explorer::{
    ClipboardOperation, CreateItemRequest, DeleteItemsRequest, DirectoryListing,
    ExplorerOperationResult, ExplorerPreviewPayload, GeneratedImageThumbnail, ListDirectoryRequest,
    PasteBlobRequest, PasteItem, PasteItemsRequest, PasteTextRequest, PrepareDragItemsRequest,
    PrepareOpenItemRequest, PreparedDragItem, PreparedDragItemsResult, PreparedDragSkippedItem,
    PreparedOpenItem, RenameItemRequest, RenameItemsRequest,
};
use crate::domain::file_sync::FileSyncPair;
use crate::domain::operation_queue::{ConflictPolicy, OperationQueueSnapshot};
use crate::domain::workspace::WorkspaceDocument;
use crate::error::{ApiError, ApiResult};
use crate::infra::agents::PrepareScopedAgentDocumentRequest;
use crate::infra::autostart::LaunchOnLoginSnapshot;
use crate::infra::connected_devices::{
    ConnectedDevicesService, ConnectedDevicesSnapshot, InitializeConnectedDevicesRequest,
    PeerPathRequest, PeerReadRequest,
};
use crate::infra::devices::{DeviceSnapshot, DeviceUnmountRequest};
use crate::infra::directory_size::{DirectorySizeRecord, DirectorySizeRequest};
#[cfg(not(target_os = "macos"))]
use crate::infra::document_intelligence::PrepareAgentDocumentRequest;
use crate::infra::document_intelligence::PreparedAgentDocument;
use crate::infra::environment::AppEnvironmentSnapshot;
use crate::infra::explorer::SavePreviewRequest;
use crate::infra::explorer_library::{
    ExplorerLibrarySnapshot, RecordLastOpenedRequest, RecordRecentRequest, SetTagsRequest,
};
use crate::infra::file_sync::{FileSyncApplyRequest, FileSyncApplyResult, FileSyncCompareRequest};
#[cfg(desktop)]
use crate::infra::media_search::{
    AcknowledgeRemovedMediaAssetsRequest, ApproveMediaAssetsRequest, CompleteMediaAssetRequest,
    CompleteMediaLegacyAdoptionRequest, MediaSearchSnapshot, PrepareMediaChunkRequest,
    PreparedMediaChunk, RecordMediaChunkRequest, ResolveMediaAssetsRequest, ResolvedMediaAsset,
    SetMediaAssetStateRequest,
};
use crate::infra::metadata::FileMetadataSnapshot;
use crate::infra::power_pack::{
    ArchiveActionResult, ArchiveCreateRequest, ArchiveExtractRequest, ArchiveListRequest,
    ArchiveListResult, CompareFilesRequest, CompareFilesResult, CompareFoldersRequest,
    CompareFoldersResult, DuplicateScanRequest, DuplicateScanResult, FileToolsActionResult,
    FileToolsChecksumRequest, FileToolsChecksumResult, FileToolsChmodRequest,
    FileToolsReadonlyRequest, FileToolsSymlinkRequest, FileToolsSymlinkTargetRequest,
    FileToolsSymlinkTargetResult, SavedSearch, SavedSearchesSnapshot,
};
use crate::infra::search::{SearchQueryRequest, SearchResult, SearchScanRequest, SearchStatus};
use crate::infra::settings::{OpenWithAssociation, SaveSettingsRequest, SettingsSnapshot};
use crate::infra::smart_library::{
    ApplySmartLibraryResultsRequest, FolderLibraryStatus, PrepareSmartLibraryPreviewsRequest,
    PreparedSmartLibraryPreview, ResolveSmartLibraryAssetsRequest, ResolvedSmartLibraryAsset,
    SmartLibraryAssetsPage, SmartLibraryAssetsPageRequest, SmartLibraryImportFilesRequest,
    SmartLibraryImportPreflight, SmartLibraryImportResult, SmartLibraryScanRequest,
    SmartLibrarySearchRequest, SmartLibrarySnapshot,
};
use crate::infra::transfers::{TransferFilter, TransferPage};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    app_name: &'static str,
    version: &'static str,
    migration_stage: &'static str,
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
        environment: state.environment.snapshot(),
    })
}

#[tauri::command]
pub async fn agents_device_snapshot(
    state: State<'_, MistyRuntime>,
) -> ApiResult<serde_json::Value> {
    state.agents.device_snapshot().await
}

#[tauri::command]
pub async fn agents_revoke_folder_scope(
    scope_id: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<()> {
    state.agents.revoke_folder_scope(scope_id).await
}

/// Shows the native folder picker and grants the chosen folder to agents on
/// this device. A page can never name a path itself.
#[tauri::command]
pub async fn agents_choose_folder_scope(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Option<serde_json::Value>> {
    use tauri_plugin_dialog::DialogExt;
    if webview.label() != "main" {
        return Err(crate::error::ApiError::Message(
            "Open the main Misty window to share a folder with agents.".into(),
        ));
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a folder Misty agents can read")
        .pick_folder(move |folder| {
            let _ = send.send(folder);
        });
    let Some(folder) = receive
        .await
        .map_err(|_| crate::error::ApiError::Message("Folder selection was canceled.".into()))?
    else {
        return Ok(None);
    };
    let path = folder
        .into_path()
        .map_err(|_| crate::error::ApiError::Message("Choose a local folder.".into()))?;
    state.agents.register_folder_scope(path).await.map(Some)
}

#[tauri::command]
pub async fn agents_list_scoped_files(
    webview: tauri::Webview,
    request: crate::infra::agents::ListScopedFilesRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<serde_json::Value> {
    if webview.label() != "main" {
        return Err(crate::error::ApiError::Message(
            "Only the Host can process approved device scopes.".into(),
        ));
    }
    state.agents.list_scoped_files(request).await
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn agents_prepare_document(
    request: PrepareAgentDocumentRequest,
) -> ApiResult<PreparedAgentDocument> {
    crate::infra::document_intelligence::prepare_document(request).await
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn agents_prepare_scoped_document(
    webview: tauri::Webview,
    instance: String,
    request: PrepareScopedAgentDocumentRequest,
    state: State<'_, MistyRuntime>,
    native: State<'_, crate::platform::mini_app::MiniAppState>,
) -> ApiResult<PreparedAgentDocument> {
    if webview.label() != "main" {
        return Err(crate::error::ApiError::Message(
            "Only the Host can process approved device scopes.".into(),
        ));
    }
    let lease = Arc::new(
        crate::infra::document_intelligence::ServiceLease::acquire(&native, &instance, "files")
            .await
            .map_err(crate::error::ApiError::Message)?,
    );
    let _cancel = lease.cancel_on_drop();
    let target = state.agents.scoped_document_path(request).await?;
    let worker = lease.clone();
    let result = tokio::task::spawn_blocking(move || worker.process(&target, "document"))
        .await
        .map_err(|_| crate::error::ApiError::Message("Document worker failed.".into()))?;
    lease
        .validate(&native, &instance)
        .map_err(crate::error::ApiError::Message)?;
    let response = result.map_err(crate::error::ApiError::Message)?;
    serde_json::from_value(
        response
            .get("document")
            .cloned()
            .ok_or_else(|| crate::error::ApiError::Message("No document returned.".into()))?,
    )
    .map_err(|_| crate::error::ApiError::Message("Invalid document response.".into()))
}
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn agents_prepare_scoped_document(
    request: PrepareScopedAgentDocumentRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<PreparedAgentDocument> {
    let target = state.agents.scoped_document_path(request).await?;
    crate::infra::document_intelligence::prepare_document(PrepareAgentDocumentRequest {
        path: target.to_string_lossy().into_owned(),
    })
    .await
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
    crate::infra::native_clipboard::native_clipboard_file_refs()
}

#[tauri::command]
pub fn clipboard_write_file_refs(items: Vec<PasteItem>) -> ApiResult<bool> {
    crate::infra::native_clipboard::write_native_clipboard_file_refs(&items)
}

#[tauri::command]
pub async fn clipboard_write_file_bytes(items: Vec<ClipboardFileBytes>) -> ApiResult<bool> {
    if items.is_empty() {
        return Err(ApiError::Message(
            "No Library items were selected to copy.".to_owned(),
        ));
    }
    let copy_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let staging = env::temp_dir()
        .join("misty-library-clipboard")
        .join(copy_id.to_string());
    tokio::fs::create_dir_all(&staging).await.map_err(|error| {
        ApiError::Message(format!(
            "The Library clipboard staging folder could not be created: {error}"
        ))
    })?;

    let mut references = Vec::with_capacity(items.len());
    let mut used_names = HashSet::with_capacity(items.len());
    for (index, item) in items.into_iter().enumerate() {
        if item.bytes.is_empty() {
            return Err(ApiError::Message(
                "A selected Library item is empty.".to_owned(),
            ));
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
        tokio::fs::write(&path, &item.bytes)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "A Library item could not be prepared for the clipboard: {error}"
                ))
            })?;
        references.push(PasteItem {
            path: path.to_string_lossy().into_owned(),
            is_directory: false,
            size_bytes: Some(item.bytes.len() as i64),
            remote_modified: None,
        });
    }
    crate::infra::native_clipboard::write_native_clipboard_file_refs(&references)
}

#[tauri::command]
pub async fn explorer_list_directory(
    request: ListDirectoryRequest,
    app: AppHandle,
    state: State<'_, MistyRuntime>,
) -> ApiResult<DirectoryListing> {
    #[cfg(desktop)]
    if request
        .path
        .as_deref()
        .is_some_and(|path| path.starts_with("misty://device/"))
    {
        use crate::domain::connected_devices::{PeerEntryKind, PeerResponse};
        use crate::domain::explorer::{ExplorerLocation, FileEntry, FileKind};
        use crate::infra::peer_files::PeerVirtualPath;
        use sha2::{Digest, Sha256};

        let path = request.path.clone().unwrap_or_default();
        let parsed = PeerVirtualPath::parse(&path)?;
        let response = state
            .connected_devices
            .list_directory(PeerPathRequest {
                device_id: parsed.device_id.clone(),
                path: path.clone(),
                show_hidden: request.show_hidden.unwrap_or(false),
            })
            .await?;
        let PeerResponse::Directory {
            entries,
            snapshot: _,
            writable,
            ..
        } = response
        else {
            return Err(ApiError::Message(
                "Peer returned an unexpected directory response.".to_owned(),
            ));
        };
        let location = ExplorerLocation::peer_device(
            parsed.device_id.clone(),
            parsed.root_id.clone(),
            parsed.relative_path.to_string_lossy().into_owned(),
            writable,
        );
        let total_count = entries.len();
        let hidden_count = entries.iter().filter(|entry| entry.hidden).count();
        let entries = entries
            .into_iter()
            .map(|entry| {
                let extension = std::path::Path::new(&entry.name)
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or("")
                    .to_owned();
                let mut hasher = Sha256::new();
                hasher.update(entry.path.as_bytes());
                FileEntry {
                    id: format!("peer_{}", hex::encode(&hasher.finalize()[..16])),
                    name: entry.name,
                    path: entry.path,
                    extension,
                    mime_type: None,
                    remote_modified: Some(entry.snapshot),
                    kind: match entry.kind {
                        PeerEntryKind::File => FileKind::File,
                        PeerEntryKind::Directory => FileKind::Folder,
                        PeerEntryKind::Symlink => FileKind::Symlink,
                    },
                    size_bytes: entry.size_bytes,
                    modified_ms: entry.modified_ms,
                    created_ms: None,
                    readonly: entry.readonly,
                    hidden: entry.hidden,
                    is_deleted: false,
                    location: location.clone(),
                }
            })
            .collect();
        let parent_path = if parsed.relative_path.as_os_str().is_empty() {
            None
        } else {
            let parent = parsed
                .relative_path
                .parent()
                .unwrap_or_else(|| std::path::Path::new(""));
            Some(PeerVirtualPath::format(
                &parsed.device_id,
                &parsed.root_id,
                parent,
            )?)
        };
        return Ok(DirectoryListing {
            path,
            title: None,
            parent_path,
            location,
            entries,
            total_count,
            hidden_count,
            modified_ms: None,
            created_ms: None,
        });
    }

    state.explorer.list_directory(request).await
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

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn search_init(
    webview: tauri::Webview,
    instance: String,
    state: State<'_, MistyRuntime>,
    native: State<'_, crate::platform::mini_app::MiniAppState>,
) -> ApiResult<SearchStatus> {
    if webview.label() != "main" {
        return Err(crate::error::ApiError::Message(
            "Only the Host can access Files search.".into(),
        ));
    }
    let lease = crate::infra::document_intelligence::ServiceLease::acquire_service(
        &native,
        &instance,
        "files",
        "file-search",
        1,
    )
    .await
    .map_err(crate::error::ApiError::Message)?;
    let search = state.search.authorized(lease)?;
    tokio::task::spawn_blocking(move || tauri::async_runtime::block_on(search.init()))
        .await
        .map_err(|e| crate::error::ApiError::Message(e.to_string()))?
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn search_get_status(
    webview: tauri::Webview,
    instance: String,
    state: State<'_, MistyRuntime>,
    native: State<'_, crate::platform::mini_app::MiniAppState>,
) -> ApiResult<SearchStatus> {
    if webview.label() != "main" {
        return Err(crate::error::ApiError::Message(
            "Only the Host can access Files search.".into(),
        ));
    }
    let lease = crate::infra::document_intelligence::ServiceLease::acquire_service(
        &native,
        &instance,
        "files",
        "file-search",
        1,
    )
    .await
    .map_err(crate::error::ApiError::Message)?;
    let search = state.search.authorized(lease)?;
    tokio::task::spawn_blocking(move || tauri::async_runtime::block_on(search.status()))
        .await
        .map_err(|e| crate::error::ApiError::Message(e.to_string()))?
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn search_start_scan(
    webview: tauri::Webview,
    instance: String,
    request: SearchScanRequest,
    state: State<'_, MistyRuntime>,
    native: State<'_, crate::platform::mini_app::MiniAppState>,
) -> ApiResult<SearchStatus> {
    if webview.label() != "main" {
        return Err(crate::error::ApiError::Message(
            "Only the Host can access Files search.".into(),
        ));
    }
    let lease = crate::infra::document_intelligence::ServiceLease::acquire_service(
        &native,
        &instance,
        "files",
        "file-search",
        1,
    )
    .await
    .map_err(crate::error::ApiError::Message)?;
    let search = state.search.authorized(lease)?;
    tokio::task::spawn_blocking(move || tauri::async_runtime::block_on(search.start_scan(request)))
        .await
        .map_err(|e| crate::error::ApiError::Message(e.to_string()))?
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn search_cancel_scan(
    webview: tauri::Webview,
    instance: String,
    state: State<'_, MistyRuntime>,
    native: State<'_, crate::platform::mini_app::MiniAppState>,
) -> ApiResult<SearchStatus> {
    if webview.label() != "main" {
        return Err(crate::error::ApiError::Message(
            "Only the Host can access Files search.".into(),
        ));
    }
    let lease = crate::infra::document_intelligence::ServiceLease::acquire_service(
        &native,
        &instance,
        "files",
        "file-search",
        1,
    )
    .await
    .map_err(crate::error::ApiError::Message)?;
    let search = state.search.authorized(lease)?;
    tokio::task::spawn_blocking(move || tauri::async_runtime::block_on(search.cancel_scan()))
        .await
        .map_err(|e| crate::error::ApiError::Message(e.to_string()))?
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn search_query(
    webview: tauri::Webview,
    instance: String,
    request: SearchQueryRequest,
    state: State<'_, MistyRuntime>,
    native: State<'_, crate::platform::mini_app::MiniAppState>,
) -> ApiResult<Vec<SearchResult>> {
    if webview.label() != "main" {
        return Err(crate::error::ApiError::Message(
            "Only the Host can access Files search.".into(),
        ));
    }
    let lease = crate::infra::document_intelligence::ServiceLease::acquire_service(
        &native,
        &instance,
        "files",
        "file-search",
        1,
    )
    .await
    .map_err(crate::error::ApiError::Message)?;
    let search = state.search.authorized(lease)?;
    tokio::task::spawn_blocking(move || tauri::async_runtime::block_on(search.query(request)))
        .await
        .map_err(|e| crate::error::ApiError::Message(e.to_string()))?
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn search_init(state: State<'_, MistyRuntime>) -> ApiResult<SearchStatus> {
    state.search.init().await
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn search_get_status(state: State<'_, MistyRuntime>) -> ApiResult<SearchStatus> {
    state.search.status().await
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn search_start_scan(
    request: SearchScanRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<SearchStatus> {
    state.search.start_scan(request).await
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn search_cancel_scan(state: State<'_, MistyRuntime>) -> ApiResult<SearchStatus> {
    state.search.cancel_scan().await
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn search_query(
    request: SearchQueryRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<SearchResult>> {
    state.search.query(request).await
}

#[cfg(desktop)]
async fn materialize_peer_paste_sources(
    request: &mut PasteItemsRequest,
    connected_devices: &ConnectedDevicesService,
) -> ApiResult<()> {
    if request.destination_directory.starts_with("misty://device/") {
        return Err(ApiError::Message(
            "Copy to a connected device through the transfer queue.".to_owned(),
        ));
    }
    let has_peer_source = request
        .sources
        .iter()
        .any(|source| source.path.starts_with("misty://device/"));
    if has_peer_source && matches!(request.operation, ClipboardOperation::Move) {
        return Err(ApiError::Message(
            "Files cannot be cut or moved from a connected device. Copy them instead.".to_owned(),
        ));
    }
    for source in &mut request.sources {
        if !source.path.starts_with("misty://device/") {
            continue;
        }
        let materialized = connected_devices.materialize_tree(&source.path).await?;
        source.path = materialized.local_path.to_string_lossy().into_owned();
    }
    Ok(())
}

#[tauri::command]
pub async fn explorer_paste_items(
    mut request: PasteItemsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerOperationResult> {
    #[cfg(desktop)]
    materialize_peer_paste_sources(&mut request, &state.connected_devices).await?;
    state.explorer.paste_items(request).await
}

#[tauri::command]
pub async fn explorer_prepare_open_item(
    request: PrepareOpenItemRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<PreparedOpenItem> {
    #[cfg(desktop)]
    if request.path.starts_with("misty://device/") {
        let materialized = state.connected_devices.materialize(&request.path).await?;
        return Ok(PreparedOpenItem {
            local_path: materialized.local_path.to_string_lossy().into_owned(),
            cached: true,
            source_path: Some(request.path),
            cache_path: Some(materialized.local_path.to_string_lossy().into_owned()),
            cache_hit: materialized.cache_hit,
        });
    }
    state.explorer.prepare_open_item(request).await
}

#[tauri::command]
pub async fn explorer_prepare_drag_items(
    request: PrepareDragItemsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<PreparedDragItemsResult> {
    #[cfg(desktop)]
    {
        let mut local_items = Vec::new();
        let mut prepared = Vec::new();
        let mut skipped = Vec::new();
        for item in request.items {
            if item.path.starts_with("misty://device/") {
                match state.connected_devices.materialize_tree(&item.path).await {
                    Ok(materialized) => prepared.push(PreparedDragItem {
                        source_path: item.path,
                        local_path: materialized.local_path.to_string_lossy().into_owned(),
                        is_directory: item.is_directory,
                        cached: true,
                    }),
                    Err(error) => skipped.push(PreparedDragSkippedItem {
                        source_path: item.path,
                        reason: error.to_string(),
                    }),
                }
            } else {
                local_items.push(item);
            }
        }
        if !local_items.is_empty() {
            let local = state
                .explorer
                .prepare_drag_items(PrepareDragItemsRequest {
                    items: local_items,
                    session_id: request.session_id,
                })
                .await?;
            prepared.extend(local.items);
            skipped.extend(local.skipped);
        }
        return Ok(PreparedDragItemsResult {
            items: prepared,
            skipped,
        });
    }
    #[cfg(not(desktop))]
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

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn explorer_preview_item(
    webview: tauri::Webview,
    instance: String,
    native: State<'_, crate::platform::mini_app::MiniAppState>,
    path: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerPreviewPayload> {
    if webview.label() != "main" {
        return Err(crate::error::ApiError::Message(
            "Only the Host can access Files previews.".into(),
        ));
    }
    let lease = std::sync::Arc::new(
        crate::infra::document_intelligence::ServiceLease::acquire(&native, &instance, "files")
            .await
            .map_err(crate::error::ApiError::Message)?,
    );
    let _cancel = lease.cancel_on_drop();
    let explorer = state.explorer.clone().with_image_service(lease.clone());
    let result = async {
        #[cfg(desktop)]
        if path.starts_with("misty://device/") {
            let materialized = state.connected_devices.materialize(&path).await?;
            return explorer
                .preview_item(&materialized.local_path.to_string_lossy())
                .await;
        }
        explorer.preview_item(&path).await
    }
    .await;
    lease
        .validate(&native, &instance)
        .map_err(crate::error::ApiError::Message)?;
    result
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn explorer_preview_item(
    path: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerPreviewPayload> {
    #[cfg(desktop)]
    if path.starts_with("misty://device/") {
        let materialized = state.connected_devices.materialize(&path).await?;
        return state
            .explorer
            .preview_item(&materialized.local_path.to_string_lossy())
            .await;
    }
    state.explorer.preview_item(&path).await
}

#[tauri::command]
pub async fn explorer_save_preview_item(
    request: SavePreviewRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerOperationResult> {
    state.explorer.save_preview_item(request).await
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn explorer_generate_image_thumbnail(
    webview: tauri::Webview,
    instance: String,
    native: State<'_, crate::platform::mini_app::MiniAppState>,
    path: String,
    max_dimension: u32,
    modified_ms: Option<u64>,
    remote_modified: Option<String>,
    size_bytes: Option<u64>,
    state: State<'_, MistyRuntime>,
) -> ApiResult<GeneratedImageThumbnail> {
    if webview.label() != "main" {
        return Err(crate::error::ApiError::Message(
            "Only the Host can access Files previews.".into(),
        ));
    }
    let lease = std::sync::Arc::new(
        crate::infra::document_intelligence::ServiceLease::acquire(&native, &instance, "files")
            .await
            .map_err(crate::error::ApiError::Message)?,
    );
    let _cancel = lease.cancel_on_drop();
    let explorer = state.explorer.clone().with_image_service(lease.clone());
    let result = async {
        explorer
            .generate_image_thumbnail(
                &path,
                max_dimension,
                modified_ms,
                remote_modified.as_deref(),
                size_bytes,
            )
            .await
    }
    .await;
    lease
        .validate(&native, &instance)
        .map_err(crate::error::ApiError::Message)?;
    result
}

#[cfg(not(target_os = "macos"))]
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

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn smart_library_prepare_previews(
    webview: tauri::Webview,
    instance: String,
    request: PrepareSmartLibraryPreviewsRequest,
    state: State<'_, MistyRuntime>,
    native: State<'_, crate::platform::mini_app::MiniAppState>,
) -> ApiResult<Vec<PreparedSmartLibraryPreview>> {
    if webview.label() != "main" {
        return Err(crate::error::ApiError::Message(
            "Only the Host can process approved Library files.".into(),
        ));
    }
    let lease = Arc::new(
        crate::infra::document_intelligence::ServiceLease::acquire(&native, &instance, "library")
            .await
            .map_err(crate::error::ApiError::Message)?,
    );
    let _cancel = lease.cancel_on_drop();
    let result = state
        .smart_library
        .prepare_previews(request, lease.clone())
        .await;
    lease
        .validate(&native, &instance)
        .map_err(crate::error::ApiError::Message)?;
    result
}
#[cfg(not(target_os = "macos"))]
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
) -> ApiResult<Vec<crate::infra::smart_library::SmartLibraryAsset>> {
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
pub async fn open_terminal_at_path(path: String, state: State<'_, MistyRuntime>) -> ApiResult<()> {
    let settings = state.settings.snapshot().await?;
    let preferred = settings
        .document
        .get("general")
        .and_then(|section| section.get("preferred_terminal_app"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("System Default")
        .to_owned();
    tokio::task::spawn_blocking(move || open_terminal_default(&path, &preferred))
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
    // Connected-device sources and destinations are resolved per item when the
    // queue runs, so remote moves and uploads keep their progress and conflicts.
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
    Ok(crate::infra::autostart::snapshot())
}

#[tauri::command]
pub fn settings_apply_launch_on_login(enabled: bool) -> ApiResult<LaunchOnLoginSnapshot> {
    crate::infra::autostart::apply(enabled).map_err(ApiError::Message)
}

#[tauri::command]
pub fn coding_ai_read_api_key(provider_id: String) -> ApiResult<Option<String>> {
    crate::infra::credentials::read_coding_ai_key(&provider_id)
}

#[tauri::command]
pub fn coding_ai_write_api_key(provider_id: String, key: String) -> ApiResult<()> {
    crate::infra::credentials::write_coding_ai_key(&provider_id, &key)
}

#[tauri::command]
pub fn coding_ai_clear_api_key(provider_id: String) -> ApiResult<()> {
    crate::infra::credentials::clear_coding_ai_key(&provider_id)
}

#[tauri::command]
pub async fn devices_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<DeviceSnapshot> {
    let devices = state.devices.clone();
    tokio::task::spawn_blocking(move || devices.snapshot())
        .await
        .map_err(|err| ApiError::Message(format!("Device scan failed: {err}")))
}

#[tauri::command]
pub async fn devices_unmount(
    request: DeviceUnmountRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<DeviceSnapshot> {
    let devices = state.devices.clone();
    tokio::task::spawn_blocking(move || devices.unmount(request))
        .await
        .map_err(|err| ApiError::Message(format!("Device unmount failed: {err}")))?
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn connected_devices_initialize(
    request: InitializeConnectedDevicesRequest,
    webview: tauri::Webview,
    apps: State<'_, crate::platform::mini_app::MiniAppState>,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ConnectedDevicesSnapshot> {
    let device_id = request.device_id.clone();
    let device_name = if request.device_name.trim().is_empty() {
        "This Misty".to_owned()
    } else {
        request.device_name.clone()
    };
    #[cfg(target_os = "macos")]
    let lease = {
        if webview.label() != "main" {
            return Err(ApiError::Unavailable(
                "Only the Host can start device services.".into(),
            ));
        }
        let lease = crate::infra::document_intelligence::ServiceLease::acquire_service(
            &apps,
            &request.instance,
            "files",
            "peer-transport",
            2,
        )
        .await
        .map_err(ApiError::Unavailable)?;
        let owner = lease
            .peer_identity(&request.device_id)
            .map_err(ApiError::Unavailable)?;
        if owner.account_id != request.account_id {
            return Err(ApiError::Unavailable(
                "The Files session belongs to another account.".into(),
            ));
        }
        std::sync::Arc::new(lease)
    };
    let snapshot = state
        .connected_devices
        .initialize(
            request,
            #[cfg(target_os = "macos")]
            lease,
        )
        .await?;
    if snapshot.enabled {
        state.clipboard.set_device_identity(device_id, device_name);
    }
    Ok(snapshot)
}

#[cfg(all(desktop, not(target_os = "macos")))]
#[tauri::command]
pub async fn connected_devices_initialize(
    request: InitializeConnectedDevicesRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ConnectedDevicesSnapshot> {
    let device_id = request.device_id.clone();
    let device_name = if request.device_name.trim().is_empty() {
        "This Misty".to_owned()
    } else {
        request.device_name.clone()
    };
    let snapshot = state.connected_devices.initialize(request).await?;
    if snapshot.enabled {
        state.clipboard.set_device_identity(device_id, device_name);
    }
    Ok(snapshot)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn connected_devices_snapshot(
    state: State<'_, MistyRuntime>,
) -> ApiResult<ConnectedDevicesSnapshot> {
    state.connected_devices.snapshot()
}

#[cfg(desktop)]
#[tauri::command]
pub async fn connected_devices_subscribe_directory(
    path: String,
    app: AppHandle,
    state: State<'_, MistyRuntime>,
) -> ApiResult<()> {
    state.connected_devices.subscribe_directory(
        path,
        Arc::new(move |path| {
            let _ = app.emit("connected-device-directory-invalidated", path);
        }),
    )
}

#[cfg(desktop)]
#[tauri::command]
pub async fn connected_devices_open_workspace_route(
    device_id: String,
    request: crate::domain::connected_devices::OpenWorkspaceRouteRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<crate::domain::connected_devices::OpenWorkspaceRouteResult> {
    state
        .connected_devices
        .open_workspace_route(&device_id, request)
        .await
}

/// This device's id on Misty's server, which paired devices know it by.
#[cfg(desktop)]
#[tauri::command]
pub async fn connected_devices_set_identity(
    device_id: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<()> {
    state.connected_devices.set_network_identity(device_id)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn connected_devices_roots(
    device_id: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<crate::domain::connected_devices::PeerRoot>> {
    state.connected_devices.roots(&device_id).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn connected_devices_list_directory(
    request: PeerPathRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<crate::domain::connected_devices::PeerResponse> {
    state.connected_devices.list_directory(request).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn connected_devices_read_file(
    request: PeerReadRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<u8>> {
    state.connected_devices.read_file(request).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn connected_devices_media_url(
    path: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<String> {
    state.connected_devices.media_url(&path).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn connected_devices_prepare_clipboard_files(
    device_id: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<bool> {
    let payload = state.clipboard.latest_shared();
    let mut prepared = Vec::new();
    for file in payload.file_refs {
        if file.provider_type != "misty_peer" || file.remote_path.is_empty() {
            continue;
        }
        let parsed = crate::infra::peer_files::PeerVirtualPath::parse(&file.remote_path)?;
        if parsed.device_id != device_id {
            continue;
        }
        let materialized = state
            .connected_devices
            .materialize_tree(&file.remote_path)
            .await?;
        prepared.push(PasteItem {
            path: materialized.local_path.to_string_lossy().into_owned(),
            is_directory: file.is_dir,
            size_bytes: None,
            remote_modified: None,
        });
    }
    if prepared.is_empty() {
        return Err(ApiError::Message(
            "No shared files from this device are waiting on the clipboard.".to_owned(),
        ));
    }
    crate::infra::native_clipboard::write_native_clipboard_file_refs(&prepared)
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

    // ShellExecute opens the file itself. `cmd /C start` would parse the path
    // as a command line, and file names may contain & | ^ that cmd runs.
    #[cfg(target_os = "windows")]
    {
        return tauri_plugin_opener::open_path(file_path, None::<&str>)
            .map_err(|err| ApiError::Message(format!("Failed to open file: {err}")));
    }

    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        let spawn_result = Command::new("open").arg(file_path).spawn();

        #[cfg(all(unix, not(target_os = "macos")))]
        let spawn_result = Command::new("xdg-open").arg(file_path).spawn();

        spawn_result
            .map(|_| ())
            .map_err(|err| ApiError::Message(format!("Failed to open file: {err}")))
    }
}

fn open_terminal_default(path: &str, preferred: &str) -> ApiResult<()> {
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
        let application = match preferred {
            "iTerm" => "iTerm",
            "Warp" => "Warp",
            "Ghostty" => "Ghostty",
            "Alacritty" => "Alacritty",
            _ => "Terminal",
        };
        Command::new("open")
            .arg("-a")
            .arg(application)
            .arg(trimmed)
            .spawn()
            .map(|_| ())
            .map_err(|err| ApiError::Message(format!("Failed to open {application}: {err}")))
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        let executable = match preferred {
            "Warp" => "warp",
            "Ghostty" => "ghostty",
            "Alacritty" => "alacritty",
            _ => "wt",
        };
        // The folder is the working directory, never an argument: Windows
        // Terminal splits its arguments at `;`, and cmd runs & | ^ as commands.
        match Command::new(executable)
            .args(["-d", "."])
            .current_dir(folder)
            .spawn()
        {
            Ok(_) => return Ok(()),
            Err(wt_err) => {
                return Command::new("cmd")
                    .arg("/K")
                    .current_dir(folder)
                    .creation_flags(CREATE_NEW_CONSOLE)
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

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut candidates = Vec::<String>::new();
        match preferred {
            "Warp" => candidates.push("warp-terminal".to_owned()),
            "Ghostty" => candidates.push("ghostty".to_owned()),
            "Alacritty" => candidates.push("alacritty".to_owned()),
            _ => {}
        }
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
) -> ApiResult<crate::domain::file_sync::FileSyncCompareResult> {
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

#[tauri::command]
pub async fn navigation_names_snapshot(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
) -> Result<crate::infra::navigation_names::NavigationSnapshot, String> {
    if webview.label() != "main" {
        return Err("Only the trusted Misty shell can read navigation names.".into());
    }
    Ok(state.navigation_names.snapshot(&account).await)
}
#[tauri::command]
pub async fn navigation_names_update(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    key: String,
    name: Option<String>,
) -> Result<crate::infra::navigation_names::NavigationSnapshot, String> {
    if webview.label() != "main" {
        return Err("Only the trusted Misty shell can rename navigation.".into());
    }
    state.navigation_names.update(account, key, name).await
}

#[tauri::command]
pub async fn settings_profile_state(
    webview: tauri::Webview,
    scope: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<crate::infra::settings_profile_store::ProfileStateSnapshot> {
    if webview.label() != "main" {
        return Err(ApiError::Unavailable(
            "Only the trusted Misty shell can read settings profiles.".into(),
        ));
    }
    state.settings.profile_state(scope, None).await
}

#[tauri::command]
pub async fn settings_profile_commit(
    webview: tauri::Webview,
    scope: String,
    revision: i64,
    document: serde_json::Value,
    state: State<'_, MistyRuntime>,
) -> ApiResult<crate::infra::settings_profile_store::ProfileStateSnapshot> {
    if webview.label() != "main" {
        return Err(ApiError::Unavailable(
            "Only the trusted Misty shell can save settings profiles.".into(),
        ));
    }
    state
        .settings
        .profile_state(scope, Some((revision, document)))
        .await
}
