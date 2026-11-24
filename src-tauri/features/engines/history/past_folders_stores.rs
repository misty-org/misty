use std::path::Path;

use super::past_folders::{modified_ms, newest_entries, Found};

const MAX_ROWS: i64 = 500;
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

pub(super) fn find_stores(found: &mut Found) {
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

fn open_read_only(db: &Path) -> Option<rusqlite::Connection> {
    if !file_access::fs::is_file(db) {
        return None;
    }
    file_access::fs::open_sqlite_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
}

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
