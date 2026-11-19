use rusqlite::Connection;
use serde_json::json;

use super::{clear, record, rows, LogEntryIn};

fn database() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    database::store::migrate(&mut connection).unwrap();
    connection
}

fn start(connection: &Connection, run: &str, account: &str, parent: &str) {
    let mut body = json!({ "account": account, "conversation_id": "c1" });
    if !parent.is_empty() {
        body["parent_run_id"] = json!(parent);
    }
    crate::agents::run_control::run_ledger::record_start(connection, run, &body, 1).unwrap();
    crate::agents::run_control::run_steps::record_start(connection, run, parent, 1).unwrap();
}

fn click(run: &str, call: &str) -> LogEntryIn {
    LogEntryIn {
        run_id: run.into(),
        call_id: call.into(),
        scope_id: "agent-scope-1".into(),
        operation: "browser.click".into(),
        target: "button \"Search\"".into(),
        url: "https://example.com/".into(),
        title: "Example".into(),
        verdict: "navigated".into(),
        state: "completed".into(),
        ..LogEntryIn::default()
    }
}

#[test]
fn actions_are_numbered_in_order_under_their_tool_call() {
    let connection = database();
    start(&connection, "r1", "me", "");
    assert_eq!(
        record(&connection, "me", &click("r1", "toolu_a"), 5).unwrap(),
        Some(("r1".into(), 1))
    );
    let mut failed = click("r1", "toolu_a");
    failed.state = "failed".into();
    failed.error = "covered by a dialog".into();
    record(&connection, "me", &failed, 6).unwrap();
    let log = rows(&connection, "me", "r1").unwrap();
    assert_eq!(log.len(), 2);
    assert_eq!(log[0].call_id, "r1:toolu_a");
    assert_eq!(log[0].verdict, "navigated");
    assert_eq!(
        (log[1].seq, log[1].state.as_str(), log[1].error.as_str()),
        (2, "failed", "covered by a dialog")
    );
}

#[test]
fn a_sub_agents_actions_go_under_the_run_that_started_it() {
    let connection = database();
    start(&connection, "r1", "me", "");
    start(&connection, "r2", "me", "r1");
    record(&connection, "me", &click("r2", "toolu_b"), 5).unwrap();
    let log = rows(&connection, "me", "r1").unwrap();
    assert_eq!(log.len(), 1);
    assert!(log[0].nested);
    assert_eq!(log[0].call_id, "r2:toolu_b");
}

#[test]
fn another_accounts_run_is_neither_logged_nor_read() {
    let connection = database();
    start(&connection, "r1", "me", "");
    assert_eq!(
        record(&connection, "someone", &click("r1", "toolu_a"), 5).unwrap(),
        None
    );
    record(&connection, "me", &click("r1", "toolu_a"), 5).unwrap();
    assert!(rows(&connection, "someone", "r1").unwrap().is_empty());
    clear(&connection, "me").unwrap();
    assert!(rows(&connection, "me", "r1").unwrap().is_empty());
}
