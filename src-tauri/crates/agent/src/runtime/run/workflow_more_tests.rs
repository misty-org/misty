//! More of the `workflow-*` tests (`workflow_tests.rs`): what a turn offers and carries.
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

use serde_json::json;

use crate::{
    runtime::{js_json::JsValue, model_tools::McpRemoteTool, task_completion::TASK_COMPLETION_TOOL, tool_execution::ToolExecutionResponse},
    sdk::Message,
};

use super::{
    loop_tests::*,
    workflow_tests::{field, finished, then_finish},
};

// workflow-browser-reinspection.test.ts

#[tokio::test]
async fn requires_a_new_inspection_turn_and_then_permits_a_freshly_planned_browser_action() {
    let harness = Harness::new(&json!({ "model_id": "fixture/model", "system": "", "prompt": "Click the inspected target", "allowed_tools": ["browser.upload", "browser.inspect"] }).to_string());
    *harness.gateway.catalog.lock().unwrap() = vec![tool("browser.upload"), tool("browser.inspect")];
    let actions = AtomicUsize::new(0);
    *harness.gateway.answer.lock().unwrap() = Some(Box::new(move |_, _| {
        let first = actions.fetch_add(1, Ordering::SeqCst) == 0;
        ToolExecutionResponse::result(json(if first { r#"{"status":"failure","reason":"browser_snapshot_stale","attempted":false}"# } else { r#"{"ok":true}"# }))
    }));
    harness.script(vec![
        calling(vec![call("call-0", "browser_upload", r#"{"elementRef":"ref-0"}"#)]),
        calling(vec![call("call-1", "browser_inspect", r#"{"elementRef":"ref-1"}"#)]),
        calling(vec![call("call-2", "browser_upload", r#"{"elementRef":"ref-2"}"#)]),
        finished(),
    ]);
    harness.run().await.unwrap();
    let executed: Vec<String> = harness.gateway.executed.lock().unwrap().iter().map(|call| call.1.clone()).collect();
    assert_eq!(executed, ["browser.upload", "browser.inspect", "browser.upload"]);
    let mut second = harness.tool_names(1);
    second.sort();
    assert_eq!(second, ["agent_finish", "browser_inspect"]);
    assert!(harness.tool_names(2).len() > 2);
    assert_eq!(field(&harness.control.completions()[0], "status"), "success");
}

// workflow-compaction.test.ts

fn compaction_context() -> String {
    json!({ "model_id": "fixture/model", "system": "", "prompt": "Read every page", "allowed_tools": ["browser.read"], "context_window_tokens": 100_000, "model_turn_limit": 12 }).to_string()
}

fn read_pages(harness: &Harness, input_tokens: u64) {
    *harness.gateway.catalog.lock().unwrap() = vec![McpRemoteTool { read_only: true, ..tool("browser.read") }];
    let page = "page text ".repeat(200);
    *harness.gateway.answer.lock().unwrap() = Some(Box::new(move |_, _| ToolExecutionResponse::result(JsValue::String(page.clone()))));
    let mut turns: Vec<Turn> = (1..8)
        .map(|turn| {
            Turn::Parts(vec![call(&format!("c{turn}"), "browser_read", &format!(r#"{{"n":{turn}}}"#)), finish("tool-calls", input_tokens, 1)])
        })
        .collect();
    let mut last = text("a", "All pages read.");
    last.push(finish("stop", input_tokens, 1));
    let last = Turn::Parts(last);
    turns.push(last.clone());
    *harness.models.after.lock().unwrap() = Some(last);
    harness.script(turns);
}

#[tokio::test]
async fn leaves_a_run_alone_while_it_fits_comfortably_in_the_window() {
    let harness = Harness::new(&compaction_context());
    read_pages(&harness, 20_000);
    harness.run().await.unwrap();
    assert!(harness.access.calls.lock().unwrap().is_empty());
    let count = harness.models.calls.lock().unwrap().len();
    assert!(!harness.prompt_json(count - 1).contains("Earlier result cleared"));
}

#[tokio::test]
async fn clears_old_results_then_summarizes_older_steps_once_the_model_reports_a_nearly_full_window() {
    let mut harness = Harness::new(&compaction_context());
    harness.access = Arc::new(crate::runtime::model_access::fixtures::FakeModel::answering("Done so far: read the first pages."));
    read_pages(&harness, 85_000);
    harness.run().await.unwrap();
    assert!(!harness.access.calls.lock().unwrap().is_empty());
    let node = harness.control.calls.lock().unwrap().iter().any(|(_, body, _)| field(body, "node_id") == "model:compact:1");
    assert!(node);
    let calls = harness.models.calls.lock().unwrap();
    let after = calls.last().unwrap();
    let first = serde_json::to_string(&after.prompt[1]).unwrap();
    assert!(first.contains("Read every page"));
    assert!(first.contains("Done so far: read the first pages."));
    // Every kept tool result still follows the call it answers.
    let mut calls_seen = Vec::new();
    for message in &after.prompt {
        match message {
            Message::Assistant { content, .. } => {
                for part in content {
                    if let crate::sdk::AssistantPart::ToolCall { tool_call_id, .. } = part {
                        calls_seen.push(tool_call_id.clone());
                    }
                }
            }
            Message::Tool { content, .. } => assert!(content.iter().all(|part| calls_seen.contains(&part.tool_call_id))),
            _ => {}
        }
    }
    // Without compaction the last call would carry all 15 messages, plus the system text.
    assert!(after.prompt.len() <= 9, "{}", after.prompt.len());
}

// workflow-verify-once.test.ts

const PARTIAL: &str = r#"{"outcome":"partial","summary":"Palace's Winter drop began October 4. A Jordan 11 Low is listed for October 23, but I couldn't confirm the date.","remaining":[{"requirement":"Confirm the Jordan 11 Low release date","reason":"the article doesn't give it"}]}"#;

fn looks_then_partial(harness: &Harness, rounds: usize) {
    let mut turns = Vec::new();
    for turn in 0..rounds {
        turns.push(calling(vec![call(&format!("look-{turn}"), "agent_ledger", r#"{"rows":[{"requirement":"Look","state":"pending"}]}"#)]));
        turns.push(calling(vec![call(&format!("finish-{turn}"), TASK_COMPLETION_TOOL, PARTIAL)]));
    }
    harness.script(turns);
}

#[tokio::test]
async fn a_short_questions_honest_partial_answer_stands_the_first_time() {
    let harness = Harness::new(&plain_context("What's dropping in streetwear this week?"));
    looks_then_partial(&harness, 1);
    harness.run().await.unwrap();
    assert_eq!(field(&harness.control.completions()[0], "error_code"), "task_incomplete");
}

#[tokio::test]
async fn a_long_requests_give_up_goes_back_and_a_next_finish_that_found_nothing_new_stands() {
    let prompt = format!("Find every streetwear release this week. {}", "For each one give the brand, item, price, date and the store, with a link to the page you read. ".repeat(4));
    let harness = Harness::new(&plain_context(&prompt));
    looks_then_partial(&harness, 2);
    harness.run().await.unwrap();
    let count = harness.models.calls.lock().unwrap().len();
    let results: Vec<String> = (0..count).map(|index| harness.prompt_json(index)).collect();
    let went_back = results.iter().any(|prompt| prompt.contains("Confirm the Jordan 11 Low release date") && prompt.contains("Keep working on the open parts"));
    assert!(went_back);
    assert_eq!(field(&harness.control.completions()[0], "error_code"), "task_incomplete");
}

// workflow-visual-transcript.test.ts

#[tokio::test]
async fn preserves_a_visual_tool_image_when_the_next_model_turn_starts() {
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOZkAAAAASUVORK5CYII=";
    let harness = Harness::new(&json!({ "model_id": "fixture/model", "system": "", "prompt": "Inspect the screenshot", "allowed_tools": ["browser.visual"] }).to_string());
    *harness.gateway.catalog.lock().unwrap() = vec![McpRemoteTool { read_only: true, ..tool("browser.visual") }];
    let output = format!(r#"{{"documentId":"visual-document","image":{{"dataUrl":"data:image/png;base64,{png}"}}}}"#);
    *harness.gateway.answer.lock().unwrap() = Some(Box::new(move |_, _| ToolExecutionResponse::result(json(&output))));
    harness.script(vec![calling(vec![call("visual-1", "browser_visual", "{}")])]);
    then_finish(&harness);
    harness.run().await.unwrap();
    let second = harness.prompt_json(1);
    assert!(second.contains(&format!(r#"{{"type":"file","data":{{"type":"data","data":"{png}"}},"mediaType":"image/png"}}"#)), "{second}");
}

// workflow-adapter-deadline.test.ts

#[tokio::test]
async fn returns_after_one_tool_turn_and_accepts_its_full_transcript_after_a_long_wait() {
    let harness = Harness::new(&plain_context("Read my note"));
    *harness.gateway.catalog.lock().unwrap() = vec![tool("task.read")];
    let clock = harness.clock.clone();
    *harness.gateway.answer.lock().unwrap() = Some(Box::new(move |_, _| {
        clock.fetch_add(6 * 60 * 60_000, Ordering::SeqCst);
        ToolExecutionResponse::result(json(r#"{"text":"walked"}"#))
    }));
    harness.script(vec![calling(vec![call("read-1", "task_read", "{}")])]);
    then_finish(&harness);
    harness.run().await.unwrap();
    assert_eq!(harness.models.calls.lock().unwrap().len(), 2);
    assert!(harness.prompt_json(1).contains("walked"));
    assert_eq!(harness.models.calls.lock().unwrap()[1].prompt.iter().filter(|message| matches!(message, Message::System { .. })).count(), 1);
}

#[tokio::test(start_paused = true)]
async fn interrupts_an_in_flight_model_stream_at_its_operation_deadline() {
    let harness = Harness::new(&plain_context("Wait indefinitely"));
    *harness.control.budget_ms.lock().unwrap() = 50;
    harness.script(vec![Turn::Hangs]);
    let result = harness.run().await.unwrap();
    assert!(result.incomplete);
    assert_eq!(harness.models.calls.lock().unwrap().len(), 1);
    assert_eq!(result.steps, 0);
    assert_eq!(field(&harness.control.completions()[0], "error_code"), "agent_runtime_interrupted");
}

#[tokio::test]
async fn serializes_actual_tool_execution_through_its_lifecycle_hooks() {
    let harness = Harness::new(&json!({ "model_id": "fixture/model", "system": "", "prompt": "Read two notes", "allowed_tools": ["task.write"] }).to_string());
    *harness.gateway.catalog.lock().unwrap() = vec![tool("task.write")];
    let events = Arc::new(Mutex::new(Vec::new()));
    let log = events.clone();
    *harness.gateway.answer.lock().unwrap() = Some(Box::new(move |id, _| {
        log.lock().unwrap().push(id.to_owned());
        ToolExecutionResponse::result(json("{}"))
    }));
    harness.script(vec![calling(vec![call("first", "task_write", r#"{"id":"first"}"#), call("second", "task_write", r#"{"id":"second"}"#)])]);
    then_finish(&harness);
    harness.run().await.unwrap();
    assert_eq!(*events.lock().unwrap(), ["first", "second"]);
}

// Invalid input reaches neither the tool nor the server.

#[tokio::test]
async fn an_invalid_call_runs_nothing_and_the_model_reads_why() {
    let schema = r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","format":"uuid"},"date":{"type":"string","format":"date"}},"required":["id","date"],"additionalProperties":false}"#;
    let harness = Harness::new(&json!({ "model_id": "fixture/model", "system": "", "prompt": "Validate a controlled test action", "allowed_tools": ["verified.action"] }).to_string());
    let mut verified = tool("verified.action");
    verified.input_schema = crate::sdk::RawJson::from_text(schema.to_owned()).unwrap();
    *harness.gateway.catalog.lock().unwrap() = vec![verified];
    *harness.gateway.answer.lock().unwrap() = Some(Box::new(|_, _| ToolExecutionResponse::result(json(r#"{"verified":true}"#))));
    harness.script(vec![
        calling(vec![call("a", "verified_action", r#"{"id":"not-a-uuid","date":"2026-09-08"}"#)]),
        calling(vec![call("b", "verified_action", r#"{"id":"10000000-0000-4000-8000-000000000001","date":"2026-09-08"}"#)]),
    ]);
    then_finish(&harness);
    harness.run().await.unwrap();
    let executed: Vec<String> = harness.gateway.executed.lock().unwrap().iter().map(|call| call.0.clone()).collect();
    assert_eq!(executed, ["b"]);
    assert!(harness.prompt_json(1).contains("data/id must match format"));
}
