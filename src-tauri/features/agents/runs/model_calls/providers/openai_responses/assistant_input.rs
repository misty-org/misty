//! Assistant turns as Responses input: stored items by reference, and the rest whole.
use std::collections::HashMap;

use serde_json::{json, Value};

use super::input::{openai, openai_text, InputItem, OutputText, SummaryText, TaggedItem};
use crate::model_calls::prompt::{AssistantPart, ProviderOptions};

fn summary_of(text: &str) -> Vec<SummaryText<'_>> {
    if text.is_empty() {
        Vec::new()
    } else {
        vec![SummaryText { kind: "summary_text", text }]
    }
}

pub(super) fn assistant_items<'a>(content: &'a [AssistantPart], store: bool, input: &mut Vec<InputItem<'a>>, warnings: &mut Vec<Value>) {
    // A reasoning item can arrive as several parts, which become one: where it sits in the input.
    let mut reasoning_items: HashMap<String, usize> = HashMap::new();
    for part in content {
        match part {
            AssistantPart::Text { text, provider_options } => {
                let options = provider_options.as_ref();
                match openai_text(options, "itemId") {
                    Some(id) if store => input.push(InputItem::Tagged(TaggedItem::ItemReference { id })),
                    id => input.push(InputItem::Assistant {
                        role: "assistant",
                        content: [OutputText { kind: "output_text", text }],
                        id,
                        phase: openai_text(options, "phase"),
                    }),
                }
            }
            // Plain function calls never go as references: the output that follows can only name
            // the call by its `call_id`, and the API can't match that to a reference.
            AssistantPart::ToolCall { tool_call_id, tool_name, input: arguments, provider_options } => {
                let options = provider_options.as_ref();
                input.push(InputItem::Tagged(TaggedItem::FunctionCall {
                    call_id: tool_call_id,
                    name: tool_name,
                    arguments: arguments.get(),
                    namespace: openai_text(options, "namespace"),
                    caller: openai(options, "caller").map(tool_caller),
                }));
            }
            AssistantPart::Reasoning { text, provider_options } => {
                reasoning_item(part, text, provider_options.as_ref(), store, &mut reasoning_items, input, warnings);
            }
        }
    }
}

fn reasoning_item<'a>(
    part: &AssistantPart,
    text: &'a str,
    options: Option<&ProviderOptions>,
    store: bool,
    seen: &mut HashMap<String, usize>,
    input: &mut Vec<InputItem<'a>>,
    warnings: &mut Vec<Value>,
) {
    let encrypted = openai_text(options, "reasoningEncryptedContent");
    let written = || serde_json::to_string(part).unwrap_or_default();
    let Some(id) = openai_text(options, "itemId") else {
        // Reasoning with no item ID can still go back as its encrypted content.
        match encrypted {
            Some(encrypted_content) => input.push(InputItem::Tagged(TaggedItem::Reasoning {
                id: None,
                encrypted_content: Some(encrypted_content),
                summary: summary_of(text),
            })),
            None => warnings.push(json!({
                "type": "other",
                "message": format!("Non-OpenAI reasoning parts are not supported. Skipping reasoning part: {}.", written()),
            })),
        }
        return;
    };
    let known = seen.get(&id).copied();
    if store {
        if known.is_none() {
            seen.insert(id.clone(), input.len());
            input.push(InputItem::Tagged(TaggedItem::ItemReference { id }));
        }
        return;
    }
    if text.is_empty() && known.is_some() {
        warnings.push(json!({
            "type": "other",
            "message": format!("Cannot append empty reasoning part to existing reasoning sequence. Skipping reasoning part: {}.", written()),
        }));
    }
    match known.and_then(|at| input.get_mut(at)) {
        Some(InputItem::Tagged(TaggedItem::Reasoning { encrypted_content, summary, .. })) => {
            summary.extend(summary_of(text));
            // The last part is the one that holds the encrypted content.
            if encrypted.is_some() {
                *encrypted_content = encrypted;
            }
        }
        _ => {
            seen.insert(id.clone(), input.len());
            input.push(InputItem::Tagged(TaggedItem::Reasoning {
                id: Some(id),
                encrypted_content: encrypted,
                summary: summary_of(text),
            }));
        }
    }
}

fn tool_caller(caller: &Value) -> Value {
    match caller.get("callerId") {
        Some(caller_id) if caller.get("type").and_then(Value::as_str) == Some("program") => {
            json!({ "type": "program", "caller_id": caller_id })
        }
        _ => caller.clone(),
    }
}
