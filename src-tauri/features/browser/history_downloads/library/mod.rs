//! The browser's durable library: the downloads list and browsing history, in `misty.db`,
//! so they survive restarts. Finished downloads also join their Space's encrypted
//! downloads list (the files stay here); history syncs through the browser sync.

#[cfg(desktop)]
use file_access::looks;
pub mod history;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use std::{
    path::Path,
    sync::{Mutex, MutexGuard, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;

use database::store::Store;
mod profile;
pub(crate) use profile::seed_records as seed_download_records;

mod downloads;
pub use downloads::*;

static LIBRARY: OnceLock<Mutex<Connection>> = OnceLock::new();
const MAX_DOWNLOADS: i64 = 1_000;

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

pub(crate) fn library(_app: &AppHandle) -> Result<MutexGuard<'static, Connection>, String> {
    if LIBRARY.get().is_none() {
        let home =
            file_access::paths::misty_home_dir().ok_or("Misty's data folder is unavailable.")?;
        let store = Store::in_home(&home);
        let connection = open(&store)?;
        let _ = LIBRARY.set(Mutex::new(connection));
    }
    LIBRARY
        .get()
        .ok_or_else(|| "The browser library is unavailable.".to_owned())?
        .lock()
        .map_err(|_| "The browser library is unavailable.".to_owned())
}

fn open(store: &Store) -> Result<Connection, String> {
    let connection = store.connect().map_err(|error| error.to_string())?;
    // Anything still running when Misty quit can no longer finish.
    connection
        .execute(
            "UPDATE downloads SET state = 'interrupted', finished_at = ?1 WHERE state = 'in_progress'",
            params![now_ms()],
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

/// Records a download the user started. Agent downloads are task files and
/// never appear in the user's list.
pub(crate) fn download_started(app: &AppHandle, id: &str, url: &str, path: &Path) {
    let Ok(connection) = library(app) else { return };
    let _ = connection.execute(
        "INSERT OR REPLACE INTO downloads (id, url, path, state, started_at) VALUES (?1, ?2, ?3, 'in_progress', ?4)",
        params![id, url, path.to_string_lossy(), now_ms()],
    );
    let _ = connection.execute(
        "DELETE FROM downloads WHERE id IN (SELECT id FROM downloads ORDER BY started_at DESC LIMIT -1 OFFSET ?1)",
        params![MAX_DOWNLOADS],
    );
}

pub(crate) fn download_finished(app: &AppHandle, id: &str, success: bool, error: Option<&str>) {
    let Ok(connection) = library(app) else { return };
    let size = connection
        .query_row(
            "SELECT path FROM downloads WHERE id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .and_then(|path: String| looks::recorded_download(Path::new(&path)))
        .map(|meta| meta.len() as i64);
    // A cancelled download also reports failure; keep it marked as cancelled.
    let _ = connection.execute(
        "UPDATE downloads SET state = ?2, error = ?3, finished_at = ?4,
             received = COALESCE(?5, received), total = CASE WHEN ?2 = 'finished' THEN COALESCE(?5, total) ELSE total END
         WHERE id = ?1 AND state = 'in_progress'",
        params![id, if success { "finished" } else { "failed" }, error, now_ms(), size],
    );
}

/// A finished download joins the downloads list of the profile whose pages use
/// `store_key`. The file stays where it was saved.
pub(crate) fn download_into_profile(app: &AppHandle, store_key: String, id: &str) {
    let Ok(connection) = library(app) else { return };
    profile::publish(&connection, store_key, id);
}

pub(crate) fn download_failed(app: &AppHandle, id: &str, url: &str, error: &str) {
    let Ok(connection) = library(app) else { return };
    let now = now_ms();
    let _ = connection.execute(
        "INSERT OR REPLACE INTO downloads (id, url, path, state, error, started_at, finished_at)
         VALUES (?1, ?2, '', 'failed', ?3, ?4, ?4)",
        params![id, url, error, now],
    );
}
