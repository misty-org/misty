//! The turn driver against a stand-in tool: a shell script that speaks Claude
//! Code's stream-json, so the real protocol, bridge and lease run end to end.
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use super::{
    bridge::BridgeContext,
    claude::ClaudeRunner,
    events::{PermissionRequest, RunnerEvent},
    lease::{Lease, LeaseMeter},
    session::{run_turn, BoxFuture, Outcome, SessionHost},
    CommandSpec, Launch, LaunchMode, Protocol, Runner, RunnerError,
};

/// Claude's protocol, but the "tool" is a script that asks to push, prints
/// the answer it got to a file, then finishes the turn.
struct ScriptedClaude {
    script: String,
}

impl Runner for ScriptedClaude {
    fn build_command(&self, launch: &Launch) -> Result<CommandSpec, RunnerError> {
        Ok(CommandSpec {
            program: "sh".into(),
            args: vec!["-c".into(), self.script.clone()],
            env: vec![],
            cwd: launch.project_root.clone(),
        })
    }
    fn protocol(&self, launch: &Launch) -> Box<dyn Protocol> {
        ClaudeRunner.protocol(launch)
    }
}

#[derive(Default)]
struct Host {
    allow: bool,
    asked: Mutex<Vec<String>>,
    events: Mutex<Vec<RunnerEvent>>,
}

impl SessionHost for Host {
    fn emit<'a>(&'a self, events: Vec<RunnerEvent>) -> BoxFuture<'a, ()> {
        self.events.lock().unwrap().extend(events);
        Box::pin(async {})
    }
    fn ask<'a>(
        &'a self,
        request: &'a PermissionRequest,
        action: &'static str,
    ) -> BoxFuture<'a, bool> {
        self.asked
            .lock()
            .unwrap()
            .push(format!("{action}:{}", request.id));
        let allow = self.allow;
        Box::pin(async move { allow })
    }
    fn now(&self) -> i64 {
        10
    }
}

fn script(answer_file: &str) -> String {
    let ask = r#"{"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"git push"}}}"#;
    let result = r#"{"type":"result","subtype":"success","is_error":false,"result":"ok","usage":{"input_tokens":10,"output_tokens":5}}"#;
    format!("read task; printf '%s\\n' '{ask}'; read answer; printf '%s' \"$answer\" > {answer_file}; printf '%s\\n' '{result}'; sleep 5")
}

fn setup(allow: bool) -> (ScriptedClaude, Launch, Arc<Host>, PathBuf) {
    let dir = std::env::temp_dir().join(format!("misty-runner-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let answer = dir.join("answer.json");
    let runner = ScriptedClaude {
        script: script(answer.to_str().unwrap()),
    };
    let launch = Launch {
        project_root: dir.clone(),
        task: "Ship it".into(),
        mode: LaunchMode::Ask,
        model: None,
        session: None,
        grants: vec![],
    };
    (
        runner,
        launch,
        Arc::new(Host {
            allow,
            ..Default::default()
        }),
        answer,
    )
}

fn meter(budget: u64) -> LeaseMeter {
    LeaseMeter::new(Lease {
        invocation_id: "inv".into(),
        token_budget: budget,
        expires_at: 100,
        grant_version: 1,
        grants: vec![],
        signature: "s".into(),
    })
}

fn context(launch: &Launch) -> BridgeContext {
    BridgeContext {
        mode: "ask".into(),
        project_root: launch.project_root.clone(),
        ..Default::default()
    }
}

#[tokio::test]
async fn a_turn_asks_the_person_answers_the_tool_and_finishes() {
    let (runner, launch, host, answer) = setup(true);
    let (_stop, stop) = tokio::sync::oneshot::channel();
    let outcome = run_turn(
        &runner,
        &launch,
        context(&launch),
        &mut meter(1_000),
        host.as_ref(),
        stop,
    )
    .await
    .unwrap();
    assert_eq!(
        outcome,
        Outcome::Finished,
        "{:?}",
        host.events.lock().unwrap()
    );
    assert_eq!(*host.asked.lock().unwrap(), ["git.push:r1"]);
    let reply: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(answer).unwrap()).unwrap();
    assert_eq!(reply["response"]["response"]["behavior"], "allow");
    assert!(host
        .events
        .lock()
        .unwrap()
        .iter()
        .any(|e| matches!(e, RunnerEvent::Done { .. })));
}

#[tokio::test]
async fn a_no_from_the_person_reaches_the_tool_as_a_deny() {
    let (runner, launch, host, answer) = setup(false);
    let (_stop, stop) = tokio::sync::oneshot::channel();
    run_turn(
        &runner,
        &launch,
        context(&launch),
        &mut meter(1_000),
        host.as_ref(),
        stop,
    )
    .await
    .unwrap();
    let reply: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(answer).unwrap()).unwrap();
    assert_eq!(reply["response"]["response"]["behavior"], "deny");
}

#[tokio::test]
async fn a_spent_lease_stops_at_the_turn_boundary_and_blocks_the_next_turn() {
    let (runner, launch, host, _) = setup(true);
    let mut spent = meter(10);
    let (_stop, stop) = tokio::sync::oneshot::channel();
    let outcome = run_turn(
        &runner,
        &launch,
        context(&launch),
        &mut spent,
        host.as_ref(),
        stop,
    )
    .await
    .unwrap();
    assert_eq!(outcome, Outcome::BudgetExhausted);
    let (_stop, stop) = tokio::sync::oneshot::channel();
    assert_eq!(
        run_turn(
            &runner,
            &launch,
            context(&launch),
            &mut spent,
            host.as_ref(),
            stop
        )
        .await
        .unwrap(),
        Outcome::BudgetExhausted
    );
}

#[tokio::test]
async fn canceling_stops_the_tool() {
    let (_, launch, host, _) = setup(true);
    let runner = ScriptedClaude {
        script: "read task; sleep 30".into(),
    };
    let (send, stop) = tokio::sync::oneshot::channel();
    send.send(()).unwrap();
    let outcome = run_turn(
        &runner,
        &launch,
        context(&launch),
        &mut meter(1_000),
        host.as_ref(),
        stop,
    )
    .await
    .unwrap();
    assert_eq!(outcome, Outcome::Canceled);
}
