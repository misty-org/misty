//! The words and shapes the model reads, checked against what `test/web-tools.record.test.ts`
//! recorded from the TypeScript. Prompts are tuned against benchmarks, so a slip here is a real change.
use std::sync::{Arc, Mutex};

use futures_util::future::BoxFuture;

use crate::model_calls::{FileData, Message, RawJson, UserPart};

use super::{
    companion_images::{companion_image_parts, DisplayCapture, ScreenControl, TaskFile},
    js_json::JsValue,
    model_input::{initial_messages, TaskInput},
    model_tools::{visual_tool_output, CatalogTool, ModelCatalog},
    proof_tabs::proof_tabs_refusal,
    runtime_errors::{classify_runtime_error, visible_error_message, RuntimeError},
    serial_tool_lifecycle::SerialToolLifecycle,
    tool_monitor::{ToolCall, ToolEnd, ToolMonitor},
    tool_outcomes::{classify_tool_outcome, incomplete_tool_result_text, unconfirmed_tool_result_reason, unfinished_model_result, OutcomeInput, ToolFailure, ToolOutcome, DEFAULT_TURN_LIMIT, EXECUTION_INSTRUCTIONS},
    tool_transport::{object, string, HarnessCheckpoint, ToolCheckpoints},
    toolsets::agent_tools,
    transcript::stringify_output,
    web_fetch::tool::web_fetch_descriptor,
    web_search::{provider::SearchProviderId, tool::{device_tool_activity, web_search_descriptor}},
};

use page_text::readable::{billing_note, browser_note};

