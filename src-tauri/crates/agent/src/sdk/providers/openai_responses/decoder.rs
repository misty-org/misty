//! Reads a Responses event stream. Ported from `doStream` in `@ai-sdk/openai`.
mod items;

use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, SecondsFormat};
use serde_json::{json, Map, Value};

use super::chunk::{read_chunk, Chunk, FailedResponse, Known, Phase, RawUsage};
use crate::sdk::{
    model::StreamDecoder,
    providers::ordered::Ordered,
    stream::{FinishReason, InputTokens, OutputTokens, StreamPart, Usage},
};

struct OngoingCall {
    name: String,
    call_id: String,
    suppress_input_streaming: bool,
    buffered_deltas: Vec<String>,
}

#[derive(Clone, Copy, PartialEq)]
enum SummaryState {
    Active,
    CanConclude,
    Concluded,
}

struct ActiveReasoning {
    encrypted_content: Option<String>,
    summary_parts: BTreeMap<u64, SummaryState>,
}

pub(super) struct ResponsesDecoder {
    warnings: Vec<Value>,
    tools: Vec<String>,
    /// Whether the call asked OpenAI to store the response. Reasoning can end sooner if so.
    stored: bool,
    finish_reason: FinishReason,
    usage: Option<RawUsage>,
    response_id: Option<String>,
    ongoing_calls: BTreeMap<u64, OngoingCall>,
    active_phase: Option<Phase>,
    has_function_call: bool,
    active_reasoning: HashMap<String, ActiveReasoning>,
    // Compatible providers can rotate opaque item IDs between events, but an output index holds
    // still for the life of its item.
    active_item_ids: HashMap<u64, String>,
    service_tier: Option<String>,
    reasoning_context: Option<String>,
    encountered_error: bool,
}

fn converted_usage(usage: Option<&RawUsage>) -> Usage {
    let Some(usage) = usage else {
        return Usage::default();
    };
    let input = usage.input_tokens;
    let output = usage.output_tokens;
    let details = usage.input_tokens_details.as_ref();
    let cached = details.and_then(|details| details.cached_tokens).unwrap_or(0);
    let cache_write = details.and_then(|details| details.cache_write_tokens);
    let reasoning = usage
        .output_tokens_details
        .as_ref()
        .and_then(|details| details.reasoning_tokens)
        .unwrap_or(0);
    Usage {
        input_tokens: InputTokens {
            total: Some(input),
            no_cache: Some(input.saturating_sub(cached).saturating_sub(cache_write.unwrap_or(0))),
            cache_read: Some(cached),
            cache_write,
        },
        output_tokens: OutputTokens {
            total: Some(output),
            text: Some(output.saturating_sub(reasoning)),
            reasoning: Some(reasoning),
        },
        raw: Some(usage.raw.clone()),
    }
}

fn item_metadata(item_id: &str) -> Option<Value> {
    Some(json!({ "openai": { "itemId": item_id } }))
}

fn reasoning_metadata(item_id: &str, encrypted: Option<&str>) -> Option<Value> {
    Some(json!({ "openai": { "itemId": item_id, "reasoningEncryptedContent": encrypted } }))
}

fn text_metadata(item_id: &str, phase: Option<Phase>) -> Option<Value> {
    let mut own = Map::new();
    own.insert("itemId".into(), json!(item_id));
    if let Some(phase) = phase {
        own.insert("phase".into(), json!(phase.as_str()));
    }
    Some(json!({ "openai": own }))
}

const CHAT_COMPLETIONS_MISMATCH: &str = "Received a Chat Completions stream while using the OpenAI Responses API. The default OpenAI provider model uses the Responses API. If your custom baseURL targets a Chat Completions-compatible endpoint, use openai.chat('model-id') or createOpenAI(...).chat('model-id') instead. You can also use @ai-sdk/openai-compatible for OpenAI-compatible providers.";

fn unified_reason(reason: Option<&str>, has_function_call: bool) -> &'static str {
    match reason {
        None => {
            if has_function_call {
                "tool-calls"
            } else {
                "stop"
            }
        }
        Some("max_output_tokens") => "length",
        Some("content_filter") => "content-filter",
        Some(_) => {
            if has_function_call {
                "tool-calls"
            } else {
                "other"
            }
        }
    }
}

