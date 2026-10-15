//! The ACP and launch-only adapters against recorded protocol output.
use std::path::PathBuf;

use serde_json::Value;

use super::{
    events::{ActionKind, RunnerEvent},
    runner_for, EngineId, Launch, LaunchMode, RunnerError,
};

fn launch(mode: LaunchMode, grants: &[&str]) -> Launch {
    Launch {
        project_root: PathBuf::from("/work/app"),
        task: "Fix the parser".into(),
        mode,
        model: None,
        session: None,
        grants: grants.iter().map(|g| g.to_string()).collect(),
    }
}

fn json(line: &str) -> Value {
    serde_json::from_str(line).unwrap()
}

#[test]
fn acp_handshake_sets_plan_mode_then_prompts() {
    let runner = runner_for(EngineId::Minimax).unwrap();
    let mut protocol = runner.protocol(&launch(LaunchMode::Plan, &[]));
    let init = json(&protocol.initial_input()[0]);
    assert_eq!(init["method"], "initialize");
    assert_eq!(
        init["params"]["clientCapabilities"]["fs"]["writeTextFile"],
        false
    );
    let new = protocol.on_line(r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1}}"#);
    let session = json(&new.writes[0]);
    assert_eq!(
        (
            session["method"].as_str(),
            session["params"]["cwd"].as_str()
        ),
        (Some("session/new"), Some("/work/app"))
    );
    let opened = protocol.on_line(r#"{"jsonrpc":"2.0","id":2,"result":{"sessionId":"s-1"}}"#);
    assert_eq!(
        opened.events,
        vec![RunnerEvent::Session { id: "s-1".into() }]
    );
    let mode = json(&opened.writes[0]);
    assert_eq!(
        (mode["method"].as_str(), mode["params"]["modeId"].as_str()),
        (Some("session/set_mode"), Some("plan"))
    );
    let prompt = json(
        &protocol
            .on_line(r#"{"jsonrpc":"2.0","id":3,"result":{}}"#)
            .writes[0],
    );
    assert_eq!(prompt["method"], "session/prompt");
    assert_eq!(prompt["params"]["prompt"][0]["text"], "Fix the parser");
}

#[test]
fn acp_updates_permissions_and_completion() {
    let runner = runner_for(EngineId::Kimi).unwrap();
    let mut protocol = runner.protocol(&launch(LaunchMode::Ask, &[]));
    protocol.initial_input();
    protocol.on_line(r#"{"jsonrpc":"2.0","id":1,"result":{}}"#);
    let prompt = protocol.on_line(r#"{"jsonrpc":"2.0","id":2,"result":{"sessionId":"s-2"}}"#);
    assert_eq!(
        json(&prompt.writes[0])["method"],
        "session/prompt",
        "Kimi asks by default, no mode to set"
    );
    let chunk = protocol.on_line(r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s-2","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Done"}}}}"#);
    assert_eq!(
        chunk.events,
        vec![RunnerEvent::Delta {
            text: "Done".into()
        }]
    );
    let plan = protocol.on_line(r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"plan","entries":[{"content":"Edit parser","status":"in_progress","priority":"high"}]}}}"#);
    assert!(
        matches!(&plan.events[0], RunnerEvent::Todos { items } if items[0].status == "in_progress")
    );
    let ask = protocol.on_line(r#"{"jsonrpc":"2.0","id":"p-9","method":"session/request_permission","params":{"sessionId":"s-2","toolCall":{"toolCallId":"t1","title":"Run npm install","kind":"execute","rawInput":{"command":"npm install left-pad"}},"options":[{"optionId":"yes","name":"Allow","kind":"allow_once"},{"optionId":"always","name":"Always","kind":"allow_always"},{"optionId":"no","name":"Reject","kind":"reject_once"}]}}"#);
    let RunnerEvent::PermissionRequest(request) = &ask.events[0] else {
        panic!("{ask:?}")
    };
    assert_eq!(request.kind, ActionKind::Install);
    let allow = json(&protocol.answer(request, true, "").unwrap());
    assert_eq!(
        (
            allow["id"].as_str(),
            allow["result"]["outcome"]["optionId"].as_str()
        ),
        (Some("p-9"), Some("yes")),
        "never allow_always"
    );
    let deny = json(&protocol.answer(request, false, "").unwrap());
    assert_eq!(deny["result"]["outcome"]["optionId"], "no");
    let refused = protocol.on_line(r#"{"jsonrpc":"2.0","id":7,"method":"fs/write_text_file","params":{"path":"/etc/x","content":""}}"#);
    assert!(json(&refused.writes[0])["error"].is_object());
    let done = protocol.on_line(r#"{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn","_meta":{"inputTokens":120,"outputTokens":30,"cachedReadTokens":10}}}"#);
    assert!(
        matches!(&done.events[0], RunnerEvent::Usage(usage) if usage.input == 120 && usage.cache_read == 10)
    );
    assert!(matches!(done.events[1], RunnerEvent::Done { .. }));
}

#[test]
fn tools_without_a_read_only_mode_refuse_plan_launches() {
    for engine in [EngineId::Qoder, EngineId::QoderCn, EngineId::Grok] {
        let runner = runner_for(engine).unwrap();
        assert!(
            matches!(
                runner.build_command(&launch(LaunchMode::Plan, &[])),
                Err(RunnerError::Unsupported(_))
            ),
            "{engine}"
        );
    }
}

#[test]
fn grok_runs_only_in_auto_with_a_push_guard_unless_push_is_remembered() {
    let runner = runner_for(EngineId::Grok).unwrap();
    assert!(runner.build_command(&launch(LaunchMode::Ask, &[])).is_err());
    let guarded = runner
        .build_command(&launch(
            LaunchMode::AutoEdit,
            &["project.edit", "project.install"],
        ))
        .unwrap();
    assert!(!guarded.args.iter().any(|arg| arg.contains("approve")));
    let env: std::collections::HashMap<_, _> = guarded.env.iter().cloned().collect();
    assert_eq!(
        env.get("GIT_CONFIG_KEY_0").map(String::as_str),
        Some("core.hooksPath")
    );
    let hook = PathBuf::from(&env["GIT_CONFIG_VALUE_0"]).join("pre-push");
    assert!(std::fs::read_to_string(hook).unwrap().contains("exit 1"));
    let trusted = runner
        .build_command(&launch(
            LaunchMode::AutoEdit,
            &["project.edit", "project.install", "git.push"],
        ))
        .unwrap();
    assert!(!trusted.env.iter().any(|(key, _)| key == "GIT_CONFIG_COUNT"));
}

#[test]
fn launch_only_tools_plan_in_ask_and_edit_in_auto() {
    for engine in [EngineId::Agy, EngineId::Pi] {
        let runner = runner_for(engine).unwrap();
        assert!(
            matches!(
                runner.build_command(&launch(LaunchMode::Ask, &[])),
                Err(RunnerError::Unsupported(_))
            ),
            "{engine}"
        );
        assert!(runner.build_command(&launch(LaunchMode::Plan, &[])).is_ok());
        assert!(runner
            .build_command(&launch(LaunchMode::AutoEdit, &[]))
            .is_ok());
    }
    let agy = runner_for(EngineId::Agy)
        .unwrap()
        .build_command(&launch(LaunchMode::Plan, &[]))
        .unwrap();
    assert!(agy.args.windows(2).any(|pair| pair == ["--mode", "plan"]));
    let pi = runner_for(EngineId::Pi)
        .unwrap()
        .build_command(&launch(LaunchMode::Plan, &[]))
        .unwrap();
    assert!(pi
        .args
        .windows(2)
        .any(|pair| pair == ["--tools", "read,grep,find,ls"]));
}

#[test]
fn launch_only_streams_map_onto_runner_events() {
    let mut agy = runner_for(EngineId::Agy)
        .unwrap()
        .protocol(&launch(LaunchMode::AutoEdit, &[]));
    let mut events = Vec::new();
    for line in [
        r#"{"type":"init","conversation_id":"c-1"}"#,
        r#"{"type":"step_update","text_delta":"Editing"}"#,
        r#"{"type":"result","status":"success","usage":{"input_tokens":50,"output_tokens":5}}"#,
    ] {
        events.extend(agy.on_line(line).events);
    }
    assert_eq!(events[0], RunnerEvent::Session { id: "c-1".into() });
    assert!(matches!(events.last(), Some(RunnerEvent::Done { .. })));
    let mut pi = runner_for(EngineId::Pi)
        .unwrap()
        .protocol(&launch(LaunchMode::AutoEdit, &[]));
    assert_eq!(json(&pi.initial_input()[0])["type"], "prompt");
    let delta = pi.on_line(
        r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hi"}}"#,
    );
    assert_eq!(delta.events, vec![RunnerEvent::Delta { text: "Hi".into() }]);
    assert!(pi
        .on_line(r#"{"type":"agent_end","willRetry":true}"#)
        .events
        .is_empty());
    assert!(matches!(
        pi.on_line(r#"{"type":"agent_end","isTerminal":true}"#)
            .events[0],
        RunnerEvent::Done { .. }
    ));
}

#[test]
fn http_hosted_tools_are_reported_as_not_supported() {
    assert!(runner_for(EngineId::Opencode).is_none());
    assert!(runner_for(EngineId::Dsh).is_none());
}
