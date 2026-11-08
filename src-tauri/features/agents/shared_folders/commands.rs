//! Folders the person shares with agents, read-only. Sharing happens only here,
//! through the system picker in Misty's main window: nothing else can add one.
#![cfg(desktop)]

use serde_json::Value;
use tauri::State;

use crate::app::error::{ApiError, ApiResult};
use crate::app::runtime::MistyRuntime;

fn require_main(webview: &tauri::Webview) -> ApiResult<()> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
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

/// A chat, new chat or workflow's key, which only ever names those things.
fn folder_changes_key(key: &str) -> ApiResult<()> {
    if key.is_empty() || key.len() > 200 {
        return Err(ApiError::Message("That chat can't be given this.".into()));
    }
    Ok(())
}

/// "Allow changes": asks the person natively, so nothing in a window can answer for them, and
/// remembers the answer for this chat and folder. Returns whether they said yes.
#[tauri::command]
pub async fn agents_allow_folder_changes(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    key: String,
    scope_id: String,
) -> ApiResult<bool> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    require_main(&webview)?;
    folder_changes_key(&key)?;
    let name = state.agents.folder_name(scope_id.clone()).await?;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!(
            "Agents in this chat will be able to add and edit files in \u{201c}{name}\u{201d}. \
             They can't delete, rename or move anything, but an edit can overwrite a file's \
             contents, and there's no undo. A script or Git hook left there could run later if you \
             run that project yourself."
        ))
        .title("Allow changes")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Allow changes".to_owned(),
            "Cancel".to_owned(),
        ))
        .show(move |answer| {
            let _ = send.send(answer);
        });
    if !receive.await.unwrap_or(false) {
        return Ok(false);
    }
    state.agents.allow_folder_changes(key, scope_id).await?;
    Ok(true)
}

/// Takes "Allow changes" back, for one folder or all of a chat's. It holds from the next command.
#[tauri::command]
pub async fn agents_stop_folder_changes(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    key: String,
    scope_id: Option<String>,
) -> ApiResult<()> {
    require_main(&webview)?;
    folder_changes_key(&key)?;
    state.agents.stop_folder_changes(key, scope_id).await
}

/// A new chat takes on its draft's answer, and a scheduled run its workflow's.
#[tauri::command]
pub async fn agents_adopt_folder_changes(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    from: String,
    chat: String,
) -> ApiResult<()> {
    require_main(&webview)?;
    folder_changes_key(&chat)?;
    state.agents.adopt_folder_changes(from, chat).await
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
