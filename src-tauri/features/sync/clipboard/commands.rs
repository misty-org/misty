//! The shared clipboard as the browser's popover shows it
//! Clips are opened natively; the webview
//! only sees what this device could already paste. Library items are copied to
//! the system clipboard as files.
#![cfg(desktop)]

use file_access::fs_async;
use std::{
    collections::HashSet,
    env,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use tauri::State;

use crate::app::error::{ApiError, ApiResult};
use crate::app::runtime::MistyRuntime;
use crate::devices::commands::require_main;
use crate::sync::clipboard::cloud::CloudClipboardView;
use crate::sync::clipboard::ClipboardPayload;
use crate::sync::clipboard::PasteItem;

/// Takes the system clipboard into the shared buffer if it isn't there yet.
async fn capture_system(state: &State<'_, MistyRuntime>) -> Option<ClipboardPayload> {
    let clipboard = state.clipboard.clone();
    tokio::task::spawn_blocking(move || clipboard.capture_system())
        .await
        .ok()
        .flatten()
}

#[tauri::command]
pub async fn clipboard_cloud_view(
    state: State<'_, MistyRuntime>,
) -> Result<CloudClipboardView, String> {
    capture_system(&state).await;
    Ok(state.cloud_clipboard.view())
}

/// Puts a clip from the account's devices on this device's clipboard.
#[tauri::command]
pub async fn clipboard_cloud_copy(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    clip_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let payload = state.cloud_clipboard.open_clip(&clip_id).await?;
    let clipboard = state.clipboard.clone();
    let written = tokio::task::spawn_blocking(move || clipboard.apply_payload_to_system(payload))
        .await
        .map_err(|error| error.to_string())?;
    if !written {
        return Err("This clip couldn't be copied here.".into());
    }
    Ok(())
}

/// Pastes the newest clip into the page's focused field. The system clipboard is not touched.
/// Images can't be typed in; they go to the clipboard with Copy.
#[tauri::command]
pub async fn clipboard_cloud_paste(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    state: State<'_, MistyRuntime>,
    id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    // Whatever is on the system clipboard now joins the buffer first, and is then the newest.
    let fresh = capture_system(&state).await;
    let payload = match fresh.filter(|copy| !copy.text.is_empty() || !copy.html.is_empty()) {
        Some(copy) => copy,
        None => {
            let clip_id = state
                .cloud_clipboard
                .latest_clip_id()
                .ok_or("Nothing has been copied in the last 24 hours.")?;
            state.cloud_clipboard.open_clip(&clip_id).await?
        }
    };
    if payload.text.is_empty() && payload.html.is_empty() {
        return Err("The newest clip is an image. Use Copy to put it on this computer.".into());
    }
    crate::browser::paste_into_page(&app, &webview, &id, &payload.text, &payload.html)
}

/// Saves a clip's files to Downloads and returns where they landed.
#[tauri::command]
pub async fn clipboard_cloud_save(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    state: State<'_, MistyRuntime>,
    clip_id: String,
) -> Result<Vec<String>, String> {
    require_main(&webview)?;
    let downloads = dirs::download_dir().ok_or("Misty can't find your Downloads folder.")?;
    if !permissions::ensure_downloads_folder_async(&app).await {
        return Err("Misty needs your OK to save to the Downloads folder.".to_owned());
    }
    let saved = state
        .cloud_clipboard
        .save_clip_files(&clip_id, &downloads)
        .await?;
    Ok(saved
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFileBytes {
    pub name: String,
    pub bytes: Vec<u8>,
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
    fs_async::create_dir_all(&staging).await.map_err(|error| {
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
        fs_async::write(&path, &item.bytes).await.map_err(|error| {
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
    crate::sync::clipboard::native::write_native_clipboard_file_refs(&references)
}
