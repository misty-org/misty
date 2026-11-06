//! Folders the person shares with agents, read-only. Sharing happens only here,
//! through the system picker in Misty's main window: nothing else can add one.
#![cfg(desktop)]

use serde_json::Value;
use tauri::State;

use crate::{
    app::runtime::MistyRuntime,
    error::{ApiError, ApiResult},
};

fn require_main(webview: &tauri::Webview) -> ApiResult<()> {
    if crate::infra::profile_windows::is_person_window(webview.label()) {
        Ok(())
    } else {
        Err(ApiError::Message(
            "Only Misty's main window can share folders.".into(),
        ))
    }
}

/// Shares the folder the person picks, or nothing if they cancel.
#[tauri::command]
pub async fn agents_share_folder(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Option<Value>> {
    use tauri_plugin_dialog::DialogExt;
    require_main(&webview)?;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a folder to share with agents")
        .pick_folder(move |folder| {
            let _ = send.send(folder);
        });
    let Some(folder) = receive
        .await
        .map_err(|_| ApiError::Message("Folder selection was canceled.".into()))?
    else {
        return Ok(None);
    };
    let path = folder
        .into_path()
        .map_err(|_| ApiError::Message("Choose a local folder.".into()))?;
    state
        .agents
        .share_folder(path, &[state.environment.misty_dir()])
        .await
        .map(Some)
}

/// Stops sharing a folder. Its files stay where they are.
#[tauri::command]
pub async fn agents_forget_folder(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
) -> ApiResult<()> {
    require_main(&webview)?;
    state.agents.revoke_folder_scope(scope_id).await
}
