//! The `workflow-*` tests. They mocked the Workflow agent; here the real turn runs on a scripted model,
//! so each case holds through the same code a real run goes through.
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::json;

use crate::js_json::JsValue;
use crate::runtime_errors::ControlPlaneError;
use crate::task_completion::{FINISH_MISSING_NOTE, TASK_COMPLETION_TOOL};
use crate::tool_execution::ToolExecutionResponse;
use crate::model_calls::Message;

use super::loop_tests::*;

pub(super) const FINISH_DONE: &str = r#"{"outcome":"completed","summary":"Task verified","remaining":[]}"#;

pub(super) fn finished() -> Turn {
    calling(vec![call("finish", TASK_COMPLETION_TOOL, FINISH_DONE)])
}

/// Whatever the run asks next after the script, the model answers by finishing.
pub(super) fn then_finish(harness: &Harness) {
    *harness.models.after.lock().unwrap() = Some(finished());
}

pub(super) fn field(body: &JsValue, name: &str) -> String {
    body.get(name).and_then(JsValue::as_str).unwrap_or("").to_owned()
}

// workflow-completion.test.ts

#[tokio::test]
async fn finishes_from_the_standalone_call_and_its_raw_receipt() {
    let harness = Harness::new(&plain_context("Summarize this request"));
    harness.script(vec![finished()]);
    harness.run().await.unwrap();
    assert_eq!(harness.control.nodes("running"), ["model:1"]);
    let completions = harness.control.completions();
    assert_eq!(completions.len(), 1);
    assert_eq!(field(&completions[0], "status"), "success");
    assert_eq!(field(&completions[0], "text"), "Task verified");
}

#[tokio::test(start_paused = true)]
async fn does_not_publish_success_when_a_stream_is_aborted() {
    let harness = Harness::new(&plain_context("Summarize this request"));
    harness.script(vec![Turn::Hangs]);
    let result = harness.run().await.unwrap();
    assert!(result.incomplete);
    let completions = harness.control.completions();
    assert_eq!(completions.len(), 1);
    assert_eq!(field(&completions[0], "status"), "incomplete");
    assert_eq!(field(&completions[0], "error_code"), "agent_runtime_interrupted");
}

#[tokio::test]
async fn does_not_publish_unfinished_results_as_success() {
    for reason in ["length", "content-filter", "error", "other"] {
        let harness = Harness::new(&plain_context("Summarize this request"));
        harness.script(vec![Turn::Parts(vec![finish(reason, 1, 1)])]);
        harness.run().await.unwrap();
        let completions = harness.control.completions();
        assert_eq!(field(&completions[0], "status"), "incomplete", "{reason}");
        assert_eq!(field(&completions[0], "error_code"), "agent_response_incomplete", "{reason}");
    }
}

