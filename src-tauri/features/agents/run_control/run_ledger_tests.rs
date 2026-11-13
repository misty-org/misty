use rusqlite::Connection;
use serde_json::json;

use super::{record_event, record_start, rows, settle_cut_off};

fn database() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    database::store::migrate(&mut connection).unwrap();
    connection
}

fn chats(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|id| (*id).to_owned()).collect()
}

#[test]
fn keeps_mode_engine_tools_and_written_files() {
    let connection = database();
    let body = json!({
        "account": "me",
        "conversation_id": "c1",
        "permission_mode": "auto",
        "engine": { "id": "codex" },
    });
    record_start(&connection, "r1", &body, 10).unwrap();
    let tool =
        |name: &str, path: &str| json!({ "type": "tool.started", "toolName": name, "path": path });
    record_event(&connection, "r1", &tool("Read", "/repo/a.ts"), 11).unwrap();
    record_event(&connection, "r1", &tool("Edit", "/repo/a.ts"), 12).unwrap();
    record_event(&connection, "r1", &tool("Edit", "/repo/a.ts"), 13).unwrap();
    record_event(
        &connection,
        "r1",
        &json!({ "type": "invocation.completed" }),
        14,
    )
    .unwrap();

    let found = rows(&connection, "me", &chats(&["c1"]), 10).unwrap();
    assert_eq!(found.len(), 1);
    let row = &found[0];
    assert_eq!(row.engine, "codex");
    // An old Auto, kept as the engine's own mode it maps to: Codex's Default.
    assert_eq!(row.mode, "default");
    assert_eq!(row.state, "completed");
    assert_eq!(row.tools, 3);
    assert_eq!(row.files, vec!["/repo/a.ts".to_owned()]);
}

#[test]
fn a_question_shows_until_the_run_moves_on() {
    let connection = database();
    record_start(
        &connection,
        "r1",
        &json!({ "account": "me", "conversation_id": "c1" }),
        1,
    )
    .unwrap();
    record_event(
        &connection,
        "r1",
        &json!({ "type": "approval.required" }),
        2,
    )
    .unwrap();
    assert_eq!(
        rows(&connection, "me", &chats(&["c1"]), 10).unwrap()[0].state,
        "needs-you"
    );
    record_event(
        &connection,
        "r1",
        &json!({ "type": "tool.started", "toolName": "Bash" }),
        3,
    )
    .unwrap();
    let row = &rows(&connection, "me", &chats(&["c1"]), 10).unwrap()[0];
    assert_eq!(row.state, "running");
    assert_eq!(row.engine, "misty");
    assert_eq!(row.mode, "ask");
}

#[test]
fn another_accounts_runs_and_sub_agents_stay_out() {
    let connection = database();
    record_start(
        &connection,
        "r1",
        &json!({ "account": "other", "conversation_id": "c1" }),
        1,
    )
    .unwrap();
    record_start(
        &connection,
        "r2",
        &json!({ "account": "me", "conversation_id": "c1", "parent_run_id": "r0" }),
        2,
    )
    .unwrap();
    assert!(rows(&connection, "me", &chats(&["c1"]), 10)
        .unwrap()
        .is_empty());
    assert!(rows(&connection, "me", &[], 10).unwrap().is_empty());
}

#[test]
fn old_rows_go_when_a_run_starts() {
    let connection = database();
    let day = 24 * 60 * 60 * 1000;
    record_start(
        &connection,
        "old",
        &json!({ "account": "me", "conversation_id": "c1" }),
        0,
    )
    .unwrap();
    record_start(
        &connection,
        "new",
        &json!({ "account": "me", "conversation_id": "c1" }),
        91 * day,
    )
    .unwrap();
    let found = rows(&connection, "me", &chats(&["c1"]), 10).unwrap();
    assert_eq!(
        found
            .iter()
            .map(|row| row.run_id.as_str())
            .collect::<Vec<_>>(),
        vec!["new"]
    );
}

#[test]
fn a_run_cut_off_by_an_earlier_launch_reads_as_stopped() {
    let connection = database();
    let start = |run: &str, at: i64| {
        let body = json!({ "account": "me", "conversation_id": "c1" });
        record_start(&connection, run, &body, at).unwrap();
    };
    start("old", 10);
    start("resumed", 11);
    start("done", 12);
    record_event(
        &connection,
        "done",
        &json!({ "type": "invocation.completed" }),
        13,
    )
    .unwrap();
    start("new", 100);

    let mut found = rows(&connection, "me", &chats(&["c1"]), 10).unwrap();
    settle_cut_off(&mut found, 50, |run| run == "resumed");
    let state = |run: &str| {
        let row = found.iter().find(|row| row.run_id == run).unwrap();
        row.state.clone()
    };
    assert_eq!(state("old"), "canceled");
    assert_eq!(state("resumed"), "running");
    assert_eq!(state("done"), "completed");
    // Started in this launch: its engine may not have come up yet.
    assert_eq!(state("new"), "running");
}
