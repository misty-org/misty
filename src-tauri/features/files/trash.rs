// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Move to Trash and Put Back. Items go to the system's own Trash, the one Finder and Explorer
//! show, and Misty keeps a ledger of where each one came from (`files_trash_ledger` in
//! `misty.db`, and in memory), since the Trash itself can't be listed on macOS without Full Disk
//! Access. The ledger drives Files' Trash view, Put Back and Undo. Put Back never replaces what is
//! there now: the item comes back under the next free name. Deleting for good is two separate
//! commands, only from the person's window after its confirm: what is in the Trash, by its ledger
//! id, and live items, on the ops queue, never the disk, the home folder or Misty's own data.
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

use file_access::disk::{fs_disk, walk};
use file_access::Access;
use serde::Serialize;
use tauri::AppHandle;

use super::entry::{entry_for, FileKind};
use super::listing::io_text;
use super::transfer::{Failure, TransferResult};
use super::undo::{self, Change};
use super::{asked_paths, blocking, display_name, gated, person_window};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedItem {
    pub id: String,
    pub name: String,
    pub original_path: String,
    pub trashed_path: String,
    pub trashed_at: i64,
    pub kind: FileKind,
    pub size: u64,
}

static APP: OnceLock<AppHandle> = OnceLock::new();
static LEDGER: LazyLock<Mutex<Vec<TrashedItem>>> = LazyLock::new(Mutex::default);

fn ledger() -> std::sync::MutexGuard<'static, Vec<TrashedItem>> {
    LEDGER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
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

fn db_text(error: rusqlite::Error) -> String {
    format!("Misty's data couldn't be read: {error}")
}

fn load(app: &AppHandle) -> Result<Vec<TrashedItem>, String> {
    super::db::with(app, |connection| {
        let mut statement = connection
            .prepare(
                "SELECT id, original_path, trashed_path, trashed_at, kind, size FROM files_trash_ledger",
            )
            .map_err(db_text)?;
        let rows = statement
            .query_map([], |row| {
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
            })
            .map_err(db_text)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_text)
    })
}

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

fn save(items: &[TrashedItem]) {
    let Some(app) = APP.get() else { return };
    if items.is_empty() {
        return;
    }
    let saved = super::db::with(app, |connection| {
        let transaction = connection.transaction().map_err(db_text)?;
        {
            let mut statement = transaction
                .prepare(
                    "INSERT OR REPLACE INTO files_trash_ledger \
                     (id, original_path, trashed_path, trashed_at, kind, size) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                )
                .map_err(db_text)?;
            for item in items {
                statement
                    .execute(rusqlite::params![
                        item.id,
                        item.original_path,
                        item.trashed_path,
                        item.trashed_at,
                        kind_text(item.kind),
                        i64::try_from(item.size).unwrap_or(i64::MAX),
                    ])
                    .map_err(db_text)?;
            }
        }
        transaction.commit().map_err(db_text)
    });
    if let Err(error) = saved {
        eprintln!("Files couldn't note what went to the Trash: {error}");
    }
}

fn forget(ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    ledger().retain(|item| !ids.contains(&item.id));
    let Some(app) = APP.get() else { return };
    let _ = super::db::with(app, |connection| {
        let transaction = connection.transaction().map_err(db_text)?;
        {
            let mut statement = transaction
                .prepare("DELETE FROM files_trash_ledger WHERE id = ?1")
                .map_err(db_text)?;
            for id in ids {
                statement.execute([id]).map_err(db_text)?;
            }
        }
        transaction.commit().map_err(db_text)
    });
}

fn protected(path: &Path) -> Option<&'static str> {
    if path.parent().is_none() {
        return Some("A whole drive can't be removed here.");
    }
    if dirs::home_dir().is_some_and(|home| home.starts_with(path)) {
        return Some("Your home folder can't be removed here.");
    }
    let in_a_drive = file_access::paths::misty_mount_dir().is_some_and(|mount| {
        path.strip_prefix(&mount)
            .is_ok_and(|inside| inside.components().count() >= 2)
    });
    let misty = file_access::paths::misty_root_dir()
        .is_some_and(|misty| misty.starts_with(path) || (path.starts_with(&misty) && !in_a_drive));
    if misty {
        return Some("That folder holds Misty's own data.");
    }
    None
}

#[cfg(target_os = "macos")]
mod system {
    use std::path::{Path, PathBuf};

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

