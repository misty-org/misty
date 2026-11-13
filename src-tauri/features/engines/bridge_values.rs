//! Plain shaping of engine values for the chat: clipping, one-line summaries, tool output and
//! the question cards an ask carries.

use serde_json::{json, Value};

pub(super) fn clip(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut clipped: String = text.chars().take(limit).collect();
    clipped.push('…');
    clipped
}

/// What a tool call is about, in one line, from whichever field the engine names it by.
pub(super) fn summary(input: &Value) -> String {
    let field = [
        "command",
        "file_path",
        "filePath",
        "path",
        "url",
        "pattern",
        "query",
        "description",
        "prompt",
    ]
    .iter()
    .find_map(|name| input[name].as_str())
    .or_else(|| {
        input["command"]
            .as_array()
            .and_then(|parts| parts.last()?.as_str())
    });
    let text = match field {
        Some(text) => text.to_string(),
        None if input.is_null() => String::new(),
        None => input.to_string(),
    };
    clip(&text, 600)
}

/// A tool's result as text for its row.
pub(super) fn output_text(result: &Value) -> String {
    let text = match result {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        Value::Array(parts) => {
            let joined: Vec<&str> = parts
                .iter()
                .filter_map(|part| part["text"].as_str())
                .collect();
            if joined.is_empty() {
                result.to_string()
            } else {
                joined.join("\n")
            }
        }
        Value::Object(map) => {
            for key in ["stdout", "output", "content", "text", "aggregatedOutput"] {
                if let Some(text) = map.get(key).and_then(Value::as_str) {
                    return clip(text, 4000);
                }
            }
            result.to_string()
        }
        other => other.to_string(),
    };
    clip(&text, 4000)
}

/// Whether a tool result reports a failure.
pub(super) fn result_failed(result: &Value) -> Option<String> {
    let failed = result["isError"].as_bool() == Some(true)
        || result["is_error"].as_bool() == Some(true)
        || result["success"].as_bool() == Some(false)
        || matches!(
            result["status"].as_str(),
            Some("failed" | "error" | "declined")
        );
    failed.then(|| {
        let text = result["error"]
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| output_text(result));
        clip(&text, 600)
    })
}

/// How full the context is, out of the engine layer's usage report: the tokens it holds and the
/// model's window, either of which may be missing.
pub(crate) fn context_usage(usage: &Value) -> (Option<u64>, Option<u64>) {
    let number = |name: &str| usage.get(name).and_then(Value::as_u64);
    let window = number("model_context_window")
        .or_else(|| number("modelContextWindow"))
        .or_else(|| number("context_window"))
        .or_else(|| number("contextWindow"))
        .or_else(|| number("size"));
    let used = number("total_tokens")
        .or_else(|| number("used"))
        .or_else(|| {
            let parts: Vec<u64> = [
                "input_tokens",
                "cache_read_input_tokens",
                "cache_creation_input_tokens",
                "output_tokens",
            ]
            .iter()
            .filter_map(|name| number(name))
            .collect();
            (!parts.is_empty()).then(|| parts.iter().sum())
        });
    (used, window)
}

/// The question cards an engine's ask carries, in one shape: `{question, header, options:
/// [{label, description}], multiSelect}`.
pub(super) fn question_cards(input: &Value) -> Vec<Value> {
    input["questions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|card| {
            let question = card["question"].as_str()?.trim();
            if question.is_empty() {
                return None;
            }
            let options: Vec<Value> = card["options"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|option| {
                    let label = option["label"].as_str().or_else(|| option.as_str())?;
                    Some(json!({
                        "label": label,
                        "description": option["description"].as_str().unwrap_or(""),
                    }))
                })
                .collect();
            Some(json!({
                "question": question,
                "header": card["header"].as_str().unwrap_or(""),
                "options": options,
                "multiSelect": card["multiSelect"].as_bool().unwrap_or(false),
            }))
        })
        .collect()
}

/// A tool's raw parameters or result for the chat's payload viewer, clipped so one huge result
/// can't flood the run's events. It stays on this device with the chat.
pub(super) fn clip_value(value: &Value) -> Value {
    const LIMIT: usize = 24_000;
    match value {
        Value::String(text) if text.len() > LIMIT => json!(clip(text, LIMIT)),
        Value::String(_) | Value::Null | Value::Bool(_) | Value::Number(_) => value.clone(),
        _ => {
            let text = value.to_string();
            if text.len() > LIMIT {
                json!(clip(&text, LIMIT))
            } else {
                value.clone()
            }
        }
    }
}
