use rusqlite::Connection;
use serde_json::json;

use super::{clear, latest, record_event, record_picture, record_start, rows};

fn database() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    database::store::migrate(&mut connection).unwrap();
    connection
}

fn start(connection: &Connection, run: &str, account: &str, parent: &str, at: i64) {
    let mut body = json!({ "account": account, "conversation_id": "c1" });
    if !parent.is_empty() {
        body["parent_run_id"] = json!(parent);
    }
    crate::agents::run_control::run_ledger::record_start(connection, run, &body, at).unwrap();
    record_start(connection, run, parent, at).unwrap();
}

fn started(id: &str, tool: &str, args: serde_json::Value) -> serde_json::Value {
    json!({ "type": "tool.started", "toolCallId": id, "toolName": tool, "args": args })
}

#[test]
fn a_step_keeps_its_tool_target_page_and_ending_but_no_arguments() {
    let connection = database();
    start(&connection, "r1", "me", "", 10);
    record_event(&connection, "r1", &started("a", "Edit", json!({ "file_path": "/repo/a.ts", "old_string": "secret" })), 11).unwrap();
    record_event(&connection, "r1", &json!({ "type": "tool.completed", "toolCallId": "a", "toolName": "Edit", "durationMs": 40 }), 12).unwrap();
    record_event(&connection, "r1", &started("b", "browser.navigate", json!({ "url": "https://example.com/a" })), 13).unwrap();
    record_event(
        &connection,
        "r1",
        &json!({ "type": "tool.completed", "toolCallId": "b", "toolName": "browser.navigate",
                 "result": "{\"url\":\"https://example.com/b\",\"title\":\"Example\"}" }),
        20,
    )
    .unwrap();
    record_event(&connection, "r1", &started("c", "Bash", json!({ "command": "npm test" })), 21).unwrap();
    record_event(&connection, "r1", &json!({ "type": "tool.failed", "toolCallId": "c", "toolName": "Bash" }), 25).unwrap();

    let steps = rows(&connection, "me", "r1").unwrap();
    assert_eq!(steps.len(), 3);
    assert_eq!((steps[0].tool.as_str(), steps[0].target.as_str(), steps[0].state.as_str()), ("Edit", "/repo/a.ts", "completed"));
    assert_eq!(steps[0].duration_ms, 40);
    assert_eq!((steps[1].target.as_str(), steps[1].title.as_str()), ("https://example.com/b", "Example"));
    assert_eq!(steps[1].duration_ms, 7);
    assert_eq!((steps[2].target.as_str(), steps[2].state.as_str()), ("", "failed"));
    let stored: String = connection
        .query_row("SELECT group_concat(target || title || tool, '|') FROM agent_run_steps", [], |row| row.get(0))
        .unwrap();
    assert!(!stored.contains("secret") && !stored.contains("npm test"));
}

#[test]
fn a_sub_agents_steps_go_under_the_run_that_started_it() {
    let connection = database();
    start(&connection, "r1", "me", "", 1);
    start(&connection, "r2", "me", "r1", 2);
    record_event(&connection, "r1", &started("a", "Read", json!({ "path": "/x" })), 3).unwrap();
    record_event(&connection, "r2", &started("a", "Read", json!({ "path": "/y" })), 4).unwrap();
    let steps = rows(&connection, "me", "r1").unwrap();
    assert_eq!(steps.iter().map(|step| step.target.as_str()).collect::<Vec<_>>(), ["/x", "/y"]);
    assert!(!steps[0].nested && steps[1].nested);
    assert!(rows(&connection, "me", "r2").unwrap().is_empty());
}

#[test]
fn a_run_that_ends_ends_its_open_steps_and_another_account_sees_none() {
    let connection = database();
    start(&connection, "r1", "me", "", 1);
    record_event(&connection, "r1", &started("a", "Bash", json!({})), 2).unwrap();
    record_event(&connection, "r1", &json!({ "type": "invocation.canceled" }), 9).unwrap();
    let steps = rows(&connection, "me", "r1").unwrap();
    assert_eq!((steps[0].state.as_str(), steps[0].duration_ms), ("failed", 7));
    assert!(rows(&connection, "other", "r1").unwrap().is_empty());
    assert!(latest(&connection, "other", &["r1".to_owned()]).unwrap().is_empty());
    assert_eq!(latest(&connection, "me", &["r1".to_owned()]).unwrap()[0].1.tool, "Bash");
}

#[test]
fn a_run_nobody_owns_keeps_no_steps_and_clearing_leaves_the_ledger() {
    let connection = database();
    record_event(&connection, "ghost", &started("a", "Bash", json!({})), 1).unwrap();
    assert!(rows(&connection, "", "ghost").unwrap().is_empty());
    start(&connection, "r1", "me", "", 1);
    record_event(&connection, "r1", &started("a", "browser.click", json!({})), 2).unwrap();
    record_picture(&connection, "r1", "a", "abc.jpg").unwrap();
    assert_eq!(rows(&connection, "me", "r1").unwrap()[0].picture, "abc.jpg");
    assert_eq!(clear(&connection, "me").unwrap(), vec!["r1".to_owned()]);
    assert!(rows(&connection, "me", "r1").unwrap().is_empty());
    let ledger: i64 = connection.query_row("SELECT COUNT(*) FROM agent_run_ledger", [], |row| row.get(0)).unwrap();
    assert_eq!(ledger, 1);
}

#[test]
fn old_steps_go_when_a_run_starts() {
    let connection = database();
    let day = 24 * 60 * 60 * 1000;
    start(&connection, "old", "me", "", 0);
    record_event(&connection, "old", &started("a", "Bash", json!({})), 0).unwrap();
    start(&connection, "new", "me", "", 91 * day);
    assert!(rows(&connection, "me", "old").unwrap().is_empty());
}

#[test]
fn a_page_named_inside_an_mcp_result_is_kept() {
    let connection = database();
    start(&connection, "r1", "me", "", 1);
    record_event(&connection, "r1", &started("a", "mcp__misty__browser_snapshot", json!({})), 2).unwrap();
    let inner = json!({ "url": "https://docs.example.com/x", "title": "Docs" }).to_string();
    record_event(
        &connection,
        "r1",
        &json!({ "type": "tool.completed", "toolCallId": "a", "toolName": "mcp__misty__browser_snapshot",
                 "result": { "content": [{ "type": "text", "text": inner }] } }),
        3,
    )
    .unwrap();
    let step = &rows(&connection, "me", "r1").unwrap()[0];
    assert_eq!((step.target.as_str(), step.title.as_str()), ("https://docs.example.com/x", "Docs"));
}

#[test]
fn a_command_line_used_as_a_tool_name_is_never_kept() {
    let connection = database();
    start(&connection, "r1", "me", "", 1);
    record_event(&connection, "r1", &started("a", "curl -H 'Authorization: Bearer x' https://a.b", json!({})), 2).unwrap();
    record_event(&connection, "r1", &started("b", "mcp__misty__browser_navigate", json!({})), 3).unwrap();
    let steps = rows(&connection, "me", "r1").unwrap();
    assert_eq!(steps[0].tool, "shell");
    assert_eq!(steps[1].tool, "mcp__misty__browser_navigate");
}
