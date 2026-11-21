//! Starred and Recent: two small tables in `misty.db` (`files_starred`, `files_recent`), kept on
//! this device. Each lists paths; what Files shows is read from the disk anew each time, so a
//! renamed or deleted item never shows stale.
use std::path::{Path, PathBuf};

use rusqlite::params;
use tauri::AppHandle;

use super::db::{connect, now_ms};
use super::entry::{entry_for, FileEntry};
use super::{asked_path, blocking, person_window};

/// How many opened items Recent shows.
const RECENT_SHOWN: usize = 50;
/// How many it keeps, so a few missing ones never leave it short.
const RECENT_KEPT: i64 = 200;

fn db_error(error: rusqlite::Error) -> String {
    format!("Misty's data couldn't be read: {error}")
}

/// The entries for `paths`, in their order, leaving out what can't be read now. Paths that are
/// gone for good come back separately so the caller can forget them; one the gate refuses (the
/// disk grant was taken back, a drive was unplugged) is only left out.
fn entries(paths: Vec<String>, most: usize) -> (Vec<FileEntry>, Vec<String>) {
    let mut found = Vec::new();
    let mut gone = Vec::new();
    for path in paths {
        if found.len() >= most {
            break;
        }
        match entry_for(Path::new(&path)) {
            Ok(entry) => found.push(entry),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => gone.push(path),
            Err(_) => {}
        }
    }
    (found, gone)
}

fn forget(connection: &rusqlite::Connection, table: &str, paths: &[String]) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("DELETE FROM {table} WHERE path = ?1"))
        .map_err(db_error)?;
    for path in paths {
        statement.execute(params![path]).map_err(db_error)?;
    }
    Ok(())
}

fn paths_in(connection: &rusqlite::Connection, sql: &str) -> Result<Vec<String>, String> {
    let mut statement = connection.prepare(sql).map_err(db_error)?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(db_error)?;
    rows.collect::<Result<_, _>>().map_err(db_error)
}

/// Notes that the person opened `path`, for Recent. Files' own Open calls this; failures are only
/// logged, since opening the item already happened.
pub fn note_recent_path(app: &AppHandle, path: &Path) {
    if let Err(error) = note_recent(app, path) {
        eprintln!("Files couldn't note a recent item: {error}");
    }
}

fn note_recent(app: &AppHandle, path: &Path) -> Result<(), String> {
    let connection = connect(app)?;
    connection
        .execute(
            "INSERT INTO files_recent (path, opened_at) VALUES (?1, ?2)
             ON CONFLICT(path) DO UPDATE SET opened_at = excluded.opened_at",
            params![path.display().to_string(), now_ms()],
        )
        .map_err(db_error)?;
    connection
        .execute(
            "DELETE FROM files_recent WHERE path NOT IN
             (SELECT path FROM files_recent ORDER BY opened_at DESC LIMIT ?1)",
            params![RECENT_KEPT],
        )
        .map_err(db_error)?;
    Ok(())
}

/// What the person starred, newest first.
#[tauri::command]
pub async fn files_starred(app: AppHandle, webview: tauri::Webview) -> Result<Vec<FileEntry>, String> {
    person_window(&webview)?;
    blocking(move || {
        let connection = connect(&app)?;
        let paths = paths_in(&connection, "SELECT path FROM files_starred ORDER BY starred_at DESC")?;
        let (found, _gone) = entries(paths, usize::MAX);
        // A starred item that's gone stays starred: it may be on a drive that isn't plugged in.
        Ok(found)
    })
    .await
}

/// Stars or unstars each of `paths`.
#[tauri::command]
pub async fn files_star(
    app: AppHandle,
    webview: tauri::Webview,
    paths: Vec<String>,
    on: bool,
) -> Result<(), String> {
    person_window(&webview)?;
    let paths: Vec<PathBuf> = paths.iter().map(|path| asked_path(path)).collect::<Result<_, _>>()?;
    blocking(move || {
        let mut connection = connect(&app)?;
        let transaction = connection.transaction().map_err(db_error)?;
        let at = now_ms();
        for path in &paths {
            let path = path.display().to_string();
            if on {
                transaction
                    .execute(
                        "INSERT INTO files_starred (path, starred_at) VALUES (?1, ?2)
                         ON CONFLICT(path) DO NOTHING",
                        params![path, at],
                    )
                    .map_err(db_error)?;
            } else {
                transaction
                    .execute("DELETE FROM files_starred WHERE path = ?1", params![path])
                    .map_err(db_error)?;
            }
        }
        transaction.commit().map_err(db_error)
    })
    .await
}

/// The newest opened items that are still there, newest first. Ones that are gone are forgotten.
#[tauri::command]
pub async fn files_recent(app: AppHandle, webview: tauri::Webview) -> Result<Vec<FileEntry>, String> {
    person_window(&webview)?;
    blocking(move || {
        let connection = connect(&app)?;
        let paths = paths_in(&connection, "SELECT path FROM files_recent ORDER BY opened_at DESC")?;
        let (found, gone) = entries(paths, RECENT_SHOWN);
        forget(&connection, "files_recent", &gone)?;
        Ok(found)
    })
    .await
}

/// Notes that the person opened `path` somewhere other than Files' own Open, such as Quick Look.
#[tauri::command]
pub async fn files_note_recent(
    app: AppHandle,
    webview: tauri::Webview,
    path: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || note_recent(&app, &path)).await
}
