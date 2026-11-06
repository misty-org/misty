//! One event of a Responses stream, as the SDK's `openaiResponsesChunkSchema` reads it. Its last
//! rule takes anything with a string `type` as an unknown chunk, so a known event that is malformed
//! is ignored rather than reported. Only a chunk with no `type` at all is invalid.
use serde::Deserialize;
use serde_json::{json, Map, Value};

#[derive(Deserialize)]
#[serde(tag = "type")]
pub(super) enum Known {
    #[serde(rename = "response.output_text.delta")]
    TextDelta { item_id: String, output_index: Option<u64>, delta: String },
    #[serde(rename = "response.completed", alias = "response.incomplete")]
    Finished { response: FinishedResponse },
    #[serde(rename = "response.failed")]
    Failed { sequence_number: u64, response: FailedResponse },
    #[serde(rename = "response.created")]
    Created { response: CreatedResponse },
    #[serde(rename = "response.in_progress")]
    InProgress { #[allow(dead_code)] response: CreatedResponse },
    #[serde(rename = "response.output_item.added")]
    ItemAdded { output_index: u64, item: AddedItem },
    #[serde(rename = "response.output_item.done")]
    ItemDone { output_index: u64, item: DoneItem },
    #[serde(rename = "response.function_call_arguments.delta")]
    ArgumentsDelta { output_index: u64, delta: String },
    #[serde(rename = "response.reasoning_summary_part.added")]
    SummaryPartAdded { item_id: String, output_index: Option<u64>, summary_index: u64 },
    #[serde(rename = "response.reasoning_summary_text.delta")]
    SummaryTextDelta { item_id: String, output_index: Option<u64>, summary_index: u64, delta: String },
    #[serde(rename = "response.reasoning_summary_part.done")]
    SummaryPartDone { item_id: String, output_index: Option<u64>, summary_index: u64 },
    /// Events that only happen with OpenAI's built-in tools, which Misty never offers.
    #[serde(
        rename = "response.custom_tool_call_input.delta",
        alias = "response.image_generation_call.partial_image",
        alias = "response.code_interpreter_call_code.delta",
        alias = "response.code_interpreter_call_code.done",
        alias = "response.output_text.annotation.added",
        alias = "response.apply_patch_call_operation_diff.delta",
        alias = "response.apply_patch_call_operation_diff.done"
    )]
    BuiltInToolEvent,
}

#[derive(Deserialize)]
pub(super) struct IncompleteDetails {
    pub reason: String,
}