fn timestamp(created_at: f64) -> Option<String> {
    let at = DateTime::from_timestamp_millis((created_at * 1000.0) as i64)?;
    Some(at.to_rfc3339_opts(SecondsFormat::Millis, true))
}

impl ResponsesDecoder {
    pub(super) fn new(warnings: Vec<Value>, tools: Vec<String>, stored: bool) -> Self {
        Self {
            warnings,
            tools,
            stored,
            finish_reason: FinishReason { unified: "other".into(), raw: None },
            usage: None,
            response_id: None,
            ongoing_calls: BTreeMap::new(),
            active_phase: None,
            has_function_call: false,
            active_reasoning: HashMap::new(),
            active_item_ids: HashMap::new(),
            service_tier: None,
            reasoning_context: None,
            encountered_error: false,
        }
    }

    fn resolved_item_id(&self, item_id: String, output_index: Option<u64>) -> String {
        output_index
            .and_then(|index| self.active_item_ids.get(&index).cloned())
            .unwrap_or(item_id)
    }

    fn fail(&mut self, error: Value, out: &mut Vec<StreamPart>) {
        self.finish_reason = FinishReason::error();
        out.push(StreamPart::Error { error });
    }

    fn invalid_chunk(&mut self, value: Value, data: &str, out: &mut Vec<StreamPart>) {
        let is_chat_completion = value.is_object()
            && value.get("choices").is_some_and(Value::is_array)
            && !value.get("type").is_some_and(Value::is_string);
        if is_chat_completion {
            // Written from the text, because a `Value` would sort its keys.
            let written = Ordered::from_text(data).map(|chunk| chunk.to_text()).unwrap_or_default();
            let error = json!({
                "name": "AI_APICallError",
                "message": CHAT_COMPLETIONS_MISMATCH,
                "responseBody": written,
                "isRetryable": false,
                "data": value,
            });
            self.fail(error, out);
            return;
        }
        let message = format!("Type validation failed: Value: {value}.\nError message: The chunk has no type.");
        self.fail(json!({ "name": "AI_TypeValidationError", "message": message, "value": value }), out);
    }

    fn failed(&mut self, sequence_number: u64, response: FailedResponse, out: &mut Vec<StreamPart>) {
        let reason = response.incomplete_details.as_ref().map(|details| details.reason.clone());
        self.finish_reason = FinishReason {
            unified: match reason.as_deref() {
                Some(reason) if !reason.is_empty() => unified_reason(Some(reason), self.has_function_call).into(),
                _ => "error".into(),
            },
            raw: Some(reason.filter(|reason| !reason.is_empty()).unwrap_or_else(|| "error".into())),
        };
        self.usage = response.usage;
        if let Some(context) = response.reasoning.and_then(|reasoning| reasoning.context) {
            self.reasoning_context = Some(context);
        }
        if let Some(error) = response.error.filter(|_| !self.encountered_error) {
            self.encountered_error = true;
            let mut echoed = Map::new();
            let mut own_error = Map::new();
            if let Some(code) = error.code {
                own_error.insert("code".into(), json!(code));
            }
            own_error.insert("message".into(), json!(error.message));
            echoed.insert("error".into(), Value::Object(own_error));
            if let Some(details) = response.incomplete_details {
                echoed.insert("incomplete_details".into(), json!({ "reason": details.reason }));
            }
            if let Some(tier) = response.service_tier {
                echoed.insert("service_tier".into(), json!(tier));
            }
            out.push(StreamPart::Error {
                error: json!({ "type": "response.failed", "sequence_number": sequence_number, "response": echoed }),
            });
        }
    }

