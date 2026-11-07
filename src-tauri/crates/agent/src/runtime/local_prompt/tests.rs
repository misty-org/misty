//! Each fixture holds what the Go server rendered for one request (`TestExportLocalPrompt`). A
//! difference here changes what the model reads, which the benchmarks are tuned on.
use std::{collections::HashMap, fs, path::PathBuf};

use serde_json::Value;

use crate::{
    runtime::{js_json::JsValue, model_tools::CatalogTool, text::js_prefix, tool_schema::{normalize_tool_input_schema, type_first}, web_search::provider::SearchProviderId},
    sdk::RawJson,
};

use super::{build_prompt, catalog::THREAD_POST_DESCRIPTION, catalog_output_schemas, go_text::{go_quote, go_value}, kept_notes, run_catalog, CatalogInputs, RunRequest};

fn fixtures() -> Vec<(String, Value)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/runtime/local_prompt/fixtures");
    let mut cases: Vec<(String, Value)> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| {
            let path = entry.unwrap().path();
            let name = path.file_stem().unwrap().to_string_lossy().into_owned();
            (name, serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap())
        })
        .collect();
    cases.sort_by(|left, right| left.0.cmp(&right.0));
    assert!(cases.len() >= 10, "fixtures are missing");
    cases
}

fn inputs_of(fixture: &Value) -> CatalogInputs {
    let inputs = &fixture["catalog_inputs"];
    let names: Option<HashMap<String, String>> = serde_json::from_value(inputs["device_names"].clone()).ok();
    CatalogInputs {
        signed_in: true,
        composio_key: inputs["composio"].as_bool().unwrap(),
        search: inputs["web_search"].as_bool().unwrap().then_some(SearchProviderId::Serper),
        device_names: names.unwrap_or_default(),
    }
}

fn first_difference(name: &str, part: &str, actual: &str, expected: &str) -> Option<String> {
    if actual == expected {
        return None;
    }
    let at = actual.bytes().zip(expected.bytes()).take_while(|(left, right)| left == right).count();
    let window = |text: &str| text.char_indices().filter(|(index, _)| *index + 200 > at && *index < at + 300).map(|(_, character)| character).collect::<String>();
    Some(format!("{name}: {part} differs at byte {at} (lengths {} and {})\n  ours:   {}\n  theirs: {}", actual.len(), expected.len(), window(actual), window(expected)))
}

fn catalog_of(request: &RunRequest, inputs: &CatalogInputs) -> Vec<CatalogTool> {
    run_catalog(request, inputs)
}

