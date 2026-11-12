// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
use super::*;

#[test]
fn runtime_snapshot_is_workspace_scoped_and_marks_session_end() {
    runtime::register_run("run-mcp-test", "/tmp/ws-mcp-test");
    runtime::record_from_run(
        "run-mcp-test",
        Some("session-1"),
        vec![
            ("alpha".to_string(), Some("connected".to_string())),
            (MISTY_SERVER_NAME.to_string(), None),
        ],
        vec![
            "mcp__alpha__search".to_string(),
            "mcp__alpha__fetch".to_string(),
            "Bash".to_string(),
        ],
    );
    let section = runtime::claude_section(Some("/tmp/ws-mcp-test"));
    assert_eq!(section.status, "ready");
    assert_eq!(section.session_id.as_deref(), Some("session-1"));
    let alpha = section.entries.iter().find(|e| e.name == "alpha").unwrap();
    assert_eq!(alpha.tool_names, vec!["fetch", "search"]);
    assert!(!alpha.builtin);
    let builtin = section
        .entries
        .iter()
        .find(|e| e.name == MISTY_SERVER_NAME)
        .unwrap();
    assert!(builtin.builtin);

    runtime::mark_run_ended("run-mcp-test");
    let ended = runtime::claude_section(Some("/tmp/ws-mcp-test"));
    assert_eq!(ended.status, "session_ended");
    assert_eq!(ended.entries.len(), 2);

    // A run that was never registered writes no snapshot.
    runtime::record_from_run("unknown-run", None, vec![("x".to_string(), None)], vec![]);
    let other = runtime::claude_section(Some("/tmp/ws-mcp-other"));
    assert_eq!(other.status, "no_session");
    assert!(other.entries.is_empty());
    assert_eq!(runtime::claude_section(None).status, "no_session");
}