#[allow(clippy::disallowed_methods)] // Test fixtures, not a path anything gave us.
pub(crate) fn recorded() -> JsValue {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/runtime_tools/strings.json");
    JsValue::parse(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn text(value: Option<&JsValue>) -> &str {
    value.and_then(JsValue::as_str).unwrap()
}

fn json(value: &str) -> JsValue {
    JsValue::parse(value).unwrap()
}

fn assert_descriptor(tool: &CatalogTool, want: &JsValue) {
    assert_eq!(tool.name, text(want.get("name")));
    assert_eq!(tool.description, text(want.get("description")));
    assert_eq!(tool.input_schema.get(), want.get("inputSchema").unwrap().stringify());
    assert_eq!(Some(&JsValue::Bool(tool.read_only)), want.get("readOnly"));
    assert_eq!(Some(&JsValue::Bool(tool.concurrent)), want.get("concurrent"));
    assert_eq!(Some(&JsValue::Bool(tool.local)), want.get("local"));
}

#[test]
fn tool_descriptors() {
    let recorded = recorded();
    assert_descriptor(&web_search_descriptor(SearchProviderId::Decodo), recorded.get("webSearchDecodo").unwrap());
    assert_descriptor(&web_search_descriptor(SearchProviderId::Serper), recorded.get("webSearchSerper").unwrap());
    assert_descriptor(&web_fetch_descriptor(), recorded.get("webFetch").unwrap());
}

#[test]
fn execution_instructions_and_proof_tab_refusals() {
    let recorded = recorded();
    assert_eq!(EXECUTION_INSTRUCTIONS, text(recorded.get("executionInstructions")));
    assert_eq!(proof_tabs_refusal("keep it open", Some("browser_run")).unwrap(), text(recorded.get("proofTabsProgram")));
}

fn descriptor(name: &str) -> CatalogTool {
    CatalogTool {
        name: name.to_owned(),
        description: name.to_owned(),
        input_schema: RawJson::from_text(r#"{"type":"object","properties":{}}"#.to_owned()).unwrap(),
        concurrent: false,
        read_only: false,
        local: false,
    }
}

#[test]
fn toolset_tools_and_instructions() {
    let recorded = recorded();
    for case in recorded.get("toolsets").unwrap().as_array().unwrap() {
        let names = case.get("names").unwrap().as_array().unwrap();
        let catalog = ModelCatalog::new(names.iter().map(|name| descriptor(name.as_str().unwrap())).collect(), &["agent_finish", "agent_tool_use", "agent_tool_load"]);
        let made = agent_tools(&catalog, text(case.get("request")));
        assert_eq!(made.initial.as_str(), text(case.get("initial")));
        assert_eq!(made.instructions, text(case.get("instructions")));
        let tools = case.get("tools").unwrap().as_array().unwrap();
        assert_eq!(made.tools.len(), tools.len());
        for (tool, want) in made.tools.iter().zip(tools) {
            assert_eq!(tool.name, text(want.get("name")));
            assert_eq!(tool.description.as_deref(), Some(text(want.get("description"))));
            assert_eq!(tool.input_schema.get(), want.get("inputSchema").unwrap().stringify());
        }
    }
}

fn file(id: &str, name: &str, mime: &str, data_url: &str, width: f64, height: f64, hash: &str) -> TaskFile {
    TaskFile { id: id.to_owned(), name: name.to_owned(), mime_type: mime.to_owned(), data_url: data_url.to_owned(), width, height, content_hash: hash.to_owned() }
}

fn shot(name: &str) -> TaskFile {
    file("c1", name, "image/png", "data:image/png;base64,AA==", 1280.0, 800.5, "abc")
}

fn display(name: &str, screen: &str, primary: bool) -> DisplayCapture {
    DisplayCapture { file: shot(name), screen: screen.to_owned(), primary, captured_at: None, source: None, controls: None }
}

#[test]
fn companion_labels() {
    let control = |label: &str, role: &str, x: f64, y: f64, width: f64, height: f64, reveal: Option<&str>| ScreenControl { label: label.to_owned(), role: role.to_owned(), x, y, width, height, reveal: reveal.map(str::to_owned) };
    let parts = companion_image_parts(&[
        DisplayCapture { captured_at: Some(1_790_470_923_004.0), ..display("screen1 — primary (Code: main.rs) (1280 × 800)", "screen1", true) },
        display("screen2 (1280 × 800)", "screen2", false),
        DisplayCapture { source: Some("desktop-window".to_owned()), ..display("window1 — Code: \"main\".rs (1280 × 800)", "window1", false) },
        display("plain", "focus1", true),
        DisplayCapture {
            controls: Some(vec![control("Back \"up\"", "button", 10.0, 20.5, 30.0, 40.0, Some("hover")), control("Go", "link", 1.0, 2.0, 3.0, 4.0, None)]),
            ..display("screen3 — primary (cursor) (1 × 1)", "screen3", true)
        },
    ]);
    assert_eq!(serde_json::to_string(&parts).unwrap(), recorded().get("companion").unwrap().stringify());
}

#[test]
fn the_first_turn() {
    let attachments = [
        file("a1", "notes \"1\".txt", "text/plain", "data:text/plain;base64,aMOpbGxvIPCfmIA=", 4.0, 3.0, "h"),
        file("a2", "plan.pdf", "application/pdf", "data:application/pdf;base64,JVBERg==", 4.0, 3.0, "h"),
        file("a3", "shot.png", "image/png", "data:image/png;base64,AAAA", 4.0, 3.0, "h"),
    ];
    let capture = shot("screen");
    let display_captures = [display("screen1 (1 × 1)", "screen1", false)];
    let messages = initial_messages(&TaskInput { prompt: "Go", attachments: &attachments, capture: Some(&capture), display_captures: &display_captures });
    let Some(Message::User { content, .. }) = messages.first() else {
        panic!("expected a user message");
    };
    let recorded = recorded();
    let want = recorded.get("initialMessages").unwrap().as_array().unwrap()[0].get("content").unwrap().as_array().unwrap().to_vec();
    assert_eq!(content.len(), want.len());
    for (part, want) in content.iter().zip(&want) {
        match part {
            UserPart::Text { text: got } => assert_eq!(got, text(want.get("text"))),
            UserPart::File { data: FileData::Data { data }, media_type } => {
                // The TypeScript held a data URL here, which the AI SDK splits on its way to a provider.
                let held = match text(want.get("type")) {
                    "image" => text(want.get("image")).to_owned(),
                    _ => match want.get("data").unwrap() {
                        JsValue::String(url) => url.clone(),
                        tagged => text(tagged.get("data")).to_owned(),
                    },
                };
                assert!(held.ends_with(data.as_str()), "{held} {data}");
                assert_eq!(media_type, text(want.get("mediaType")));
            }
            other => panic!("unexpected part {other:?}"),
        }
    }
}

struct Quiet;

impl ToolCheckpoints for Quiet {
    fn checkpoint(&self, _event: HarnessCheckpoint) -> BoxFuture<'_, Result<(), RuntimeError>> {
        Box::pin(async { Ok(()) })
    }
}

async fn monitor_words(name: &str, success: bool, output: Option<&str>, error: Option<&str>, input: &str, rejected: bool) -> JsValue {
    let order = SerialToolLifecycle::new();
    let mut tool = descriptor(name);
    tool.description = String::new();
    let catalog = Arc::new(ModelCatalog::new(vec![tool], &["agent_finish"]));
    let rejected = Arc::new(Mutex::new(if rejected { ["a".to_owned()].into_iter().collect() } else { Default::default() }));
    let monitor = ToolMonitor::new(catalog, order.clone(), Arc::new(Quiet), rejected);
    let call = ToolCall { tool_call_id: "a".to_owned(), tool_name: name.replace('.', "_"), input: json(input) };
    monitor.on_start(&call).await.unwrap();
    monitor
        .on_end(ToolEnd { tool_call: call, duration_ms: 1, success, output: output.map(json), error: error.map(RuntimeError::error) })
        .await
        .unwrap();
    order.start("b", || async { Ok(()) }, false).await.unwrap();
    let failures = monitor.failures().into_iter().map(|failure: ToolFailure| object([("toolName", string(failure.tool_name)), ("error", string(failure.error))])).collect();
    object([
        ("stopped", string(order.stopped_reason())),
        ("declined", string(order.declined("b").unwrap())),
        ("failures", JsValue::Array(failures)),
    ])
}

#[tokio::test]
async fn what_the_monitor_says_when_it_pauses_or_stops() {
    let recorded = recorded();
    let want = recorded.get("monitor").unwrap();
    const UNCERTAIN: Option<&str> = Some(r#"{"status":"uncertain"}"#);
    let cases = [
        ("ownTab", monitor_words("screen.open", true, UNCERTAIN, None, r#"{"url":"https://a.example"}"#, false).await),
        ("close", monitor_words("screen.close", false, None, Some("boom timeout"), "{}", false).await),
        ("nobody", monitor_words("browser.request_user_action", false, None, Some("boom"), "{}", false).await),
        ("rejected", monitor_words("note.update", false, None, Some("tool_execution_failed: conflict here"), "{}", true).await),
        ("uncertainWrite", monitor_words("note.update", true, UNCERTAIN, None, "{}", false).await),
        ("pageLook", monitor_words("browser.steps", true, UNCERTAIN, None, "{}", false).await),
    ];
    for (name, got) in cases {
        assert_eq!(got.stringify(), want.get(name).unwrap().stringify(), "{name}");
    }
}

#[test]
fn notes_and_error_words() {
    let recorded = recorded();
    let notes = recorded.get("notes").unwrap();
    assert_eq!(billing_note("$10 monthly"), Some(text(notes.get("billing"))));
    assert_eq!(browser_note(404, ""), Some(text(notes.get("browser"))));
    let JsValue::Object(visible) = recorded.get("visible").unwrap() else {
        panic!("expected an object");
    };
    assert_eq!(visible.len(), 10);
    for (input, want) in visible {
        assert_eq!(visible_error_message(&RuntimeError::error(input.as_str())), want.as_str().unwrap(), "{input}");
    }
    let JsValue::Object(classified) = recorded.get("classified").unwrap() else {
        panic!("expected an object");
    };
    assert_eq!(classified.len(), 14);
    for (input, want) in classified {
        let got = classify_runtime_error(&RuntimeError::error(input.as_str()));
        assert_eq!(got.code, text(want.get("code")), "{input}");
        assert_eq!(got.message, text(want.get("message")), "{input}");
    }
}

#[test]
fn outcome_words() {
    let recorded = recorded();
    let reasons = recorded.get("unconfirmed").unwrap().as_array().unwrap();
    let long = object([("status", string("failure")), ("tool_error", object([("message", string("x".repeat(600)))]))]);
    let outputs = [None, Some(json(r#"{"status":"uncertain"}"#)), Some(json(r#"{"status":"device_required"}"#)), Some(json(r#"{"denied":true}"#)), Some(json(r#"{"unavailable":true}"#)), Some(long)];
    for (output, want) in outputs.iter().zip(reasons) {
        assert_eq!(unconfirmed_tool_result_reason(output.as_ref()), want.as_str().unwrap());
    }
    let handoffs = recorded.get("handoffs").unwrap().as_array().unwrap();
    for (status, want) in ["screen_requested", "waiting_for_user", "awaiting_approval", "awaiting_answer", "plan_proposed"].iter().zip(handoffs) {
        let output = object([("status", string(*status))]);
        let outcome = classify_tool_outcome(&OutcomeInput { success: true, output: Some(&output), error: None, read_only: false, rejected: false });
        assert_eq!(outcome, ToolOutcome::Handoff { reason: text(want.get("reason")).to_owned() });
    }
    let unfinished = recorded.get("unfinished").unwrap().as_array().unwrap();
    let cases = [(true, 1, "stop"), (false, 20, "tool-calls"), (false, 3, "length"), (false, 3, "other")];
    for ((aborted, steps, reason), want) in cases.iter().zip(unfinished) {
        let got = unfinished_model_result(*aborted, *steps, reason, DEFAULT_TURN_LIMIT).unwrap();
        assert_eq!((got.code, got.message), (text(want.get("code")), text(want.get("message"))));
    }
    let failure = |name: &str, error: String| ToolFailure { tool_name: name.to_owned(), error };
    assert_eq!(incomplete_tool_result_text(&[failure("a.b_c", "  ".to_owned()), failure("d", format!("{} ", "e".repeat(310)))]), text(recorded.get("incomplete")));
}

#[test]
fn a_screenshot_and_a_timeline_entry() {
    let recorded = recorded();
    let output = object([
        ("z", JsValue::Number(1.0)),
        ("displayCaptures", json(r#"[{"name":"s","dataUrl":"data:image/png;base64,AA==","width":1.5,"height":2}]"#)),
        ("10", JsValue::Bool(true)),
        ("a", json(r#"{"b":[1.5,null]}"#)),
    ]);
    // JavaScript moves a key that's a number to the front, which parsing the text does here too.
    let output = JsValue::parse(&output.stringify()).unwrap();
    assert_eq!(stringify_output(&visual_tool_output("browser.visual", Some(&output))), recorded.get("visual").unwrap().stringify());
    let activity = device_tool_activity(&json(r#"{"url":"https://tea.example"}"#), Some(&json(r#"{"title":"Tea","url":"https://tea.example/final","text":"é"}"#)));
    assert_eq!(activity.stringify(), recorded.get("activity").unwrap().stringify());
}
