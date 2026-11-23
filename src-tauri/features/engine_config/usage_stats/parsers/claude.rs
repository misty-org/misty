// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use super::{clean, de_count, de_opt_string, model_or_unknown, UsageEvent};
use crate::engine_config::usage_stats::time::parse_iso_ms;
use crate::engine_config::usage_stats::types::Tokens;
use serde::Deserialize;

#[derive(Deserialize)]
struct Line {
    #[serde(default, rename = "type", deserialize_with = "de_opt_string")]
    kind: Option<String>,
    #[serde(default)]
    message: Option<Message>,
    #[serde(default, rename = "requestId", deserialize_with = "de_opt_string")]
    request_id: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string")]
    timestamp: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string")]
    cwd: Option<String>,
    #[serde(default, rename = "sessionId", deserialize_with = "de_opt_string")]
    session_id: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string")]
    uuid: Option<String>,
}

#[derive(Deserialize)]
struct Message {
    #[serde(default, deserialize_with = "de_opt_string")]
    id: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string")]
    model: Option<String>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Deserialize)]
struct Usage {
    #[serde(default, deserialize_with = "de_count")]
    input_tokens: i64,
    #[serde(default, deserialize_with = "de_count")]
    output_tokens: i64,
    #[serde(default, deserialize_with = "de_count")]
    cache_creation_input_tokens: i64,
    #[serde(default, deserialize_with = "de_count")]
    cache_read_input_tokens: i64,
}

const SYNTHETIC_MODEL: &str = "<synthetic>";

pub(crate) struct ClaudeParser;

impl ClaudeParser {
    pub fn wants(&self, line: &[u8]) -> bool {
        super::contains(line, b"\"usage\"")
    }

    pub fn feed(&self, line: &[u8], out: &mut Vec<UsageEvent>) {
        if let Some(event) = parse_line(line) {
            out.push(event);
        }
    }
}

fn parse_line(line: &[u8]) -> Option<UsageEvent> {
    let parsed: Line = serde_json::from_slice(line).ok()?;
    if parsed
        .kind
        .as_deref()
        .is_some_and(|kind| kind != "assistant")
    {
        return None;
    }
    let message = parsed.message?;
    let usage = message.usage?;
    let model = clean(message.model.as_deref());
    if model.as_deref() == Some(SYNTHETIC_MODEL) {
        return None;
    }
    let tokens = Tokens {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cache_read: usage.cache_read_input_tokens,
        cache_write: usage.cache_creation_input_tokens,
        reasoning: 0,
    };
    if tokens.is_zero() {
        return None;
    }
    let ts_ms = parse_iso_ms(parsed.timestamp.as_deref()?)?;
    let key = match (&message.id, &parsed.uuid) {
        (Some(id), _) => format!(
            "claude:{id}:{}",
            parsed.request_id.as_deref().unwrap_or_default()
        ),
        (None, Some(uuid)) => format!("claude:uuid:{uuid}"),
        (None, None) => return None,
    };
    Some(UsageEvent {
        key,
        ts_ms,
        engine: "claude",
        model: model_or_unknown(model),
        project: parsed.cwd,
        session_id: parsed.session_id,
        tokens,
    })
}
