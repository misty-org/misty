//! The shared clipboard as the browser's popover shows it
//! (docs/design/clipboard/BRIEF.md). Clips are opened natively; the webview
//! only sees what this device could already paste.
#![cfg(desktop)]

use tauri::State;

use crate::app::device_commands::require_main;
use crate::app::runtime::MistyRuntime;
use crate::infra::cloud_clipboard::CloudClipboardView;

#[tauri::command]
pub async fn clipboard_cloud_view(
    state: State<'_, MistyRuntime>,
) -> Result<CloudClipboardView, String> {
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

/// Saves a clip's files to Downloads and returns where they landed.
#[tauri::command]
pub async fn clipboard_cloud_save(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    clip_id: String,
) -> Result<Vec<String>, String> {
    require_main(&webview)?;
    let downloads = dirs::download_dir().ok_or("Misty can't find your Downloads folder.")?;
    let saved = state
        .cloud_clipboard
        .save_clip_files(&clip_id, &downloads)
        .await?;
    Ok(saved
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}
