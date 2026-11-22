// What the engines keep in `misty.db`, on this computer only: the project folders the person
// picked, the folder each chat works in, and each chat's session in its engine. None ever syncs.

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

/// Every project folder on this computer, to let the file gate reach them as the app starts.
pub fn all_folders(store: &Store) -> Result<Vec<PathBuf>, String> {
    let connection = store.connect().map_err(text)?;
    let mut statement = connection
        .prepare("SELECT DISTINCT path FROM project_folders")
        .map_err(text)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(text)?;
    rows.map(|row| row.map(PathBuf::from))
        .collect::<Result<_, _>>()
        .map_err(text)
}

/// Whether the account may work in this folder: one of its project folders or inside one, or a
/// chat's scratch folder Misty keeps (`chat_folder.rs`).
pub fn is_linked(store: &Store, account: &str, folder: &Path) -> Result<bool, String> {
    if super::chat_folder::is_scratch(store, folder) {
        return Ok(true);
    }
    let connection = store.connect().map_err(text)?;
    let mut statement = connection
        .prepare("SELECT path FROM project_folders WHERE account = ?1")
        .map_err(text)?;
    let rows = statement
        .query_map([account], |row| row.get::<_, String>(0))
        .map_err(text)?;
    for row in rows {
        if within(folder, Path::new(&row.map_err(text)?)) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Whether `path` is `root` or lies inside it. On Windows one folder has several spellings: a
/// canonical path starts `\\?\C:\` where the folder picker and Misty's data folder give `C:\`,
/// either may use `/`, and letter case doesn't matter. Both are compared in one form there, or a
/// linked folder never matches itself. Elsewhere paths compare as they are.
pub(crate) fn within(path: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let form = |path: &Path| {
            let mut text = dunce::simplified(path).to_string_lossy().replace('/', "\\").to_lowercase();
            while text.ends_with('\\') {
                text.pop();
            }
            text
        };
        let (path, root) = (form(path), form(root));
        !root.is_empty() && (path == root || path.starts_with(&format!("{root}\\")))
    }
    #[cfg(not(windows))]
    {
        path.starts_with(root)
    }
}

/// Adds a project folder, or marks one already there as just used.
pub fn add_project(store: &Store, account: &str, path: &str) -> Result<(), String> {
    let at = now();
    store
        .connect()
        .map_err(text)?
        .execute(
            "INSERT INTO project_folders (account, path, added_at, last_used_at) VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT (account, path) DO UPDATE SET last_used_at = ?3",
            rusqlite::params![account, path, at],
        )
        .map(|_| ())
        .map_err(text)
}

/// Forgets a project folder. Returns whether any account on this computer still has it.
pub fn remove_project(store: &Store, account: &str, path: &str) -> Result<bool, String> {
    let connection = store.connect().map_err(text)?;
    connection
        .execute(
            "DELETE FROM project_folders WHERE account = ?1 AND path = ?2",
            [account, path],
        )
        .map_err(text)?;
    connection
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM project_folders WHERE path = ?1)",
            [path],
            |row| row.get::<_, bool>(0),
        )
        .map_err(text)
}

