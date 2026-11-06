//! The Messages API's request shapes. Typed rather than built as a `Value`, because a `Value` would
//! sort keys, and Anthropic's prompt cache needs them stable from turn to turn.
use std::borrow::Cow;

use serde::Serialize;
use serde_json::Value;

use crate::sdk::{providers::media::js_number, providers::ordered::Ordered, raw_json::RawJson};

#[derive(Serialize)]
pub(super) struct MessagesRequest<'a> {
    pub model: &'a str,
    pub max_tokens: u64,
    #[serde(serialize_with = "js_number", skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(serialize_with = "js_number", skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_sequences: Option<&'a [String]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<ThinkingBody>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_config: Option<OutputConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<Vec<SystemBlock<'a>>>,
    pub messages: Vec<OutgoingMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<Tool<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<ToolChoiceBody<'a>>,
    pub stream: bool,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum ThinkingBody {
    Enabled { budget_tokens: u64 },
    Adaptive { display: &'static str },
    Disabled,
}

#[derive(Default, Serialize)]
pub(super) struct OutputConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<OutputFormat>,
}

#[derive(Serialize)]
pub(super) struct OutputFormat {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub schema: Ordered,
}

#[derive(Serialize)]
pub(super) struct SystemBlock<'a> {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub text: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_control: Option<Value>,
}

#[derive(Serialize)]
#[serde(untagged)]
pub(super) enum OutgoingMessage<'a> {
    System { role: &'static str, content: Vec<SystemBlock<'a>> },
    Turn { role: &'static str, content: Vec<Block<'a>> },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum Block<'a> {
    Text {
        text: Cow<'a, str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_control: Option<Value>,
    },
    Image {
        source: Source<'a>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_control: Option<Value>,
    },
    Document {
        source: Source<'a>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_control: Option<Value>,
    },
    ToolResult {
        tool_use_id: &'a str,
        content: ToolResultContent<'a>,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_control: Option<Value>,
    },
    Thinking {
        thinking: &'a str,
        signature: String,
    },
    RedactedThinking {
        data: String,
    },
    ToolUse {
        id: &'a str,
        name: &'a str,
        input: ToolInput<'a>,
        #[serde(skip_serializing_if = "Option::is_none")]
        caller: Option<Caller>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_control: Option<Value>,
    },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub(super) enum Source<'a> {
    Base64 { media_type: Cow<'a, str>, data: &'a str },
    Url { url: &'a str },
    Text { media_type: &'static str, data: String },
}

#[derive(Serialize)]
#[serde(untagged)]
pub(super) enum ToolResultContent<'a> {
    Text(Cow<'a, str>),
    Parts(Vec<ToolResultPiece<'a>>),
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub(super) enum ToolResultPiece<'a> {
    Text { text: &'a str },
    Image { source: Source<'a> },
    Document { source: Source<'a> },
}

/// Anthropic needs a tool call's input to be an object, so anything else travels wrapped.
#[derive(Serialize)]
#[serde(untagged)]
pub(super) enum ToolInput<'a> {
    Object(&'a RawJson),
    Wrapped {
        #[serde(rename = "rawInvalidInput")]
        raw_invalid_input: &'a RawJson,
    },
}

#[derive(Serialize)]
pub(super) struct Caller {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_id: Option<String>,
}

#[derive(Serialize)]
pub(super) struct Tool<'a> {
    pub name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<&'a str>,
    pub input_schema: &'a RawJson,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eager_input_streaming: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strict: Option<bool>,
}

#[derive(Serialize)]
pub(super) struct ToolChoiceBody<'a> {
    #[serde(rename = "type")]
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disable_parallel_tool_use: Option<bool>,
}
