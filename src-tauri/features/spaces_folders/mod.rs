mod walk;

#[cfg(test)]
mod tests;

use std::collections::HashSet;
use std::io;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};

use tauri::{State, Webview};

use crate::agents::shared_folders::check_root;
use crate::app::runtime::MistyRuntime;
use crate::project::person_window;

pub use walk::Scan;

static PICKED: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

const NOT_PICKED: &str = "Choose that folder again to share it.";
const MAX_IGNORE_TEXT: usize = 256 * 1024;

fn picked() -> std::sync::MutexGuard<'static, HashSet<PathBuf>> {
    PICKED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn picked_folder(folder: &str) -> Result<PathBuf, String> {
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

pub(crate) fn source_to_copy(source: &str, protected: &[PathBuf]) -> Result<PathBuf, String> {
    if let Ok(path) = picked_folder(source) {
        return Ok(path);
    }
    let asked = crate::files::asked_path(source)?;
    let (real, kind) =
        crate::files::copy_source::real_local(&asked).map_err(|error| error.to_string())?;
    match kind {
        space_drive::CopyKind::Folder => {
            check_root(&real, protected, dirs::home_dir().as_deref())?;
        }
        space_drive::CopyKind::Other => {
            return Err("Choose a file or a folder on this computer.".into());
        }
        space_drive::CopyKind::File if protected.iter().any(|kept| real.starts_with(kept)) => {
            return Err("That file is Misty's own.".into());
        }
        space_drive::CopyKind::File => {}
    }
    Ok(real)
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

async fn pick_dialog(webview: &Webview, start: Option<&str>) -> Result<Option<PathBuf>, String> {
    let start = start.map(PathBuf::from).filter(|path| path.is_absolute());
    let pick = crate::files::pick::Pick::folder("Choose a folder to copy into the Space")
        .start(start.or_else(dirs::document_dir));
    crate::files::pick::pick_one(webview, pick).await
}

#[tauri::command]
pub async fn space_folder_pick(
    webview: Webview,
    state: State<'_, MistyRuntime>,
    start: Option<String>,
) -> Result<Option<String>, String> {
    person_window(&webview)?;
    let Some(path) = pick_dialog(&webview, start.as_deref()).await? else {
        return Ok(None);
    };
    let protected = [state.environment.misty_dir()];
    let home = dirs::home_dir();
    check_root(&path, &protected, home.as_deref())?;
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

#[tauri::command]
pub async fn space_folder_scan(webview: Webview, folder: String) -> Result<Scan, String> {
    person_window(&webview)?;
    let root = picked_folder(&folder)?;
    blocking(move || Ok(walk::scan(&root))).await
}

#[tauri::command]
pub async fn space_folder_ignore_read(webview: Webview, folder: String) -> Result<String, String> {
    person_window(&webview)?;
    let root = picked_folder(&folder)?;
    blocking(
        move || match file_access::fs::read_to_string(root.join(walk::IGNORE_FILE)) {
            Ok(text) => Ok(text),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(String::new()),
            Err(error) => Err(format!("Misty couldn't read .mistyignore: {error}")),
        },
    )
    .await
}

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
        let text = if text.ends_with('\n') {
            text
        } else {
            format!("{text}\n")
        };
        file_access::fs::write(&path, text)
            .map_err(|error| format!("Misty couldn't save .mistyignore: {error}"))
    })
    .await
}
