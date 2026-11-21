//! Copy, Cut and Paste of files on the system's own clipboard, so a copy in Files pastes in Finder
//! or Explorer and the other way round. The platform code is the chat's file panel's
//! (`project/files/clipboard.rs`). macOS's clipboard has no "cut", so Files keeps that beside the
//! paths it wrote and trusts it only while the clipboard still holds that write (its change count
//! hasn't moved). Where the system has no file clipboard Misty can reach (Linux), the paths are
//! kept here alone.
use std::sync::{LazyLock, Mutex};

use file_access::disk::fs_disk;
use serde::Serialize;

use super::{asked_path, person_window};
use crate::project::files::clipboard as system;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFiles {
    pub paths: Vec<String>,
    pub cut: bool,
}

/// The last write from Files: its paths, whether they were cut, and the clipboard's change count
/// right after it.
struct Written {
    paths: Vec<String>,
    cut: bool,
    change_count: Option<u64>,
}

static WRITTEN: LazyLock<Mutex<Option<Written>>> = LazyLock::new(Mutex::default);

fn written() -> std::sync::MutexGuard<'static, Option<Written>> {
    WRITTEN.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Puts the items on the clipboard. Items that aren't there are left off.
#[tauri::command]
pub async fn files_clipboard_set(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    paths: Vec<String>,
    cut: bool,
) -> Result<(), String> {
    person_window(&webview)?;
    let mut kept = Vec::new();
    for path in &paths {
        let path = asked_path(path)?;
        if fs_disk::exists(&path) {
            kept.push(path.display().to_string());
        }
    }
    if kept.is_empty() {
        return Err("Nothing to copy.".into());
    }
    // Linux has no file clipboard Misty can reach; Files then keeps the paths here alone.
    let change_count = system::write_checked_paths_on_main_thread(&app, kept.clone())
        .await
        .unwrap_or(None);
    *written() = Some(Written {
        paths: kept,
        cut,
        change_count,
    });
    Ok(())
}

/// The files on the clipboard, and whether Files cut them.
#[tauri::command]
pub async fn files_clipboard(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<ClipboardFiles, String> {
    person_window(&webview)?;
    let snapshot = system::snapshot_on_main_thread(&app).await?;
    let guard = written();
    let ours = guard.as_ref();
    if snapshot.change_count.is_none() && snapshot.paths.is_empty() {
        return Ok(match ours {
            Some(written) => ClipboardFiles {
                paths: written.paths.clone(),
                cut: written.cut,
            },
            None => ClipboardFiles {
                paths: Vec::new(),
                cut: false,
            },
        });
    }
    let cut = ours.is_some_and(|written| {
        written.cut
            && written.change_count.is_some()
            && written.change_count == snapshot.change_count
    });
    Ok(ClipboardFiles {
        paths: snapshot.paths,
        cut,
    })
}
