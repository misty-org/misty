//! Plays the script `test/run-parity.record.test.ts` recorded against the real TypeScript loop, and
//! compares what the model is sent, turn by turn, with what the loop recorded there.
use serde_json::Value;

use crate::js_json::JsValue;
use crate::model_tools::CatalogTool;
use crate::tool_execution::ToolExecutionResponse;
use crate::model_calls::{AssistantPart, Message, StreamPart};

use super::loop_tests::{finish, Harness, Turn};

fn fixture_text() -> String {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/run_parity/scripted_run.json");
    std::fs::read_to_string(path).unwrap()
}

fn fixture() -> Value {
    serde_json::from_str(&fixture_text()).unwrap()
}

/// The catalog with its schemas' key order as recorded.
fn catalog() -> Vec<CatalogTool> {
    let whole = JsValue::parse(&fixture_text()).unwrap();
    serde_json::from_str(&whole.get("case").unwrap().get("catalog").unwrap().stringify()).unwrap()
}

fn turns(case: &Value) -> Vec<Turn> {
    case["turns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|turn| {
            let mut parts = Vec::new();
            for (index, part) in turn["parts"].as_array().unwrap().iter().enumerate() {
                if part["type"] == "text" {
                    parts.extend(super::loop_tests::text(&format!("t{index}"), part["text"].as_str().unwrap()));
                } else {
                    parts.push(StreamPart::ToolCall {
                        tool_call_id: part["toolCallId"].as_str().unwrap().to_owned(),
                        tool_name: part["toolName"].as_str().unwrap().to_owned(),
                        input: part["input"].as_str().unwrap().to_owned(),
                        provider_metadata: part.get("providerMetadata").cloned(),
                    });
                }
            }
            parts.push(finish(turn["finishReason"].as_str().unwrap(), turn["inputTokens"].as_u64().unwrap(), 5));
            Turn::Parts(parts)
        })
        .collect()
}

fn harness(case: &Value) -> Harness {
    let context = serde_json::json!({ "model_id": case["modelId"], "system": case["system"], "prompt": case["prompt"], "allowed_tools": ["note.read", "note.create", "browser.visual"], "model_turn_limit": case["turnLimit"] });
    let harness = Harness::new(&context.to_string());
    let whole = JsValue::parse(&fixture_text()).unwrap();
    let outputs = whole.get("case").unwrap().get("toolOutputs").unwrap().clone();
    *harness.gateway.answer.lock().unwrap() = Some(Box::new(move |id, _| match outputs.get(id).unwrap() {
        JsValue::String(text) => {
            let (code, message) = text.split_once(": ").unwrap();
            ToolExecutionResponse::tool_error(code, message)
        }
        other => ToolExecutionResponse::result(other.clone()),
    }));
    *harness.gateway.catalog.lock().unwrap() = catalog();
    harness.script(turns(case));
    harness
}

#[tokio::test]
async fn the_rust_loop_sends_what_the_typescript_loop_sent() {
    let recorded = fixture();
    let case = &recorded["case"];
    let harness = harness(case);
    // The TypeScript loop's mock had these from the device; here the saved context carries them.
    let mut context: Value = serde_json::from_str(&harness.control.context.lock().unwrap()).unwrap();
    context["reasoning_effort"] = case["reasoning"].clone();
    let mut stored = harness.stored();
    stored.misty_run_id = "run_parity".to_owned();
    stored.context = Some(context.to_string());
    let ended = super::space_task_agent::run_space_task_agent(harness.deps(), stored).await.unwrap();
    assert_eq!(ended.text, recorded["ended"]["text"].as_str().unwrap());
    assert_eq!(ended.incomplete, recorded["ended"]["incomplete"].as_bool().unwrap());
    assert_eq!(ended.steps as u64, recorded["ended"]["steps"].as_u64().unwrap());

    let calls = harness.models.calls.lock().unwrap();
    let want_calls = recorded["modelCalls"].as_array().unwrap();
    assert_eq!(calls.len(), want_calls.len());
    for (index, (got, want)) in calls.iter().zip(want_calls).enumerate() {
        let got_json = serde_json::to_value(got).unwrap();
        let (got_prompt, want_prompt) = (got_json["prompt"].as_array().unwrap(), want["prompt"].as_array().unwrap());
        for (at, (message, wanted)) in got_prompt.iter().zip(want_prompt).enumerate() {
            assert_eq!(message, wanted, "model call {index}, message {at}");
        }
        for field in ["prompt", "tools", "toolChoice", "maxOutputTokens", "reasoning", "providerOptions"] {
            assert_eq!(got_json[field], want[field], "model call {index}, field {field}");
        }
        // Key order isn't in a parsed comparison, and providers' prompt caches depend on it.
        let inputs: Vec<String> = got
            .prompt
            .iter()
            .flat_map(|message| match message {
                Message::Assistant { content, .. } => content.iter().filter_map(|part| if let AssistantPart::ToolCall { input, .. } = part { Some(input.get().to_owned()) } else { None }).collect(),
                _ => Vec::new(),
            })
            .collect();
        assert_eq!(serde_json::to_value(&inputs).unwrap(), want["inputs"], "model call {index}, inputs");
        let schemas: Vec<String> = got.tools.iter().map(|tool| tool.input_schema.get().to_owned()).collect();
        assert_eq!(serde_json::to_value(&schemas).unwrap(), want["schemas"], "model call {index}, schemas");
    }

    // The tool service saw the same calls under the same IDs and tokens.
    let executed = harness.gateway.executed.lock().unwrap();
    let want_executed = recorded["executed"].as_array().unwrap();
    assert_eq!(executed.len(), want_executed.len());
    for (got, want) in executed.iter().zip(want_executed) {
        assert_eq!(got.0, want["id"].as_str().unwrap());
        assert_eq!(got.1, want["name"].as_str().unwrap());
        assert_eq!(got.2, want["input"].as_str().unwrap());
        assert_eq!(got.3, want["token"].as_str().unwrap());
    }

    // Whoever follows the run saw the same lifecycle calls, in the same order, under the same
    // idempotency keys. The recording is from when a run had a server: it also has the bearer exchange,
    // which is gone, and no tool's arguments or result, which now stay on the computer for its timeline.
    let recorded_events = || recorded["events"].as_array().unwrap().iter().filter(|event| !matches!(event["action"].as_str(), Some("activate" | "context" | "mcp-token")));
    let control = harness.control.calls.lock().unwrap();
    let got_events: Vec<(String, String)> = control.iter().filter(|(action, ..)| action != "budget").map(|(action, _, key)| (action.clone(), key.clone())).collect();
    let want_events: Vec<(String, String)> = recorded_events().map(|event| (event["action"].as_str().unwrap().to_owned(), event["key"].as_str().unwrap().to_owned())).collect();
    assert_eq!(got_events, want_events);
    let bodies: Vec<&JsValue> = control.iter().filter(|(action, ..)| action != "budget").map(|(_, body, _)| body).collect();
    let want_bodies: Vec<&Value> = recorded_events().map(|event| &event["body"]).collect();
    for (got, want) in bodies.iter().zip(want_bodies) {
        let got: Value = serde_json::from_str(&got.stringify()).unwrap();
        let mut got = got;
        let mut want = want.clone();
        // A tool's duration is the only field that's different each time.
        for side in [&mut got, &mut want] {
            if let Some(output) = side.get_mut("output").and_then(Value::as_object_mut) {
                output.remove("duration_ms");
                output.remove("device_arguments");
                output.remove("device_result");
            }
        }
        assert_eq!(got, want);
    }
}
