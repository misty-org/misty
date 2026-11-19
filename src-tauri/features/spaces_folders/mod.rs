//! Shared Space folders, the app's side: a folder the person picks is walked (`.gitignore`, then
//! `.mistyignore`), hashed and streamed to the presigned addresses the server hands out, and a
//! shared folder is kept on this computer in Misty's data folder for agent runs to use.
//!
//! The page talks to the server (create, diff, commit); native code only reads the picked folder
//! and moves bytes. A folder a window names is used only if the person picked it in the system's
//! own dialog while Misty has been running (`space_folder_pick`).

mod download;
mod paths;
mod progress;
mod upload;
mod walk;

#[cfg(test)]
mod tests;

use std::collections::HashSet;
use std::io;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};

use serde::Serialize;
use tauri::{AppHandle, State, Webview};

use crate::agents::shared_folders::check_root;
use crate::app::runtime::MistyRuntime;
use crate::project::person_window;

pub use download::RemoteFile;
pub use upload::FolderUpload;
pub use walk::Scan;

/// Folders the person picked in the dialog since Misty started, by their real path.
static PICKED: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

const NOT_PICKED: &str = "Choose that folder again to share it.";
/// The most a `.mistyignore` may hold.
const MAX_IGNORE_TEXT: usize = 256 * 1024;

fn picked() -> std::sync::MutexGuard<'static, HashSet<PathBuf>> {
    PICKED.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The real path of a folder the person picked, or a refusal.
