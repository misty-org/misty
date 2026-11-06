//! Reads a chat-completions event stream.
use std::collections::HashMap;

use chrono::{DateTime, SecondsFormat};
use serde_json::{json, Map, Value};

use crate::sdk::{
    model::StreamDecoder,
    stream::{FinishReason, InputTokens, OutputTokens, StreamPart, Usage},
    tool_calls::{ToolCallDelta, ToolCallTracker},
};

const TEXT_ID: &str = "txt-0";
const REASONING_ID: &str = "reasoning-0";

/// A call whose name hasn't arrived. Some servers send arguments first.
#[derive(Default)]
struct PendingCall {
    id: Option<String>,
    arguments: String,
    metadata: Option<Value>,
}

pub(super) struct CompatibleDecoder {
    provider: String,
    warnings: Vec<Value>,
    tracker: ToolCallTracker,
    pending: Vec<(u64, PendingCall)>,
    forwarded: HashMap<u64, ()>,
    finish_reason: Option<FinishReason>,
    usage: Option<Value>,
    first_chunk: bool,
    reasoning_open: bool,
    text_open: bool,
}

impl CompatibleDecoder {
    pub(super) fn new(provider: &str, warnings: Vec<Value>) -> Self {
        Self {
            provider: provider.to_owned(),
            warnings,
            tracker: ToolCallTracker::default(),
            pending: Vec::new(),
            forwarded: HashMap::new(),
            finish_reason: None,
            usage: None,
            first_chunk: true,
            reasoning_open: false,
            text_open: false,
        }
    }

    fn close_reasoning(&mut self, out: &mut Vec<StreamPart>) {
        if self.reasoning_open {
            out.push(StreamPart::ReasoningEnd { id: REASONING_ID.into() });
            self.reasoning_open = false;
        }
    }

    fn fail(&mut self, error: Value, out: &mut Vec<StreamPart>) {
        self.finish_reason = Some(FinishReason::error());
        out.push(StreamPart::Error { error });
    }

    fn tool_delta(&mut self, delta: &Value, out: &mut Vec<StreamPart>) {
        let index = delta.get("index").and_then(Value::as_u64);
        let id = string_field(delta, "id");
        let function = delta.get("function");
        let name = function.and_then(|function| string_field(function, "name"));
        let arguments = function.and_then(|function| string_field(function, "arguments"));
        let metadata = self.thought_metadata(delta);
        // Servers that send no index, or a call already forwarded, go straight to the tracker.
        let Some(index) = index.filter(|index| !self.forwarded.contains_key(index)) else {
            self.forward(ToolCallDelta { index, id, name, arguments, metadata }, out);
            return;
        };
        let position = match self.pending.iter().position(|(known, _)| *known == index) {
            Some(position) => position,
            None => {
                self.pending.push((index, PendingCall::default()));
                self.pending.len() - 1
            }
        };
        let call = &mut self.pending[position].1;
        if call.id.is_none() {
            call.id = id;
        }
        if call.metadata.is_none() {
            call.metadata = metadata;
        }
        if let Some(arguments) = arguments {
            call.arguments.push_str(&arguments);
        }
        if let Some(name) = name {
            let (_, call) = self.pending.remove(position);
            self.forwarded.insert(index, ());
            self.forward(
                ToolCallDelta {
                    index: Some(index),
                    id: call.id,
                    name: Some(name),
                    arguments: Some(call.arguments),
                    metadata: call.metadata,
                },
                out,
            );
        }
    }

    fn forward(&mut self, delta: ToolCallDelta, out: &mut Vec<StreamPart>) {
        if let Err(error) = self.tracker.process(delta, out) {
            self.fail(error, out);
        }
    }

    fn thought_metadata(&self, delta: &Value) -> Option<Value> {
        let signature = delta
            .get("extra_content")?
            .get("google")?
            .get("thought_signature")?
            .as_str()?;
        Some(json!({ self.provider.as_str(): { "thoughtSignature": signature } }))
    }
}

fn string_field(value: &Value, name: &str) -> Option<String> {
    value.get(name)?.as_str().map(str::to_owned)
}

fn unified_reason(reason: &str) -> &'static str {
    match reason {
        "stop" => "stop",
        "length" => "length",
        "content_filter" => "content-filter",
        "function_call" | "tool_calls" => "tool-calls",
        _ => "other",
    }
}