    pub(super) fn put_back(trashed: &str, original: &Path) -> Result<PathBuf, String> {
        use file_access::disk::place;
        use file_access::Access;
        let text = |error: std::io::Error| super::io_text(&error);
        let (held, name) = super::gated::parent(Path::new(trashed), Access::Write).map_err(text)?;
        let (folder, wanted) = super::gated::parent(original, Access::Write).map_err(text)?;
        let landed = place::rename_keep_both(&held, &name, &folder, &wanted).map_err(text)?;
        Ok(original.with_file_name(landed))
    }

    pub(super) fn delete(trashed: &str) -> Result<(), String> {
        file_access::disk::walk::remove_tree_checked(
            Path::new(trashed),
            file_access::disk::walk::WalkFor::Person,
            &mut |_| true,
        )
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
        Some(
            items
                .iter()
                .any(|item| item.id.to_string_lossy() == trashed),
        )
    }

    pub(super) fn put_back(trashed: &str, original: &Path) -> Result<std::path::PathBuf, String> {
        let item = find(trashed).ok_or("It isn't in the Trash anymore.")?;
        trash::os_limited::restore_all([item]).map_err(|error| error.to_string())?;
        Ok(original.to_path_buf())
    }

    pub(super) fn delete(trashed: &str) -> Result<(), String> {
        let item = find(trashed).ok_or("It isn't in the Trash anymore.")?;
        trash::os_limited::purge_all([item]).map_err(|error| error.to_string())
    }
}

pub fn trash_paths(paths: &[PathBuf]) -> (Vec<TrashedItem>, Vec<Failure>) {
    let mut trashed = Vec::new();
    let mut failures = Vec::new();
    for path in paths {
        if let Some(why) = protected(path) {
            failures.push(Failure::new(path, why));
            continue;
        }
        let checked =
            gated::parent(path, Access::Write).and_then(|(folder, name)| folder.metadata(&name));
        if let Err(error) = checked {
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
                trashed.push(TrashedItem {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: entry.name,
                    original_path: path.display().to_string(),
                    trashed_path: landed,
                    trashed_at: super::db::now_ms(),
                    kind: entry.kind,
                    size: entry.size,
                });
                super::search::note_removed(path);
            }
            Err(error) => failures.push(Failure::new(path, error)),
        }
    }
    save(&trashed);
    ledger().extend(trashed.iter().cloned());
    (trashed, failures)
}

pub fn put_back_ids(ids: &[String]) -> (TransferResult, Vec<String>) {
    let mut result = TransferResult::default();
    let mut done = Vec::new();
    let mut left = Vec::new();
    for id in ids {
        let Some(item) = ledger().iter().find(|item| &item.id == id).cloned() else {
            result.failed.push(Failure {
                path: id.clone(),
                error: "Misty doesn't know where that item came from.".into(),
            });
            continue;
        };
        let original = PathBuf::from(&item.original_path);
        if let Some(parent) = original.parent() {
            if let Err(error) = fs_disk::create_dir_all(parent) {
                result.failed.push(Failure::new(&original, io_text(&error)));
                left.push(item.id);
                continue;
            }
        }
        match system::put_back(&item.trashed_path, &original) {
            Ok(landed) => {
                super::search::note_added(&landed);
                result.created.push(landed.display().to_string());
                done.push(item.id);
            }
            Err(error) => {
                result.failed.push(Failure::new(&original, error));
                left.push(item.id);
            }
        }
    }
    forget(&done);
    (result, left)
}

#[tauri::command]
pub async fn files_trash(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    paths: Vec<String>,
) -> Result<Vec<TrashedItem>, String> {
    person_window(&webview)?;
    let paths = asked_paths(&paths)?;
    let window = webview.label().to_owned();
    blocking(move || {
        attach(&app);
        let (trashed, failures) = trash_paths(&paths);
        if !trashed.is_empty() {
            let ids = trashed.iter().map(|item| item.id.clone()).collect();
            undo::record(&window, "Move to Trash", Change::Trashed(ids));
        }
        match (trashed.is_empty(), failures.into_iter().next()) {
            (true, Some(failure)) => Err(failure.error),
            _ => Ok(trashed),
        }
    })
    .await
}

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
        Ok(put_back_ids(&ids).0)
    })
    .await
}

