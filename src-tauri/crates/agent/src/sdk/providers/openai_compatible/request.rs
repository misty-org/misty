//! The chat-completions request body. Typed rather than built as a `Value`, because a `Value` would
//! sort the keys of tool schemas (see `Cargo.toml`).
use serde::Serialize;
use serde_json::{json, Value};

use crate::sdk::{
    call::{CallOptions, ResponseFormat, ToolChoice, ToolDefinition},
    error::ModelError,
    prompt::{AssistantPart, FileData, Message, ToolOutput, UserPart},
    raw_json::RawJson,
};

#[derive(Serialize)]
pub(super) struct ChatRequest<'a> {
    model: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop: Option<&'a [String]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seed: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<&'a str>,
    messages: Vec<ChatMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<ChatTool<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<Value>,
    stream: bool,
}

#[derive(Serialize)]
#[serde(untagged)]
enum ChatMessage<'a> {
    Plain {
        role: &'static str,
        content: &'a str,
    },
    UserParts {
        role: &'static str,
        content: Vec<Value>,
    },
    Assistant {
        role: &'static str,
        content: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reasoning_content: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_calls: Option<Vec<ChatToolCall<'a>>>,
    },
    Tool {
        role: &'static str,
        tool_call_id: &'a str,
        content: String,
    },
}

#[derive(Serialize)]
struct ChatToolCall<'a> {
    id: &'a str,
    #[serde(rename = "type")]
    kind: &'static str,
    function: ChatFunctionCall<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    extra_content: Option<Value>,
}

#[derive(Serialize)]
struct ChatFunctionCall<'a> {
    name: &'a str,
    arguments: &'a str,
}

#[derive(Serialize)]
struct ChatTool<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    function: ChatFunction<'a>,
}

#[derive(Serialize)]
struct ChatFunction<'a> {
    name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<&'a str>,
    parameters: &'a RawJson,
    #[serde(skip_serializing_if = "Option::is_none")]
    strict: Option<bool>,
}

/// Builds the request, and the warnings the stream starts with.
pub(super) fn build<'a>(
    model: &'a str,
    options: &'a CallOptions,
    provider: &str,
) -> Result<(ChatRequest<'a>, Vec<Value>), ModelError> {
    let mut warnings = Vec::new();
    let response_format = match &options.response_format {
        Some(ResponseFormat::Json { schema, .. }) => {
            // These servers aren't assumed to support schemas, so they get plain JSON mode.
            if schema.is_some() {
                warnings.push(json!({
                    "type": "unsupported",
                    "feature": "responseFormat",
                    "details": "JSON response format schema is only supported with structuredOutputs",
                }));
            }
            Some(json!({ "type": "json_object" }))
        }
        _ => None,
    };
    let reasoning_effort = options
        .reasoning
        .as_deref()
        .filter(|value| *value != "provider-default");
    let tools = (!options.tools.is_empty()).then(|| options.tools.iter().map(chat_tool).collect());
    let tool_choice = if options.tools.is_empty() {
        None
    } else {
        options.tool_choice.as_ref().map(chat_tool_choice)
    };
    Ok((
        ChatRequest {
            model,
            max_tokens: options.max_output_tokens,
            temperature: options.temperature,
            top_p: options.top_p,
            response_format,
            stop: options.stop_sequences.as_deref(),
            seed: options.seed,
            reasoning_effort,
            messages: chat_messages(&options.prompt, provider)?,
            tools,
            tool_choice,
            stream: true,
        },
        warnings,
    ))
}

fn chat_tool(tool: &ToolDefinition) -> ChatTool<'_> {
    ChatTool {
        kind: "function",
        function: ChatFunction {
            name: &tool.name,
            description: tool.description.as_deref(),
            parameters: &tool.input_schema,
            strict: tool.strict,
        },
    }
}

