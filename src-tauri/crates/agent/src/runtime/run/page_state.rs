//! Pushed page state (`opened_pages.rs`): the pages this turn opened, shown before the next turn, so
//! the agent acts on them instead of spending a turn asking for each. A run with browser_run reads
//! pages in its programs instead.
use crate::runtime::{
    js_json::JsValue,
    opened_pages::{opened_scopes, page_state_messages, TurnResult, PAGE_STATE_CHARS},
    tool_calls::execute_tool,
    tool_transport::{object, string},
};
use crate::sdk::Message;

use super::{agent_run::{locked, RunShared}, run_tools::RunTools};

pub(super) async fn push_opened_pages(shared: &RunShared, tools: &RunTools, results: &[TurnResult], environment: &dyn crate::runtime::tool_calls::CallEnvironment) -> Vec<Message> {
    let catalog = &tools.catalog;
    let (Some(open_tool), Some(snapshot_tool)) = (catalog.model_name("screen.open"), catalog.model_name("browser.snapshot")) else {
        return Vec::new();
    };
    if catalog.model_name("browser.run").is_some() {
        return Vec::new();
    }
    let mut pushed = Vec::new();
    for (index, scope_id) in opened_scopes(results, open_tool).iter().enumerate() {
        let call_id = format!("page-state-{}-{index}", shared.model_turn());
        let input = object([("scopeId", string(scope_id.as_str())), ("maxChars", JsValue::Number(f64::from(PAGE_STATE_CHARS)))]);
        // The agent can still take the snapshot itself.
        let Ok(state) = execute_tool(&shared.tool_deps(environment), &call_id, "browser.snapshot", &input, None).await else {
            continue;
        };
        let text = match &state {
            JsValue::String(text) => text.clone(),
            other => other.stringify(),
        };
        locked(&shared.documents).note(&object([("scopeId", string(scope_id.as_str()))]), &text);
        pushed.extend(page_state_messages(&call_id, snapshot_tool, scope_id, &state));
    }
    pushed
}