fn picked_folder(folder: &str) -> Result<PathBuf, String> {
    let asked = PathBuf::from(folder);
    if !asked.is_absolute() {
        return Err(NOT_PICKED.into());
    }
    let real = file_access::fs::canonicalize(&asked).map_err(|_| NOT_PICKED.to_string())?;
    if picked().contains(&real) {
        Ok(real)
    } else {
        Err(NOT_PICKED.into())
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

/// The system's folder dialog, opening on `start` when given, else Documents.
async fn pick_dialog(app: &AppHandle, start: Option<&str>) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (send, receive) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Choose a folder to share")
        .set_can_create_directories(false);
    let start = start.map(PathBuf::from).filter(|path| path.is_absolute());
    if let Some(directory) = start.or_else(dirs::document_dir) {
        dialog = dialog.set_directory(directory);
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

/// Lets the person pick a folder to share in the system's dialog, and lets Misty read it. `start`
/// is where the dialog opens, such as the folder a shared folder last came from. Its real path,
/// or `None` when they cancel.
#[tauri::command]
pub async fn space_folder_pick(
    app: AppHandle,
    webview: Webview,
    state: State<'_, MistyRuntime>,
    start: Option<String>,
) -> Result<Option<String>, String> {
    person_window(&webview)?;
    let Some(path) = pick_dialog(&app, start.as_deref()).await? else {
        return Ok(None);
    };
    let protected = [state.environment.misty_dir()];
    let home = dirs::home_dir();
    check_root(&path, &protected, home.as_deref())?;
    // The person chose it in the system's own dialog, which is what lets Misty reach it.
    file_access::allow_linked_folder(&path);
    let real = match file_access::fs::canonicalize(&path) {
        Ok(real) => real,
        Err(error) => {
            file_access::revoke_linked_folder(&path);
            return Err(error.to_string());
        }
    };
    if real != path {
        file_access::revoke_linked_folder(&path);
        check_root(&real, &protected, home.as_deref())?;
        file_access::allow_linked_folder(&real);
    }
    if !file_access::fs::is_dir(&real) {
        return Err("Choose a folder on this computer.".into());
    }
    picked().insert(real.clone());
    Ok(Some(real.to_string_lossy().into_owned()))
}

/// The picker's tree of a picked folder: the files that are shared, and what the folder's
/// `.gitignore` and `.mistyignore` leave out.
#[tauri::command]
pub async fn space_folder_scan(webview: Webview, folder: String) -> Result<Scan, String> {
    person_window(&webview)?;
    let root = picked_folder(&folder)?;
    blocking(move || Ok(walk::scan(&root))).await
}

/// The folder's own `.mistyignore`, or nothing when it has none.
#[tauri::command]
pub async fn space_folder_ignore_read(webview: Webview, folder: String) -> Result<String, String> {
    person_window(&webview)?;
    let root = picked_folder(&folder)?;
    blocking(move || match file_access::fs::read_to_string(root.join(walk::IGNORE_FILE)) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("Misty couldn't read .mistyignore: {error}")),
    })
    .await
}

/// Replaces the folder's `.mistyignore`. Blank text removes the file.
#[tauri::command]
pub async fn space_folder_ignore_write(
    webview: Webview,
    folder: String,
    text: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let root = picked_folder(&folder)?;
    if text.len() > MAX_IGNORE_TEXT {
        return Err(".mistyignore is too long.".into());
    }
    blocking(move || {
        let path = root.join(walk::IGNORE_FILE);
        if text.trim().is_empty() {
            return match file_access::fs::remove_file(&path) {
                Err(error) if error.kind() != io::ErrorKind::NotFound => {
                    Err(format!("Misty couldn't change .mistyignore: {error}"))
                }
                _ => Ok(()),
            };
        }
        let text = if text.ends_with('\n') { text } else { format!("{text}\n") };
        file_access::fs::write(&path, text)
            .map_err(|error| format!("Misty couldn't save .mistyignore: {error}"))
    })
    .await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFile {
    path: String,
    sha256: String,
    size: u64,
}

/// Every shared file of a picked folder with its SHA-256 and size, sorted by path. Progress goes
/// to the calling window as `misty://space-folder-progress`, with `folder` as given.
#[tauri::command]
pub async fn space_folder_manifest(
    app: AppHandle,
    webview: Webview,
    folder: String,
) -> Result<Vec<ManifestFile>, String> {
    person_window(&webview)?;
    let root = picked_folder(&folder)?;
    let window = webview.label().to_string();
    blocking(move || {
        let files = walk::included_files(&root)?;
        let progress = progress::Progress::new(
            app,
            window,
            folder,
            files.len(),
            files.iter().map(|file| file.size).sum(),
        );
        progress.send(true);
        let mut out = Vec::with_capacity(files.len());
        for file in files {
            let (sha256, size) = walk::sha256_file(&file.absolute, |count| progress.bytes(count))
                .map_err(|error| format!("Misty couldn't read {}: {error}", file.path))?;
            progress.file_done();
            out.push(ManifestFile {
                path: file.path,
                sha256,
                size,
            });
        }
        progress.send(true);
        Ok(out)
    })
    .await
}

/// Streams each listed file of a picked folder to its presigned address, a few at a time, with
/// progress to the calling window.
#[tauri::command]
pub async fn space_folder_put(
    app: AppHandle,
    webview: Webview,
    folder: String,
    uploads: Vec<FolderUpload>,
) -> Result<(), String> {
    person_window(&webview)?;
    let root = picked_folder(&folder)?;
    let window = webview.label().to_string();
    upload::put_all(&root, uploads, |total, bytes| {
        progress::Progress::new(app, window, folder, total, bytes)
    })
    .await
}

/// Brings this computer's copy of a shared folder up to its manifest, and returns where it is.
/// Progress goes to the calling window with `folder` set to `folder_id`.
#[tauri::command]
pub async fn space_folder_download(
    app: AppHandle,
    webview: Webview,
    state: State<'_, MistyRuntime>,
    space: String,
    folder_id: String,
    files: Vec<RemoteFile>,
) -> Result<String, String> {
    person_window(&webview)?;
    let cache = download::cache_root(&state.environment.misty_dir(), &space, &folder_id)?;
    let window = webview.label().to_string();
    download::sync(cache.clone(), files, |total, bytes| {
        progress::Progress::new(app, window, folder_id, total, bytes)
    })
    .await?;
    Ok(cache.to_string_lossy().into_owned())
}

/// Where this computer keeps a shared folder, whether it was downloaded yet or not.
#[tauri::command]
pub async fn space_folder_cache_path(
    webview: Webview,
    state: State<'_, MistyRuntime>,
    space: String,
    folder_id: String,
) -> Result<String, String> {
    person_window(&webview)?;
    let cache = download::cache_root(&state.environment.misty_dir(), &space, &folder_id)?;
    Ok(cache.to_string_lossy().into_owned())
}

/// The shared folders of `space` this computer downloaded, for runs in that Space: their engine
/// may read them beside its own folder (`engines::launch_dirs`). Folders still downloading
/// (`.<id>.partial`) are left out.
pub(crate) fn downloaded_folders(misty_dir: &std::path::Path, space: &str) -> Vec<std::path::PathBuf> {
    let Ok(space) = paths::id(space) else {
        return Vec::new();
    };
    let root = misty_dir.join("spaces").join(space).join("folders");
    let Ok(entries) = file_access::fs::read_dir(&root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .map(|entry| entry.path())
        .filter(|path| file_access::fs::is_dir(path))
        .collect()
}
