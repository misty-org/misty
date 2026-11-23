use std::collections::HashSet;
use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};

use super::{same_or_child, SessionFile};

const VISIBLE: &str = "parent_id IS NULL AND time_archived IS NULL AND EXISTS \
    (SELECT 1 FROM session_message m WHERE m.session_id = session_v2.id \
     AND m.type IN ('user', 'assistant'))";

const MAX_SESSIONS: i64 = 512;
const MAX_MESSAGES: i64 = 4096;
const MAX_PARTS: i64 = 512;

#[allow(
    clippy::disallowed_methods,
    reason = "reads OpenCode's own database in place, wherever OpenCode keeps it"
)]
fn open(db: &Path) -> Option<Connection> {
    if !db.is_file() {
        return None;
    }
    Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
}

fn has_table(conn: &Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
        |_| Ok(()),
    )
    .is_ok()
}

pub(super) fn discover(
    root: &Path,
    workspace: &Path,
    seen: &mut HashSet<String>,
    out: &mut Vec<SessionFile>,
) {
    let db = root.join("opencode.db");
    let Some(conn) = open(&db) else {
        return;
    };
    if !has_table(&conn, "session_v2") {
        return;
    }
    let sql = format!(
        "SELECT id, directory FROM session_v2 WHERE {VISIBLE} ORDER BY time_updated DESC LIMIT ?1"
    );
    let Ok(mut stmt) = conn.prepare(&sql) else {
        return;
    };
    let Ok(rows) = stmt.query_map([MAX_SESSIONS], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    }) else {
        return;
    };
    for (session_id, directory) in rows.flatten() {
        if session_id.is_empty()
            || directory.is_empty()
            || !same_or_child(Path::new(&directory), workspace)
            || !seen.insert(session_id.clone())
        {
            continue;
        }
        out.push(SessionFile {
            engine: "opencode",
            session_id: session_id.clone(),
            workspace_path: workspace.to_string_lossy().to_string(),
            file_path: super::opencode_db_session_path(&db, &session_id),
        });
    }
}

pub(super) fn visible_sessions(db: &Path, session_ids: &[String]) -> Option<HashSet<String>> {
    let conn = open(db)?;
    let (v1, v2) = (has_table(&conn, "session"), has_table(&conn, "session_v2"));
    if !v1 && !v2 {
        return None;
    }
    let mut visible = if v1 {
        super::discovery::opencode_db_visible_sessions(db, session_ids)?
    } else {
        HashSet::new()
    };
    if v2 {
        for chunk in session_ids.chunks(200) {
            let marks = vec!["?"; chunk.len()].join(",");
            let sql = format!("SELECT id FROM session_v2 WHERE id IN ({marks}) AND {VISIBLE}");
            let mut stmt = conn.prepare(&sql).ok()?;
            let rows = stmt
                .query_map(rusqlite::params_from_iter(chunk), |r| r.get::<_, String>(0))
                .ok()?;
            visible.extend(rows.flatten());
        }
    }
    Some(visible)
}

pub(super) fn messages(
    conn: &Connection,
    session_id: &str,
    part_byte_cap: Option<u64>,
) -> Option<Vec<(Value, Vec<Value>)>> {
    if !has_table(conn, "session_v2") {
        return None;
    }
    conn.query_row("SELECT 1 FROM session_v2 WHERE id=?1", [session_id], |_| {
        Ok(())
    })
    .ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, type, data FROM session_message WHERE session_id=?1 \
             ORDER BY seq LIMIT ?2",
        )
        .ok()?;
    let rows: Vec<(String, String, String)> = stmt
        .query_map(rusqlite::params![session_id, MAX_MESSAGES], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .ok()?
        .flatten()
        .collect();
    let mut part_stmt = has_table(conn, "session_part")
        .then(|| {
            conn.prepare(
                "SELECT data FROM session_part WHERE message_id=?1 ORDER BY ordinal LIMIT ?2",
            )
            .ok()
        })
        .flatten();
    let mut out = Vec::with_capacity(rows.len());
    for (message_id, kind, data) in rows {
        let Ok(data) = serde_json::from_str::<Value>(&data) else {
            continue;
        };
        let own_parts: Vec<Value> = match part_stmt.as_mut() {
            Some(stmt) if kind == "assistant" => stmt
                .query_map(rusqlite::params![message_id, MAX_PARTS], |r| {
                    r.get::<_, String>(0)
                })
                .map(|rows| {
                    rows.flatten()
                        .filter(|data| part_byte_cap.is_none_or(|cap| data.len() as u64 <= cap))
                        .filter_map(|data| serde_json::from_str(&data).ok())
                        .collect()
                })
                .unwrap_or_default(),
            _ => Vec::new(),
        };
        if let Some(message) = as_v1(&kind, &data, own_parts, part_byte_cap) {
            out.push(message);
        }
    }
    Some(out)
}

