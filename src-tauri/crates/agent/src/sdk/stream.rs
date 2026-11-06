//! What a model call gives back, piece by piece.
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum StreamPart {
    StreamStart {
        warnings: Vec<Value>,
    },
    ResponseMetadata {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(default, rename = "modelId", skip_serializing_if = "Option::is_none")]
        model_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        timestamp: Option<String>,
    },
    TextStart {
        id: String,
    },
    TextDelta {
        id: String,
        delta: String,
    },
    TextEnd {
        id: String,
    },
    ReasoningStart {
        id: String,
    },
    ReasoningDelta {
        id: String,
        delta: String,
    },
    ReasoningEnd {
        id: String,
    },
    ToolInputStart {
        id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
    },
    ToolInputDelta {
        id: String,
        delta: String,
    },
    ToolInputEnd {
        id: String,
    },
    /// A finished call. `input` is the JSON text the model wrote, which may be invalid.
    ToolCall {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        input: String,
        #[serde(default, rename = "providerMetadata", skip_serializing_if = "Option::is_none")]
        provider_metadata: Option<Value>,
    },
    Finish {
        #[serde(rename = "finishReason")]
        finish_reason: FinishReason,
        usage: Usage,
        #[serde(default, rename = "providerMetadata", skip_serializing_if = "Option::is_none")]
        provider_metadata: Option<Value>,
    },
    /// A failure inside the stream. It doesn't end the stream, as with the SDK: parts may follow.
    Error {
        error: Value,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FinishReason {
    /// `stop`, `length`, `content-filter`, `tool-calls`, `error` or `other`.
    pub unified: String,
    /// What the provider actually said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

impl FinishReason {
    pub(crate) fn error() -> Self {
        Self {
            unified: "error".into(),
            raw: None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: InputTokens,
    pub output_tokens: OutputTokens,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputTokens {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_cache: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write: Option<u64>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct OutputTokens {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<u64>,
}