fn keeps_calling() -> Turn {
    calling(vec![call("load", "web_fetch", r#"{"url":"file:///x"}"#)])
}

#[tokio::test]
async fn retains_the_durable_turn_limit_outcome_when_the_local_stop_fires() {
    let harness = Harness::new(&plain_context("Summarize this request"));
    *harness.models.after.lock().unwrap() = Some(calling(vec![]));
    harness.run().await.unwrap();
    assert_eq!(field(&harness.control.completions()[0], "error_code"), "agent_model_turn_limit");
    assert_eq!(harness.models.calls.lock().unwrap().len(), 20);
    let want: Vec<String> = (1..=20).map(|turn| format!("model:{turn}")).collect();
    assert_eq!(harness.control.nodes("running"), want);
}

#[tokio::test]
async fn accepts_a_normally_finished_answer() {
    let harness = Harness::new(&plain_context("Summarize this request"));
    harness.script(vec![answer("The summary.")]);
    harness.run().await.unwrap();
    assert_eq!(field(&harness.control.completions()[0], "status"), "success");
}

#[test]
fn requires_a_completed_step_even_if_a_transport_claims_stop() {
    use crate::tool_outcomes::unfinished_model_result;
    assert!(unfinished_model_result(false, 0, "stop", 20).is_some());
}

#[tokio::test]
async fn refreshes_the_active_time_deadline_after_a_six_hour_wait_and_carries_the_transcript() {
    let harness = Harness::new(&plain_context("Summarize this request"));
    *harness.gateway.catalog.lock().unwrap() = vec![tool("task.wait")];
    // The durable wait moves the clock while no model request is active.
    let clock = harness.clock.clone();
    *harness.gateway.answer.lock().unwrap() = Some(Box::new(move |_, _| {
        clock.fetch_add(6 * 60 * 60_000, Ordering::SeqCst);
        ToolExecutionResponse::result(json("{}"))
    }));
    harness.script(vec![calling(vec![call("c1", "task_wait", "{}")]), finished()]);
    harness.run().await.unwrap();
    assert_eq!(harness.control.nodes("running"), ["model:1", "model:2"]);
    let calls = harness.models.calls.lock().unwrap();
    assert!(calls[1].prompt.iter().any(|message| matches!(message, Message::Tool { .. })));
    assert_eq!(calls[1].prompt.iter().filter(|message| matches!(message, Message::System { .. })).count(), 1);
    drop(calls);
    let usage = harness.control.completions()[0].get("usage").unwrap().stringify();
    assert_eq!(usage, r#"{"inputTokens":200,"outputTokens":24,"totalTokens":224,"inputTokenDetails":{},"outputTokenDetails":{}}"#);
}

#[tokio::test]
async fn stops_before_the_next_model_when_the_control_plane_reports_exhaustion_retaining_earlier_usage() {
    let harness = Harness::new(&plain_context("Summarize this request"));
    harness.script(vec![keeps_calling()]);
    let reads = AtomicUsize::new(0);
    *harness.control.intercept.lock().unwrap() = Some(Box::new(move |action, _| {
        (action == "budget" && reads.fetch_add(1, Ordering::SeqCst) >= 1).then(|| Err(ControlPlaneError::new(422, "agent_execution_time_limit", Some("agent_execution_time_limit")).into()))
    }));
    let error = harness.run().await.err().unwrap();
    assert!(error.to_string().contains("execution-time allowance"), "{error}");
    assert_eq!(harness.models.calls.lock().unwrap().len(), 1);
    let completions = harness.control.completions();
    assert_eq!(completions.len(), 1);
    assert_eq!(field(&completions[0], "status"), "failed");
    assert_eq!(field(&completions[0], "error_code"), "agent_execution_time_limit");
    assert_eq!(completions[0].get("usage").unwrap().stringify(), r#"{"inputTokens":100,"outputTokens":12,"totalTokens":112}"#);
}

fn with_limit(limit: u32) -> String {
    json!({ "model_id": "fixture/model", "system": "", "prompt": "Summarize this request", "allowed_tools": [], "model_turn_limit": limit }).to_string()
}

#[tokio::test]
async fn completes_beyond_twenty_turns_only_with_a_larger_pinned_budget() {
    let harness = Harness::new(&with_limit(120));
    let mut turns: Vec<Turn> = (0..25).map(|_| calling(vec![])).collect();
    turns.push(finished());
    harness.script(turns);
    harness.run().await.unwrap();
    assert_eq!(harness.control.nodes("running").len(), 26);
    assert_eq!(field(&harness.control.completions()[0], "status"), "success");
}

#[tokio::test]
async fn still_stops_exactly_at_the_foreground_budget_without_claiming_success() {
    let harness = Harness::new(&with_limit(120));
    *harness.models.after.lock().unwrap() = Some(calling(vec![]));
    harness.run().await.unwrap();
    assert_eq!(harness.control.nodes("running").len(), 120);
    let completions = harness.control.completions();
    assert_eq!(field(&completions[0], "status"), "incomplete");
    assert_eq!(field(&completions[0], "error_code"), "agent_model_turn_limit");
}

#[tokio::test]
async fn continues_the_same_model_transcript_when_a_follow_up_arrives_before_completion() {
    let harness = Harness::new(&plain_context("Summarize this request"));
    harness.script(vec![finished(), finished()]);
    harness.control.steering.lock().unwrap().push_back(json(r#"{"messages":[{"sequence":7,"text":"Keep the invoices unchanged"}],"closed":false}"#));
    harness.run().await.unwrap();
    assert_eq!(harness.models.calls.lock().unwrap().len(), 2);
    assert!(harness.prompt_json(1).contains(r#"{"role":"user","content":[{"type":"text","text":"Keep the invoices unchanged"}]"#));
    assert_eq!(harness.control.completions().len(), 1);
}

// workflow-reply-and-turn-start.test.ts

const GREETING: &str = "gmorning! hope your day's off to a good start.";

#[tokio::test]
async fn treats_a_reply_that_took_no_actions_as_a_finished_answer() {
    let harness = Harness::new(&plain_context("gmorning"));
    harness.script(vec![answer(GREETING)]);
    harness.run().await.unwrap();
    let completions = harness.control.completions();
    assert_eq!(field(&completions[0], "status"), "success");
    assert_eq!(field(&completions[0], "text"), GREETING);
}

#[tokio::test]
async fn still_requires_a_confirmed_outcome_once_the_run_used_a_tool() {
    let harness = Harness::new(&plain_context("gmorning"));
    let mut parts = vec![call("read", "agent_ledger", r#"{"rows":[{"requirement":"One","state":"pending"}]}"#)];
    parts.extend(text("a", GREETING));
    parts.push(finish("stop", 10, 8));
    *harness.models.after.lock().unwrap() = Some(Turn::Parts(parts));
    harness.run().await.unwrap();
    let completions = harness.control.completions();
    assert_eq!(field(&completions[0], "status"), "incomplete");
    assert_eq!(field(&completions[0], "error_code"), "task_outcome_unreported");
}

#[tokio::test]
async fn stops_before_calling_the_model_when_the_server_refuses_the_turn_and_says_why() {
    let harness = Harness::new(&plain_context("gmorning"));
    *harness.control.intercept.lock().unwrap() = Some(Box::new(|action, body| {
        let refused = action == "events" && field(body, "node_id").starts_with("model:") && field(body, "state") == "running";
        refused.then(|| Err(ControlPlaneError::new(409, "agent_model_turn_limit: This run reached its model-turn limit.", Some("agent_model_turn_limit")).into()))
    }));
    assert!(harness.run().await.is_err());
    assert_eq!(harness.models.calls.lock().unwrap().len(), 0);
    let completions = harness.control.completions();
    assert_eq!(field(&completions[0], "status"), "failed");
    assert_eq!(field(&completions[0], "error_code"), "agent_model_turn_limit");
}

#[tokio::test]
async fn fails_the_run_when_the_turns_checkpoint_cant_be_recorded() {
    let harness = Harness::new(&plain_context("gmorning"));
    harness.script(vec![answer(GREETING)]);
    *harness.control.intercept.lock().unwrap() = Some(Box::new(|action, body| {
        let refused = action == "events" && field(body, "node_id").starts_with("model:") && field(body, "state") == "completed";
        refused.then(|| Err(ControlPlaneError::new(409, "run_state_conflict: the run changed", Some("run_state_conflict")).into()))
    }));
    assert!(harness.run().await.is_err());
    let completions = harness.control.completions();
    assert_eq!(field(&completions[0], "status"), "failed");
    assert_eq!(field(&completions[0], "text"), "");
}

// workflow-finish-once.test.ts

const ANSWER: &str = "The capital of France is Paris.";

#[tokio::test]
async fn a_text_answer_the_finish_nudge_then_the_answer_once() {
    let harness = Harness::new(&plain_context("What is the capital of France?"));
    harness.script(vec![
        calling(vec![call("look", "agent_ledger", r#"{"rows":[{"requirement":"Name it","state":"skipped","reason":"plain"}]}"#)]),
        answer(ANSWER),
        calling(vec![call("finish", TASK_COMPLETION_TOOL, r#"{"outcome":"completed","remaining":[]}"#)]),
    ]);
    harness.run().await.unwrap();
    // The nudge asks for outcome and remaining only, and the model leaves summary out.
    let asked = (0..3).any(|index| harness.prompt_json(index).contains(&serde_json::to_string(FINISH_MISSING_NOTE).unwrap()));
    assert!(asked);
    // The text answer becomes the summary, so the final text is that answer once.
    let completions = harness.control.completions();
    assert_eq!(field(&completions[0], "status"), "success");
    assert!(field(&completions[0], "text").starts_with(ANSWER));
    assert_eq!(field(&completions[0], "text").matches(ANSWER).count(), 1);
}

// workflow-batch-stop.test.ts

fn sender(harness: &Harness, output: &'static str) {
    *harness.gateway.catalog.lock().unwrap() = vec![tool("social.send_message"), tool("task.create")];
    *harness.gateway.answer.lock().unwrap() = Some(Box::new(move |_, _| ToolExecutionResponse::result(json(output))));
}

#[tokio::test]
async fn stops_a_queued_dependent_action_and_records_incomplete_work() {
    for output in [r#"{"status":"uncertain","reason":"Send response lost"}"#, r#"{"denied":true,"reason":"creator_denied"}"#, r#"{"status":"user_intervention_required","action":"sign_in"}"#] {
        let harness = Harness::new(&json!({ "model_id": "fixture/model", "system": "", "prompt": "Message then record it", "allowed_tools": ["social.send_message", "task.create"] }).to_string());
        sender(&harness, output);
        harness.script(vec![calling(vec![call("send-call", "social_send_message", "{}"), call("note-call", "task_create", "{}")])]);
        let result = harness.run().await.unwrap();
        assert!(result.incomplete, "{output}");
        let executed: Vec<String> = harness.gateway.executed.lock().unwrap().iter().map(|call| call.1.clone()).collect();
        assert_eq!(executed, ["social.send_message"], "{output}");
        let completions = harness.control.completions();
        assert_eq!(completions.len(), 1);
        assert_eq!(field(&completions[0], "status"), "incomplete");
        assert_eq!(field(&completions[0], "error_code"), "tool_sequence_stopped");
    }
}

#[tokio::test]
async fn does_not_spend_another_model_turn_after_a_single_denied_action() {
    let harness = Harness::new(&json!({ "model_id": "fixture/model", "system": "", "prompt": "Message then record it", "allowed_tools": ["social.send_message"] }).to_string());
    sender(&harness, r#"{"denied":true,"reason":"creator_denied"}"#);
    harness.script(vec![calling(vec![call("send-call", "social_send_message", "{}")])]);
    assert!(harness.run().await.unwrap().incomplete);
    assert_eq!(harness.models.calls.lock().unwrap().len(), 1);
    assert_ne!(field(&harness.control.completions()[0], "status"), "success");
}
