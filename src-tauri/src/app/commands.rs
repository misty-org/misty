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
use crate::domain::workspace::WorkspaceDocument;
use crate::error::{ApiError, ApiResult};
use crate::infra::agents::PrepareScopedAgentDocumentRequest;
use crate::infra::autostart::LaunchOnLoginSnapshot;
use crate::infra::default_browser::DefaultBrowserSnapshot;
use crate::infra::devices::{DeviceSnapshot, DeviceUnmountRequest};
use crate::infra::document_intelligence::PreparedAgentDocument;
use crate::infra::environment::AppEnvironmentSnapshot;
use crate::infra::explorer::SavePreviewRequest;
use crate::infra::explorer_library::{
    ExplorerLibrarySnapshot, RecordLastOpenedRequest, RecordRecentRequest, SetTagsRequest,
};
use crate::infra::settings::{OpenWithAssociation, SaveSettingsRequest, SettingsSnapshot};

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
/// Windows parses the document in the confined worker; the shared folder's
/// file is copied in, never opened by the worker in place.
#[cfg(windows)]
#[tauri::command]
pub async fn agents_prepare_scoped_document(
    webview: tauri::Webview,
    request: PrepareScopedAgentDocumentRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<PreparedAgentDocument> {
    if webview.label() != "main" {
        return Err(crate::error::ApiError::Message(
            "Only the Host can process approved device scopes.".into(),
        ));
    }
    let target = state.agents.scoped_document_path(request).await?;
    crate::infra::document_intelligence::prepare_document(target).await
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
    state.explorer.list_directory(request).await
}

#[tauri::command]
pub async fn explorer_prepare_open_item(
    request: PrepareOpenItemRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<PreparedOpenItem> {
    state.explorer.prepare_open_item(request).await
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
pub fn settings_default_browser_snapshot() -> ApiResult<DefaultBrowserSnapshot> {
    Ok(crate::infra::default_browser::snapshot())
}

#[tauri::command]
pub fn settings_request_default_browser() -> ApiResult<DefaultBrowserSnapshot> {
    Ok(crate::infra::default_browser::request())
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