pub(crate) fn delete_now(paths: &[PathBuf], stopped: &dyn Fn() -> bool) -> (Vec<Failure>, bool) {
    let mut failures = Vec::new();
    for path in paths {
        if stopped() {
            return (failures, true);
        }
        if let Some(why) = protected(path) {
            failures.push(Failure::new(path, why));
            continue;
        }
        match walk::remove_tree_checked(path, walk::WalkFor::Person, &mut |_| !stopped()) {
            Ok(()) => super::search::note_removed(path),
            Err(error) if gated::is_cancel(&error) => {
                super::search::note_removed(path);
                return (failures, true);
            }
            Err(error) => failures.push(Failure::new(path, io_text(&error))),
        }
    }
    (failures, false)
}

#[tauri::command]
pub async fn files_delete_now(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    paths: Vec<String>,
    op_id: String,
) -> Result<Vec<Failure>, String> {
    person_window(&webview)?;
    let paths = asked_paths(&paths)?;
    super::runtime::run(&app, &webview, &op_id, "Deleting", move |op| {
        let stop = op.stop();
        let (failures, _) = delete_now(&paths, &|| stop.stopped());
        Ok(failures)
    })
    .await
}

#[tauri::command]
pub async fn files_delete_trashed(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    ids: Vec<String>,
) -> Result<Vec<Failure>, String> {
    person_window(&webview)?;
    blocking(move || {
        attach(&app);
        let mut failures = Vec::new();
        let mut emptied = Vec::new();
        for id in &ids {
            let Some(item) = ledger().iter().find(|item| &item.id == id).cloned() else {
                failures.push(Failure {
                    path: id.clone(),
                    error: "That item isn't in the Trash anymore.".into(),
                });
                continue;
            };
            let gone = match system::still_there(&item.trashed_path) {
                Some(false) => Ok(()),
                _ => system::delete(&item.trashed_path),
            };
            match gone {
                Ok(()) => emptied.push(item.id),
                Err(error) => failures.push(Failure {
                    path: item.original_path.clone(),
                    error: format!("{}: {error}", item.name),
                }),
            }
        }
        forget(&emptied);
        Ok(failures)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deleting_now_refuses_the_disk_the_home_folder_and_misty_s_data() {
        let home = dirs::home_dir().expect("a home folder");
        let mut asked = vec![PathBuf::from("/"), home.clone()];
        if let Some(up) = home.parent() {
            asked.push(up.to_path_buf());
        }
        if let Some(misty) = file_access::paths::misty_root_dir() {
            asked.push(misty.join("dev"));
        }
        let (failures, stopped) = delete_now(&asked, &|| false);
        assert!(!stopped);
        assert_eq!(failures.len(), asked.len());
        assert!(file_access::fs::exists(&home));
        assert!(super::super::asked_path(&format!("{}/../x", home.display())).is_err());
    }

    #[test]
    fn deleting_now_removes_a_folder_and_stops_when_asked() {
        let root = tempfile::tempdir().expect("temp folder");
        let folder = root.path().join("old");
        file_access::fs::create_dir_all(folder.join("inner")).expect("folder");
        file_access::fs::write(folder.join("inner/a.txt"), b"a").expect("write");
        let (failures, stopped) = delete_now(&[folder.clone()], &|| false);
        assert!(failures.is_empty() && !stopped, "{failures:?}");
        assert!(!file_access::fs::exists(&folder));
        let (_, stopped) = delete_now(&[root.path().join("x")], &|| true);
        assert!(stopped);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn put_back_keeps_both_when_the_name_is_taken() {
        let root = tempfile::tempdir().expect("temp folder");
        let held = root.path().join("held");
        let back = root.path().join("back");
        file_access::fs::create_dir_all(&held).expect("folder");
        file_access::fs::create_dir_all(&back).expect("folder");
        file_access::fs::write(held.join("notes.txt"), b"old").expect("write");
        file_access::fs::write(back.join("notes.txt"), b"new").expect("write");
        let landed = system::put_back(
            &held.join("notes.txt").display().to_string(),
            &back.join("notes.txt"),
        )
        .expect("put back");
        assert_eq!(landed, back.join("notes 2.txt"));
        assert_eq!(
            file_access::fs::read(back.join("notes.txt")).expect("read"),
            b"new"
        );
        assert_eq!(file_access::fs::read(&landed).expect("read"), b"old");
    }
}
