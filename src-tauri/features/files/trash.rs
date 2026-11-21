// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Move to Trash and Put Back. Items go to the system's own Trash, the one Finder and Explorer
//! show, and Misty keeps a ledger of where each one came from (`files_trash_ledger` in
//! `misty.db`, and in memory), since the Trash itself can't be listed on macOS without Full Disk
//! Access. The ledger drives Files' Trash view, Put Back and Undo. Deleting for good is a separate
//! command, only from the person's window after its confirm.
//!
//! On macOS an item goes through NSFileManager's `trashItemAtURL`, which says where it landed;
//! elsewhere through the `trash` crate, which finds it again in the system's list.
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        LazyLock, Mutex, OnceLock,
    },
};

use file_access::disk::{check_disk_link, fs_disk};
use file_access::Access;
use serde::Serialize;
use tauri::AppHandle;

use super::entry::{entry_for, FileKind};
use super::listing::io_text;
use super::transfer::{remove_item, Failure, TransferResult};
use super::undo::{self, Change};
use super::{asked_path, blocking, display_name, failed, person_window};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedItem {
    pub id: String,
    pub name: String,
    pub original_path: String,
    /// Where it is in the Trash (on Windows and Linux, the system's own id for it there).
    pub trashed_path: String,
    pub trashed_at: i64,
    pub kind: FileKind,
    pub size: u64,
}

/// The app, for the ledger's table. Every command that reaches the Trash attaches it first; the
/// first one also reads the ledger back from `misty.db`.
static APP: OnceLock<AppHandle> = OnceLock::new();
static LEDGER: LazyLock<Mutex<Vec<TrashedItem>>> = LazyLock::new(Mutex::default);

fn ledger() -> std::sync::MutexGuard<'static, Vec<TrashedItem>> {
    LEDGER.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn kind_text(kind: FileKind) -> &'static str {
    match kind {
        FileKind::Folder => "folder",
        FileKind::File => "file",
        FileKind::Link => "link",
        FileKind::Package => "package",
    }
}

fn kind_from(text: &str) -> FileKind {
    match text {
        "folder" => FileKind::Folder,
        "link" => FileKind::Link,
        "package" => FileKind::Package,
        _ => FileKind::File,
    }
}

static LOADED: AtomicBool = AtomicBool::new(false);

fn load(app: &AppHandle) -> rusqlite::Result<Vec<TrashedItem>> {
    let connection = super::db::connect(app).map_err(|_| rusqlite::Error::InvalidQuery)?;
    let mut statement = connection.prepare(
        "SELECT id, original_path, trashed_path, trashed_at, kind, size FROM files_trash_ledger",
    )?;
    let rows = statement.query_map([], |row| {
        let original: String = row.get(1)?;
        Ok(TrashedItem {
            id: row.get(0)?,
            name: display_name(Path::new(&original)),
            original_path: original,
            trashed_path: row.get(2)?,
            trashed_at: row.get(3)?,
            kind: kind_from(&row.get::<_, String>(4)?),
            size: u64::try_from(row.get::<_, i64>(5)?).unwrap_or(0),
        })
    })?;
    let items = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(items)
}

/// Hands the ledger the app, and the first time `misty.db` answers, reads back what earlier runs
/// of Misty trashed.
pub(crate) fn attach(app: &AppHandle) {
    let _ = APP.set(app.clone());
    if LOADED.load(Ordering::SeqCst) {
        return;
    }
    let Ok(rows) = load(app) else { return };
    LOADED.store(true, Ordering::SeqCst);
    let mut ledger = ledger();
    for row in rows {
        if !ledger.iter().any(|item| item.id == row.id) {
            ledger.push(row);
        }
    }
}

fn save(item: &TrashedItem) {
    let Some(connection) = APP.get().and_then(|app| super::db::connect(app).ok()) else { return };
    let _ = connection.execute(
        "INSERT OR REPLACE INTO files_trash_ledger \
         (id, original_path, trashed_path, trashed_at, kind, size) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            item.id,
            item.original_path,
            item.trashed_path,
            item.trashed_at,
            kind_text(item.kind),
            i64::try_from(item.size).unwrap_or(i64::MAX),
        ],
    );
}