/// The account's project folders, most recently used first, as (path, last used).
pub fn projects(store: &Store, account: &str) -> Result<Vec<(String, i64)>, String> {
    let connection = store.connect().map_err(text)?;
    let mut statement = connection
        .prepare(
            "SELECT path, last_used_at FROM project_folders WHERE account = ?1
             ORDER BY last_used_at DESC",
        )
        .map_err(text)?;
    let rows = statement
        .query_map([account], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
        .map_err(text)?;
    rows.collect::<Result<_, _>>().map_err(text)
}

/// The folder a chat works in, as (path, kind), kind being `project` or `scratch`.
pub fn chat_folder(store: &Store, account: &str, conversation: &str) -> Option<(String, String)> {
    store
        .connect()
        .ok()?
        .query_row(
            "SELECT path, kind FROM chat_folders WHERE account = ?1 AND conversation_id = ?2",
            [account, conversation],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .ok()
}

/// The chats that work in a project, with its path: the Code page lists them, the sidebar doesn't.
pub fn project_chats(store: &Store, account: &str) -> Result<Vec<(String, String)>, String> {
    let connection = store.connect().map_err(text)?;
    let mut statement = connection
        .prepare(
            "SELECT conversation_id, path FROM chat_folders WHERE account = ?1 AND kind = 'project'",
        )
        .map_err(text)?;
    let rows = statement
        .query_map([account], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(text)?;
    rows.collect::<Result<_, _>>().map_err(text)
}

/// The folder new projects go in, chosen in the system's dialog during setup; `None` before then.
pub fn projects_home(store: &Store, account: &str) -> Option<String> {
    store
        .connect()
        .ok()?
        .query_row(
            "SELECT path FROM projects_home WHERE account = ?1",
            [account],
            |row| row.get::<_, String>(0),
        )
        .ok()
}

/// Sets the folder new projects go in.
pub fn set_projects_home(store: &Store, account: &str, path: &str) -> Result<(), String> {
    store
        .connect()
        .map_err(text)?
        .execute(
            "INSERT INTO projects_home (account, path, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (account) DO UPDATE SET path = ?2, updated_at = ?3",
            rusqlite::params![account, path, now()],
        )
        .map(|_| ())
        .map_err(text)
}

/// Sets the folder a chat works in, replacing the one it had.
pub fn set_chat_folder(
    store: &Store,
    account: &str,
    conversation: &str,
    path: &str,
    kind: &str,
) -> Result<(), String> {
    store
        .connect()
        .map_err(text)?
        .execute(
            "INSERT INTO chat_folders (account, conversation_id, path, kind, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (account, conversation_id) DO UPDATE SET path = ?3, kind = ?4, updated_at = ?5",
            rusqlite::params![account, conversation, path, kind, now()],
        )
        .map(|_| ())
        .map_err(text)
}

/// Forgets what a deleted chat kept: its folder and its engine sessions.
pub fn forget_chat(store: &Store, account: &str, conversation: &str) -> Result<(), String> {
    let connection = store.connect().map_err(text)?;
    for statement in [
        "DELETE FROM chat_folders WHERE account = ?1 AND conversation_id = ?2",
        "DELETE FROM engine_sessions WHERE account = ?1 AND conversation_id = ?2",
    ] {
        connection
            .execute(statement, [account, conversation])
            .map_err(text)?;
    }
    Ok(())
}

/// Every chat id this computer keeps, whatever the account, to find scratch folders left behind.
pub fn all_chat_ids(store: &Store) -> Result<std::collections::HashSet<String>, String> {
    let connection = store.connect().map_err(text)?;
    let mut statement = connection
        .prepare("SELECT id FROM agent_chats WHERE kind = 'conversation'")
        .map_err(text)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(text)?;
    rows.collect::<Result<_, _>>().map_err(text)
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

/// The engine session a chat last kept, with its engine, wherever it ran: `(engine, session)`.
pub fn chat_session(store: &Store, account: &str, conversation: &str) -> Option<(String, String)> {
    store
        .connect()
        .ok()?
        .query_row(
            "SELECT engine, session_id FROM engine_sessions
             WHERE account = ?1 AND conversation_id = ?2
             ORDER BY updated_at DESC LIMIT 1",
            [account, conversation],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
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

/// The folders Misty made for agents before chats owned their folders, as (account, path), for
/// the one-time move to projects or the Trash (`chat_folder::retire_agent_folders`).
pub fn old_agent_folders(store: &Store) -> Result<Vec<(String, String)>, String> {
    let connection = store.connect().map_err(text)?;
    let mut statement = connection
        .prepare("SELECT account, path FROM agent_folders")
        .map_err(text)?;
    let rows = statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(text)?;
    rows.collect::<Result<_, _>>().map_err(text)
}

/// Forgets every agent folder row once they were moved or thrown away.
pub fn clear_old_agent_folders(store: &Store) -> Result<(), String> {
    store
        .connect()
        .map_err(text)?
        .execute("DELETE FROM agent_folders", [])
        .map(|_| ())
        .map_err(text)
}
