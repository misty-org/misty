use super::*;
use serde_json::json;

#[test]
fn parse_tool_args_value_drops_empty_and_parses_strings() {
    assert_eq!(parse_tool_args_value(&Value::Null), None);
    assert_eq!(parse_tool_args_value(&json!({})), None);
    assert_eq!(parse_tool_args_value(&json!([])), None);
    assert_eq!(
        parse_tool_args_value(&json!("{\"path\":\"a.ts\"}")),
        Some(json!({"path": "a.ts"}))
    );
    assert_eq!(
        parse_tool_args_value(&json!({"file_path": "a.ts"})),
        Some(json!({"file_path": "a.ts"}))
    );
    assert_eq!(
        parse_tool_args_value(&json!("plain command")),
        Some(json!("plain command"))
    );
}

#[test]
fn tool_call_message_extracts_path_and_marks_patch() {
    match tool_call_message("Read", Some(&json!({"file_path": "src/a.ts"}))) {
        EngineEvent::Message {
            path, args, patch, ..
        } => {
            assert_eq!(path.as_deref(), Some("src/a.ts"));
            assert_eq!(args, Some(json!({"file_path": "src/a.ts"})));
            assert!(!patch);
        }
        _ => panic!("expected tool message"),
    }
    match tool_call_patch_with_id("Read", Some(&json!({"file_path": "src/a.ts"})), None) {
        EngineEvent::Message { patch, .. } => assert!(patch),
        _ => panic!("expected patch"),
    }
}

/// Claude's TaskCreate answers with the id the CLI assigned; the call's
/// args carry no id, so this result is the only place the id exists.
#[test]
fn created_task_result_carries_the_id_task_update_addresses() {
    // Live wire shape: the structured object the CLI streams back.
    let payload = parse_todo_result(
        "TaskCreate",
        &json!({
            "task": {"id": "1", "subject": "编写 bili_app.py 网页版"}
        }),
    )
    .expect("create envelope is a todo fact");
    assert!(!payload.replace);
    assert_eq!(payload.items.len(), 1);
    assert_eq!(payload.items[0].id.as_deref(), Some("1"));
    assert_eq!(payload.items[0].content, "编写 bili_app.py 网页版");
    assert_eq!(payload.items[0].status, "pending");

    // Transcript shape: the same fact as the CLI's own result line.
    let payload = parse_todo_result(
        "TaskCreate",
        &json!("Task #12 created successfully: 樱花\"整季选集\"批量下载设计"),
    )
    .expect("result line is a todo fact");
    assert_eq!(payload.items[0].id.as_deref(), Some("12"));
    assert_eq!(payload.items[0].content, "樱花\"整季选集\"批量下载设计");
}

/// Updates and unrelated tool output must not be mistaken for creations:
/// a phantom "pending" row per update would inflate the task count.
#[test]
fn non_create_results_are_not_todos() {
    assert!(parse_todo_result(
        "TaskUpdate",
        &json!({
            "success": true,
            "taskId": "13",
            "statusChange": {"from": "pending", "to": "in_progress"}
        })
    )
    .is_none());
    assert!(parse_todo_result("TaskUpdate", &json!("Updated task #13 status")).is_none());
    assert!(parse_todo_result(
        "TaskCreate",
        &json!({"stdout": "Task #1 created successfully: x"})
    )
    .is_none());
    assert!(parse_todo_result(
        "TaskCreate",
        &json!("Task #1 created successfully: x\nextra line")
    )
    .is_none());
}

/// TaskGet answers with the same `{task:{id,subject}}` envelope as
/// TaskCreate (plus the task's status), and its args are a bare `taskId`.
/// Reading a task changes nothing, so neither half may become a todo
/// patch: as a "creation" it forced the task back to pending.
#[test]
fn task_get_is_not_a_todo_fact() {
    let envelope = json!({
        "task": {"id": "1", "subject": "A", "description": "",
                 "status": "completed", "blocks": [], "blockedBy": []}
    });
    assert!(parse_todo_result("TaskGet", &envelope).is_none());
    assert!(parse_todo_args(&json!({"taskId": "1"})).is_none());
    // Only TaskCreate's answer is a creation, whatever text another tool
    // happens to print.
    assert!(parse_todo_result("Bash", &json!("Task #1 created successfully: x")).is_none());
    assert!(parse_todo_result("", &json!({"task": {"id": "1", "subject": "A"}})).is_none());
}

/// A TaskUpdate that does not name a status leaves the status alone:
/// renames and description edits patch only what they carry, and
/// owner/dependency-only updates have nothing the list shows.
#[test]
fn status_less_task_update_keeps_the_status() {
    assert!(parse_todo_args(&json!({"taskId": "3", "addBlockedBy": ["1"]})).is_none());
    assert!(parse_todo_args(&json!({"taskId": "3", "owner": "researcher"})).is_none());

    let rename =
        parse_todo_args(&json!({"taskId": "12", "subject": "新标题"})).expect("rename patch");
    assert_eq!(rename.items[0].id.as_deref(), Some("12"));
    assert_eq!(rename.items[0].content, "新标题");
    let wire = serde_json::to_value(&rename).unwrap();
    assert!(
        wire["items"][0].get("status").is_none(),
        "unchanged status stays off the wire: {wire}"
    );

    let done =
        parse_todo_args(&json!({"taskId": "12", "status": "completed"})).expect("status patch");
    assert_eq!(done.items[0].status, "complete");
    let wire = serde_json::to_value(&done).unwrap();
    assert_eq!(wire["items"][0]["status"], "complete");
}

/// omp still owns the `details.phases` shape; the created-task branch must
/// not swallow it.
#[test]
fn phases_snapshot_still_wins_over_the_create_envelope() {
    let payload = parse_todo_result("todo", &json!({
        "details": {"phases": [{"name": "P1", "tasks": [{"content": "Task 1", "status": "completed"}]}]}
    }))
    .expect("phases payload");
    assert!(payload.replace);
    assert_eq!(payload.items[0].status, "complete");
}
