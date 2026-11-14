//! Antigravity's sub-agents, from agy 1.5.9's own `invoke_subagent` call, sub-agent record and
//! sub-agent transcript.
use super::*;

const CHILD: &str = "4985418f-d540-4477-992a-5617b7ae6a52";

/// The `tool_call` update agy sends for `/teamwork reply with just: hi`.
fn invoke(id: &str) -> Value {
    json!({
        "sessionId": "cd973451-2b50-4748-a026-905672cf6cc9",
        "update": {
            "sessionUpdate": "tool_call", "toolCallId": id, "name": "invoke_subagent",
            "status": "in_progress", "kind": "other", "title": "Run invoke_subagent",
            "rawInput": {
                "Prompt": "reply with just: hi", "Role": "Teamwork Coordinator",
                "TypeName": "teamwork",
            },
        },
    })
}

fn record(brain: &std::path::Path, parent: &str, child: &str, step: i64) {
    let folder = brain.join(parent).join(".system_generated/subagents");
    std::fs::create_dir_all(&folder).unwrap();
    let record = json!({
        "conversationId": child,
        "subagentDescriptor": { "typeName": "teamwork", "role": "Teamwork Coordinator" },
        "state": "SUBAGENT_STATE_ALIVE", "spawnStepIndex": step,
    });
    std::fs::write(folder.join(format!("{child}.json")), record.to_string()).unwrap();
}

fn append(brain: &std::path::Path, child: &str, text: &str) {
    use std::io::Write;
    let folder = brain.join(child).join(".system_generated/logs");
    std::fs::create_dir_all(&folder).unwrap();
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(folder.join("transcript.jsonl"))
        .unwrap();
    file.write_all(text.as_bytes()).unwrap();
}

const SPAWNED: &str = r#"{"step_index":0,"source":"SYSTEM","type":"SYSTEM_MESSAGE","status":"DONE","content":"[Message] content=reply with just: hi"}
{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","tool_calls":[{"name":"run_command","args":{"CommandLine":"\"ls -la ..\"","WaitMsBeforeAsync":"5000","toolSummary":"\"Check directory contents\""}}],"content":null}
"#;
const REFUSED: &str = r#"{"step_index":2,"source":"MODEL","type":"GENERIC","status":"ERROR","error":"permission check failed for unsandboxed \"ls -la ..\"","content":"Created At: 2026-11-13T23:38:25-08:00\nCompleted At: 2026-11-13T23:38:25-08:00\nEncountered error"}"#;

/// (kind, tool call id, parent) of each event, to read the order off.
fn shape(events: &[EngineEvent]) -> Vec<String> {
    events
        .iter()
        .map(|event| match event {
            EngineEvent::Scope { parent } => format!("scope {}", parent.as_deref().unwrap_or("-")),
            EngineEvent::Message {
                text,
                patch,
                tool_call_id,
                ..
            } => format!(
                "{} {text} {}",
                if *patch { "result" } else { "call" },
                tool_call_id.as_deref().unwrap_or("-"),
            ),
            other => format!("{other:?}"),
        })
        .collect()
}

#[test]
fn an_invoke_subagent_call_is_named_like_a_task() {
    let dir = tempfile::tempdir().unwrap();
    let mut subagents = Subagents::in_brain(dir.path().to_path_buf(), "parent");
    let named = subagents.update(&invoke("call_1")).expect("renamed");
    let input = &named["update"]["rawInput"];
    assert_eq!(input["description"], "Teamwork Coordinator");
    assert_eq!(input["prompt"], "reply with just: hi");
    assert_eq!(input["subagent_type"], "teamwork");
    assert_eq!(
        input["Prompt"], "reply with just: hi",
        "agy's own keys stay"
    );
    let other = json!({ "update": { "sessionUpdate": "tool_call", "toolCallId": "call_2",
        "name": "write_file", "rawInput": { "Path": "/ws/a" } } });
    assert!(subagents.update(&other).is_none());
    assert_eq!(subagents.rows, ["call_1"]);
}

