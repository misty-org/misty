//! OpenAI models can wrap several calls in one to a `parallel` tool that nobody declared. Misty sees
//! the calls inside it, each as its own. Ported from `expand-parallel-tool-call.ts`.
use serde_json::json;

use crate::model_calls::providers::ordered::Ordered;
use crate::model_calls::stream::StreamPart;

const PARALLEL_TOOL_NAME: &str = "parallel";
const RECIPIENT_NAME_PREFIX: &str = "functions.";

pub(super) fn is_undeclared_parallel_tool_call(tool_name: &str, tools: &[String]) -> bool {
    tool_name == PARALLEL_TOOL_NAME && !tools.iter().any(|tool| tool == PARALLEL_TOOL_NAME)
}

/// The calls inside a wrapper, or `None` unless every one names a declared tool.
pub(super) fn expand_parallel_tool_call(
    tool_call_id: &str,
    tool_name: &str,
    input: &str,
    tools: &[String],
    item_id: &str,
) -> Option<Vec<StreamPart>> {
    if !is_undeclared_parallel_tool_call(tool_name, tools) {
        return None;
    }
    let parsed = Ordered::from_text(input).ok()?;
    let Some(Ordered::Array(tool_uses)) = parsed.get("tool_uses") else {
        return None;
    };
    if tool_uses.is_empty() {
        return None;
    }
    let mut expanded = Vec::with_capacity(tool_uses.len());
    for (index, tool_use) in tool_uses.iter().enumerate() {
        let recipient = tool_use.get("recipient_name")?.as_str()?;
        let parameters = tool_use.get("parameters").filter(|value| matches!(value, Ordered::Object(_)))?;
        let name = recipient.strip_prefix(RECIPIENT_NAME_PREFIX)?;
        if name.is_empty() || !tools.iter().any(|tool| tool == name) {
            return None;
        }
        expanded.push(StreamPart::ToolCall {
            tool_call_id: format!("{tool_call_id}_{index}"),
            tool_name: name.to_owned(),
            input: parameters.to_text(),
            provider_metadata: Some(json!({
                "openai": {
                    "parallelToolCall": {
                        "itemId": item_id,
                        "toolCallId": tool_call_id,
                        "toolName": tool_name,
                        "input": input,
                        "index": index,
                        "count": tool_uses.len(),
                    },
                },
            })),
        });
    }
    Some(expanded)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tools() -> Vec<String> {
        vec!["look".to_owned()]
    }

    #[test]
    fn calls_inside_keep_their_key_order() {
        let input = r#"{"tool_uses":[{"recipient_name":"functions.look","parameters":{"z":1,"a":2}}]}"#;
        let parts = expand_parallel_tool_call("c", "parallel", input, &tools(), "i").unwrap();
        let StreamPart::ToolCall { tool_call_id, tool_name, input, .. } = &parts[0] else {
            panic!("expected a call");
        };
        assert_eq!((tool_call_id.as_str(), tool_name.as_str(), input.as_str()), ("c_0", "look", r#"{"z":1,"a":2}"#));
    }

    #[test]
    fn anything_unusual_stays_a_plain_call() {
        let declared = vec!["parallel".to_owned(), "look".to_owned()];
        let good = r#"{"tool_uses":[{"recipient_name":"functions.look","parameters":{}}]}"#;
        assert!(expand_parallel_tool_call("c", "parallel", good, &declared, "i").is_none());
        for input in [
            "not json",
            "[]",
            r#"{"tool_uses":[]}"#,
            r#"{"tool_uses":[{"recipient_name":"look","parameters":{}}]}"#,
            r#"{"tool_uses":[{"recipient_name":"functions.other","parameters":{}}]}"#,
            r#"{"tool_uses":[{"recipient_name":"functions.","parameters":{}}]}"#,
            r#"{"tool_uses":[{"recipient_name":"functions.look","parameters":[]}]}"#,
        ] {
            assert!(expand_parallel_tool_call("c", "parallel", input, &tools(), "i").is_none(), "{input}");
        }
    }
}
