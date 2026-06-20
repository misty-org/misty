use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::clipboard::{
    ClipboardImage, ClipboardPayload, ClipboardPayloadKind, SharedClipboardClient,
};
use crate::core::explorer::{
    CreateItemRequest, DeleteItemsRequest, DirectoryListing, ExplorerOperationResult,
    ExplorerPreviewPayload, ListDirectoryRequest, PasteBlobRequest, PasteItem, PasteItemsRequest,
    PasteTextRequest, PrepareOpenItemRequest, PreparedOpenItem, RenameItemRequest,
    RenameItemsRequest,
};
use crate::core::file_sync::FileSyncPair;
use crate::core::operation_queue::{ConflictPolicy, OperationQueueSnapshot};
use crate::core::workspace::WorkspaceDocument;
use crate::error::{ApiError, ApiResult};
use crate::runtime::MistyRuntime;
use crate::services::commands::{SaveShortcutsRequest, ShortcutsSnapshot};
use crate::services::devices::DeviceSnapshot;
use crate::services::environment::AppEnvironmentSnapshot;
use crate::services::explorer_library::{
    ExplorerLibrarySnapshot, RecordLastOpenedRequest, RecordRecentRequest,
};
use crate::services::file_sync::{
    FileSyncApplyRequest, FileSyncApplyResult, FileSyncCompareRequest,
};
use crate::services::plugin_commands::PluginCommandsSnapshot;
use crate::services::providers::{
    ProviderConfigRequest, ProviderConfigStep, ProvidersSnapshot, RcloneConfigPaths,
    RemoteEditDraft, RemoteTestResult, SaveRemoteRequest,
};
use crate::services::proxy::ProxySnapshot;
use crate::services::settings::{OpenWithAssociation, SaveSettingsRequest, SettingsSnapshot};
use crate::services::transfers::{TransferFilter, TransferPage};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    app_name: &'static str,
    migration_stage: &'static str,
    proxy_url: Option<String>,
    environment: AppEnvironmentSnapshot,
}

#[derive(Debug, Serialize)]
pub struct ClipboardSnapshot {
    pub local: ClipboardPayload,
    pub shared: ClipboardPayload,
}

#[tauri::command]
pub async fn app_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<AppSnapshot> {
    Ok(AppSnapshot {
        app_name: "Misty",
        migration_stage: "Tauri migration shell",
        proxy_url: state.proxy.proxy_url(),
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
pub async fn proxy_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<ProxySnapshot> {
    Ok(state.proxy.snapshot().await)
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
    let mut payload = state.clipboard.latest_shared();
    if payload.kind != ClipboardPayloadKind::Image || payload.images.is_empty() {
        return Err(ApiError::Message(
            "No shared clipboard image is available.".to_owned(),
        ));
    }
    if !state.proxy_clipboard.hydrate_payload(&mut payload) {
        return Err(ApiError::Message(
            "Failed to download the shared clipboard image.".to_owned(),
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
pub async fn explorer_list_directory(
    request: ListDirectoryRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<DirectoryListing> {
    state.explorer.list_directory(request).await
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
pub async fn explorer_preview_item(
    path: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<ExplorerPreviewPayload> {
    state.explorer.preview_item(&path).await
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
pub async fn explorer_open_with(application_path: String, file_path: String) -> ApiResult<()> {
    tokio::task::spawn_blocking(move || open_with_application(&application_path, &file_path))
        .await
        .map_err(|err| ApiError::Message(format!("Open With worker failed: {err}")))?
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

#[tauri::command]
pub async fn plugin_commands_snapshot(
    state: State<'_, MistyRuntime>,
) -> ApiResult<PluginCommandsSnapshot> {
    state.plugin_commands.snapshot().await
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
pub async fn operation_queue_retry(
    operation_id: u64,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.retry(operation_id).await
}

#[tauri::command]
pub async fn operation_queue_undo(
    undo_token_id: u64,
    state: State<'_, MistyRuntime>,
) -> ApiResult<OperationQueueSnapshot> {
    state.operation_queue.undo(undo_token_id).await
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

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct Placeholder {}
