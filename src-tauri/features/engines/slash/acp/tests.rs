use super::grok::grok_info_rows;
use super::hermes::{hermes_btw_prompt, hermes_process_rows, hermes_save_args, uptime};
use super::out_of_turn::has_session_call;
use super::*;

#[test]
fn hermes_side_question_carries_its_rules() {
    let prompt = hermes_btw_prompt("  what did we decide?  ");
    assert!(prompt.starts_with("The user asked a quick SIDE question with /btw"));
    assert!(prompt.contains("Do NOT call any tools"));
    assert!(prompt.ends_with("Side question:\nwhat did we decide?"));
}

#[test]
fn save_arguments_follow_hermes() {
    assert_eq!(hermes_save_args("json").unwrap(), ("json", None, false));
    assert_eq!(
        hermes_save_args("markdown notes.md redact").unwrap(),
        ("md", Some("notes.md".into()), true)
    );
    assert_eq!(
        hermes_save_args("HTML --redact").unwrap(),
        ("html", None, true)
    );
    assert_eq!(hermes_save_args("snapshot").unwrap().0, "json");
    assert!(hermes_save_args("pdf").is_err());
    assert!(hermes_save_args("redact").is_err());
}

/// The `initialize` answers of the installed engines (Kimi Code 2.6.2, Grok 1.0.77, Hermes
/// 0.23.1, MiniMax Code 0.7.7), trimmed to their session capabilities.
#[test]
fn session_calls_follow_each_engines_handshake() {
    let kimi = json!({"protocolVersion": 1, "agentCapabilities": {"loadSession": true,
        "sessionCapabilities": {"list": {}, "resume": {}, "close": {}, "delete": {}, "fork": {},
        "additionalDirectories": {}}}});
    let grok = json!({"protocolVersion": 1, "agentCapabilities": {"loadSession": true,
        "sessionCapabilities": {"list": {}, "resume": {}, "close": {}}}});
    let hermes = json!({"protocolVersion": 1, "agentCapabilities": {"loadSession": true,
        "sessionCapabilities": {"fork": {}, "list": {}, "resume": {}}}});
    let minimax = json!({"protocolVersion": 1, "agentCapabilities": {"loadSession": true,
        "sessionCapabilities": {"list": {}, "fork": {}, "resume": {}, "close": {}}}});
    for agent in [&kimi, &hermes, &minimax] {
        assert!(has_session_call(agent, "fork"));
        assert!(has_session_call(agent, "resume"));
    }
    // Grok has no ACP fork: its own `_x.ai/session/fork` makes one.
    assert!(!has_session_call(&grok, "fork"));
    assert!(has_session_call(&grok, "resume"));
    assert!(!has_session_call(&json!({}), "resume"));
}

/// Grok 1.0.77's own session calls, as it answers them: fork and rename unwrapped, info
/// wrapped in `{result}` (and `{result: {}}` for a session this process hasn't opened).
#[test]
fn grok_session_calls_read_its_answers() {
    let forked = json!({"newSessionId": "01a1d856-29df-7f81-a279-92fac4df77db",
        "chatMessagesCopied": 0, "updatesCopied": 0, "planStateCopied": false,
        "newCwd": "/w", "parentSessionId": "01a1d855-85dd-70d2-821a-681dc231020f"});
    assert_eq!(
        text(unwrapped(&forked), "newSessionId").as_deref(),
        Some("01a1d856-29df-7f81-a279-92fac4df77db")
    );
    let info = json!({"result": {"sessionId": "01a1d856", "cwd": "/w",
        "agentName": "grok-build-plan", "model": "grok-4.6", "modelDisplayName": "Grok 4.6",
        "resolvedModelId": null, "apiBackend": "Responses", "turns": 1, "turnIndex": 0,
        "context": {"used": 2907, "total": 500000, "systemPromptTokens": 1350,
            "toolDefinitionsCount": 25, "compactionCount": 0, "turnCount": 0, "toolCallCount": 0,
            "messageCount": 2, "freeTokens": 497093, "usagePct": 1,
            "autoCompactThresholdPercent": 80}}});
    let rows: Vec<(String, String)> = grok_info_rows(unwrapped(&info))
        .into_iter()
        .map(|row| (row.label, row.value))
        .collect();
    let expect = [
        ("Model", "Grok 4.6"),
        ("Agent", "grok-build-plan"),
        ("Turns", "1"),
        ("Context", "2907 of 500000 tokens (1%)"),
        ("Compacts at", "80%"),
        ("Compactions", "0"),
        ("Messages", "2"),
        ("Tool calls", "0"),
        ("Session", "01a1d856"),
        ("Folder", "/w"),
    ];
    assert_eq!(
        rows,
        expect.map(|(label, value)| (label.to_string(), value.to_string()))
    );
    assert!(grok_info_rows(unwrapped(&json!({"result": {}}))).is_empty());
}

#[test]
fn withheld_commands_never_reach_the_menu() {
    crate::engines::reported::acp_update(
        "grok",
        &json!({"sessionUpdate": "available_commands_update", "availableCommands": [
            {"name": "compact", "description": "Compress conversation history to save context window", "input": null},
            {"name": "always-approve", "description": "Toggle always-approve mode (skip all permission prompts)", "input": {"hint": "on|off"}},
            {"name": "session-info", "description": "Show session details (model, turns, context usage)", "input": null}
        ]}),
    );
    let names: Vec<String> = crate::engines::reported::report_of("grok")
        .commands
        .unwrap()
        .into_iter()
        .map(|named| named.name)
        .collect();
    assert_eq!(names, ["compact", "session-info"]);
    crate::engines::reported::forget("grok");
}

#[test]
fn minimax_fork_refusal_says_why() {
    assert_eq!(
        fork_refusal("Invalid params: message-boundary-not-found".into()),
        "MiniMax Code forks a session only after a reply has finished."
    );
    assert_eq!(fork_refusal("other".into()), "other");
}

#[test]
fn processes_read_like_hermes_agents() {
    let entries = vec![
        json!({"session_id": "proc_1", "pid": 42, "started_at": 1000.0,
               "command": "npm   run dev"}),
        json!({"session_id": "gone", "command": "no pid"}),
    ];
    let rows = hermes_process_rows(&entries, 1000.0 + 3725.0);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].label, "proc_1");
    assert_eq!(rows[0].value, "1h 2m · npm run dev");
    assert_eq!(uptime(45), "45s");
    assert_eq!(uptime(600), "10m");
}
