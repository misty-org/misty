//! Reads a Messages event stream. Ported from `doStream` in `@ai-sdk/anthropic`. Unlike the other
//! formats, the finish comes from the `message_stop` event, so a stream that ends without one has
//! no finish part.
use std::collections::HashMap;

use serde_json::{json, Map, Value};

use super::{
    chunk::{valid_details, Chunk, Delta, MessageDelta, StartBlock, StartContent, StartMessage},
    usage::{self, TokenCounts},
};
use crate::sdk::{
    model::StreamDecoder,
    stream::{FinishReason, StreamPart},
};

enum OpenBlock {
    Text,
    Reasoning,
    ToolCall { id: String, name: String, input: String, caller: Option<Value> },
}

pub(super) struct AnthropicDecoder {
    warnings: Vec<Value>,
    uses_json_response_tool: bool,
    is_json_response_from_tool: bool,
    blocks: HashMap<u64, OpenBlock>,
    in_thinking_block: bool,
    finish_reason: FinishReason,
    counts: TokenCounts,
    raw_usage: Option<Map<String, Value>>,
    stop_sequence: Option<String>,
    stop_details: Option<Value>,
    message_open: bool,
    active_message: Option<String>,
    invalid_sequence: bool,
}

fn caller_metadata(caller: Option<&Value>) -> Option<Value> {
    let caller = caller?;
    let mut info = Map::new();
    info.insert("type".into(), caller.get("type").cloned().unwrap_or(Value::Null));
    if let Some(tool_id) = caller.get("tool_id") {
        info.insert("toolId".into(), tool_id.clone());
    }
    Some(json!({ "anthropic": { "caller": info } }))
}

/// The SDK reports a chunk as its schema read it, which only keeps these parts of a message.
fn without_unread_fields(raw: &Value) -> Value {
    let mut chunk = raw.clone();
    if let Some(Value::Object(message)) = chunk.get_mut("message") {
        message.retain(|name, _| {
            matches!(name.as_str(), "id" | "model" | "role" | "usage" | "content" | "stop_reason" | "container")
        });
    }
    chunk
}

fn validation_error(value: Value, reason: &str) -> Value {
    json!({
        "name": "AI_TypeValidationError",
        "message": format!("Type validation failed: Value: {value}.\nError message: {reason}"),
        "value": value,
    })
}

fn unified_reason(reason: Option<&str>, json_from_tool: bool) -> &'static str {
    match reason {
        Some("pause_turn" | "end_turn" | "stop_sequence") => "stop",
        Some("refusal") => "content-filter",
        Some("tool_use") if json_from_tool => "stop",
        Some("tool_use") => "tool-calls",
        Some("max_tokens" | "model_context_window_exceeded") => "length",
        _ => "other",
    }
}

impl AnthropicDecoder {
    pub(super) fn new(warnings: Vec<Value>, uses_json_response_tool: bool) -> Self {
        Self {
            warnings,
            uses_json_response_tool,
            is_json_response_from_tool: false,
            blocks: HashMap::new(),
            in_thinking_block: false,
            finish_reason: FinishReason { unified: "other".into(), raw: None },
            counts: TokenCounts::default(),
            raw_usage: None,
            stop_sequence: None,
            stop_details: None,
            message_open: false,
            active_message: None,
            invalid_sequence: false,
        }
    }

    fn message_start(&mut self, message: StartMessage, raw: &Value, out: &mut Vec<StreamPart>) {
        if self.message_open {
            if self.active_message == message.id {
                return;
            }
            self.invalid_sequence = true;
            let name = |id: &Option<String>| id.as_ref().map_or_else(|| "undefined".to_owned(), |id| json!(id).to_string());
            out.push(StreamPart::Error {
                error: json!({
                    "name": "AI_InvalidResponseDataError",
                    "message": format!(
                        "Received message_start for message {} while message {} is still open.",
                        name(&message.id),
                        name(&self.active_message)
                    ),
                    "data": without_unread_fields(raw),
                }),
            });
            return;
        }
        self.message_open = true;
        self.active_message = message.id.clone();
        self.counts.start(&message.usage);
        self.raw_usage = message.usage.as_object().cloned();
        if let Some(reason) = message.stop_reason {
            self.finish_reason = FinishReason {
                unified: unified_reason(Some(&reason), self.is_json_response_from_tool).into(),
                raw: Some(reason),
            };
        }
        out.push(StreamPart::ResponseMetadata { id: message.id, model_id: message.model, timestamp: None });
        for StartContent::ToolUse { id, name, input, caller } in message.content.unwrap_or_default() {
            let input = input.map_or_else(|| "{}".to_owned(), |input| input.get().to_owned());
            out.push(StreamPart::ToolInputStart { id: id.clone(), tool_name: name.clone(), provider_metadata: None });
            out.push(StreamPart::ToolInputDelta { id: id.clone(), delta: input.clone(), provider_metadata: None });
            out.push(StreamPart::ToolInputEnd { id: id.clone(), provider_metadata: None });
            out.push(StreamPart::ToolCall {
                tool_call_id: id,
                tool_name: name,
                input,
                provider_metadata: caller_metadata(caller.as_ref()),
            });
        }
    }

