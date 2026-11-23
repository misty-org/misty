use std::path::{Path, PathBuf};

use database::store::Store;
use tauri::{AppHandle, Manager, State};

use super::commands::{blocking, person_window};
use super::store;
use crate::agents::shared_folders::check_root;
use crate::app::runtime::MistyRuntime;

#[path = "chat_folder_retire.rs"]
mod retire;
pub(crate) use retire::retire_agent_folders;

pub(super) const PROJECT: &str = "project";
const SCRATCH: &str = "scratch";
const THREAD: &str = "thread";

fn data_dir(db: &Store) -> Option<PathBuf> {
    db.path().parent()?.parent().map(Path::to_path_buf)
}

pub(crate) fn scratch_root(db: &Store) -> Option<PathBuf> {
    data_dir(db).map(|data| data.join("chats"))
}

fn runs_root(db: &Store) -> Option<PathBuf> {
    data_dir(db).map(|data| data.join("runs"))
}

pub(super) fn folder_name(id: &str) -> Result<&str, String> {
    let fine = !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    fine.then_some(id)
        .ok_or_else(|| "That chat can't have a folder.".to_string())
}

pub(crate) fn scratch_for(db: &Store, conversation: &str) -> Result<PathBuf, String> {
    let root = scratch_root(db).ok_or("Misty couldn't find its data folder.")?;
    Ok(root.join(folder_name(conversation)?))
}

pub(crate) fn is_scratch(db: &Store, folder: &Path) -> bool {
    [
        scratch_root(db),
        runs_root(db),
        super::thread_work::root(db),
    ]
    .into_iter()
    .flatten()
    .any(|root| store::within(folder, &root) && !store::within(&root, folder))
}

