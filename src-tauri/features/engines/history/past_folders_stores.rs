//! The engines that keep their chats' folders in a database or an index rather than in each chat
//! file: OpenCode (`session.directory`, in `opencode.db` or its older JSON tree), Hermes
//! (`sessions.cwd` in `state.db`), Kimi (`session_index.jsonl`), Grok (one folder per working
//! folder, its path percent-encoded in the name) and Antigravity (`conversation_summaries.db` and
//! `last_conversations.json`). Every database opens read-only, and every
//! query and listing has a limit.

use std::path::{Path, PathBuf};

use super::past_folders::{modified_ms, newest_entries, Found};

/// Rows read from an engine's own database.
const MAX_ROWS: i64 = 500;
/// OpenCode's older JSON tree: projects, and sessions per project, looked at.
const MAX_TREE_PROJECTS: usize = 64;
const MAX_TREE_SESSIONS: usize = 16;
/// The biggest JSON or index file read whole.
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_META_BYTES: u64 = 64 * 1024;

pub(super) fn find_stores(found: &mut Found) {
    for root in opencode_roots() {
        find_opencode_db(&root.join("opencode.db"), found);
        find_opencode_tree(&root.join("storage").join("session"), found);
    }
    find_hermes(
        &crate::engine_config::support::hermes_home().join("state.db"),
        found,
    );
    for home in super::discovery::dir_session_anchor_roots("kimi") {
        find_kimi(&home.join("session_index.jsonl"), found);
    }
    for root in super::discovery::dir_session_anchor_roots("grok") {
        find_grok(&root, found);
    }
    find_agy(&crate::engines::agy::agy_home(), found);
}

/// OpenCode's data folders, as the scanner looks for them. One outside the engines' homes is
/// refused by the file gate and skipped.
fn opencode_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(home) = std::env::var_os("OPENCODE_HOME").filter(|home| !home.is_empty()) {
        roots.push(PathBuf::from(home));
    }
    roots.extend(dirs::data_local_dir().map(|dir| dir.join("opencode")));
    roots.extend(dirs::data_dir().map(|dir| dir.join("opencode")));
    roots.push(
        crate::engines::support::paths::home_dir()
            .join(".local")
            .join("share")
            .join("opencode"),
    );
    let mut unique = Vec::new();
    for root in roots {
        if !unique.contains(&root) {
            unique.push(root);
        }
    }
    unique
}

fn open_read_only(db: &Path) -> Option<rusqlite::Connection> {
    if !file_access::fs::is_file(db) {
        return None;
    }
    file_access::fs::open_sqlite_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
}

fn has_column(conn: &rusqlite::Connection, table: &str, column: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2",
        [table, column],
        |_| Ok(()),
    )
    .is_ok()
}

/// Runs a `(folder, last activity)` query and adds each row; the time is scaled to ms by `to_ms`.
fn add_rows(conn: &rusqlite::Connection, sql: &str, to_ms: impl Fn(f64) -> i64, found: &mut Found) {
    let Ok(mut statement) = conn.prepare(sql) else {
        return;
    };
    let Ok(rows) = statement.query_map([MAX_ROWS], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<f64>>(1)?))
    }) else {
        return;
    };
    for (folder, at) in rows.flatten() {
        found.add(&folder, at.map(&to_ms).unwrap_or(0));
    }
}

/// OpenCode 1.18 and later: one `session` row per chat, with its `directory`; 2.x keeps its
/// chats in `session_v2`, same columns, in the same database. Subagents' and archived chats are
/// left out where the schema has those columns.
pub(super) fn find_opencode_db(db: &Path, found: &mut Found) {
    let Some(conn) = open_read_only(db) else {
        return;
    };
    for table in ["session", "session_v2"] {
        if !has_column(&conn, table, "directory") {
            continue;
        }
        let mut filter = String::new();
        if has_column(&conn, table, "parent_id") {
            filter.push_str(" AND parent_id IS NULL");
        }
        if has_column(&conn, table, "time_archived") {
            filter.push_str(" AND time_archived IS NULL");
        }
        let sql = format!(
            "SELECT directory, MAX(time_updated) FROM {table}
             WHERE directory IS NOT NULL AND directory <> ''{filter}
             GROUP BY directory ORDER BY 2 DESC LIMIT ?1"
        );
        add_rows(&conn, &sql, |at| at as i64, found);
    }
}