#[derive(Deserialize)]
pub(super) struct ReasoningEcho {
    pub context: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct FinishedResponse {
    pub incomplete_details: Option<IncompleteDetails>,
    pub usage: RawUsage,
    pub reasoning: Option<ReasoningEcho>,
    pub service_tier: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct FailedError {
    pub code: Option<String>,
    pub message: String,
}

#[derive(Deserialize)]
pub(super) struct FailedResponse {
    pub error: Option<FailedError>,
    pub incomplete_details: Option<IncompleteDetails>,
    pub usage: Option<RawUsage>,
    pub reasoning: Option<ReasoningEcho>,
    pub service_tier: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct CreatedResponse {
    pub id: String,
    pub created_at: f64,
    pub model: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum AddedItem {
    Message { id: String, phase: Option<Phase> },
    Reasoning { id: String, encrypted_content: Option<String> },
    FunctionCall {
        #[allow(dead_code)]
        id: String,
        call_id: String,
        name: String,
        #[allow(dead_code)]
        arguments: String,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum DoneItem {
    Message { id: String, phase: Option<Phase> },
    Reasoning { id: String, encrypted_content: Option<String> },
    FunctionCall {
        id: String,
        call_id: String,
        name: String,
        arguments: String,
        #[allow(dead_code)]
        status: CallStatus,
        namespace: Option<String>,
        caller: Option<Caller>,
    },
    #[serde(other)]
    Other,
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(super) enum Phase {
    Commentary,
    FinalAnswer,
}

impl Phase {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Commentary => "commentary",
            Self::FinalAnswer => "final_answer",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum CallStatus {
    InProgress,
    Completed,
    Incomplete,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum Caller {
    Direct,
    Program { caller_id: String },
}

/// Usage as the SDK's schema keeps it: only these fields, and `raw` carries exactly them.
#[derive(Deserialize)]
pub(super) struct RawUsage {
    pub input_tokens: u64,
    pub input_tokens_details: Option<InputDetails>,
    pub output_tokens: u64,
    pub output_tokens_details: Option<OutputDetails>,
    #[serde(skip)]
    pub raw: Value,
}

#[derive(Deserialize)]
pub(super) struct InputDetails {
    pub cached_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
}

#[derive(Deserialize)]
pub(super) struct OutputDetails {
    pub reasoning_tokens: Option<u64>,
}

fn keep(object: &Value, names: &[&str]) -> Map<String, Value> {
    let mut kept = Map::new();
    for name in names {
        if let Some(value) = object.get(*name) {
            kept.insert((*name).to_owned(), value.clone());
        }
    }
    kept
}

/// The usage as the SDK reports it in `raw`, from the same event's `response.usage`.
pub(super) fn raw_usage(usage: &Value) -> Value {
    let mut raw = keep(usage, &["input_tokens", "output_tokens"]);
    for (name, known) in [
        (
            "input_tokens_details",
            &[
                "cached_tokens",
                "cache_write_tokens",
                "orchestration_input_tokens",
                "orchestration_input_cached_tokens",
            ][..],
        ),
        ("output_tokens_details", &["reasoning_tokens", "orchestration_output_tokens"][..]),
    ] {
        match usage.get(name) {
            Some(details) if details.is_object() => {
                raw.insert(name.to_owned(), Value::Object(keep(details, known)));
            }
            Some(other) => {
                raw.insert(name.to_owned(), other.clone());
            }
            None => {}
        }
    }
    Value::Object(raw)
}

pub(super) enum Chunk {
    Known(Box<Known>),
    /// An `error` event, as the schema that matched it keeps it.
    ErrorFrame(Value),
    Unknown,
}

fn text_or_null(value: Option<&Value>) -> bool {
    value.map_or(true, |value| value.is_null() || value.is_string())
}

/// Two shapes exist. OpenAI's early `insufficient_quota` failure nests the error, and its documented
/// event has the fields at the top.
fn error_frame(value: &Value) -> Option<Value> {
    let sequence = value.get("sequence_number").filter(|number| number.is_number())?;
    if let Some(error) = value.get("error").filter(|error| {
        error.get("type").is_some_and(Value::is_string)
            && error.get("code").is_some_and(Value::is_string)
            && error.get("message").is_some_and(Value::is_string)
            && text_or_null(error.get("param"))
    }) {
        return Some(json!({
            "type": "error",
            "sequence_number": sequence,
            "error": keep(error, &["type", "code", "message", "param"]),
        }));
    }
    let fine = value.get("message").is_some_and(Value::is_string)
        && text_or_null(value.get("code"))
        && text_or_null(value.get("param"));
    fine.then(|| Value::Object(keep(value, &["type", "sequence_number", "code", "message", "param"])))
}

/// Reads a parsed event, or `None` when the schema would refuse it outright.
pub(super) fn read_chunk(value: &Value) -> Option<Chunk> {
    let kind = value.get("type")?.as_str()?;
    if kind == "error" {
        return Some(error_frame(value).map_or(Chunk::Unknown, Chunk::ErrorFrame));
    }
    Some(match serde_json::from_value::<Known>(value.clone()) {
        Ok(Known::Finished { mut response }) => {
            response.usage.raw = value.pointer("/response/usage").map(raw_usage).unwrap_or_default();
            Chunk::Known(Box::new(Known::Finished { response }))
        }
        Ok(Known::Failed { sequence_number, mut response }) => {
            if let Some(usage) = &mut response.usage {
                usage.raw = value.pointer("/response/usage").map(raw_usage).unwrap_or_default();
            }
            Chunk::Known(Box::new(Known::Failed { sequence_number, response }))
        }
        Ok(known) => Chunk::Known(Box::new(known)),
        Err(_) => Chunk::Unknown,
    })
}

/// Whether the model has started producing output, which ends the wait for an early failure.
pub(super) fn is_output_chunk(chunk: &Chunk) -> bool {
    match chunk {
        Chunk::Unknown | Chunk::ErrorFrame(_) => false,
        Chunk::Known(known) => {
            !matches!(**known, Known::Created { .. } | Known::InProgress { .. } | Known::Failed { .. })
        }
    }
}
