// What the engines keep in `misty.db`, on this computer only: the project folders linked to each
// Space, and each chat's session in its engine. Neither ever syncs.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use database::store::Store;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

fn text(error: rusqlite::Error) -> String {
    error.to_string()
}

/// The folders linked to one Space, oldest first.
pub fn folders(store: &Store, account: &str, space: &str) -> Result<Vec<String>, String> {
    let connection = store.connect().map_err(text)?;
    let mut statement = connection
        .prepare(
            "SELECT path FROM space_folders WHERE account = ?1 AND space = ?2 ORDER BY added_at",
        )
        .map_err(text)?;
    let rows = statement
        .query_map([account, space], |row| row.get::<_, String>(0))
        .map_err(text)?;
    rows.collect::<Result<_, _>>().map_err(text)
}

/// Every linked folder on this computer, to let the file gate reach them as the app starts.
pub fn all_folders(store: &Store) -> Result<Vec<PathBuf>, String> {
    let connection = store.connect().map_err(text)?;
    let mut statement = connection
        .prepare("SELECT DISTINCT path FROM space_folders")
        .map_err(text)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(text)?;
    rows.map(|row| row.map(PathBuf::from))
        .collect::<Result<_, _>>()
        .map_err(text)
}

/// Whether the account linked this folder, or one that holds it, to any Space.
pub fn is_linked(store: &Store, account: &str, folder: &Path) -> Result<bool, String> {
    let connection = store.connect().map_err(text)?;
    let mut statement = connection
        .prepare("SELECT path FROM space_folders WHERE account = ?1")
        .map_err(text)?;
    let rows = statement
        .query_map([account], |row| row.get::<_, String>(0))
        .map_err(text)?;
    for row in rows {
        if folder.starts_with(row.map_err(text)?) {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn link_folder(store: &Store, account: &str, space: &str, path: &str) -> Result<(), String> {
    store
        .connect()
        .map_err(text)?
        .execute(
            "INSERT OR IGNORE INTO space_folders (account, space, path, added_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![account, space, path, now()],
        )
        .map(|_| ())
        .map_err(text)
}

/// Unlinks a folder from a Space. Returns whether any Space on this computer still links it.
pub fn unlink_folder(
    store: &Store,
    account: &str,
    space: &str,
    path: &str,
) -> Result<bool, String> {
    let connection = store.connect().map_err(text)?;
    connection
        .execute(
            "DELETE FROM space_folders WHERE account = ?1 AND space = ?2 AND path = ?3",
            [account, space, path],
        )
        .map_err(text)?;
    connection
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM space_folders WHERE path = ?1)",
            [path],
            |row| row.get::<_, bool>(0),
        )
        .map_err(text)
}

/// The engine's own session for a chat, to continue it in the same folder.
pub fn session(
    store: &Store,
    account: &str,
    conversation: &str,
    engine: &str,
    folder: &str,
) -> Option<String> {
    store
        .connect()
        .ok()?
        .query_row(
            "SELECT session_id FROM engine_sessions
             WHERE account = ?1 AND conversation_id = ?2 AND engine = ?3 AND folder = ?4",
            [account, conversation, engine, folder],
            |row| row.get::<_, String>(0),
        )
        .ok()
}

pub fn keep_session(
    store: &Store,
    account: &str,
    conversation: &str,
    engine: &str,
    folder: &str,
    session: &str,
) -> Result<(), String> {
    store
        .connect()
        .map_err(text)?
        .execute(
            "INSERT INTO engine_sessions (account, conversation_id, engine, session_id, folder, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (account, conversation_id, engine)
             DO UPDATE SET session_id = ?4, folder = ?5, updated_at = ?6",
            rusqlite::params![account, conversation, engine, session, folder, now()],
        )
        .map(|_| ())
        .map_err(text)
}

/// Forgets the engine's session for a chat (`/clear`): the next turn starts a new one.
pub fn forget_session(store: &Store, account: &str, conversation: &str) -> Result<(), String> {
    store
        .connect()
        .map_err(text)?
        .execute(
            "DELETE FROM engine_sessions WHERE account = ?1 AND conversation_id = ?2",
            [account, conversation],
        )
        .map(|_| ())
        .map_err(text)
}


/// The engine session a chat last ran: its engine, session id and folder.
pub fn chat_session(store: &Store, account: &str, conversation: &str) -> Option<(String, String, String)> {
    store
        .connect()
        .ok()?
        .query_row(
            "SELECT engine, session_id, folder FROM engine_sessions
             WHERE account = ?1 AND conversation_id = ?2 ORDER BY updated_at DESC LIMIT 1",
            [account, conversation],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok()
}