    fn block_start(&mut self, index: u64, block: StartBlock, out: &mut Vec<StreamPart>) {
        if !matches!(block, StartBlock::Other) {
            self.in_thinking_block = matches!(block, StartBlock::Thinking { .. });
        }
        let id = index.to_string();
        match block {
            StartBlock::Text { .. } => {
                // A JSON response tool returns its answer as the tool call, so text is ignored.
                if !self.uses_json_response_tool {
                    self.blocks.insert(index, OpenBlock::Text);
                    out.push(StreamPart::TextStart { id, provider_metadata: None });
                }
            }
            StartBlock::Thinking { .. } => {
                self.blocks.insert(index, OpenBlock::Reasoning);
                out.push(StreamPart::ReasoningStart { id, provider_metadata: None });
            }
            StartBlock::RedactedThinking { data } => {
                self.blocks.insert(index, OpenBlock::Reasoning);
                out.push(StreamPart::ReasoningStart {
                    id,
                    provider_metadata: Some(json!({ "anthropic": { "redactedData": data } })),
                });
            }
            StartBlock::ToolUse { id: call_id, name, input, caller } => {
                if self.uses_json_response_tool && name == "json" {
                    self.is_json_response_from_tool = true;
                    self.blocks.insert(index, OpenBlock::Text);
                    out.push(StreamPart::TextStart { id, provider_metadata: None });
                    return;
                }
                // Input only comes here for a deferred call, and `{}` means it comes as deltas.
                let input = input.map(|input| input.get().to_owned()).filter(|input| input != "{}");
                out.push(StreamPart::ToolInputStart { id: call_id.clone(), tool_name: name.clone(), provider_metadata: None });
                self.blocks.insert(
                    index,
                    OpenBlock::ToolCall { id: call_id, name, input: input.unwrap_or_default(), caller },
                );
            }
            StartBlock::Other => {}
        }
    }

    fn block_stop(&mut self, index: u64, out: &mut Vec<StreamPart>) {
        self.in_thinking_block = false;
        let id = index.to_string();
        match self.blocks.remove(&index) {
            Some(OpenBlock::Text) => out.push(StreamPart::TextEnd { id, provider_metadata: None }),
            Some(OpenBlock::Reasoning) => out.push(StreamPart::ReasoningEnd { id, provider_metadata: None }),
            Some(OpenBlock::ToolCall { id: call_id, name, input, caller }) => {
                out.push(StreamPart::ToolInputEnd { id: call_id.clone(), provider_metadata: None });
                out.push(StreamPart::ToolCall {
                    tool_call_id: call_id,
                    tool_name: name,
                    input: if input.is_empty() { "{}".to_owned() } else { input },
                    provider_metadata: caller_metadata(caller.as_ref()),
                });
            }
            None => {}
        }
    }

    fn block_delta(&mut self, index: u64, delta: Delta, out: &mut Vec<StreamPart>) {
        let id = index.to_string();
        match delta {
            Delta::TextDelta { text } => {
                if !self.uses_json_response_tool {
                    out.push(StreamPart::TextDelta { id, delta: text, provider_metadata: None });
                }
            }
            Delta::ThinkingDelta { thinking } => {
                out.push(StreamPart::ReasoningDelta { id, delta: thinking, provider_metadata: None });
            }
            // Signatures only belong on thinking blocks. This one has to reach the next turn.
            Delta::SignatureDelta { signature } => {
                if self.in_thinking_block {
                    out.push(StreamPart::ReasoningDelta {
                        id,
                        delta: String::new(),
                        provider_metadata: Some(json!({ "anthropic": { "signature": signature } })),
                    });
                }
            }
            Delta::InputJsonDelta { partial_json } => {
                if partial_json.is_empty() {
                    return;
                }
                match self.blocks.get_mut(&index) {
                    Some(OpenBlock::Text) if self.is_json_response_from_tool => {
                        out.push(StreamPart::TextDelta { id, delta: partial_json, provider_metadata: None });
                    }
                    Some(OpenBlock::ToolCall { id: call_id, input, .. }) if !self.is_json_response_from_tool => {
                        input.push_str(&partial_json);
                        out.push(StreamPart::ToolInputDelta { id: call_id.clone(), delta: partial_json, provider_metadata: None });
                    }
                    _ => {}
                }
            }
            Delta::CompactionDelta | Delta::CitationsDelta => {}
        }
    }