pub(super) fn as_v1(
    kind: &str,
    data: &Value,
    own_parts: Vec<Value>,
    part_byte_cap: Option<u64>,
) -> Option<(Value, Vec<Value>)> {
    let time = data.get("time").cloned().unwrap_or(Value::Null);
    let model = json!({ "modelID": data["model"]["id"] });
    let step_finish = |parts: &mut Vec<Value>| {
        if let Some(tokens) = data.get("tokens").filter(|tokens| tokens.is_object()) {
            parts.push(json!({ "type": "step-finish", "tokens": tokens }));
        }
    };
    match kind {
        "user" => {
            let mut parts = vec![json!({ "type": "text", "text": data["text"] })];
            parts.extend(
                data["files"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(file),
            );
            Some((json!({ "role": "user", "time": time }), parts))
        }
        "assistant" => {
            let content = data["content"].as_array().cloned().unwrap_or_default();
            let mut parts: Vec<Value> = own_parts
                .iter()
                .chain(&content)
                .filter_map(|part| assistant_part(part, part_byte_cap))
                .collect();
            step_finish(&mut parts);
            let message = json!({ "role": "assistant", "time": time, "model": model,
                                  "agent": data["agent"] });
            Some((message, parts))
        }
        "compaction" if data["status"] == "completed" => {
            let mut parts = vec![json!({ "type": "text", "text": data["summary"] })];
            step_finish(&mut parts);
            let message = json!({ "role": "assistant", "time": time, "model": model,
                                  "summary": true, "mode": "compaction" });
            Some((message, parts))
        }
        _ => None,
    }
}

fn file(attachment: &Value) -> Option<Value> {
    let mime = attachment["mime"].as_str()?;
    let url = match attachment["data"].as_str().filter(|data| !data.is_empty()) {
        Some(data) => format!("data:{mime};base64,{data}"),
        None => attachment["source"]["uri"].as_str()?.to_string(),
    };
    Some(json!({ "type": "file", "mime": mime, "url": url }))
}

fn assistant_part(part: &Value, part_byte_cap: Option<u64>) -> Option<Value> {
    let start = json!({ "start": part["time"]["created"] });
    match part["type"].as_str()? {
        "text" => Some(json!({ "type": "text", "text": part["text"] })),
        "reasoning" => Some(json!({ "type": "reasoning", "text": part["text"], "time": start })),
        "tool" => {
            let state = &part["state"];
            let mut output: String = state["content"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|item| item["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n");
            if output.is_empty() && state["status"] == "error" {
                output = state["error"]["message"]
                    .as_str()
                    .or_else(|| state["error"].as_str())
                    .unwrap_or("")
                    .to_string();
            }
            if part_byte_cap.is_some_and(|cap| output.len() as u64 > cap) {
                output.clear();
            }
            Some(
                json!({ "type": "tool", "tool": part["name"], "callID": part["id"],
                         "state": { "status": state["status"], "input": state["input"],
                                    "output": output },
                         "time": start }),
            )
        }
        _ => None,
    }
}

#[cfg(test)]
#[path = "opencode_v2_tests.rs"]
mod tests;