#[test]
fn a_sub_agents_steps_nest_under_its_call_as_its_transcript_grows() {
    let dir = tempfile::tempdir().unwrap();
    let brain = dir.path();
    // A sub-agent an earlier turn started is left alone.
    record(brain, "parent", "earlier", 1);
    append(brain, "earlier", SPAWNED);
    let mut subagents = Subagents::in_brain(brain.to_path_buf(), "parent");
    assert!(subagents.poll(true).is_empty(), "nothing started yet");

    subagents.update(&invoke("call_1"));
    record(brain, "parent", CHILD, 2);
    // Its result line is still being written.
    append(brain, CHILD, &format!("{SPAWNED}{}", &REFUSED[..40]));
    assert_eq!(
        shape(&subagents.poll(true)),
        [
            "scope call_1".to_string(),
            format!("call run_command {CHILD}:1:0"),
            "scope -".to_string(),
        ]
    );
    append(brain, CHILD, &format!("{}\n", &REFUSED[40..]));
    let events = subagents.poll(true);
    assert_eq!(
        shape(&events),
        [
            "scope call_1".to_string(),
            format!("result run_command {CHILD}:1:0"),
            "scope -".to_string(),
        ]
    );
    let EngineEvent::Message { result, .. } = &events[1] else {
        panic!("a result");
    };
    let result = result.as_ref().unwrap();
    assert_eq!(result["isError"], true);
    assert!(result["content"]
        .as_str()
        .unwrap()
        .starts_with("permission check failed"));
    assert!(subagents.poll(true).is_empty(), "nothing new");
}

#[test]
fn the_calls_arguments_are_decoded_and_the_output_loses_its_timestamps() {
    let dir = tempfile::tempdir().unwrap();
    let brain = dir.path();
    let mut subagents = Subagents::in_brain(brain.to_path_buf(), "parent");
    subagents.update(&invoke("call_1"));
    record(brain, "parent", CHILD, 2);
    let done = r#"{"step_index":2,"type":"GENERIC","status":"DONE","content":"Created At: x\nCompleted At: y\na.txt\n"}"#;
    append(brain, CHILD, &format!("{SPAWNED}{done}\n"));
    let events = subagents.poll(true);
    let EngineEvent::Message { args, .. } = &events[1] else {
        panic!("a call");
    };
    assert_eq!(args.as_ref().unwrap()["CommandLine"], "ls -la ..");
    let EngineEvent::Message { result, .. } = &events[2] else {
        panic!("a result");
    };
    assert_eq!(result.as_ref().unwrap(), &json!("a.txt\n"));
}

#[test]
fn sub_agents_of_one_call_share_its_row_and_wait_for_theirs() {
    let dir = tempfile::tempdir().unwrap();
    let brain = dir.path();
    let mut subagents = Subagents::in_brain(brain.to_path_buf(), "parent");
    // Recorded before its call's update arrived: it waits for the row.
    record(brain, "parent", "a", 4);
    record(brain, "parent", "b", 4);
    append(brain, "a", SPAWNED);
    append(brain, "b", SPAWNED);
    assert!(subagents.poll(true).is_empty());
    subagents.update(&invoke("call_9"));
    let shown = shape(&subagents.poll(true));
    assert_eq!(
        shown,
        [
            "scope call_9",
            "call run_command a:1:0",
            "scope -",
            "scope call_9",
            "call run_command b:1:0",
            "scope -",
        ]
    );
}

#[test]
fn a_sub_agent_that_sent_its_message_has_reported_back() {
    let dir = tempfile::tempdir().unwrap();
    let brain = dir.path();
    let mut subagents = Subagents::in_brain(brain.to_path_buf(), "parent");
    assert!(!subagents.started_any());
    subagents.update(&invoke("call_1"));
    assert!(subagents.started_any());
    assert_eq!(subagents.quiet_after(), QUIET_WORKING, "no sub-agent yet");
    record(brain, "parent", CHILD, 2);
    // agy 1.5.9's teamwork sub-agent answering `/teamwork reply with just: hi`.
    let sent = r#"{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","tool_calls":[{"name":"send_message","args":{"Message":"\"hi\"","Recipient":"\"d2630c75-df0b-4bf3-b9c0-92278a0fbdb4\""}}]}
"#;
    append(brain, CHILD, sent);
    subagents.poll(true);
    assert_eq!(subagents.quiet_after(), QUIET_WORKING, "still sending");
    let done = r#"{"step_index":2,"source":"MODEL","type":"GENERIC","status":"DONE","content":"Created At: 2026-11-14T01:14:09-08:00\nCompleted At: 2026-11-14T01:14:09-08:00\nMessage sent to \"d2630c75-df0b-4bf3-b9c0-92278a0fbdb4\"."}
{"step_index":3,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","content":"hi"}
"#;
    append(brain, CHILD, done);
    let events = subagents.poll(true);
    let EngineEvent::Message { result, .. } = &events[1] else {
        panic!("the message's result");
    };
    assert_eq!(
        result.as_ref().unwrap(),
        &json!("Message sent to \"d2630c75-df0b-4bf3-b9c0-92278a0fbdb4\".")
    );
    assert_eq!(subagents.quiet_after(), QUIET_REPORTED);
}
