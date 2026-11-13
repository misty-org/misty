use super::*;
use crate::model_tools::CatalogTool;

fn catalog_of(names: &[&str]) -> ModelCatalog {
    let descriptors = names
        .iter()
        .map(|name| CatalogTool {
            name: (*name).to_owned(),
            description: (*name).to_owned(),
            input_schema: RawJson::from_text(r#"{"type":"object","properties":{}}"#.to_owned()).unwrap(),
            concurrent: false,
            read_only: false,
            local: false,
        })
        .collect();
    ModelCatalog::new(descriptors, &["agent_finish", TOOL_USE_TOOL, TOOL_LOAD_TOOL])
}

fn call(tool_name: &str, input: &str) -> Message {
    Message::Assistant {
        content: vec![AssistantPart::ToolCall {
            tool_call_id: tool_name.to_owned(),
            tool_name: tool_name.to_owned(),
            input: RawJson::from_text(input.to_owned()).unwrap(),
            provider_options: None,
        }],
        provider_options: None,
    }
}

const NAMES: [&str; 10] = ["web.search", "web.fetch", "note.search", "screen.open", "screen.look", "browser.workspace.focus", "integration.search", "integration.execute", "agent.delegate", "browser.tab.list"];

fn every_name(catalog: &ModelCatalog, tools: &AgentTools<'_>) -> Vec<String> {
    catalog.tools.iter().map(|tool| tool.model_name.clone()).chain(tools.tools.iter().map(|tool| tool.name.clone())).collect()
}

#[test]
fn starts_in_answer_with_its_own_tab_one_call_away_and_sub_agents_ready_and_hides_apps() {
    let catalog = catalog_of(&NAMES);
    let tools = agent_tools(&catalog, "");
    assert_eq!(tools.initial, Toolset::Answer);
    let shown = tools.visible(&every_name(&catalog, &tools), &tool_state(&[], tools.initial));
    for name in ["web_search", "web_fetch", "screen_look", "screen_open", "browser_tab_list", "agent_delegate", TOOL_USE_TOOL, TOOL_LOAD_TOOL] {
        assert!(shown.iter().any(|item| item == name), "{name}");
    }
    for hidden in ["browser_workspace_focus", "integration_search", "integration_execute", "note_search"] {
        assert!(!shown.iter().any(|item| item == hidden), "{hidden}");
    }
}

#[test]
fn keeps_sub_agents_behind_a_load_when_the_run_cant_open_its_own_tabs() {
    let catalog = catalog_of(&["web.search", "web.fetch", "agent.delegate"]);
    let loaded = agent_tools(&catalog, "");
    let names = every_name(&catalog, &loaded);
    let has = |messages: &[Message]| loaded.visible(&names, &tool_state(messages, loaded.initial)).iter().any(|item| item == "agent_delegate");
    assert!(!has(&[]));
    assert!(has(&[call(TOOL_LOAD_TOOL, r#"{"family":"agent"}"#)]));
}

#[test]
fn starts_with_mistys_own_tools_loaded_when_the_request_is_about_them() {
    let catalog = catalog_of(&NAMES);
    let has = |tools: &AgentTools<'_>, messages: &[Message]| {
        tools.visible(&every_name(&catalog, tools), &tool_state(messages, tools.initial)).iter().any(|item| item == "note_search")
    };
    assert!(has(&agent_tools(&catalog, "Summarize my notes from last week"), &[]));
    let web = agent_tools(&catalog, "Find the cheapest Nike running shoes under $200");
    assert!(!has(&web, &[]));
    assert!(has(&web, &[call(TOOL_LOAD_TOOL, r#"{"family":"misty"}"#)]));
}

#[test]
fn follows_switches_and_loads_in_the_transcript() {
    let catalog = catalog_of(&NAMES);
    let tools = agent_tools(&catalog, "");
    let state = tool_state(&[call(TOOL_USE_TOOL, r#"{"tool":"browse"}"#), call(TOOL_LOAD_TOOL, r#"{"family":"integration"}"#)], tools.initial);
    assert_eq!(state.toolset, Toolset::Browse);
    assert!(state.seen);
    let shown = tools.visible(&every_name(&catalog, &tools), &state);
    for name in ["screen_open", "integration_search", "integration_execute"] {
        assert!(shown.iter().any(|item| item == name), "{name}");
    }
}

#[test]
fn offers_only_the_toolsets_and_families_the_run_has() {
    let catalog = catalog_of(&["web.search", "web.fetch"]);
    let small = agent_tools(&catalog, "");
    assert!(small.tools.is_empty());
    assert_eq!(small.instructions, "");
}

#[test]
fn starts_in_browse_when_a_browser_is_already_attached() {
    let catalog = catalog_of(&["web.search", "browser.snapshot", "browser.steps", "browser.request_user_action"]);
    let attached = agent_tools(&catalog, "");
    assert_eq!(attached.initial, Toolset::Browse);
    let names: Vec<String> = ["web_search", "browser_snapshot", "browser_steps"].map(str::to_owned).to_vec();
    assert_eq!(attached.visible(&names, &tool_state(&[], attached.initial)).len(), 3);
    // Asking the person for help alone isn't a browser.
    let catalog = catalog_of(&["web.search", "browser.request_user_action"]);
    assert_eq!(agent_tools(&catalog, "").initial, Toolset::Answer);
}

#[test]
fn offers_browser_run_in_answer_and_keeps_the_step_tools_behind_browse() {
    let catalog = catalog_of(&["web.search", "screen.open", "browser.run", "browser.snapshot", "browser.steps"]);
    let programs = agent_tools(&catalog, "");
    assert_eq!(programs.initial, Toolset::Answer);
    let names: Vec<String> = ["web_search", "screen_open", "browser_run", "browser_snapshot", "browser_steps"].map(str::to_owned).to_vec();
    assert_eq!(programs.visible(&names, &tool_state(&[], programs.initial)), ["web_search", "screen_open", "browser_run"]);
}

#[test]
fn the_runtimes_own_tools_answer_with_what_changed() {
    let input = JsValue::parse(r#"{"tool":"browse"}"#).unwrap();
    assert_eq!(run_toolset_tool(TOOL_USE_TOOL, &input).unwrap().stringify(), r#"{"toolset":"browse","note":"Now in agent.tool.browse."}"#);
    let input = JsValue::parse(r#"{"family":"misty"}"#).unwrap();
    assert_eq!(run_toolset_tool(TOOL_LOAD_TOOL, &input).unwrap().stringify(), r#"{"loaded":"misty"}"#);
    assert_eq!(run_toolset_tool("note_search", &input), None);
}