#[test]
fn prompts_match_the_server_byte_for_byte() {
    let mut failures = Vec::new();
    for (name, fixture) in fixtures() {
        let request = RunRequest::from_json(&fixture["request"]);
        let names: Vec<String> = catalog_of(&request, &inputs_of(&fixture)).into_iter().map(|tool| tool.name).collect();
        let built = build_prompt(&request, &names, fixture["now"].as_str().unwrap(), fixture["memory_context"].as_str().unwrap(), fixture["method_guidance"].as_str().unwrap());
        let expected = &fixture["expected"];
        failures.extend(first_difference(&name, "system", &built.system, expected["system"].as_str().unwrap()));
        failures.extend(first_difference(&name, "prompt", &built.prompt, expected["prompt"].as_str().unwrap()));
        failures.extend(first_difference(&name, "title_prompt", &built.title_prompt, expected["title_prompt"].as_str().unwrap()));
        let summary = &expected["summary_request"];
        let summary = (!summary.is_null()).then(|| (summary["previous"].as_str().unwrap().to_owned(), summary["turns"].as_str().unwrap().to_owned()));
        if built.summary_request != summary {
            failures.push(format!("{name}: summary_request differs"));
        }
        let kept = kept_notes(&request, "Fresh notes.", "test/model").unwrap_or(Value::Null);
        if kept != expected["kept_notes"] {
            failures.push(format!("{name}: kept_notes\n  ours:   {kept}\n  theirs: {}", expected["kept_notes"]));
        }
        if built.model_turn_limit != expected["model_turn_limit"].as_i64() {
            failures.push(format!("{name}: model_turn_limit {:?}, expected {}", built.model_turn_limit, expected["model_turn_limit"]));
        }
        if built.context_window_tokens != expected["context_window_tokens"].as_i64() {
            failures.push(format!("{name}: context_window_tokens {:?}", built.context_window_tokens));
        }
        if built.teach != expected["teach"].as_bool().unwrap() || Some(built.teach_tool_budget) != expected["teach_tool_budget"].as_f64() {
            failures.push(format!("{name}: teach {} budget {}", built.teach, built.teach_tool_budget));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}

#[test]
fn tools_match_the_server() {
    let mut failures = Vec::new();
    for (name, fixture) in fixtures() {
        let request = RunRequest::from_json(&fixture["request"]);
        let inputs = inputs_of(&fixture);
        let tools = catalog_of(&request, &inputs);
        // The device's own tools run here, so the server never had them.
        let own: Vec<&str> = tools.iter().filter(|tool| tool.local).map(|tool| tool.name.as_str()).collect();
        let wanted_own: &[&str] = if inputs.search.is_some() { &["web.search", "web.fetch"] } else { &["web.fetch"] };
        if own != wanted_own {
            failures.push(format!("{name}: device tools {own:?}"));
        }
        let remote: Vec<&CatalogTool> = tools.iter().filter(|tool| !tool.local).collect();
        let expected = fixture["expected"]["tools"].as_array().unwrap();
        let ours: Vec<&str> = remote.iter().map(|tool| tool.name.as_str()).collect();
        let theirs: Vec<&str> = expected.iter().map(|tool| tool["name"].as_str().unwrap()).collect();
        if ours != theirs {
            failures.push(format!("{name}: tool names differ\n  ours:   {ours:?}\n  theirs: {theirs:?}"));
            continue;
        }
        for (tool, row) in remote.iter().zip(expected) {
            // The one row we word differently from the server (`THREAD_POST_DESCRIPTION`).
            let description = if tool.name == "thread.post" { THREAD_POST_DESCRIPTION } else { js_prefix(row["description"].as_str().unwrap(), 2_000) };
            failures.extend(first_difference(&name, &format!("{} description", tool.name), &tool.description, description));
            // The one row we classify differently from the server: opening an address is no read.
            let read_only = row["readOnly"].as_bool().unwrap() && tool.name != "screen.open";
            let concurrent = read_only && matches!(row["locality"].as_str(), Some("server" | "provider")) && tool.name != "browser.request_user_action";
            if tool.read_only != read_only || tool.concurrent != concurrent {
                failures.push(format!("{name}: {} read_only {} concurrent {}", tool.name, tool.read_only, tool.concurrent));
            }
            if let Some(schema) = fixture["expected"]["schemas"].get(&tool.name) {
                let raw = RawJson::from_text(schema.to_string()).unwrap();
                let wanted = JsValue::from_raw(&type_first(&normalize_tool_input_schema(&raw))).unwrap();
                let actual = JsValue::from_raw(&tool.input_schema).unwrap();
                // serde_json sorted the fixture's keys, as Go's maps sorted theirs at every level but the moved `type`.
                if sorted(&actual) != sorted(&wanted) {
                    failures.push(format!("{name}: {} schema\n  ours:   {}\n  theirs: {}", tool.name, actual.stringify(), wanted.stringify()));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}

fn sorted(value: &JsValue) -> String {
    go_value(&serde_json::from_str(&value.stringify()).unwrap())
}

fn signed_out_request() -> RunRequest {
    RunRequest::from_json(&serde_json::json!({
        "mode": "drawer", "surface_id": "global", "trigger": "message", "prompt": "Hello", "conversation_id": "chat", "window_label": "main",
        "device_contexts": [
            {"device_id": "d", "kind": "local_folder", "opaque_ref": "f", "display_name": "Reports", "capabilities": ["folder.list"], "metadata": {}},
            {"device_id": "d", "kind": "workspace", "opaque_ref": "w", "capabilities": ["browser.session", "browser.run"], "metadata": {"source": "desktop"}},
        ],
    }))
}

#[test]
fn a_signed_out_run_has_nothing_that_needs_the_server() {
    let names = |signed_in: bool| -> Vec<String> {
        run_catalog(&signed_out_request(), &CatalogInputs { signed_in, ..CatalogInputs::default() }).into_iter().map(|tool| tool.name).collect()
    };
    let out = names(false);
    for gone in ["space.list", "space.manage", "note.read", "message.send", "file.search", "folder.send", "search.all", "agent.configure"] {
        assert!(!out.iter().any(|name| name == gone), "{gone} should need an account");
    }
    for kept in ["web.fetch", "screen.open", "browser.run", "shell.run", "folder.read", "memory.pref.list", "log.work.write", "conversation.ask_user", "agent.delegate"] {
        assert!(out.iter().any(|name| name == kept), "{kept} should work signed out");
    }
    let signed_in = names(true);
    assert!(signed_in.iter().any(|name| name == "note.read") && signed_in.iter().any(|name| name == "folder.send"));
}

#[test]
fn nobody_else_can_ask_this_agent_to_act() {
    let rows = catalog_output_schemas();
    for removed in ["agent.request", "agent.request_status", "agent.directory", "agent.background"] {
        assert!(!rows.contains_key(removed), "{removed} is gone");
    }
    assert!(rows.contains_key("conversation.ask_user") && rows.contains_key("plan.propose") && rows.contains_key("goal.update") && rows.contains_key("shell.run") && rows.contains_key("integration.search"));
}

/// Which of the state's tools a fixture's run is offered, and whether the prompt speaks of them.
#[test]
fn the_chats_plan_and_goal_decide_their_tools_and_instructions() {
    let cases = [
        ("approved_plan", true, false, "The user approved this plan"),
        ("active_goal", false, true, "Active goal (keep working toward it across turns)"),
        ("personal_agent_goal", true, true, "The budget is nearly spent"),
        ("settled_plan_and_paused_goal", false, false, ""),
        ("proposed_plan_while_acting", false, false, ""),
        ("saved_plan_mode_rejected_plan", false, false, "The current proposed plan (version 6"),
        ("plan_mode_over_approved_plan", false, false, ""),
    ];
    let all = fixtures();
    for (name, plan_update, goal_update, words) in cases {
        let fixture = &all.iter().find(|(case, _)| case == name).unwrap().1;
        let request = RunRequest::from_json(&fixture["request"]);
        let tools = catalog_of(&request, &inputs_of(fixture));
        let listed = |tool: &str| tools.iter().any(|item| item.name == tool);
        assert_eq!((listed("plan.update"), listed("goal.update")), (plan_update, goal_update), "{name}");
        let names: Vec<String> = tools.iter().map(|tool| tool.name.clone()).collect();
        let system = build_prompt(&request, &names, "2026-11-06T17:04:05Z", "", "").system;
        assert!(system.contains(words), "{name}");
    }
}

#[test]
fn quotes_as_go_does() {
    assert_eq!(go_quote("a \"b\"\t\u{1}\u{a0}é\u{200b}😀\u{7f}"), "\"a \\\"b\\\"\\t\\x01\\u00a0é\\u200b😀\\x7f\"");
}