fn forget(ids: &[String]) {
    ledger().retain(|item| !ids.contains(&item.id));
    let Some(connection) = APP.get().and_then(|app| super::db::connect(app).ok()) else { return };
    for id in ids {
        let _ = connection.execute("DELETE FROM files_trash_ledger WHERE id = ?1", [id]);
    }
}

#[cfg(target_os = "macos")]
mod system {
    use std::path::Path;

    /// Moves `path` to the Trash and returns where it landed.
    pub(super) fn trash(path: &Path) -> Result<String, String> {
        use objc2::rc::autoreleasepool;
        use objc2_foundation::{NSFileManager, NSString, NSURL};
        autoreleasepool(|_| {
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
            let mut landed = None;
            NSFileManager::defaultManager()
                .trashItemAtURL_resultingItemURL_error(&url, Some(&mut landed))
                .map_err(|error| error.localizedDescription().to_string())?;
            Ok(landed
                .and_then(|url| url.path())
                .map(|path| path.to_string())
                .unwrap_or_default())
        })
    }

    /// Whether the item is still in the Trash: None while that can't be told.
    pub(super) fn still_there(trashed: &str) -> Option<bool> {
        if trashed.is_empty() {
            return Some(false);
        }
        match file_access::disk::fs_disk::symlink_metadata(trashed) {
            Ok(_) => Some(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(false),
            Err(_) => None,
        }
    }

    pub(super) fn put_back(trashed: &str, original: &Path) -> Result<(), String> {
        file_access::disk::fs_disk::rename(trashed, original)
            .map_err(|error| super::io_text(&error))
    }
}

#[cfg(not(target_os = "macos"))]
mod system {
    use std::path::Path;

    fn find(id: &str) -> Option<trash::TrashItem> {
        trash::os_limited::list()
            .ok()?
            .into_iter()
            .find(|item| item.id.to_string_lossy() == id)
    }

    /// Moves `path` to the Trash and returns the system's id for it there.
    pub(super) fn trash(path: &Path) -> Result<String, String> {
        crate::project::files::move_to_trash(path).map_err(|error| error.to_string())?;
        Ok(trash::os_limited::list()
            .ok()
            .and_then(|items| {
                items
                    .into_iter()
                    .filter(|item| item.original_path() == path)
                    .max_by_key(|item| item.time_deleted)
            })
            .map(|item| item.id.to_string_lossy().into_owned())
            .unwrap_or_default())
    }

    pub(super) fn still_there(trashed: &str) -> Option<bool> {
        if trashed.is_empty() {
            return Some(false);
        }
        let items = trash::os_limited::list().ok()?;
        Some(items.iter().any(|item| item.id.to_string_lossy() == trashed))
    }

