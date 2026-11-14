use super::*;
use crate::engines::history::{opencode_db_session_path, parse_session_file, scan_summary_file};

const SESSION: &str = "ses_e26ba161bffehdrt84wmSzpe2q";

/// A data root whose `opencode.db` holds OpenCode 2.3.0's tables and the session it wrote
/// (testdata/opencode_v2_session.sql), its folder moved to `<root>/work`.
fn fixture(tag: &str) -> (std::path::PathBuf, std::path::PathBuf) {
    let root = std::env::temp_dir().join(format!("misty-oc2-{tag}-{}", uuid::Uuid::new_v4()));
    let work = root.join("work");
    std::fs::create_dir_all(&work).unwrap();
    let sql = include_str!("../testdata/opencode_v2_session.sql")
        .replace("'/work'", &format!("'{}'", work.display()))
        .replace(
            "Read directory /work",
            &format!("Read directory {}", work.display()),
        );
    let conn = Connection::open(root.join("opencode.db")).unwrap();
    // The chat tables point at `project`, which the reader never reads.
    conn.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
    conn.execute_batch(&sql).unwrap();
    (root, work)
}

/// Another `session_v2` row like the fixture's, in `directory`.
fn add_session(conn: &Connection, id: &str, directory: &str, parent: Option<&str>, archived: bool) {
    conn.execute(
        "INSERT INTO session_v2(id, project_id, parent_id, slug, directory, version, time_created,
            time_updated, time_archived) VALUES(?1, 'p', ?2, 'slug', ?3, '2.3.0', 1, 1, ?4)",
        rusqlite::params![id, parent, directory, archived.then_some(2)],
    )
    .unwrap();
}

fn add_message(conn: &Connection, id: &str, session: &str, kind: &str, seq: i64, data: Value) {
    conn.execute(
        "INSERT INTO session_message VALUES(?1, ?2, ?3, ?4, 1, 1, ?5)",
        rusqlite::params![id, session, kind, seq, data.to_string()],
    )
    .unwrap();
}

