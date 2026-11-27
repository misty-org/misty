use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use tauri::{Manager, State};

use super::chat_folder::{adopt, folder_name, pick_folder_from, scratch_for, PROJECT};
use super::commands::{blocking, person_window};
use super::store;
use crate::agents::shared_folders::check_root;
use crate::app::runtime::MistyRuntime;

static PICKED: LazyLock<Mutex<HashMap<String, PathBuf>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn check_parent(app: &tauri::AppHandle, folder: &Path) -> Result<(), String> {
    let protected = [app.state::<MistyRuntime>().environment.misty_dir()];
    let home = dirs::home_dir();
    check_root(&folder.join("project"), &protected, home.as_deref())
        .map_err(|_| "Projects can't go in that folder. Choose another one.".to_string())
}

fn project_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    let fine = !name.is_empty()
        && name.chars().count() <= 100
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':', '\0'])
        && !name.chars().any(char::is_control);
    fine.then(|| name.to_string()).ok_or_else(|| {
        "Give the project a folder name without slashes or a leading dot.".to_string()
    })
}

#[tauri::command]
pub async fn projects_home(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
) -> Result<Option<String>, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || Ok(store::projects_home(&db, &account))).await
}

#[tauri::command]
pub async fn projects_home_choose(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
) -> Result<Option<String>, String> {
    person_window(&webview)?;
    let Some(folder) =
        pick_folder_from(&webview, "Choose where your projects go", dirs::home_dir()).await?
    else {
        return Ok(None);
    };
    check_parent(&app, &folder)?;
    let db = state.environment.store();
    let text = folder.to_string_lossy().into_owned();
    let kept = text.clone();
    blocking(move || store::set_projects_home(&db, &account, &kept)).await?;
    Ok(Some(text))
}

#[tauri::command]
pub async fn project_parent_pick(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
) -> Result<Option<String>, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    let start = {
        let (db, account) = (db.clone(), account.clone());
        blocking(move || Ok(store::projects_home(&db, &account))).await?
    }
    .map(PathBuf::from)
    .or_else(dirs::home_dir);
    let Some(folder) = pick_folder_from(&webview, "Choose where this project goes", start).await?
    else {
        return Ok(None);
    };
    check_parent(&app, &folder)?;
    let text = folder.to_string_lossy().into_owned();
    PICKED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(account, folder);
    Ok(Some(text))
}

#[tauri::command]
pub async fn chat_open_in_code(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    person_window(&webview)?;
    folder_name(&conversation)?;
    let name = project_name(&name)?;
    let db = state.environment.store();
    let home = {
        let (db, account) = (db.clone(), account.clone());
        blocking(move || Ok(store::projects_home(&db, &account))).await?
    };
    let picked = PICKED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(&account)
        .cloned();
    let parent = PathBuf::from(&parent);
    let chosen = home.as_deref().map(Path::new) == Some(parent.as_path())
        || picked.as_deref() == Some(parent.as_path());
    if !chosen {
        return Err("Choose where the project goes first.".into());
    }
    check_parent(&app, &parent)?;
    let target = parent.join(&name);
    let scratch = scratch_for(&db, &conversation)?;

    file_access::allow_linked_folder(&target);
    let moved = {
        let (target, scratch) = (target.clone(), scratch.clone());
        blocking(move || {
            if file_access::fs::exists(&target) {
                return Err(format!(
                    "There's already a folder named {name} there. Choose another name."
                ));
            }
            if !file_access::fs::is_dir(&scratch) {
                return file_access::fs::create_dir(&target).map_err(|error| error.to_string());
            }
            if file_access::fs::rename(&scratch, &target).is_ok() {
                return Ok(());
            }
            file_access::fs::copy_tree(&scratch, &target)
                .map_err(|error| format!("Misty couldn't move the chat's files: {error}"))?;
            let _ = file_access::fs::remove_dir_all(&scratch);
            Ok(())
        })
        .await
    };
    if let Err(message) = moved {
        file_access::revoke_linked_folder(&target);
        return Err(message);
    }
    let real = adopt(&app, &db, &account, target).await?;
    let text = real.to_string_lossy().into_owned();
    PICKED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&account);
    let kept = text.clone();
    blocking(move || store::set_chat_folder(&db, &account, &conversation, &kept, PROJECT)).await?;
    Ok(text)
}

#[tauri::command]
pub async fn chat_folder_projects(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
) -> Result<HashMap<String, String>, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || Ok(store::project_chats(&db, &account)?.into_iter().collect())).await
}
