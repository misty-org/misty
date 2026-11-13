#![allow(clippy::disallowed_methods, clippy::disallowed_types)] // Fixtures are built with the standard library.

use super::*;
use crate::engines::history::past_folders_stores::{
    find_agy, find_grok, find_hermes, find_kimi, find_opencode_db, find_opencode_tree,
};

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("misty-past-{tag}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn folders(found: Found) -> Vec<String> {
    let mut out = found.newest_first();
    out.sort();
    out
}

#[test]
fn json_paths_take_real_keys_only() {
    let text = r#"{"note":"say \"cwd\":\"/fake\"","cwd": "/Users/me/app","x":{"cwd":"rel"}}"#;
    assert_eq!(json_paths(text, "cwd"), vec!["/Users/me/app".to_string()]);
    // A value the read cut off is no value.
    assert_eq!(json_path(r#"{"cwd":"/Users/me/ap"#, "cwd"), None);
    assert_eq!(
        json_path(r#"{"cwd":"/Users/me/café"}"#, "cwd").as_deref(),
        Some("/Users/me/café")
    );
}

#[test]
fn found_folders_are_plain_absolute_paths_newest_first() {
    let mut found = Found::default();
    found.add("/Users/me/old/", 1);
    found.add("/Users/me/new", 5);
    found.add("/Users/me/old", 3);
    found.add("relative/path", 9);
    found.add("/Users/me/../escape", 9);
    assert_eq!(found.newest_first(), vec!["/Users/me/new", "/Users/me/old"]);
}

#[test]
fn claude_folders_come_from_cwd_matching_the_project_name() {
    let projects = scratch("claude");
    let cwd = "/Users/me/code/my.app";
    let dir = projects.join(crate::engines::history::claude_encode_project_path(cwd));
    // The `cwd` comes after a long message, and an unrelated `cwd` inside a tool input comes first.
    let big = "x".repeat(20_000);
    write(
        &dir.join("s1.jsonl"),
        &format!(
            "{{\"type\":\"session-owner\",\"sessionId\":\"s1\"}}\n\
             {{\"type\":\"user\",\"message\":{{\"content\":\"{big}\",\"input\":{{\"cwd\":\"/elsewhere\"}}}},\"cwd\":\"{cwd}\"}}\n"
        ),
    );
    // A project folder whose chats name some other folder isn't trusted.
    write(
        &projects.join("-Users-me-other").join("s2.jsonl"),
        "{\"cwd\":\"/Users/me/not-other\"}\n",
    );
    // Neither is a folder holding only the prompt history.
    write(
        &projects.join("-Users-me-history").join("history.jsonl"),
        "{\"cwd\":\"/Users/me/history\"}\n",
    );
    let mut found = Found::default();
    find_claude(&projects, &mut found);
    assert_eq!(folders(found), vec![cwd.to_string()]);
    let _ = std::fs::remove_dir_all(&projects);
}

#[test]
fn codex_folders_come_from_session_meta() {
    let home = scratch("codex");
    write(
        &home.join("sessions/2026/11/12/rollout-2026-11-12-a.jsonl"),
        "{\"type\":\"session_meta\",\"payload\":{\"id\":\"a\",\"cwd\":\"/Users/me/one\",\"base_instructions\":{\"text\":\"long\"}}}\n",
    );
    write(
        &home.join("archived_sessions/rollout-2026-01-01-b.jsonl"),
        "{\"type\":\"session_meta\",\"payload\":{\"id\":\"b\",\"cwd\":\"/Users/me/two\"}}\n",
    );
    write(
        &home.join("sessions/2026/11/12/rollout-2026-11-12-c.jsonl"),
        "{\"type\":\"response_item\",\"cwd\":\"/Users/me/not-meta\"}\n",
    );
    write(
        &home.join("sessions/2026/11/12/notes.jsonl"),
        "{\"type\":\"session_meta\",\"payload\":{\"cwd\":\"/Users/me/not-rollout\"}}\n",
    );
    let mut found = Found::default();
    find_codex(&home, &mut found);
    assert_eq!(folders(found), vec!["/Users/me/one", "/Users/me/two"]);
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn pi_and_dsh_folders_come_from_session_headers() {
    let pi = scratch("pi");
    write(
        &pi.join("--Users-me-pi--").join("1.jsonl"),
        "{\"type\":\"title\",\"title\":\"t\"}\n{\"type\":\"session\",\"id\":\"1\",\"cwd\":\"/Users/me/pi\"}\n",
    );
    let mut found = Found::default();
    find_pi_family(&pi, &mut found);
    assert_eq!(folders(found), vec!["/Users/me/pi"]);

    let dsh = scratch("dsh");
    crate::engines::history::scanner::tests::write_zstd_jsonl(
        &dsh.join("cwd-a")
            .join("session-1")
            .join("session.v2.jsonl.zstd"),
        &["{\"type\":\"session\",\"id\":\"1\",\"cwd\":\"/Users/me/dsh\"}"],
    );
    let mut found = Found::default();
    find_dsh(&dsh, &mut found);
    assert_eq!(folders(found), vec!["/Users/me/dsh"]);
    let _ = std::fs::remove_dir_all(&pi);
    let _ = std::fs::remove_dir_all(&dsh);
}

#[test]
fn gemini_and_qwen_folders_come_from_directories_or_cwd() {
    let tmp = scratch("gemini");
    write(
        &tmp.join("hash-a/chats/session-1.jsonl"),
        "{\"sessionId\":\"1\",\"projectHash\":\"hash-a\",\"directories\":[\"/Users/me/gem\",\"/Users/me/extra\"]}\n",
    );
    write(
        &tmp.join("hash-b/chats/session-2.jsonl"),
        "{\"sessionId\":\"2\",\"cwd\":\"/Users/me/qwen\",\"type\":\"user\"}\n",
    );
    let mut found = Found::default();
    find_gemini_family(&tmp, &mut found);
    assert_eq!(folders(found), vec!["/Users/me/gem", "/Users/me/qwen"]);
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn opencode_folders_come_from_its_database_and_tree() {
    let root = scratch("opencode");
    let db = root.join("opencode.db");
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch(
        "CREATE TABLE session(id TEXT, directory TEXT, parent_id TEXT, time_archived INTEGER,
                              time_updated INTEGER);
         INSERT INTO session VALUES('a', '/Users/me/oc', NULL, NULL, 10);
         INSERT INTO session VALUES('b', '/Users/me/sub', 'a', NULL, 20);
         INSERT INTO session VALUES('c', '/Users/me/gone', NULL, 5, 30);",
    )
    .unwrap();
    drop(conn);
    write(
        &root.join("storage/session/project-1/ses_1.json"),
        "{\"id\":\"ses_1\",\"directory\":\"/Users/me/tree\",\"time\":{\"updated\":4}}",
    );
    let mut found = Found::default();
    find_opencode_db(&db, &mut found);
    find_opencode_tree(&root.join("storage").join("session"), &mut found);
    assert_eq!(found.newest_first(), vec!["/Users/me/oc", "/Users/me/tree"]);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn hermes_kimi_and_grok_folders_come_from_their_records() {
    let root = scratch("stores");
    let db = root.join("state.db");
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch(
        "CREATE TABLE sessions(id TEXT, cwd TEXT, parent_session_id TEXT, hidden INTEGER,
                               started_at REAL, last_activity_at REAL);
         INSERT INTO sessions VALUES('a', '/Users/me/hermes', NULL, 0, 1700000000.5, NULL);
         INSERT INTO sessions VALUES('b', '/Users/me/branch', 'a', 0, 1700000001, NULL);
         INSERT INTO sessions VALUES('c', '/Users/me/hidden', NULL, 1, 1700000002, NULL);",
    )
    .unwrap();
    drop(conn);
    write(
        &root.join("kimi").join("session_index.jsonl"),
        "{\"sessionId\":\"k\",\"workDir\":\"/Users/me/kimi\"}\nnot json\n",
    );
    std::fs::create_dir_all(root.join("grok").join("%2FUsers%2Fme%2Fgrok%20app")).unwrap();
    let mut found = Found::default();
    find_hermes(&db, &mut found);
    find_kimi(&root.join("kimi").join("session_index.jsonl"), &mut found);
    find_grok(&root.join("grok"), &mut found);
    assert_eq!(
        folders(found),
        vec!["/Users/me/grok app", "/Users/me/hermes", "/Users/me/kimi"]
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn registered_folders_become_scan_workspaces_once() {
    let root = scratch("register");
    let db = Db::open_at(&root.join("app.db")).unwrap();
    db.0.lock()
        .execute(
            "INSERT INTO cli_workspaces(id, path, name, last_opened_at) VALUES('w', '/Users/me/linked', 'linked', 7)",
            [],
        )
        .unwrap();
    let folders = vec!["/Users/me/linked".to_string(), "/Users/me/past".to_string()];
    register_into(&db, &folders).unwrap();
    register_into(&db, &folders).unwrap();
    let mut paths = db.workspace_paths().unwrap();
    paths.sort();
    assert_eq!(paths, folders);
    let opened: Option<i64> =
        db.0.lock()
            .query_row(
                "SELECT last_opened_at FROM cli_workspaces WHERE path='/Users/me/linked'",
                [],
                |row| row.get(0),
            )
            .unwrap();
    assert_eq!(
        opened,
        Some(7),
        "a linked folder's own row is left as it was"
    );
    // A folder that has dropped out of the newest ones stops being scanned; a linked one stays.
    register_into(&db, &["/Users/me/newer".to_string()]).unwrap();
    let mut paths = db.workspace_paths().unwrap();
    paths.sort();
    assert_eq!(paths, vec!["/Users/me/linked", "/Users/me/newer"]);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn antigravity_folders_come_from_its_summaries_and_cache() {
    let home = scratch("agy");
    let conn = rusqlite::Connection::open(home.join("conversation_summaries.db")).unwrap();
    conn.execute_batch(
        "CREATE TABLE conversation_summaries(conversation_id TEXT, workspace_uris TEXT);
         INSERT INTO conversation_summaries VALUES('a', '[\"file:///Users/me/agy%20one\"]');
         INSERT INTO conversation_summaries VALUES('b', 'not json');",
    )
    .unwrap();
    drop(conn);
    write(
        &home.join("cache").join("last_conversations.json"),
        "{\"/Users/me/agy-two\": \"b\"}",
    );
    let mut found = Found::default();
    find_agy(&home, &mut found);
    assert_eq!(
        folders(found),
        vec!["/Users/me/agy one", "/Users/me/agy-two"]
    );
    let _ = std::fs::remove_dir_all(&home);
}
