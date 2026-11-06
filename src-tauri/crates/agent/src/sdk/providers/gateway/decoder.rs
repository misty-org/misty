//! Reads the Gateway's stream, whose events are already the SDK's stream parts.
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{json, Value};

use crate::sdk::{model::StreamDecoder, stream::StreamPart};

#[derive(Default)]
pub(super) struct GatewayDecoder {
    /// An event that can't be read ends the stream, where other providers carry on past it.
    ended: bool,
}

fn iso_timestamp(text: &str) -> Option<String> {
    let parsed = DateTime::parse_from_rfc3339(text).ok()?;
    Some(parsed.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Millis, true))
}

/// A tool the provider ran itself isn't Misty's to run, so it doesn't read as a tool call.
fn provider_executed(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str) == Some("tool-call")
        && value.get("providerExecuted") == Some(&Value::Bool(true))
}

impl StreamDecoder for GatewayDecoder {
    // The Gateway starts the stream itself.
    fn start(&mut self, _out: &mut Vec<StreamPart>) {}

    fn event(&mut self, data: &str, out: &mut Vec<StreamPart>) {
        if self.ended {
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            self.ended = true;
            out.push(StreamPart::Error { error: json!({ "name": "AI_JSONParseError", "text": data }) });
            return;
        };
        if value.get("type").and_then(Value::as_str) == Some("raw") {
            return;
        }
        if provider_executed(&value) {
            out.push(StreamPart::Other(value));
            return;
        }
        let mut part = serde_json::from_value(value.clone()).unwrap_or(StreamPart::Other(value));
        if let StreamPart::ResponseMetadata { timestamp: Some(timestamp), .. } = &mut part {
            if let Some(iso) = iso_timestamp(timestamp) {
                *timestamp = iso;
            }
        }
        out.push(part);
    }

    fn finish(&mut self, _out: &mut Vec<StreamPart>) {}
}