fn chat_tool_choice(choice: &ToolChoice) -> Value {
    match choice {
        ToolChoice::Auto => json!("auto"),
        ToolChoice::None => json!("none"),
        ToolChoice::Required => json!("required"),
        ToolChoice::Tool { tool_name } => json!({ "type": "function", "function": { "name": tool_name } }),
    }
}

fn chat_messages<'a>(prompt: &'a [Message], provider: &str) -> Result<Vec<ChatMessage<'a>>, ModelError> {
    let mut messages = Vec::with_capacity(prompt.len());
    for message in prompt {
        match message {
            Message::System { content, .. } => messages.push(ChatMessage::Plain { role: "system", content }),
            Message::User { content, .. } => messages.push(user_message(content)?),
            Message::Assistant { content, .. } => messages.push(assistant_message(content, provider)),
            Message::Tool { content, .. } => {
                for part in content {
                    messages.push(ChatMessage::Tool {
                        role: "tool",
                        tool_call_id: &part.tool_call_id,
                        content: output_text(&part.output),
                    });
                }
            }
        }
    }
    Ok(messages)
}

fn user_message(content: &[UserPart]) -> Result<ChatMessage<'_>, ModelError> {
    if let [UserPart::Text { text }] = content {
        return Ok(ChatMessage::Plain { role: "user", content: text });
    }
    let parts = content.iter().map(user_part).collect::<Result<Vec<_>, _>>()?;
    Ok(ChatMessage::UserParts { role: "user", content: parts })
}

fn user_part(part: &UserPart) -> Result<Value, ModelError> {
    match part {
        UserPart::Text { text } => Ok(json!({ "type": "text", "text": text })),
        UserPart::File { data, media_type } if media_type.starts_with("image/") => {
            let url = match data {
                FileData::Url { url } => url.clone(),
                FileData::Data { data } => format!("data:{media_type};base64,{data}"),
            };
            Ok(json!({ "type": "image_url", "image_url": { "url": url } }))
        }
        UserPart::File { media_type, .. } => Err(ModelError::Unsupported(format!(
            "This model can't take {media_type} files."
        ))),
    }
}

fn assistant_message<'a>(content: &'a [AssistantPart], provider: &str) -> ChatMessage<'a> {
    let mut text = String::new();
    let mut reasoning = String::new();
    let mut calls = Vec::new();
    for part in content {
        match part {
            AssistantPart::Text { text: piece } => text.push_str(piece),
            AssistantPart::Reasoning { text: piece, .. } => reasoning.push_str(piece),
            AssistantPart::ToolCall { tool_call_id, tool_name, input, provider_options } => {
                calls.push(ChatToolCall {
                    id: tool_call_id,
                    kind: "function",
                    function: ChatFunctionCall { name: tool_name, arguments: input.get() },
                    extra_content: thought_signature(provider_options.as_ref(), provider),
                });
            }
        }
    }
    let content = if calls.is_empty() {
        Some(text)
    } else {
        (!text.is_empty()).then_some(text)
    };
    ChatMessage::Assistant {
        role: "assistant",
        content,
        reasoning_content: (!reasoning.is_empty()).then_some(reasoning),
        tool_calls: (!calls.is_empty()).then_some(calls),
    }
}

/// Gemini behind a compatible endpoint needs its thought signature back on the tool call.
fn thought_signature(options: Option<&serde_json::Map<String, Value>>, provider: &str) -> Option<Value> {
    let signature = options?
        .get(provider)
        .or_else(|| options?.get("google"))?
        .get("thoughtSignature")?
        .as_str()?;
    Some(json!({ "google": { "thought_signature": signature } }))
}

fn output_text(output: &ToolOutput) -> String {
    match output {
        ToolOutput::Text { value } | ToolOutput::ErrorText { value } => value.clone(),
        ToolOutput::Json { value } | ToolOutput::ErrorJson { value } => value.get().to_owned(),
        ToolOutput::ExecutionDenied { reason } => reason
            .clone()
            .unwrap_or_else(|| "Tool call execution denied.".into()),
        ToolOutput::Content { value } => serde_json::to_string(value).unwrap_or_default(),
    }
}