#[test]
fn finds_the_chats_the_sidebar_shows() {
    let (root, work) = fixture("discover");
    {
        let conn = Connection::open(root.join("opencode.db")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        let folder = work.to_string_lossy();
        let prompt = json!({ "time": { "created": 1 }, "text": "hi", "files": [] });
        add_session(&conn, "ses_child", &folder, Some(SESSION), false);
        add_message(&conn, "msg_c", "ses_child", "user", 1, prompt.clone());
        add_session(&conn, "ses_archived", &folder, None, true);
        add_message(&conn, "msg_a", "ses_archived", "user", 1, prompt.clone());
        // A chat that only ran a shell command never got a prompt.
        add_session(&conn, "ses_empty", &folder, None, false);
        add_message(
            &conn,
            "msg_e",
            "ses_empty",
            "idle",
            1,
            json!({ "outcome": "succeeded" }),
        );
        add_session(&conn, "ses_elsewhere", "/elsewhere", None, false);
        add_message(&conn, "msg_x", "ses_elsewhere", "user", 1, prompt);
    }
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    discover(&root, &work, &mut seen, &mut found);
    let ids: Vec<&str> = found.iter().map(|f| f.session_id.as_str()).collect();
    assert_eq!(ids, [SESSION]);
    // The id handed to a resumed turn is OpenCode's own, and the address reads the same chat.
    let db = root.join("opencode.db");
    assert_eq!(found[0].file_path, opencode_db_session_path(&db, SESSION));
    // A 1.x row of the same id already found isn't listed twice.
    let mut again = Vec::new();
    discover(&root, &work, &mut seen, &mut again);
    assert!(again.is_empty());

    let ids: Vec<String> = ["ses_child", "ses_archived", "ses_empty", SESSION]
        .map(str::to_string)
        .into();
    assert_eq!(
        visible_sessions(&db, &ids),
        Some(HashSet::from([SESSION.to_string()]))
    );
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn a_database_with_both_generations_keeps_each_ones_chats() {
    let (root, _work) = fixture("mixed");
    let db = root.join("opencode.db");
    {
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE session(id TEXT PRIMARY KEY, directory TEXT NOT NULL,
                parent_id TEXT, time_archived INTEGER, time_updated INTEGER NOT NULL);
             CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
                time_created INTEGER NOT NULL, data TEXT NOT NULL);
             INSERT INTO session VALUES('ses_old', '/work', NULL, NULL, 1);
             INSERT INTO message VALUES('msg_old', 'ses_old', 1, '{\"role\":\"user\"}');",
        )
        .unwrap();
    }
    let ids = vec![
        "ses_old".to_string(),
        SESSION.to_string(),
        "ses_gone".to_string(),
    ];
    assert_eq!(
        visible_sessions(&db, &ids),
        Some(HashSet::from(["ses_old".to_string(), SESSION.to_string()]))
    );
    // Neither table: nothing is known, so nothing is pruned.
    let bare = root.join("bare.db");
    Connection::open(&bare)
        .unwrap()
        .execute_batch("CREATE TABLE kv(k TEXT)")
        .unwrap();
    assert_eq!(visible_sessions(&bare, &ids), None);
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn reads_the_chat_for_the_reader_search_and_sidebar() {
    let (root, work) = fixture("read");
    let address = opencode_db_session_path(&root.join("opencode.db"), SESSION);
    let parsed = parse_session_file("opencode", &address).unwrap();
    let roles: Vec<&str> = parsed.messages.iter().map(|m| m.role.as_str()).collect();
    assert_eq!(roles, ["user", "tool", "assistant", "user", "assistant"]);
    assert_eq!(
        parsed.messages[0].text,
        "Use a tool to list the files in the current folder, then reply with their names only."
    );
    let tool = &parsed.messages[1];
    assert_eq!(tool.text, "read");
    let listing = format!("Read directory {}, entries 1-1\nnotes.txt", work.display());
    assert_eq!(tool.result, Some(json!(listing)));
    let answer = &parsed.messages[4];
    assert_eq!(answer.text, "notes.txt");
    assert_eq!(answer.model.as_deref(), Some("big-pickle"));
    assert_eq!(answer.duration_ms, Some(1709));
    // The reply's tokens size the context as 1.x's do: its input leaves the cache out.
    let usage = answer.usage.as_ref().expect("usage");
    assert_eq!(usage["total_tokens"], 142 + 4 + 8192);
    assert_eq!(usage["cache_read_input_tokens"], 8192);

    let summary = scan_summary_file("opencode", &address).unwrap();
    // The first prompt, clipped as every engine's title is.
    assert!(
        summary.title.starts_with("Use a tool to list the files"),
        "{}",
        summary.title
    );
    assert_eq!(summary.preview, "notes.txt");
    assert_eq!(summary.first_ts, Some(1_794_646_600_288));
    assert_eq!(summary.last_ts, Some(1_794_646_725_671));
    assert_eq!(summary.message_count, 5);
    // A 1.x address in the same database, or a chat that isn't there, reads as no 2.x chat.
    let conn = open(&root.join("opencode.db")).unwrap();
    assert!(messages(&conn, "ses_missing", None).is_none());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn parts_rows_compactions_errors_and_images_come_through() {
    // An assistant message whose parts OpenCode wrote as `session_part` rows (its experimental
    // flag): they come before the message's own content.
    let reply = json!({ "time": { "created": 10, "completed": 30 }, "agent": "build",
        "model": { "id": "big-pickle", "providerID": "opencode" },
        "content": [{ "type": "text", "text": "after" }],
        "tokens": { "input": 5, "output": 1, "reasoning": 0, "cache": { "read": 0, "write": 0 } } });
    let own = vec![
        json!({ "type": "reasoning", "text": "think", "time": { "created": 11 } }),
        json!({ "type": "tool", "id": "c1", "name": "bash",
            "state": { "status": "error", "input": { "command": "false" },
                       "error": { "message": "exit 1" } },
            "time": { "created": 12 } }),
    ];
    let (message, parts) = as_v1("assistant", &reply, own, None).unwrap();
    assert_eq!(message["role"], "assistant");
    assert_eq!(message["model"]["modelID"], "big-pickle");
    let kinds: Vec<&str> = parts.iter().map(|p| p["type"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["reasoning", "tool", "text", "step-finish"]);
    assert_eq!(parts[0]["time"]["start"], 11);
    assert_eq!(parts[1]["tool"], "bash");
    assert_eq!(parts[1]["state"]["output"], "exit 1");
    // A scan drops a tool's output over the cap.
    let long = json!({ "type": "tool", "id": "c2", "name": "read", "state": { "status":
        "completed", "input": {}, "content": [{ "type": "text", "text": "x".repeat(64) }] },
        "time": { "created": 13 } });
    let reply = json!({ "time": { "created": 10 }, "content": [long] });
    let (_, parts) = as_v1("assistant", &reply, Vec::new(), Some(16)).unwrap();
    assert_eq!(parts[0]["state"]["output"], "");

    // A finished compaction reads as its summary, flagged so its tokens don't size the context.
    let compaction = json!({ "status": "completed", "reason": "manual", "summary": "## Goal",
        "time": { "created": 40 }, "model": { "id": "big-pickle", "providerID": "opencode" },
        "tokens": { "input": 580, "output": 165, "reasoning": 0,
                    "cache": { "read": 5504, "write": 0 } } });
    let (message, parts) = as_v1("compaction", &compaction, Vec::new(), None).unwrap();
    assert!(crate::engines::opencode_session::is_compaction_summary(
        &message
    ));
    assert_eq!(parts[0]["text"], "## Goal");
    let running = json!({ "status": "running", "reason": "auto", "summary": "" });
    assert!(as_v1("compaction", &running, Vec::new(), None).is_none());

    // A prompt's inline image becomes a data URL.
    let prompt = json!({ "time": { "created": 1 }, "text": "look",
        "files": [{ "data": "iVBORw0KGgo=", "mime": "image/png", "source": { "type": "inline" } }] });
    let (_, parts) = as_v1("user", &prompt, Vec::new(), None).unwrap();
    assert_eq!(parts[1]["url"], "data:image/png;base64,iVBORw0KGgo=");
    for kind in ["shell", "synthetic", "idle", "model-switched"] {
        assert!(
            as_v1(kind, &json!({}), Vec::new(), None).is_none(),
            "{kind}"
        );
    }
}

#[test]
fn past_folders_list_a_2_x_chats_folder() {
    let (root, work) = fixture("folders");
    let mut found = super::super::past_folders::Found::default();
    super::super::past_folders_stores::find_opencode_db(&root.join("opencode.db"), &mut found);
    assert_eq!(found.newest_first(), [work.to_string_lossy().to_string()]);
    std::fs::remove_dir_all(&root).ok();
}

/// Reads a real OpenCode 2.x database by hand (ignored):
/// `MISTY_TEST_OPENCODE_DB=/path/to/opencode.db cargo test --lib reads_a_real -- --ignored`.
#[test]
#[ignore = "reads the OpenCode database MISTY_TEST_OPENCODE_DB names"]
fn reads_a_real_2_x_database() {
    let db = std::path::PathBuf::from(std::env::var("MISTY_TEST_OPENCODE_DB").unwrap());
    let conn = open(&db).unwrap();
    let ids: Vec<String> = conn
        .prepare("SELECT id FROM session_v2")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .flatten()
        .collect();
    let visible = visible_sessions(&db, &ids).unwrap();
    for id in &ids {
        let summary = scan_summary_file("opencode", &opencode_db_session_path(&db, id)).unwrap();
        eprintln!(
            "{id} visible={} title={:?} messages={}",
            visible.contains(id),
            summary.title,
            summary.message_count
        );
    }
}

#[test]
fn opencode_db_signature_follows_its_write_ahead_log() {
    let dir = std::env::temp_dir().join(format!("misty-wal-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = dir.join("opencode.db");
    std::fs::write(&db, b"db").unwrap();
    let address = super::super::opencode_db_session_path(&db, "ses_1");
    let before = super::super::stat_signature(&address).unwrap();
    // A new turn lands in the log only; the signature must still change.
    std::fs::write(dir.join("opencode.db-wal"), b"new turn").unwrap();
    let after = super::super::stat_signature(&address).unwrap();
    assert_ne!(before, after);
    assert_eq!(after.0, before.0 + 8);
    std::fs::remove_dir_all(dir).unwrap();
}