    pub(super) fn put_back(trashed: &str, _original: &Path) -> Result<(), String> {
        let item = find(trashed).ok_or("It isn't in the Trash anymore.")?;
        trash::os_limited::restore_all([item]).map_err(|error| error.to_string())
    }
}

/// Moves each item to the system's Trash and notes where it came from. Returns what went, and
/// why each of the rest didn't.
pub fn trash_paths(paths: &[PathBuf]) -> (Vec<TrashedItem>, Vec<Failure>) {
    let mut trashed = Vec::new();
    let mut failures = Vec::new();
    let home = dirs::home_dir();
    for path in paths {
        if path.parent().is_none() || home.as_deref() == Some(path.as_path()) {
            failures.push(Failure::new(path, "This folder can't be moved to the Trash."));
            continue;
        }
        if let Err(error) = check_disk_link(path, Access::Write) {
            failures.push(Failure::new(path, io_text(&error)));
            continue;
        }
        let entry = match entry_for(path) {
            Ok(entry) => entry,
            Err(error) => {
                failures.push(Failure::new(path, io_text(&error)));
                continue;
            }
        };
        match system::trash(path) {
            Ok(landed) => {
                let item = TrashedItem {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: entry.name,
                    original_path: path.display().to_string(),
                    trashed_path: landed,
                    trashed_at: super::db::now_ms(),
                    kind: entry.kind,
                    size: entry.size,
                };
                save(&item);
                ledger().push(item.clone());
                super::search::note_removed(path);
                trashed.push(item);
            }
            Err(error) => failures.push(Failure::new(path, error)),
        }
    }
    (trashed, failures)
}

/// Puts items the ledger knows back where they came from. Like Finder, it fails rather than
/// replace something that has taken the name since.
pub fn put_back_ids(ids: &[String]) -> TransferResult {
    let mut result = TransferResult::default();
    let mut done = Vec::new();
    for id in ids {
        let Some(item) = ledger().iter().find(|item| &item.id == id).cloned() else {
            result.failed.push(Failure {
                path: id.clone(),
                error: "Misty doesn't know where that item came from.".into(),
            });
            continue;
        };
        let original = PathBuf::from(&item.original_path);
        if fs_disk::exists(&original) {
            result
                .failed
                .push(Failure::new(&original, "An item with that name is already there."));
            continue;
        }
        if let Some(parent) = original.parent() {
            if let Err(error) = fs_disk::create_dir_all(parent) {
                result.failed.push(Failure::new(&original, io_text(&error)));
                continue;
            }
        }
        match system::put_back(&item.trashed_path, &original) {
            Ok(()) => {
                super::search::note_added(&original);
                result.created.push(item.original_path.clone());
                done.push(item.id);
            }
            Err(error) => result.failed.push(Failure::new(&original, error)),
        }
    }
    forget(&done);
    result
}

/// Moves items to the Trash, for Undo to put back.
#[tauri::command]
pub async fn files_trash(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    paths: Vec<String>,
) -> Result<Vec<TrashedItem>, String> {
    person_window(&webview)?;
    let paths = paths
        .iter()
        .map(|path| asked_path(path))
        .collect::<Result<Vec<_>, _>>()?;
    blocking(move || {
        attach(&app);
        let (trashed, failures) = trash_paths(&paths);
        if !trashed.is_empty() {
            let ids = trashed.iter().map(|item| item.id.clone()).collect();
            undo::record("Move to Trash", Change::Trashed(ids));
        }
        match (trashed.is_empty(), failures.into_iter().next()) {
            (true, Some(failure)) => Err(failure.error),
            _ => Ok(trashed),
        }
    })
    .await
}

/// What Misty moved to the Trash that is still there, newest first. Items emptied from the Trash
/// or taken out of it elsewhere drop out of the ledger.
#[tauri::command]
pub async fn files_trashed(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<Vec<TrashedItem>, String> {
    person_window(&webview)?;
    blocking(move || {
        attach(&app);
        let items = ledger().clone();
        let mut present = Vec::new();
        let mut gone = Vec::new();
        for item in items {
            match system::still_there(&item.trashed_path) {
                Some(true) => present.push(item),
                Some(false) => gone.push(item.id),
                None => {}
            }
        }
        forget(&gone);
        present.sort_by(|a, b| b.trashed_at.cmp(&a.trashed_at));
        Ok(present)
    })
    .await
}

#[tauri::command]
pub async fn files_put_back(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    ids: Vec<String>,
) -> Result<TransferResult, String> {
    person_window(&webview)?;
    blocking(move || {
        attach(&app);
        Ok(put_back_ids(&ids))
    })
    .await
}

/// Deletes items for good. Only the person's window reaches this, after its delete dialog; no
/// tool or SDK call does. A link goes as itself, never what it points to.
#[tauri::command]
pub async fn files_delete_forever(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    paths: Vec<String>,
) -> Result<Vec<Failure>, String> {
    person_window(&webview)?;
    let paths = paths
        .iter()
        .map(|path| asked_path(path))
        .collect::<Result<Vec<_>, _>>()?;
    blocking(move || {
        attach(&app);
        let home = dirs::home_dir();
        let mut failures = Vec::new();
        let mut emptied = Vec::new();
        for path in &paths {
            if path.parent().is_none() || home.as_deref() == Some(path.as_path()) {
                failures.push(Failure::new(path, "This folder can't be deleted."));
                continue;
            }
            match remove_item(path) {
                Ok(()) => {
                    super::search::note_removed(path);
                    let text = path.display().to_string();
                    emptied.extend(
                        ledger()
                            .iter()
                            .filter(|item| item.trashed_path == text)
                            .map(|item| item.id.clone()),
                    );
                }
                Err(error) => failures.push(Failure {
                    path: path.display().to_string(),
                    error: failed(path, io_text(&error)),
                }),
            }
        }
        forget(&emptied);
        Ok(failures)
    })
    .await
}
