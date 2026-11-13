//! Hermes Agent keeps every session in one SQLite file, `<hermes home>/state.db`: `sessions`
//! (with the `cwd` it ran in) and `messages` (`role`, `content`, `timestamp` in seconds, `active`).
//! Each session gets the same virtual `<db>\u{1f}<id>` address as OpenCode's database rows, so the
//! path-keyed history pipeline reads it. Read-only: a running Hermes holds the database.

use std::path::{Path, PathBuf};

use super::{Message, ParsedSession, ScanSummary, SessionFile};

const MAX_SESSIONS: i64 = 500;
const MAX_MESSAGES: i64 = 5000;

fn database() -> PathBuf {
    crate::engine_config::support::hermes_home().join("state.db")
}

fn open(db: &Path) -> Option<rusqlite::Connection> {
    file_access::fs::open_sqlite_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
}

pub(super) fn discover_hermes(workspace: &Path) -> Vec<SessionFile> {
    discover_hermes_in(&database(), workspace)
}

/// The workspace's own sessions: started in it or a folder inside it, not hidden, and not a
/// subagent's or a branch's (those carry a `parent_session_id`).
pub(super) fn discover_hermes_in(db: &Path, workspace: &Path) -> Vec<SessionFile> {
    if !file_access::fs::exists(db) {
        return Vec::new();
    }
    let Some(conn) = open(db) else {
        return Vec::new();
    };
    let Ok(mut statement) = conn.prepare(
        "SELECT id, cwd FROM sessions
         WHERE cwd IS NOT NULL AND parent_session_id IS NULL AND COALESCE(hidden, 0) = 0
         ORDER BY COALESCE(last_activity_at, started_at) DESC LIMIT ?1",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = statement.query_map([MAX_SESSIONS], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) else {
        return Vec::new();
    };
    rows.flatten()
        .filter(|(_, cwd)| super::same_or_child(Path::new(cwd), workspace))
        .map(|(id, _)| SessionFile {
            engine: "hermes",
            file_path: super::opencode_db_session_path(db, &id),
            session_id: id,
            workspace_path: workspace.to_string_lossy().to_string(),
        })
        .collect()
}

/// The session's visible turns: the person's and Hermes's own text, in order. Tool rows and
/// messages Hermes rewound (`active = 0`) are left out.
pub(super) fn parse_hermes_session(path: &Path) -> ParsedSession {
    let Some((db, id)) = super::split_opencode_db_path(path) else {
        return ParsedSession {
            messages: Vec::new(),
        };
    };
    ParsedSession {
        messages: messages(&db, &id),
    }
}

fn messages(db: &Path, id: &str) -> Vec<Message> {
    let Some(conn) = open(db) else {
        return Vec::new();
    };
    let Ok(mut statement) = conn.prepare(
        "SELECT role, content, timestamp FROM messages
         WHERE session_id = ?1 AND COALESCE(active, 1) = 1 AND role IN ('user', 'assistant')
         ORDER BY timestamp, id LIMIT ?2",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = statement.query_map(rusqlite::params![id, MAX_MESSAGES], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<f64>>(2)?,
        ))
    }) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (role, content, seconds) in rows.flatten() {
        let mut text = content.unwrap_or_default();
        if role == "user" {
            text = super::extract::strip_internal_prompt_tail(&text).to_string();
        }
        if text.trim().is_empty() {
            continue;
        }
        out.push(Message {
            seq: out.len() as i64 + 1,
            role,
            text,
            ts: seconds.map(|s| ((s * 1000.0) as i64).to_string()),
            path: None,
            args: None,
            result: None,
            todos: None,
            usage: None,
            model: None,
            effort: None,
            duration_ms: None,
            images: Vec::new(),
        });
    }
    out
}

pub(super) fn scan_hermes_summary(path: &Path) -> ScanSummary {
    let messages = parse_hermes_session(path).messages;
    let first_user = messages.iter().find(|m| m.role == "user");
    let title: String = first_user
        .map(|m| {
            m.text
                .lines()
                .next()
                .unwrap_or("")
                .chars()
                .take(80)
                .collect()
        })
        .unwrap_or_default();
    let preview: String = messages
        .last()
        .map(|m| m.text.chars().take(200).collect())
        .unwrap_or_default();
    let ts = |m: &Message| m.ts.as_deref().and_then(|t| t.parse::<i64>().ok());
    ScanSummary {
        title,
        preview,
        first_ts: messages.first().and_then(ts),
        last_ts: messages.last().and_then(ts),
        message_count: messages.len() as i64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_workspaces_own_sessions_and_their_turns() {
        let dir = std::env::temp_dir().join(format!("misty-hermes-{}", uuid::Uuid::new_v4()));
        file_access::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("state.db");
        let workspace = dir.join("project");
        {
            let conn = file_access::fs::open_sqlite(&db).unwrap();
            conn.execute_batch(
                "CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, parent_session_id TEXT,
                     hidden INTEGER DEFAULT 0, started_at REAL NOT NULL, last_activity_at REAL);
                 CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT,
                     role TEXT, content TEXT, timestamp REAL, active INTEGER DEFAULT 1);",
            )
            .unwrap();
            let here = workspace.to_string_lossy().to_string();
            let inside = workspace.join("src").to_string_lossy().to_string();
            for (id, cwd, parent, hidden) in [
                ("s1", here.as_str(), None, 0),
                ("s2", inside.as_str(), None, 0),
                ("child", here.as_str(), Some("s1"), 0),
                ("gone", here.as_str(), None, 1),
                ("other", "/elsewhere", None, 0),
            ] {
                conn.execute(
                    "INSERT INTO sessions (id, cwd, parent_session_id, hidden, started_at)
                     VALUES (?1, ?2, ?3, ?4, 1)",
                    rusqlite::params![id, cwd, parent, hidden],
                )
                .unwrap();
            }
            for (role, content, ts, active) in [
                ("user", "hello", 1.0, 1),
                ("assistant", "hi there", 2.0, 1),
                ("tool", "{}", 3.0, 1),
                ("assistant", "rewound", 4.0, 0),
            ] {
                conn.execute(
                    "INSERT INTO messages (session_id, role, content, timestamp, active)
                     VALUES ('s1', ?1, ?2, ?3, ?4)",
                    rusqlite::params![role, content, ts, active],
                )
                .unwrap();
            }
        }
        let mut found: Vec<String> = discover_hermes_in(&db, &workspace)
            .into_iter()
            .map(|file| file.session_id)
            .collect();
        found.sort();
        assert_eq!(found, ["s1", "s2"]);

        let parsed = parse_hermes_session(&super::super::opencode_db_session_path(&db, "s1"));
        let turns: Vec<(&str, &str)> = parsed
            .messages
            .iter()
            .map(|m| (m.role.as_str(), m.text.as_str()))
            .collect();
        assert_eq!(turns, [("user", "hello"), ("assistant", "hi there")]);
        assert_eq!(parsed.messages[0].ts.as_deref(), Some("1000"));
        let _ = file_access::fs::remove_dir_all(&dir);
    }
}