fn make(folder: &Path) -> Result<(), String> {
    file_access::fs::create_dir_all(folder)
        .map_err(|error| format!("Misty couldn't make {}: {error}", folder.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = file_access::fs::set_permissions(folder, std::fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

fn usable_project(db: &Store, account: &str, folder: &Path) -> bool {
    !is_scratch(db, folder)
        && store::is_linked(db, account, folder).unwrap_or(false)
        && file_access::fs::is_dir(folder)
}

pub(crate) fn for_run(
    db: &Store,
    account: &str,
    conversation: &str,
    run_id: &str,
    named: &str,
) -> Result<PathBuf, String> {
    let named_path = Path::new(named);
    if !named.is_empty() && super::multirun::is_worktree(db, account, named_path) {
        return Ok(named_path.to_path_buf());
    }
    if conversation.is_empty() {
        let root = runs_root(db).ok_or("Misty couldn't find its data folder.")?;
        let folder = root.join(folder_name(run_id)?);
        make(&folder)?;
        return Ok(folder);
    }
    let saved = store::chat_folder(db, account, conversation);
    if let Some((path, kind)) = &saved {
        let path = PathBuf::from(path);
        if kind == PROJECT && usable_project(db, account, &path) {
            let _ = store::add_project(db, account, &path.to_string_lossy());
            return Ok(path);
        }
    }
    let saved_project = saved.as_ref().is_some_and(|(_, kind)| kind == PROJECT);
    if !named.is_empty() && !saved_project && usable_project(db, account, named_path) {
        store::set_chat_folder(db, account, conversation, named, PROJECT)?;
        let _ = store::add_project(db, account, named);
        return Ok(named_path.to_path_buf());
    }
    let scratch = scratch_for(db, conversation)?;
    make(&scratch)?;
    if saved.is_none() {
        store::set_chat_folder(
            db,
            account,
            conversation,
            &scratch.to_string_lossy(),
            SCRATCH,
        )?;
    }
    Ok(scratch)
}

pub(crate) fn current(db: &Store, account: &str, conversation: &str) -> Option<PathBuf> {
    if let Some(thread) = super::thread_work::current(db, account, conversation) {
        return Some(thread);
    }
    if let Some(lane) = super::multirun::lane_folder(db, account, conversation) {
        return Some(lane);
    }
    if let Some((path, kind)) = store::chat_folder(db, account, conversation) {
        let path = PathBuf::from(path);
        if kind == PROJECT && usable_project(db, account, &path) {
            return Some(path);
        }
    }
    scratch_for(db, conversation)
        .ok()
        .filter(|folder| file_access::fs::is_dir(folder))
}

pub(crate) fn end_run(db: &Store, run_id: &str) {
    let (Some(root), Ok(name)) = (runs_root(db), folder_name(run_id)) else {
        return;
    };
    let folder = root.join(name);
    if file_access::fs::is_dir(&folder) {
        let _ = file_access::fs::remove_dir_all(&folder);
    }
}

pub(crate) fn forget_chat(db: &Store, account: &str, conversation: &str) -> Result<(), String> {
    store::forget_chat(db, account, conversation)?;
    super::thread_work::forget(db, account, conversation)?;
    let scratch = scratch_for(db, conversation)?;
    if file_access::fs::is_dir(&scratch) {
        file_access::fs::remove_dir_all(&scratch).map_err(|error| error.to_string())?;
    }
    Ok(())
}

async fn pick_folder(app: &AppHandle, title: &str) -> Result<Option<PathBuf>, String> {
    pick_folder_from(app, title, dirs::document_dir()).await
}

pub(super) async fn pick_folder_from(
    app: &AppHandle,
    title: &str,
    start: Option<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (send, receive) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title(title)
        .set_can_create_directories(true);
    if let Some(start) = start {
        dialog = dialog.set_directory(start);
    }
    dialog.pick_folder(move |folder| {
        let _ = send.send(folder);
    });
    let Some(folder) = receive
        .await
        .map_err(|_| "No folder was chosen.".to_string())?
    else {
        return Ok(None);
    };
    folder
        .into_path()
        .map(Some)
        .map_err(|_| "Choose a folder on this computer.".to_string())
}

pub(super) async fn adopt(
    app: &AppHandle,
    db: &Store,
    account: &str,
    path: PathBuf,
) -> Result<PathBuf, String> {
    let protected = [app.state::<MistyRuntime>().environment.misty_dir()];
    let home = dirs::home_dir();
    check_root(&path, &protected, home.as_deref())?;
    file_access::allow_linked_folder(&path);
    let real = file_access::fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if real != path {
        file_access::revoke_linked_folder(&path);
        check_root(&real, &protected, home.as_deref())?;
        file_access::allow_linked_folder(&real);
    }
    let (db, account, text) = (
        db.clone(),
        account.to_string(),
        real.to_string_lossy().into_owned(),
    );
    let kept = text.clone();
    blocking(move || store::add_project(&db, &account, &kept)).await?;
    super::folder_linked(&text);
    Ok(real)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatFolder {
    path: String,
    kind: String,
}

#[tauri::command]
pub async fn chat_folder(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
) -> Result<ChatFolder, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || {
        if let Some(thread) = super::thread_work::current(&db, &account, &conversation) {
            return Ok(ChatFolder {
                path: thread.to_string_lossy().into_owned(),
                kind: THREAD.into(),
            });
        }
        if let Some(lane) = super::multirun::lane_folder(&db, &account, &conversation) {
            return Ok(ChatFolder {
                path: lane.to_string_lossy().into_owned(),
                kind: PROJECT.into(),
            });
        }
        if let Some((path, kind)) = store::chat_folder(&db, &account, &conversation) {
            if kind == PROJECT && usable_project(&db, &account, Path::new(&path)) {
                return Ok(ChatFolder { path, kind });
            }
        }
        let scratch = scratch_for(&db, &conversation)?;
        make(&scratch)?;
        Ok(ChatFolder {
            path: scratch.to_string_lossy().into_owned(),
            kind: SCRATCH.into(),
        })
    })
    .await
}

#[tauri::command]
pub async fn chat_folder_choose(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: Option<String>,
) -> Result<Option<String>, String> {
    person_window(&webview)?;
    let Some(path) = pick_folder(&app, "Choose a project folder").await? else {
        return Ok(None);
    };
    let db = state.environment.store();
    let real = adopt(&app, &db, &account, path).await?;
    let text = real.to_string_lossy().into_owned();
    if let Some(conversation) = conversation.filter(|id| !id.is_empty()) {
        folder_name(&conversation)?;
        let kept = text.clone();
        blocking(move || store::set_chat_folder(&db, &account, &conversation, &kept, PROJECT))
            .await?;
    }
    Ok(Some(text))
}

#[tauri::command]
pub async fn chat_folder_use(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
    path: String,
) -> Result<(), String> {
    person_window(&webview)?;
    folder_name(&conversation)?;
    let db = state.environment.store();
    blocking(move || {
        if !usable_project(&db, &account, Path::new(&path)) {
            return Err("That folder isn't one of your projects on this computer.".to_string());
        }
        store::add_project(&db, &account, &path)?;
        store::set_chat_folder(&db, &account, &conversation, &path, PROJECT)
    })
    .await
}

#[tauri::command]
pub async fn chat_folder_scratch(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
) -> Result<String, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || {
        let scratch = scratch_for(&db, &conversation)?;
        let text = scratch.to_string_lossy().into_owned();
        store::set_chat_folder(&db, &account, &conversation, &text, SCRATCH)?;
        Ok(text)
    })
    .await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    path: String,
    last_used_at: i64,
}

#[tauri::command]
pub async fn project_folder_list(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
) -> Result<Vec<Project>, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || {
        Ok(store::projects(&db, &account)?
            .into_iter()
            .filter(|(path, _)| file_access::fs::is_dir(Path::new(path)))
            .map(|(path, last_used_at)| Project { path, last_used_at })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn project_folder_forget(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    path: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let db = state.environment.store();
    let gone = path.clone();
    let still = blocking(move || store::remove_project(&db, &account, &gone)).await?;
    if !still {
        file_access::revoke_linked_folder(Path::new(&path));
    }
    Ok(())
}

#[tauri::command]
pub async fn chat_folder_forget(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || forget_chat(&db, &account, &conversation)).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchUsage {
    bytes: u64,
    folders: usize,
    left_behind: usize,
}

fn folder_bytes(folder: &Path) -> u64 {
    let mut total = 0;
    let mut pending = vec![folder.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = file_access::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            match file_access::fs::symlink_metadata(&path) {
                Ok(meta) if meta.is_dir() => pending.push(path),
                Ok(meta) => total += meta.len(),
                Err(_) => {}
            }
        }
    }
    total
}

fn scratch_folders(db: &Store) -> Vec<(String, PathBuf)> {
    let Some(root) = scratch_root(db) else {
        return Vec::new();
    };
    let Ok(entries) = file_access::fs::read_dir(&root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| file_access::fs::is_dir(entry.path()))
        .map(|entry| {
            (
                entry.file_name().to_string_lossy().into_owned(),
                entry.path(),
            )
        })
        .collect()
}

#[tauri::command]
pub async fn chat_scratch_usage(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
) -> Result<ScratchUsage, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || {
        let chats = store::all_chat_ids(&db)?;
        let folders = scratch_folders(&db);
        Ok(ScratchUsage {
            bytes: folders.iter().map(|(_, path)| folder_bytes(path)).sum(),
            left_behind: folders
                .iter()
                .filter(|(name, _)| !chats.contains(name))
                .count(),
            folders: folders.len(),
        })
    })
    .await
}

#[tauri::command]
pub async fn chat_scratch_clear(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
) -> Result<usize, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || {
        let chats = store::all_chat_ids(&db)?;
        let mut cleared = 0;
        for (name, path) in scratch_folders(&db) {
            if !chats.contains(&name) && file_access::fs::remove_dir_all(&path).is_ok() {
                cleared += 1;
            }
        }
        Ok(cleared)
    })
    .await
}

#[cfg(test)]
#[path = "chat_folder_tests.rs"]
mod tests;
