//! What a window may ask about engines and a Space's linked folders. Linking happens only
//! through the system's folder picker, so nothing in a page can name a folder for an engine.

use tauri::State;

use crate::app::runtime::MistyRuntime;

use super::{store, EngineInfo};

fn person_window(webview: &tauri::Webview) -> Result<(), String> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
        Ok(())
    } else {
        Err("Only a profile's window can do this.".into())
    }
}

/// A Space's key in the folder table: its id, or `personal` for the person's own Space.
pub(super) fn space_key(space: &str) -> Result<String, String> {
    let key = space.trim();
    if key.len() > 200 || key.chars().any(char::is_control) {
        return Err("That Space can't have folders.".into());
    }
    Ok(if key.is_empty() {
        "personal".into()
    } else {
        key.to_string()
    })
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

/// The engines Misty has adapters for, and which are installed on this computer.
#[tauri::command]
pub async fn engines_list(webview: tauri::Webview) -> Result<Vec<EngineInfo>, String> {
    person_window(&webview)?;
    Ok(super::list().await)
}

/// The models an engine offers, for the agent editor's model choice.
#[tauri::command]
pub async fn engine_models(
    webview: tauri::Webview,
    engine: String,
) -> Result<Vec<super::EngineModel>, String> {
    person_window(&webview)?;
    let engine = super::EngineKind::from_id(&engine).ok_or("That engine has no adapter.")?;
    Ok(super::models(engine).await)
}

/// The project folders linked to a Space on this computer.
#[tauri::command]
pub async fn space_folder_list(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    space: String,
) -> Result<Vec<String>, String> {
    person_window(&webview)?;
    let (db, space) = (state.environment.store(), space_key(&space)?);
    blocking(move || store::folders(&db, &account, &space)).await
}

/// Links the folder the person picks to a Space, or nothing if they cancel.
#[tauri::command]
pub async fn space_folder_link(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    space: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    person_window(&webview)?;
    let space = space_key(&space)?;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a project folder for this Space")
        .pick_folder(move |folder| {
            let _ = send.send(folder);
        });
    let Some(folder) = receive
        .await
        .map_err(|_| "No folder was chosen.".to_string())?
    else {
        return Ok(None);
    };
    let path = folder
        .into_path()
        .map_err(|_| "Choose a folder on this computer.".to_string())?;
    // The person chose it in the system's own dialog, which is what lets Misty reach it.
    file_access::allow_linked_folder(&path);
    let real = file_access::fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if real != path {
        file_access::revoke_linked_folder(&path);
        file_access::allow_linked_folder(&real);
    }
    let text = real.to_string_lossy().to_string();
    let (db, kept) = (state.environment.store(), text.clone());
    blocking(move || store::link_folder(&db, &account, &space, &kept)).await?;
    Ok(Some(text))
}

/// Unlinks a folder from a Space. Its files are left as they are.
#[tauri::command]
pub async fn space_folder_unlink(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    space: String,
    path: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let (db, space, gone) = (state.environment.store(), space_key(&space)?, path.clone());
    let still_linked = blocking(move || store::unlink_folder(&db, &account, &space, &gone)).await?;
    if !still_linked {
        file_access::revoke_linked_folder(std::path::Path::new(&path));
    }
    Ok(())
}

/// Lets the file gate reach every folder linked on this computer. Runs once as the app starts.
pub fn allow_linked_folders(db: &database::store::Store) {
    for folder in store::all_folders(db).unwrap_or_default() {
        file_access::allow_linked_folder(&folder);
    }
    // Multi-run: the worktrees it made are reached the same way (multirun.rs).
    for folder in super::multirun::worktree_folders(db) {
        file_access::allow_linked_folder(&folder);
    }
}
