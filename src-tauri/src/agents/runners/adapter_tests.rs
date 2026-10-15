//! Claude Code and Codex adapters against recorded protocol output. The CLIs
//! aren't run here; the fixtures follow each tool's documented wire format.
use std::path::PathBuf;

use serde_json::Value;

use super::{
    bridge::{decide, BridgeContext, Decision},
    events::{ActionKind, RunnerEvent},
    runner_for, EngineId, Launch, LaunchMode, Protocol,
};

fn launch(mode: LaunchMode) -> Launch {
    Launch {
        project_root: PathBuf::from("/work/app"),
        task: "Fix the parser".into(),
        mode,
        model: None,
        session: None,
    }
}

fn replay(protocol: &mut dyn Protocol, fixture: &str) -> (Vec<RunnerEvent>, Vec<String>) {
    let mut events = Vec::new();
    let mut writes = Vec::new();
    for line in fixture.lines() {
        let step = protocol.on_line(line);
        events.extend(step.events);
        writes.extend(step.writes);
    }
    (events, writes)
}

fn permissions(events: &[RunnerEvent]) -> Vec<&super::events::PermissionRequest> {
    events
        .iter()
        .filter_map(|event| match event {
            RunnerEvent::PermissionRequest(request) => Some(request),
            _ => None,
        })
        .collect()
}

#[test]
fn claude_plan_and_default_launches() {
    let runner = runner_for(EngineId::Claude).unwrap();
    let plan = runner.build_command(&launch(LaunchMode::Plan)).unwrap();
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["--permission-mode", "plan"]));
    let ask = runner.build_command(&launch(LaunchMode::AutoEdit)).unwrap();
    assert!(ask
        .args
        .windows(2)
        .any(|pair| pair == ["--permission-mode", "default"]));
    assert!(ask
        .args
        .windows(2)
        .any(|pair| pair == ["--permission-prompt-tool", "stdio"]));
}

#[test]
fn claude_turn_maps_onto_runner_events() {
    let runner = runner_for(EngineId::Claude).unwrap();
    let mut protocol = runner.protocol(&launch(LaunchMode::Ask));
    let input: Value = serde_json::from_str(&protocol.initial_input()[0]).unwrap();
    assert_eq!(input["message"]["content"][0]["text"], "Fix the parser");
    let (events, writes) = replay(
        protocol.as_mut(),
        include_str!("fixtures/claude_turn.jsonl"),
    );
    assert!(writes.is_empty());
    assert_eq!(
        events[0],
        RunnerEvent::Session {
            id: "sess-123".into()
        }
    );
    let todos = events
        .iter()
        .find_map(|e| match e {
            RunnerEvent::Todos { items } => Some(items),
            _ => None,
        })
        .unwrap();
    assert_eq!(
        todos.iter().map(|t| t.status.as_str()).collect::<Vec<_>>(),
        ["done", "in_progress", "pending"]
    );
    let asks = permissions(&events);
    assert_eq!(asks.len(), 3);
    assert_eq!(
        (asks[0].kind, asks[0].path.as_deref()),
        (ActionKind::Edit, Some("/work/app/src/parse.rs"))
    );
    assert_eq!(asks[1].kind, ActionKind::Push);
    let usage = events
        .iter()
        .find_map(|e| match e {
            RunnerEvent::Usage(u) => Some(u),
            _ => None,
        })
        .unwrap();
    assert_eq!(
        (
            usage.input,
            usage.output,
            usage.cache_read,
            usage.cache_write
        ),
        (1200, 300, 5000, 800)
    );
    assert_eq!(usage.model, "claude-sonnet-x");
    assert!(
        !events
            .iter()
            .any(|e| matches!(e, RunnerEvent::Message { .. })),
        "streamed text isn't repeated"
    );
    assert!(matches!(events.last(), Some(RunnerEvent::Done { .. })));

    // The bridge: the edit continues in Auto, the push asks, /etc is refused.
    let auto = BridgeContext {
        mode: "auto".into(),
        project_root: PathBuf::from("/work/app"),
        lease_valid: true,
        ..Default::default()
    };
    assert_eq!(decide(asks[0], &auto), Decision::Allow);
    assert!(matches!(
        decide(asks[1], &auto),
        Decision::AskPerson { action: "git.push" }
    ));
    assert!(matches!(decide(asks[2], &auto), Decision::Deny { .. }));
    let allow: Value = serde_json::from_str(&protocol.answer(asks[0], true, "").unwrap()).unwrap();
    assert_eq!(allow["response"]["request_id"], "req-1");
    assert_eq!(allow["response"]["response"]["behavior"], "allow");
    assert_eq!(
        allow["response"]["response"]["updatedInput"]["file_path"],
        "/work/app/src/parse.rs"
    );
    let deny: Value =
        serde_json::from_str(&protocol.answer(asks[2], false, "outside").unwrap()).unwrap();
    assert_eq!(
        deny["response"]["response"],
        serde_json::json!({"behavior": "deny", "message": "outside"})
    );
}

