//! Each fixture holds what the Go server rendered for one request (`TestExportLocalPrompt`). A
//! difference here changes what the model reads, which the benchmarks are tuned on.
use std::{collections::HashMap, fs, path::PathBuf};

use serde_json::Value;

use crate::js_json::JsValue;
use crate::model_tools::CatalogTool;
use crate::text::js_prefix;
use crate::tool_schema::{normalize_tool_input_schema, type_first};
use crate::web_search::provider::SearchProviderId;
use crate::model_calls::RawJson;

use super::{build_prompt, catalog::{catalog_output_schemas, THREAD_POST_DESCRIPTION}, go_text::{go_quote, go_value}, kept_notes, run_catalog, CatalogInputs, RunRequest};

fn fixtures() -> Vec<(String, Value)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("local_prompt/fixtures");
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
        let built = build_prompt(&request, &names, fixture["now"].as_str().unwrap());
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
    for kept in ["web.fetch", "screen.open", "browser.run", "shell.run", "folder.read", "log.work.write", "conversation.ask_user", "agent.delegate"] {
        assert!(out.iter().any(|name| name == kept), "{kept} should work signed out");
    }
    let signed_in = names(true);
    assert!(signed_in.iter().any(|name| name == "note.read") && signed_in.iter().any(|name| name == "folder.send"));
}

#[test]
fn nobody_else_can_ask_this_agent_to_act() {
    let rows = catalog_output_schemas();
    for removed in ["agent.request", "agent.request_status", "agent.directory", "agent.background", "goal.update"] {
        assert!(!rows.contains_key(removed), "{removed} is gone");
    }
    assert!(rows.contains_key("conversation.ask_user") && rows.contains_key("plan.propose") && rows.contains_key("shell.run") && rows.contains_key("integration.search"));
}

/// Which of the state's tools a fixture's run is offered, and whether the prompt speaks of them. A
/// goal saved by an older build is ignored.
#[test]
fn the_chats_plan_decides_its_tools_and_instructions() {
    let cases = [
        ("approved_plan", true, "The user approved this plan"),
        ("active_goal", false, ""),
        ("personal_agent_goal", true, ""),
        ("settled_plan_and_paused_goal", false, ""),
        ("proposed_plan_while_acting", false, ""),
        ("saved_plan_mode_rejected_plan", false, "The current proposed plan (version 6"),
        ("plan_mode_over_approved_plan", false, ""),
    ];
    let all = fixtures();
    for (name, plan_update, words) in cases {
        let fixture = &all.iter().find(|(case, _)| case == name).unwrap().1;
        let request = RunRequest::from_json(&fixture["request"]);
        let tools = catalog_of(&request, &inputs_of(fixture));
        assert_eq!(tools.iter().any(|item| item.name == "plan.update"), plan_update, "{name}");
        let names: Vec<String> = tools.iter().map(|tool| tool.name.clone()).collect();
        let system = build_prompt(&request, &names, "2026-11-06T17:04:05Z").system;
        assert!(system.contains(words), "{name}");
        assert!(!system.contains("Active goal"), "{name}");
    }
}

#[test]
fn quotes_as_go_does() {
    assert_eq!(go_quote("a \"b\"\t\u{1}\u{a0}é\u{200b}😀\u{7f}"), "\"a \\\"b\\\"\\t\\x01\\u00a0é\\u200b😀\\x7f\"");
}

/// Rewrites every fixture's expected prompt and tools from the code as it is now. Run it by hand
/// after a deliberate change to the prompt or the tools, then read the diff:
/// `MISTY_BLESS_FIXTURES=1 cargo test -p agent-runs bless_fixtures -- --ignored`.
#[test]
#[ignore]
fn bless_fixtures() {
    if std::env::var("MISTY_BLESS_FIXTURES").as_deref() != Ok("1") {
        return;
    }
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("local_prompt/fixtures");
    for (name, mut fixture) in fixtures() {
        let request = RunRequest::from_json(&fixture["request"]);
        let inputs = inputs_of(&fixture);
        let tools = catalog_of(&request, &inputs);
        let names: Vec<String> = tools.iter().map(|tool| tool.name.clone()).collect();
        let built = build_prompt(
            &request,
            &names,
            fixture["now"].as_str().unwrap(),
        );
        let old_rows: HashMap<String, Value> = fixture["expected"]["tools"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|row| (row["name"].as_str().unwrap_or("").to_owned(), row.clone()))
            .collect();
        let rows: Vec<Value> = tools
            .iter()
            .filter(|tool| !tool.local)
            .map(|tool| {
                let old = old_rows.get(&tool.name);
                let description = match old {
                    Some(row) if tool.name == "thread.post" => row["description"].clone(),
                    _ => Value::String(tool.description.clone()),
                };
                let read_only = match old {
                    Some(row) if tool.name == "screen.open" => row["readOnly"].clone(),
                    _ => Value::Bool(tool.read_only),
                };
                let locality = match old {
                    Some(row) => row["locality"].clone(),
                    None => Value::String(if tool.concurrent { "server" } else { "device" }.into()),
                };
                serde_json::json!({ "name": tool.name, "description": description, "readOnly": read_only, "locality": locality })
            })
            .collect();
        let expected = &mut fixture["expected"];
        expected["system"] = Value::String(built.system);
        expected["prompt"] = Value::String(built.prompt);
        expected["title_prompt"] = Value::String(built.title_prompt);
        expected["tools"] = Value::Array(rows);
        if let Some(schemas) = expected["schemas"].as_object_mut() {
            schemas.retain(|tool, _| names.contains(tool));
        }
        let text = serde_json::to_string_pretty(&fixture).unwrap();
        fs::write(dir.join(format!("{name}.json")), text + "\n").unwrap();
    }
}