/// OpenCode 1.1 and earlier: `storage/session/<project>/<session>.json`, each with its
/// `directory` and `time.updated`.
pub(super) fn find_opencode_tree(sessions: &Path, found: &mut Found) {
    for (project, _) in newest_entries(sessions, true)
        .into_iter()
        .take(MAX_TREE_PROJECTS)
    {
        for (file, changed) in newest_entries(&project, false)
            .into_iter()
            .filter(|(file, _)| file.extension().and_then(|e| e.to_str()) == Some("json"))
            .take(MAX_TREE_SESSIONS)
        {
            let Some(meta) = small_json(&file) else {
                continue;
            };
            let Some(directory) = meta.get("directory").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let updated = meta
                .get("time")
                .and_then(|time| time.get("updated"))
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(changed);
            found.add(directory, updated);
        }
    }
}

fn small_json(path: &Path) -> Option<serde_json::Value> {
    use std::io::Read;
    let file = file_access::fs::File::open(path).ok()?;
    let mut text = String::new();
    file.take(MAX_META_BYTES).read_to_string(&mut text).ok()?;
    serde_json::from_str(&text).ok()
}

/// Hermes: `sessions.cwd`, leaving out hidden chats and subagents' or branches' (those carry a
/// `parent_session_id`). Its times are in seconds.
pub(super) fn find_hermes(db: &Path, found: &mut Found) {
    let Some(conn) = open_read_only(db) else {
        return;
    };
    add_rows(
        &conn,
        "SELECT cwd, MAX(COALESCE(last_activity_at, started_at)) FROM sessions
         WHERE cwd IS NOT NULL AND cwd <> '' AND parent_session_id IS NULL
           AND COALESCE(hidden, 0) = 0
         GROUP BY cwd ORDER BY 2 DESC LIMIT ?1",
        |at| {
            if at < 1e11 {
                (at * 1000.0) as i64
            } else {
                at as i64
            }
        },
        found,
    );
}

/// Kimi: one line per chat in `session_index.jsonl`, with its `workDir`.
pub(super) fn find_kimi(index: &Path, found: &mut Found) {
    let Ok(metadata) = file_access::fs::metadata(index) else {
        return;
    };
    if metadata.len() > MAX_FILE_BYTES {
        return;
    }
    let Ok(text) = file_access::fs::read_to_string(index) else {
        return;
    };
    let changed = modified_ms(&metadata);
    for line in text.lines().take(MAX_ROWS as usize * 10) {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if let Some(folder) = value
            .get("workDir")
            .or_else(|| value.get("work_dir"))
            .and_then(serde_json::Value::as_str)
        {
            found.add(folder, changed);
        }
    }
}

/// Grok: `<sessions>/<percent-encoded folder>/<session>/`, so the listing alone names them.
pub(super) fn find_grok(sessions: &Path, found: &mut Found) {
    for (dir, changed) in newest_entries(sessions, true)
        .into_iter()
        .take(MAX_ROWS as usize)
    {
        let Some(name) = dir
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
        else {
            continue;
        };
        let folder = percent_encoding::percent_decode_str(&name).decode_utf8_lossy();
        found.add(&folder, changed);
    }
}

/// Antigravity: each conversation's `workspace_uris` (`file://` URIs) in
/// `conversation_summaries.db`, and the folder each last conversation ran in, the keys of
/// `cache/last_conversations.json`. Neither records when, so the files' own times stand in.
pub(super) fn find_agy(home: &Path, found: &mut Found) {
    let summaries = home.join("conversation_summaries.db");
    if let Some(conn) = open_read_only(&summaries) {
        let changed = file_access::fs::metadata(&summaries)
            .map(|metadata| modified_ms(&metadata))
            .unwrap_or(0);
        if let Ok(mut statement) =
            conn.prepare("SELECT workspace_uris FROM conversation_summaries LIMIT ?1")
        {
            if let Ok(rows) = statement.query_map([MAX_ROWS], |row| row.get::<_, String>(0)) {
                for uris in rows.flatten() {
                    for uri in serde_json::from_str::<Vec<String>>(&uris).unwrap_or_default() {
                        if let Some(path) = uri.strip_prefix("file://") {
                            let folder =
                                percent_encoding::percent_decode_str(path).decode_utf8_lossy();
                            found.add(&folder, changed);
                        }
                    }
                }
            }
        }
    }
    let last = home.join("cache").join("last_conversations.json");
    let Ok(metadata) = file_access::fs::metadata(&last) else {
        return;
    };
    if metadata.len() > MAX_FILE_BYTES {
        return;
    }
    let Some(map) = file_access::fs::read_to_string(&last)
        .ok()
        .and_then(|text| {
            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&text).ok()
        })
    else {
        return;
    };
    for folder in map.keys().take(MAX_ROWS as usize) {
        found.add(folder, modified_ms(&metadata));
    }
}