#[test]
fn codex_handshake_uses_on_request_approvals() {
    let runner = runner_for(EngineId::Codex).unwrap();
    for (mode, sandbox) in [
        (LaunchMode::Plan, "read-only"),
        (LaunchMode::AutoEdit, "workspace-write"),
    ] {
        let mut protocol = runner.protocol(&launch(mode));
        let init: Value = serde_json::from_str(&protocol.initial_input()[0]).unwrap();
        assert_eq!(init["method"], "initialize");
        let step = protocol.on_line(r#"{"jsonrpc":"2.0","id":1,"result":{}}"#);
        let thread: Value = serde_json::from_str(&step.writes[1]).unwrap();
        assert_eq!(thread["method"], "thread/start");
        assert_eq!(thread["params"]["approvalPolicy"], "on-request");
        assert_eq!(thread["params"]["sandbox"], sandbox);
        assert_eq!(thread["params"]["cwd"], "/work/app");
    }
}

#[test]
fn codex_turn_maps_onto_runner_events() {
    let runner = runner_for(EngineId::Codex).unwrap();
    let mut protocol = runner.protocol(&launch(LaunchMode::Ask));
    protocol.initial_input();
    let (events, writes) = replay(protocol.as_mut(), include_str!("fixtures/codex_turn.jsonl"));
    let turn: Value = serde_json::from_str(&writes[2]).unwrap();
    assert_eq!(
        (turn["method"].as_str(), turn["params"]["threadId"].as_str()),
        (Some("turn/start"), Some("thr-9"))
    );
    assert_eq!(turn["params"]["input"][0]["text"], "Fix the parser");
    let declined: Value = serde_json::from_str(&writes[3]).unwrap();
    assert_eq!(
        (
            declined["id"].as_u64(),
            declined["result"]["action"].as_str()
        ),
        (Some(9), Some("decline"))
    );
    assert!(events.contains(&RunnerEvent::Session { id: "thr-9".into() }));
    let asks = permissions(&events);
    assert_eq!(asks.len(), 2);
    assert_eq!(
        (asks[0].kind, asks[0].path.as_deref()),
        (ActionKind::Edit, Some("/work/app/src/parse.rs"))
    );
    assert_eq!(asks[1].kind, ActionKind::Install);
    let reply: Value = serde_json::from_str(&protocol.answer(asks[1], false, "").unwrap()).unwrap();
    assert_eq!(
        (reply["id"].as_u64(), reply["result"]["decision"].as_str()),
        (Some(8), Some("decline"))
    );
    let todos = events
        .iter()
        .find_map(|e| match e {
            RunnerEvent::Todos { items } => Some(items),
            _ => None,
        })
        .unwrap();
    assert_eq!(todos[1].status, "in_progress");
    let usage = events
        .iter()
        .find_map(|e| match e {
            RunnerEvent::Usage(u) => Some(u),
            _ => None,
        })
        .unwrap();
    assert_eq!(
        (
            usage.input,
            usage.cache_read,
            usage.output,
            usage.model.as_str()
        ),
        (2000, 1000, 400, "gpt-codex-x")
    );
    let limit = events
        .iter()
        .find_map(|e| match e {
            RunnerEvent::RateLimit(l) => Some(l),
            _ => None,
        })
        .unwrap();
    assert_eq!((limit.used_percent, limit.window.as_str()), (42.5, "300m"));
    assert!(matches!(events.last(), Some(RunnerEvent::Done { .. })));
}
