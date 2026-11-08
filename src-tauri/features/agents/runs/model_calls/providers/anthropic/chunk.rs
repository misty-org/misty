//! One event of a Messages stream, as the SDK's `anthropicChunkSchema` reads it. Anything these types
//! refuse is reported as a validation error.
use serde::Deserialize;
use serde_json::Value;

use super::usage;
use crate::model_calls::raw_json::RawJson;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum Chunk {
    Ping,
    MessageStart { message: StartMessage },
    ContentBlockStart { index: u64, content_block: StartBlock },
    ContentBlockDelta { index: u64, delta: Delta },
    ContentBlockStop { index: u64 },
    MessageDelta { delta: MessageDelta, usage: Value },
    MessageStop,
    Error { error: ErrorBody },
}

#[derive(Deserialize)]
pub(super) struct StartMessage {
    pub id: Option<String>,
    pub model: Option<String>,
    pub usage: Value,
    pub content: Option<Vec<StartContent>>,
    pub stop_reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum StartContent {
    ToolUse { id: String, name: String, input: Option<RawJson>, caller: Option<Value> },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum StartBlock {
    Text { #[allow(dead_code)] text: String },
    Thinking { #[allow(dead_code)] thinking: String },
    RedactedThinking { data: String },
    ToolUse { id: String, name: String, input: Option<RawJson>, caller: Option<Value> },
    #[serde(other)]
    Other,
}

#[allow(clippy::enum_variant_names)] // The names are the API's own, by way of serde.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum Delta {
    InputJsonDelta { partial_json: String },
    TextDelta { text: String },
    ThinkingDelta { thinking: String },
    SignatureDelta { signature: String },
    CompactionDelta,
    CitationsDelta,
}

#[derive(Deserialize)]
pub(super) struct MessageDelta {
    pub stop_reason: Option<String>,
    pub stop_sequence: Option<String>,
    pub stop_details: Option<StopDetails>,
}

#[derive(Deserialize)]
pub(super) struct StopDetails {
    #[serde(rename = "type")]
    pub kind: String,
    pub category: Option<String>,
    pub explanation: Option<String>,
    pub recommended_model: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct ErrorBody {
    #[serde(rename = "type")]
    pub kind: String,
    pub message: String,
}

/// Blocks the API can send for tools Misty never offers. They carry nothing Misty reads, but they
/// aren't invalid either.
const IGNORED_BLOCKS: [&str; 13] = [
    "fallback",
    "compaction",
    "server_tool_use",
    "web_fetch_tool_result",
    "web_search_tool_result",
    "code_execution_tool_result",
    "bash_code_execution_tool_result",
    "text_editor_code_execution_tool_result",
    "tool_search_tool_result",
    "advisor_tool_result",
    "mcp_tool_use",
    "mcp_tool_result",
    "container_upload",
];

/// What the typed chunks above can't say: usage stays open-ended, and only some block types exist.
pub(super) fn valid_details(chunk: &Chunk, raw: &Value) -> Result<(), &'static str> {
    match chunk {
        Chunk::MessageStart { message } => usage::valid_start(&message.usage),
        Chunk::MessageDelta { usage, .. } => usage::valid_delta(usage),
        Chunk::ContentBlockStart { content_block: StartBlock::Other, .. } => {
            let kind = raw.pointer("/content_block/type").and_then(Value::as_str).unwrap_or_default();
            if IGNORED_BLOCKS.contains(&kind) {
                Ok(())
            } else {
                Err("Unknown content block type.")
            }
        }
        Chunk::ContentBlockStart { content_block: StartBlock::ToolUse { input: Some(input), .. }, .. } => {
            if input.get().trim_start().starts_with('{') {
                Ok(())
            } else {
                Err("A tool call's input must be an object.")
            }
        }
        _ => Ok(()),
    }
}
