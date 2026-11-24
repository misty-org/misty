use std::path::Path;

use super::past_folders::{modified_ms, Found};

const MAX_ROWS: i64 = 500;
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

pub(super) fn find_stores(found: &mut Found) {
    find_agy(&crate::engines::agy::agy_home(), found);
}

fn open_read_only(db: &Path) -> Option<rusqlite::Connection> {
    if !file_access::fs::is_file(db) {
        return None;
    }
    file_access::fs::open_sqlite_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
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