    fn message_delta(&mut self, delta: MessageDelta, usage: &Value) {
        self.counts.update(usage);
        self.finish_reason = FinishReason {
            unified: unified_reason(delta.stop_reason.as_deref(), self.is_json_response_from_tool).into(),
            raw: delta.stop_reason,
        };
        self.stop_sequence = delta.stop_sequence;
        self.stop_details = delta.stop_details.map(|details| {
            let mut mapped = Map::new();
            mapped.insert("type".into(), json!(details.kind));
            for (name, value) in [
                ("category", details.category),
                ("explanation", details.explanation),
                ("recommendedModel", details.recommended_model),
            ] {
                if let Some(value) = value {
                    mapped.insert(name.into(), json!(value));
                }
            }
            Value::Object(mapped)
        });
        let raw = self.raw_usage.get_or_insert_with(Map::new);
        if let Some(fields) = usage::known_fields(usage).as_object() {
            raw.extend(fields.iter().map(|(name, value)| (name.clone(), value.clone())));
        }
    }

    fn message_stop(&mut self, out: &mut Vec<StreamPart>) {
        self.message_open = false;
        self.active_message = None;
        let raw = self.raw_usage.clone().map(Value::Object);
        let mut metadata = Map::new();
        metadata.insert("usage".into(), raw.clone().unwrap_or(Value::Null));
        metadata.insert("stopSequence".into(), json!(self.stop_sequence));
        if let Some(details) = &self.stop_details {
            metadata.insert("stopDetails".into(), details.clone());
        }
        metadata.insert("iterations".into(), self.counts.iterations_metadata());
        metadata.insert("container".into(), Value::Null);
        metadata.insert("contextManagement".into(), Value::Null);
        out.push(StreamPart::Finish {
            finish_reason: self.finish_reason.clone(),
            usage: self.counts.to_usage(raw),
            provider_metadata: Some(json!({ "anthropic": metadata })),
        });
    }
}

impl StreamDecoder for AnthropicDecoder {
    fn start(&mut self, out: &mut Vec<StreamPart>) {
        out.push(StreamPart::StreamStart { warnings: std::mem::take(&mut self.warnings) });
    }

    fn event(&mut self, data: &str, out: &mut Vec<StreamPart>) {
        if self.invalid_sequence {
            return;
        }
        let raw: Value = match serde_json::from_str(data) {
            Ok(raw) => raw,
            Err(error) => {
                out.push(StreamPart::Error {
                    error: json!({
                        "name": "AI_JSONParseError",
                        "message": format!("JSON parsing failed: Text: {data}.\nError message: {error}"),
                        "text": data,
                    }),
                });
                return;
            }
        };
        // Parsed from the text rather than the value, which would sort the keys of a tool's input.
        let chunk = match serde_json::from_str::<Chunk>(data) {
            Ok(chunk) => chunk,
            Err(error) => {
                out.push(StreamPart::Error { error: validation_error(raw, &error.to_string()) });
                return;
            }
        };
        if let Err(reason) = valid_details(&chunk, &raw) {
            out.push(StreamPart::Error { error: validation_error(raw, reason) });
            return;
        }
        match chunk {
            Chunk::Ping => {}
            Chunk::MessageStart { message } => self.message_start(message, &raw, out),
            Chunk::ContentBlockStart { index, content_block } => self.block_start(index, content_block, out),
            Chunk::ContentBlockDelta { index, delta } => self.block_delta(index, delta, out),
            Chunk::ContentBlockStop { index } => self.block_stop(index, out),
            Chunk::MessageDelta { delta, usage } => self.message_delta(delta, &usage),
            Chunk::MessageStop => self.message_stop(out),
            Chunk::Error { error } => {
                out.push(StreamPart::Error { error: json!({ "type": error.kind, "message": error.message }) });
            }
        }
    }

    fn finish(&mut self, _out: &mut Vec<StreamPart>) {}
}
