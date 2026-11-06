//! Pushed page state (docs/agents/harness.md, Context). After screen_open the agent spent a whole
//! turn asking for the new page with browser_snapshot: 39 of 157 calls in one run. browser-use shows
//! the page with every step instead. So after a turn that opened tabs, the runtime takes the newest
//! ones' snapshots itself and adds them to the transcript, as if the agent had asked, and the next
//! turn acts on them directly.
use crate::sdk::{AssistantPart, Message, RawJson, ToolOutput, ToolResultPart};

use super::{js_json::JsValue, tool_transport::{object, string}};

const MAX_PAGES: usize = 3;
/// The same size as the snapshot after browser_steps (src-tauri browser_page AFTER_STEPS_SNAPSHOT_CHARS).
pub(crate) const PAGE_STATE_CHARS: u32 = 12_000;

fn parse(output: &JsValue, depth: usize) -> Option<JsValue> {
    if depth > 4 {
        return None;
    }
    match output {
        JsValue::String(text) => {
            if !text.contains("scopeId") {
                return None;
            }
            parse(&JsValue::parse(text)?, depth + 1)
        }
        JsValue::Object(_) => {
            let scoped = output.get("scopeId").is_some_and(|scope| scope.as_str().is_some());
            if output.get("status").and_then(JsValue::as_str) == Some("open") && scoped {
                return Some(output.clone());
            }
            ["value", "output", "result"].iter().find_map(|key| parse(output.get(key)?, depth + 1))
        }
        _ => None,
    }
}

/// One tool result of a turn.
#[derive(Clone, Debug, Default)]
pub(crate) struct TurnResult {
    pub(crate) tool_name: Option<String>,
    pub(crate) output: Option<JsValue>,
}

/// The scopes of tabs this turn's calls opened (not tabs found already open), newest last.
pub(crate) fn opened_scopes(results: &[TurnResult], open_tool: &str) -> Vec<String> {
    let mut scopes: Vec<String> = Vec::new();
    for result in results {
        if result.tool_name.as_deref() != Some(open_tool) {
            continue;
        }
        let Some(opened) = result.output.as_ref().and_then(|output| parse(output, 0)) else {
            continue;
        };
        let scope = opened.get("scopeId").and_then(JsValue::as_str).unwrap_or("");
        let reused = opened.get("message").and_then(JsValue::as_str).is_some_and(|message| message.contains("is already open"));
        if !scope.is_empty() && !reused && !scopes.iter().any(|known| known == scope) {
            scopes.push(scope.to_owned());
        }
    }
    let keep_from = scopes.len().saturating_sub(MAX_PAGES);
    scopes.split_off(keep_from)
}

/// The transcript entries for a snapshot the runtime took for the agent.
pub(crate) fn page_state_messages(call_id: &str, snapshot_tool: &str, scope_id: &str, state: &JsValue) -> Vec<Message> {
    let input = object([("scopeId", string(scope_id)), ("maxChars", JsValue::Number(f64::from(PAGE_STATE_CHARS)))]);
    let value = match state {
        JsValue::String(text) => text.clone(),
        other => other.stringify(),
    };
    vec![
        Message::Assistant {
            content: vec![AssistantPart::ToolCall {
                tool_call_id: call_id.to_owned(),
                tool_name: snapshot_tool.to_owned(),
                input: RawJson::from_text(input.stringify()).unwrap_or_else(|_| RawJson::empty_object()),
                provider_options: None,
            }],
            provider_options: None,
        },
        Message::Tool {
            content: vec![ToolResultPart {
                kind: "tool-result".to_owned(),
                tool_call_id: call_id.to_owned(),
                tool_name: snapshot_tool.to_owned(),
                output: ToolOutput::Text { value },
            }],
            provider_options: None,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opened(scope: &str, reused: bool) -> String {
        object([
            ("status", string("open")),
            ("scopeId", string(scope)),
            ("message", string(if reused { "Your own browser tab on this computer is already open" } else { "Your own browser tab is open" })),
        ])
        .stringify()
    }

    fn result(tool: &str, output: JsValue) -> TurnResult {
        TurnResult { tool_name: Some(tool.to_owned()), output: Some(output) }
    }

    #[test]
    fn finds_the_tabs_a_turn_opened_newest_three_not_tabs_found_already_open() {
        let results = [
            result("screen_open", string(opened("s1", false))),
            result("screen_open", object([("type", string("text")), ("value", string(opened("s2", false)))])),
            result("screen_open", string(opened("s3", true))),
            result("web_search", string(opened("s9", false))),
            result("screen_open", string(opened("s4", false))),
            result("screen_open", string(opened("s5", false))),
        ];
        assert_eq!(opened_scopes(&results, "screen_open"), ["s2", "s4", "s5"]);
    }

    #[test]
    fn adds_the_snapshot_as_the_agents_own_call_and_result() {
        let state = object([("tree", string("- button [ref=e1]"))]);
        let messages = page_state_messages("page-state-3-0", "browser_snapshot", "s1", &state);
        assert_eq!(
            serde_json::to_string(&messages).unwrap(),
            concat!(
                r#"[{"role":"assistant","content":[{"type":"tool-call","toolCallId":"page-state-3-0","toolName":"browser_snapshot","input":{"scopeId":"s1","maxChars":12000}}]},"#,
                r#"{"role":"tool","content":[{"type":"tool-result","toolCallId":"page-state-3-0","toolName":"browser_snapshot","output":{"type":"text","value":"{\"tree\":\"- button [ref=e1]\"}"}}]}]"#,
            )
        );
    }

    #[test]
    fn a_text_snapshot_stays_as_it_is_and_bad_output_finds_nothing() {
        let messages = page_state_messages("c", "browser_snapshot", "s1", &string("plain"));
        let Message::Tool { content, .. } = &messages[1] else {
            panic!("expected a tool message");
        };
        assert!(matches!(&content[0].output, ToolOutput::Text { value } if value == "plain"));
        let results = [result("screen_open", string("{not json scopeId")), TurnResult::default()];
        assert!(opened_scopes(&results, "screen_open").is_empty());
    }
}
