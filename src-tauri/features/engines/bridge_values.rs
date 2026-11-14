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
///
/// The size is the first of: Codex's and OpenCode's `total_tokens`, an explicit `used` (ACP's
/// usage_update, pi's reply, a compaction's `0`), the camelCase `totalTokens` that ACP prompt
/// results carry (Grok's `_meta`, MiniMax's and omp's `usage`, pi-ai), then the sum of the
/// token buckets. Only an explicit `used` can say 0: a failed attempt reports zero tokens, and
/// that must not read as a compaction's unknown size.
pub(crate) fn context_usage(usage: &Value) -> (Option<u64>, Option<u64>) {
    let number = |name: &str| usage.get(name).and_then(Value::as_u64);
    let window = number("model_context_window")
        .or_else(|| number("modelContextWindow"))
        .or_else(|| number("context_window"))
        .or_else(|| number("contextWindow"))
        .or_else(|| number("size"));
    let counted = |tokens: &u64| *tokens > 0;
    let used = number("total_tokens")
        .filter(counted)
        .or_else(|| number("used"))
        .or_else(|| number("totalTokens").filter(counted))
        .or_else(|| {
            // Each bucket under the first name it's sent by, so one spelt two ways counts once.
            let parts: Vec<u64> = [
                &["input_tokens", "inputTokens"][..],
                &["cache_read_input_tokens", "cacheRead", "cachedReadTokens"][..],
                &[
                    "cache_creation_input_tokens",
                    "cacheWrite",
                    "cachedWriteTokens",
                ][..],
                &["output_tokens", "outputTokens"][..],
            ]
            .iter()
            .filter_map(|names| names.iter().find_map(|name| number(name)))
            .collect();
            Some(parts.iter().sum()).filter(counted)
        });
    (used, window)
}

/// The usage report's token buckets, under each name an engine sends them by.
pub(super) const USAGE_BUCKETS: [(&str, &[&str]); 4] = [
    ("input", &["input_tokens", "inputTokens", "input"]),
    ("output", &["output_tokens", "outputTokens", "output"]),
    (
        "cacheRead",
        &[
            "cache_read_input_tokens",
            "cachedInputTokens",
            "cacheRead",
            "cachedReadTokens",
        ],
    ),
    (
        "cacheWrite",
        &[
            "cache_creation_input_tokens",
            "cacheWrite",
            "cachedWriteTokens",
        ],
    ),
];

/// Whether a report's size is only an ACP turn's `totalTokens`, which sums every model call in
/// the turn rather than measuring the context.
pub(super) fn only_turn_total(usage: &Value) -> bool {
    let counted = |name: &str| {
        usage
            .get(name)
            .and_then(Value::as_u64)
            .is_some_and(|n| n > 0)
    };
    !counted("total_tokens") && usage.get("used").is_none() && counted("totalTokens")
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
