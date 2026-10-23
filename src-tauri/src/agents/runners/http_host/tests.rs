use std::path::PathBuf;

use serde_json::{json, Value};

use super::{
    super::{events::ActionKind, events::RunnerEvent, Launch, LaunchMode},
    dsh::DshProtocol,
    opencode::OpencodeProtocol,
    HostCall, HostedProtocol,
};

pub(super) fn launch(mode: LaunchMode, grants: &[&str]) -> Launch {
    Launch {
        project_root: PathBuf::from("/work/app"),
        task: "Fix the bug".into(),
        mode,
        model: None,
        session: None,
        grants: grants.iter().map(|grant| grant.to_string()).collect(),
    }
}

fn body_of(call: &HostCall) -> (String, Value) {
    match call {
        HostCall::Post { path, body, .. } => (path.clone(), body.clone()),
        HostCall::OpenStream { path, .. } => (path.clone(), Value::Null),
    }
}

fn opencode_event(kind: &str, properties: Value) -> Value {
    json!({ "type": kind, "properties": properties })
}

#[test]
fn opencode_runs_a_turn_and_asks_before_installing() {
    let mut protocol = OpencodeProtocol::new(&launch(LaunchMode::Plan, &[]));
    let start = protocol.start();
    assert_eq!(body_of(&start[0]).0, "/session?directory=%2Fwork%2Fapp");
    let step = protocol.on_response("session", 200, json!({ "id": "ses_1" }));
    assert_eq!(
        step.events,
        vec![RunnerEvent::Session { id: "ses_1".into() }]
    );
    assert!(
        matches!(&step.calls[0], HostCall::OpenStream { path, .. } if path.starts_with("/event?"))
    );
    let (path, prompt) = body_of(&step.calls[1]);
    assert!(path.starts_with("/session/ses_1/prompt_async"));
    assert_eq!(
        prompt["agent"], "plan",
        "plan launches use OpenCode's plan agent"
    );

    let mine = |properties: Value| {
        let mut properties = properties;
        properties["sessionID"] = json!("ses_1");
        properties
    };
    // Idle before the prompt is picked up isn't the end of the turn.
    assert!(protocol
        .on_message(opencode_event(
            "session.status",
            mine(json!({ "status": { "type": "idle" } }))
        ))
        .events
        .is_empty());
    protocol.on_message(opencode_event(
        "session.status",
        mine(json!({ "status": { "type": "busy" } })),
    ));
    protocol.on_message(opencode_event(
        "message.part.updated",
        json!({ "part": { "id": "p1", "type": "reasoning", "sessionID": "ses_1" } }),
    ));
    let thinking = protocol.on_message(opencode_event(
        "message.part.delta",
        mine(json!({ "partID": "p1", "delta": "Hmm" })),
    ));
    assert_eq!(
        thinking.events,
        vec![RunnerEvent::Thinking { text: "Hmm".into() }]
    );
    let text = protocol.on_message(opencode_event(
        "message.part.delta",
        mine(json!({ "partID": "p2", "delta": "Done." })),
    ));
    assert_eq!(
        text.events,
        vec![RunnerEvent::Delta {
            text: "Done.".into()
        }]
    );
    let other = opencode_event(
        "message.part.delta",
        json!({ "sessionID": "ses_2", "partID": "p2", "delta": "x" }),
    );
    assert!(
        protocol.on_message(other).events.is_empty(),
        "other sessions are ignored"
    );

    let ask = protocol.on_message(opencode_event(
        "permission.asked",
        mine(json!({ "id": "per_1", "permission": "bash", "patterns": ["npm install left-pad"] })),
    ));
    let RunnerEvent::PermissionRequest(request) = &ask.events[0] else {
        panic!("{ask:?}")
    };
    assert_eq!(
        (request.kind, request.command.as_deref()),
        (ActionKind::Install, Some("npm install left-pad"))
    );
    let (path, reply) = body_of(&protocol.answer(request, false, "Not now.")[0]);
    assert!(path.starts_with("/permission/per_1/reply"));
    assert_eq!(reply, json!({ "reply": "reject", "message": "Not now." }));
    assert_eq!(
        body_of(&protocol.answer(request, true, "")[0]).1,
        json!({ "reply": "once" })
    );

    let info = json!({ "id": "m1", "role": "assistant", "sessionID": "ses_1", "modelID": "m", "time": { "completed": 5 },
        "tokens": { "input": 10, "output": 4, "reasoning": 1, "cache": { "read": 3, "write": 2 } } });
    let usage = protocol.on_message(opencode_event(
        "message.updated",
        json!({ "info": info.clone() }),
    ));
    let RunnerEvent::Usage(usage) = &usage.events[0] else {
        panic!()
    };
    assert_eq!(
        (
            usage.input,
            usage.output,
            usage.cache_read,
            usage.cache_write
        ),
        (10, 5, 3, 2)
    );
    assert!(
        protocol
            .on_message(opencode_event("message.updated", json!({ "info": info })))
            .events
            .is_empty(),
        "usage counts once"
    );
    let done = protocol.on_message(opencode_event(
        "session.status",
        mine(json!({ "status": { "type": "idle" } })),
    ));
    assert!(matches!(done.events[..], [RunnerEvent::Done { .. }]));
    assert!(body_of(&protocol.cancel()[0])
        .0
        .starts_with("/session/ses_1/abort"));
}