fn timestamp(created: Option<i64>) -> Option<String> {
    Some(DateTime::from_timestamp(created?, 0)?.to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn converted_usage(usage: Option<&Value>) -> Usage {
    let Some(usage) = usage.filter(|usage| !usage.is_null()) else {
        return Usage::default();
    };
    let count = |value: Option<&Value>| value.and_then(Value::as_u64).unwrap_or(0);
    let prompt = count(usage.get("prompt_tokens"));
    let completion = count(usage.get("completion_tokens"));
    let cached = count(usage.pointer("/prompt_tokens_details/cached_tokens"));
    let reasoning = count(usage.pointer("/completion_tokens_details/reasoning_tokens"));
    Usage {
        input_tokens: InputTokens {
            total: Some(prompt),
            no_cache: Some(prompt.saturating_sub(cached)),
            cache_read: Some(cached),
            cache_write: None,
        },
        output_tokens: OutputTokens {
            total: Some(completion),
            text: Some(completion.saturating_sub(reasoning)),
            reasoning: Some(reasoning),
        },
        raw: Some(usage.clone()),
    }
}

impl StreamDecoder for CompatibleDecoder {
    fn start(&mut self, out: &mut Vec<StreamPart>) {
        out.push(StreamPart::StreamStart { warnings: std::mem::take(&mut self.warnings) });
    }

    fn event(&mut self, data: &str, out: &mut Vec<StreamPart>) {
        let chunk: Value = match serde_json::from_str(data) {
            Ok(chunk) => chunk,
            Err(_) => {
                self.fail(json!({ "name": "AI_JSONParseError", "text": data }), out);
                return;
            }
        };
        if let Some(error) = chunk.get("error") {
            self.fail(error.clone(), out);
            return;
        }
        if !chunk.get("choices").is_some_and(Value::is_array) {
            self.fail(json!({ "name": "AI_TypeValidationError", "message": "A chunk had no choices." }), out);
            return;
        }
        if self.first_chunk {
            self.first_chunk = false;
            out.push(StreamPart::ResponseMetadata {
                id: string_field(&chunk, "id"),
                model_id: string_field(&chunk, "model"),
                timestamp: timestamp(chunk.get("created").and_then(Value::as_i64)),
            });
        }
        if let Some(usage) = chunk.get("usage").filter(|usage| !usage.is_null()) {
            self.usage = Some(usage.clone());
        }
        let Some(choice) = chunk["choices"].get(0) else {
            return;
        };
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.finish_reason = Some(FinishReason {
                unified: unified_reason(reason).into(),
                raw: Some(reason.to_owned()),
            });
        }
        let Some(delta) = choice.get("delta").filter(|delta| !delta.is_null()) else {
            return;
        };
        let reasoning = delta
            .get("reasoning_content")
            .filter(|value| !value.is_null())
            .or_else(|| delta.get("reasoning"))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty());
        if let Some(text) = reasoning {
            if !self.reasoning_open {
                out.push(StreamPart::ReasoningStart { id: REASONING_ID.into() });
                self.reasoning_open = true;
            }
            out.push(StreamPart::ReasoningDelta { id: REASONING_ID.into(), delta: text.to_owned() });
        }
        if let Some(text) = delta.get("content").and_then(Value::as_str).filter(|text| !text.is_empty()) {
            self.close_reasoning(out);
            if !self.text_open {
                out.push(StreamPart::TextStart { id: TEXT_ID.into() });
                self.text_open = true;
            }
            out.push(StreamPart::TextDelta { id: TEXT_ID.into(), delta: text.to_owned() });
        }
        if let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) {
            self.close_reasoning(out);
            for call in calls {
                self.tool_delta(call, out);
            }
        }
    }

    fn finish(&mut self, out: &mut Vec<StreamPart>) {
        self.close_reasoning(out);
        if self.text_open {
            out.push(StreamPart::TextEnd { id: TEXT_ID.into() });
            self.text_open = false;
        }
        // Calls whose name never came still get their chance, and fail plainly if they can't.
        for (index, call) in std::mem::take(&mut self.pending) {
            self.forward(
                ToolCallDelta {
                    index: Some(index),
                    id: call.id,
                    name: None,
                    arguments: Some(call.arguments),
                    metadata: call.metadata,
                },
                out,
            );
        }
        self.tracker.flush(out);
        if self.finish_reason.is_none() {
            self.fail(
                json!({
                    "name": "AI_InvalidResponseDataError",
                    "message": "Response stream ended without a finish reason.",
                }),
                out,
            );
        }
        let mut metadata = Map::new();
        let details = self.usage.as_ref().and_then(|usage| usage.get("completion_tokens_details"));
        let mut own = Map::new();
        for (from, to) in [
            ("accepted_prediction_tokens", "acceptedPredictionTokens"),
            ("rejected_prediction_tokens", "rejectedPredictionTokens"),
        ] {
            if let Some(count) = details.and_then(|details| details.get(from)).filter(|count| !count.is_null()) {
                own.insert(to.to_owned(), count.clone());
            }
        }
        metadata.insert(self.provider.clone(), Value::Object(own));
        out.push(StreamPart::Finish {
            finish_reason: self.finish_reason.take().unwrap_or_else(FinishReason::error),
            usage: converted_usage(self.usage.as_ref()),
            provider_metadata: Some(Value::Object(metadata)),
        });
    }
}
