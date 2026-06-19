use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::clipboard::ClipboardPayload;
use crate::core::explorer::{
    CreateItemRequest, DeleteItemsRequest, DirectoryListing, ExplorerOperationResult,
    ListDirectoryRequest, PasteItemsRequest, PasteTextRequest, PrepareOpenItemRequest,
    PreparedOpenItem, RenameItemRequest, RenameItemsRequest,
};
use crate::core::file_sync::FileSyncPair;
use crate::core::operation_queue::{ConflictPolicy, OperationQueueSnapshot};
use crate::core::workspace::WorkspaceDocument;
use crate::error::{ApiError, ApiResult};
use crate::runtime::MistyRuntime;
use crate::services::commands::{SaveShortcutsRequest, ShortcutsSnapshot};
use crate::services::environment::AppEnvironmentSnapshot;
use crate::services::file_sync::{
    FileSyncApplyRequest, FileSyncApplyResult, FileSyncCompareRequest,
};
use crate::services::providers::{
    ProvidersSnapshot, RcloneConfigPaths, RemoteEditDraft, RemoteTestResult, SaveRemoteRequest,
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