fn item(stream: &str, value: Value) -> Value {
    json!({ "type": "item", "streamId": stream, "value": value })
}

#[test]
fn deepseek_shell_prompts_once_both_streams_are_open() {
    let mut protocol = DshProtocol::new(&launch(LaunchMode::AutoEdit, &[]));
    assert_eq!(body_of(&protocol.start()[0]).0, "/api/workspace/create");
    let ok = |value: Value| json!({ "type": "server-response", "result": { "ok": true, "value": value } });
    let session = protocol.on_response("workspace", 200, ok(json!({ "workspaceId": "w1" })));
    assert_eq!(
        body_of(&session.calls[0]).1["payload"]["args"]["request"]["workspaceId"],
        "w1"
    );
    let open = protocol.on_response("session", 200, ok(json!({ "sessionId": "s1" })));
    assert_eq!(open.events, vec![RunnerEvent::Session { id: "s1".into() }]);
    assert!(matches!(&open.calls[0], HostCall::OpenStream { frames, .. } if frames.len() == 2));
    assert!(protocol
        .on_message(item("events", json!({ "type": "ready", "clientId": "c1" })))
        .calls
        .is_empty());
    let prompt = protocol.on_message(item("follow", json!({ "type": "snapshot" })));
    assert_eq!(body_of(&prompt.calls[0]).0, "/api/session/prompt");
    assert!(
        protocol
            .on_message(item("follow", json!({ "type": "snapshot" })))
            .calls
            .is_empty(),
        "the prompt goes once"
    );

    let ask = protocol.on_message(item(
        "events",
        json!({ "type": "waterfall", "event": "approval/request", "eventId": "e1",
        "request": { "tool": "shell", "command": "git push origin main" } }),
    ));
    let RunnerEvent::PermissionRequest(request) = &ask.events[0] else {
        panic!("{ask:?}")
    };
    assert_eq!(request.kind, ActionKind::Push);
    let (path, answer) = body_of(&protocol.answer(request, true, "")[0]);
    assert_eq!(path, "/api/$events/result");
    assert_eq!(
        answer["payload"]["args"]["outcome"],
        json!({ "kind": "result", "value": "allowed-once" })
    );
    let denied = body_of(&protocol.answer(request, false, "No.")[0]).1;
    assert_eq!(denied["payload"]["args"]["outcome"]["kind"], "rejected");
    let question = protocol.on_message(item(
        "events",
        json!({ "type": "waterfall", "event": "user-questions/request", "eventId": "e2" }),
    ));
    assert_eq!(
        body_of(&question.calls[0]).1["payload"]["args"]["outcome"]["kind"],
        "rejected"
    );

    let chunk = |chunk: Value| {
        item(
            "follow",
            json!({ "type": "assistant-stream", "frame": { "type": "chunk", "chunk": chunk } }),
        )
    };
    assert_eq!(
        protocol
            .on_message(chunk(json!({ "type": "text-delta", "text": "Hi" })))
            .events,
        vec![RunnerEvent::Delta { text: "Hi".into() }]
    );
    let usage = protocol.on_message(chunk(json!({ "type": "usage", "usage": { "inputTokens": 7, "outputTokens": 3, "cachedInputTokens": 2 } })));
    assert!(
        matches!(&usage.events[0], RunnerEvent::Usage(usage) if usage.input == 7 && usage.output == 3 && usage.cache_read == 2)
    );
    let end = protocol.on_message(item("follow", json!({ "type": "event", "event": { "type": "turn/end", "data": { "reason": { "kind": "completed" } } } })));
    assert!(matches!(end.events[..], [RunnerEvent::Done { .. }]));
    assert!(
        protocol
            .on_response("prompt", 500, Value::Null)
            .events
            .len()
            == 1
    );
}