    fn known(&mut self, chunk: Known, out: &mut Vec<StreamPart>) {
        match chunk {
            Known::ItemAdded { output_index, item } => self.item_added(output_index, item, out),
            Known::ItemDone { output_index, item } => self.item_done(output_index, item, out),
            Known::ArgumentsDelta { output_index, delta } => {
                if let Some(call) = self.ongoing_calls.get_mut(&output_index) {
                    if call.suppress_input_streaming {
                        call.buffered_deltas.push(delta);
                    } else {
                        out.push(StreamPart::ToolInputDelta { id: call.call_id.clone(), delta, provider_metadata: None });
                    }
                }
            }
            Known::Created { response } => {
                self.response_id = Some(response.id.clone());
                out.push(StreamPart::ResponseMetadata {
                    id: Some(response.id),
                    model_id: Some(response.model),
                    timestamp: timestamp(response.created_at),
                });
            }
            Known::TextDelta { item_id, output_index, delta } => {
                let id = self.resolved_item_id(item_id, output_index);
                out.push(StreamPart::TextDelta { id, delta, provider_metadata: None });
            }
            Known::SummaryPartAdded { item_id, output_index, summary_index } => {
                let item_id = self.resolved_item_id(item_id, output_index);
                self.summary_part_added(item_id, summary_index, out);
            }
            Known::SummaryTextDelta { item_id, output_index, summary_index, delta } => {
                let item_id = self.resolved_item_id(item_id, output_index);
                out.push(StreamPart::ReasoningDelta {
                    id: format!("{item_id}:{summary_index}"),
                    delta,
                    provider_metadata: item_metadata(&item_id),
                });
            }
            Known::SummaryPartDone { item_id, output_index, summary_index } => {
                let item_id = self.resolved_item_id(item_id, output_index);
                let stored = self.stored;
                if let Some(active) = self.active_reasoning.get_mut(&item_id) {
                    if stored {
                        out.push(StreamPart::ReasoningEnd {
                            id: format!("{item_id}:{summary_index}"),
                            provider_metadata: item_metadata(&item_id),
                        });
                        active.summary_parts.insert(summary_index, SummaryState::Concluded);
                    } else {
                        // Unstored, the part waits for the item's encrypted content.
                        active.summary_parts.insert(summary_index, SummaryState::CanConclude);
                    }
                }
            }
            Known::Finished { response } => {
                let reason = response.incomplete_details.map(|details| details.reason);
                self.finish_reason = FinishReason {
                    unified: unified_reason(reason.as_deref(), self.has_function_call).into(),
                    raw: reason,
                };
                self.usage = Some(response.usage);
                if let Some(tier) = response.service_tier {
                    self.service_tier = Some(tier);
                }
                if let Some(context) = response.reasoning.and_then(|reasoning| reasoning.context) {
                    self.reasoning_context = Some(context);
                }
            }
            Known::Failed { sequence_number, response } => self.failed(sequence_number, response, out),
            Known::InProgress { .. } | Known::BuiltInToolEvent => {}
        }
    }
}

impl StreamDecoder for ResponsesDecoder {
    fn start(&mut self, out: &mut Vec<StreamPart>) {
        out.push(StreamPart::StreamStart { warnings: std::mem::take(&mut self.warnings) });
    }

    fn event(&mut self, data: &str, out: &mut Vec<StreamPart>) {
        let value: Value = match serde_json::from_str(data) {
            Ok(value) => value,
            Err(error) => {
                let message = format!("JSON parsing failed: Text: {data}.\nError message: {error}");
                self.fail(json!({ "name": "AI_JSONParseError", "message": message, "text": data }), out);
                return;
            }
        };
        match read_chunk(&value) {
            None => self.invalid_chunk(value, data, out),
            Some(Chunk::ErrorFrame(frame)) => {
                self.encountered_error = true;
                self.finish_reason = FinishReason { unified: "error".into(), raw: Some("error".into()) };
                out.push(StreamPart::Error { error: frame });
            }
            Some(Chunk::Known(known)) => self.known(*known, out),
            Some(Chunk::Unknown) => {}
        }
    }

    fn finish(&mut self, out: &mut Vec<StreamPart>) {
        for call in self.ongoing_calls.values() {
            if !call.suppress_input_streaming {
                continue;
            }
            out.push(StreamPart::ToolInputStart { id: call.call_id.clone(), tool_name: call.name.clone(), provider_metadata: None });
            for delta in &call.buffered_deltas {
                out.push(StreamPart::ToolInputDelta { id: call.call_id.clone(), delta: delta.clone(), provider_metadata: None });
            }
        }
        let mut own = Map::new();
        own.insert("responseId".into(), json!(self.response_id));
        if let Some(tier) = &self.service_tier {
            own.insert("serviceTier".into(), json!(tier));
        }
        if let Some(context) = &self.reasoning_context {
            own.insert("reasoningContext".into(), json!(context));
        }
        out.push(StreamPart::Finish {
            finish_reason: self.finish_reason.clone(),
            usage: converted_usage(self.usage.as_ref()),
            provider_metadata: Some(json!({ "openai": own })),
        });
    }
}
