//! What a model is told: the same shape as the Vercel AI SDK's language model prompt.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::raw_json::RawJson;

/// Options for one provider, by provider name, such as Anthropic's cache breakpoints.
pub type ProviderOptions = Map<String, Value>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "role", rename_all = "lowercase")]
pub enum Message {
    System {
        content: String,
        #[serde(default, rename = "providerOptions", skip_serializing_if = "Option::is_none")]
        provider_options: Option<ProviderOptions>,
    },
    User {
        content: Vec<UserPart>,
        #[serde(default, rename = "providerOptions", skip_serializing_if = "Option::is_none")]
        provider_options: Option<ProviderOptions>,
    },
    Assistant {
        content: Vec<AssistantPart>,
        #[serde(default, rename = "providerOptions", skip_serializing_if = "Option::is_none")]
        provider_options: Option<ProviderOptions>,
    },
    Tool {
        content: Vec<ToolResultPart>,
        #[serde(default, rename = "providerOptions", skip_serializing_if = "Option::is_none")]
        provider_options: Option<ProviderOptions>,
    },
}

/// File contents: base64 in the request, or an address the provider fetches.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum FileData {
    Data { data: String },
    Url { url: String },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum UserPart {
    Text {
        text: String,
    },
    File {
        data: FileData,
        #[serde(rename = "mediaType")]
        media_type: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum AssistantPart {
    Text {
        text: String,
        #[serde(default, rename = "providerOptions", skip_serializing_if = "Option::is_none")]
        provider_options: Option<ProviderOptions>,
    },
    Reasoning {
        text: String,
        #[serde(default, rename = "providerOptions", skip_serializing_if = "Option::is_none")]
        provider_options: Option<ProviderOptions>,
    },
    ToolCall {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        input: RawJson,
        #[serde(default, rename = "providerOptions", skip_serializing_if = "Option::is_none")]
        provider_options: Option<ProviderOptions>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ToolResultPart {
    /// Always `tool-result`. A plain field, since this is the only kind of part Misty sends.
    #[serde(rename = "type", default = "tool_result_kind")]
    pub kind: String,
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
    #[serde(rename = "toolName")]
    pub tool_name: String,
    pub output: ToolOutput,
}

fn tool_result_kind() -> String {
    "tool-result".into()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ToolOutput {
    Text { value: String },
    Json { value: RawJson },
    ErrorText { value: String },
    ErrorJson { value: RawJson },
    ExecutionDenied {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    Content { value: Vec<OutputItem> },
}

/// One piece of a tool result with mixed content.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum OutputItem {
    Text {
        text: String,
    },
    File {
        data: FileData,
        #[serde(rename = "mediaType")]
        media_type: String,
    },
}
