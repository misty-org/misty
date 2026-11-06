//! Turns a prompt into Responses input items. Ported from `convert-to-openai-responses-input.ts`, for
//! function tools with no conversation or previous response chaining. When OpenAI stores responses,
//! which is its default, items it already holds go back as `item_reference`s. When it doesn't,
//! they go back whole, reasoning as its encrypted content.
use serde::Serialize;
use serde_json::{json, Value};

use super::assistant_input::assistant_items;
use crate::sdk::{
    error::ModelError,
    prompt::{FileData, Message, OutputItem, ProviderOptions, ToolOutput, UserPart},
    media_type::top_level,
    providers::media::{resolve_full_media_type, unsupported},
};

#[derive(Serialize)]
#[serde(untagged)]
pub(super) enum InputItem<'a> {
    Instructions {
        role: &'static str,
        content: &'a str,
    },
    User {
        role: &'static str,
        content: Vec<UserContent<'a>>,
    },
    Assistant {
        role: &'static str,
        content: [OutputText<'a>; 1],
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        phase: Option<String>,
    },
    Tagged(TaggedItem<'a>),
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum TaggedItem<'a> {
    ItemReference {
        id: String,
    },
    FunctionCall {
        call_id: &'a str,
        name: &'a str,
        arguments: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        namespace: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        caller: Option<Value>,
    },
    FunctionCallOutput {
        call_id: &'a str,
        output: CallOutput<'a>,
    },
    Reasoning {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        encrypted_content: Option<String>,
        summary: Vec<SummaryText<'a>>,
    },
}

#[derive(Serialize)]
pub(super) struct OutputText<'a> {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub text: &'a str,
}

#[derive(Serialize)]
pub(super) struct SummaryText<'a> {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub text: &'a str,
}

#[derive(Serialize)]
#[serde(untagged)]
pub(super) enum UserContent<'a> {
    Text {
        #[serde(rename = "type")]
        kind: &'static str,
        text: &'a str,
    },
    ImageUrl {
        #[serde(rename = "type")]
        kind: &'static str,
        image_url: String,
    },
    ImageFile {
        #[serde(rename = "type")]
        kind: &'static str,
        file_id: &'a str,
    },
    FileUrl {
        #[serde(rename = "type")]
        kind: &'static str,
        file_url: &'a str,
    },
    FileData {
        #[serde(rename = "type")]
        kind: &'static str,
        filename: String,
        file_data: String,
    },
}

#[derive(Serialize)]
#[serde(untagged)]
pub(super) enum CallOutput<'a> {
    Text(&'a str),
    Content(Vec<UserContent<'a>>),
}

pub(super) fn openai<'o>(options: Option<&'o ProviderOptions>, name: &str) -> Option<&'o Value> {
    options?.get("openai")?.get(name).filter(|value| !value.is_null())
}

pub(super) fn openai_text(options: Option<&ProviderOptions>, name: &str) -> Option<String> {
    openai(options, name)?.as_str().map(str::to_owned)
}

/// A string that starts like this names a file already uploaded to OpenAI.
fn file_id(data: &str) -> Option<&str> {
    data.starts_with("file-").then_some(data)
}

fn user_part(part: &UserPart, index: usize) -> Result<UserContent<'_>, ModelError> {
    let (data, media_type) = match part {
        UserPart::Text { text } => return Ok(UserContent::Text { kind: "input_text", text }),
        UserPart::File { data, media_type } => (data, media_type.as_str()),
    };
    if top_level(media_type) == "image" {
        return Ok(match data {
            FileData::Url { url } => UserContent::ImageUrl { kind: "input_image", image_url: url.clone() },
            FileData::Data { data: bytes } => match file_id(bytes) {
                Some(file_id) => UserContent::ImageFile { kind: "input_image", file_id },
                None => UserContent::ImageUrl {
                    kind: "input_image",
                    image_url: format!("data:{};base64,{bytes}", resolve_full_media_type(media_type, data)?),
                },
            },
        });
    }
    let FileData::Data { data: bytes } = data else {
        let FileData::Url { url } = data else {
            return Err(unsupported("file part"));
        };
        return Ok(UserContent::FileUrl { kind: "input_file", file_url: url });
    };
    let full = resolve_full_media_type(media_type, data)?;
    if full != "application/pdf" {
        return Err(unsupported(&format!("file part media type {full}")));
    }
    Ok(match file_id(bytes) {
        Some(file_id) => UserContent::ImageFile { kind: "input_file", file_id },
        None => UserContent::FileData {
            kind: "input_file",
            filename: format!("part-{index}.pdf"),
            file_data: format!("data:{full};base64,{bytes}"),
        },
    })
}

fn output_item(item: &OutputItem) -> Result<UserContent<'_>, ModelError> {
    let (data, media_type) = match item {
        OutputItem::Text { text } => return Ok(UserContent::Text { kind: "input_text", text }),
        OutputItem::File { data, media_type } => (data, media_type.as_str()),
    };
    let is_image = top_level(media_type) == "image";
    Ok(match data {
        FileData::Url { url } if is_image => UserContent::ImageUrl { kind: "input_image", image_url: url.clone() },
        FileData::Url { url } => UserContent::FileUrl { kind: "input_file", file_url: url },
        FileData::Data { data: bytes } => {
            let full = resolve_full_media_type(media_type, data)?;
            let url = format!("data:{full};base64,{bytes}");
            if is_image {
                UserContent::ImageUrl { kind: "input_image", image_url: url }
            } else {
                UserContent::FileData { kind: "input_file", filename: "data".into(), file_data: url }
            }
        }
    })
}

fn call_output(output: &ToolOutput) -> Result<CallOutput<'_>, ModelError> {
    Ok(match output {
        ToolOutput::Text { value } | ToolOutput::ErrorText { value } => CallOutput::Text(value),
        ToolOutput::ExecutionDenied { reason } => CallOutput::Text(
            reason.as_deref().unwrap_or("Tool call execution denied."),
        ),
        ToolOutput::Json { value } | ToolOutput::ErrorJson { value } => CallOutput::Text(value.get()),
        // Unlike chat completions, a tool's output here can hold the screenshot itself.
        ToolOutput::Content { value } => {
            CallOutput::Content(value.iter().map(output_item).collect::<Result<_, _>>()?)
        }
    })
}

/// The input items, with reasoning models taking their instructions as the developer.
pub(super) fn convert_input<'a>(
    prompt: &'a [Message],
    instructions_role: &'static str,
    store: bool,
    warnings: &mut Vec<Value>,
) -> Result<Vec<InputItem<'a>>, ModelError> {
    let mut input = Vec::with_capacity(prompt.len());
    for message in prompt {
        match message {
            Message::System { content, .. } => {
                input.push(InputItem::Instructions { role: instructions_role, content });
            }
            Message::User { content, .. } => {
                let parts = content
                    .iter()
                    .enumerate()
                    .map(|(index, part)| user_part(part, index))
                    .collect::<Result<_, _>>()?;
                input.push(InputItem::User { role: "user", content: parts });
            }
            Message::Assistant { content, .. } => assistant_items(content, store, &mut input, warnings),
            Message::Tool { content, .. } => {
                for part in content {
                    input.push(InputItem::Tagged(TaggedItem::FunctionCallOutput {
                        call_id: &part.tool_call_id,
                        output: call_output(&part.output)?,
                    }));
                }
            }
        }
    }
    let unusable = |item: &InputItem<'a>| {
        matches!(item, InputItem::Tagged(TaggedItem::Reasoning { encrypted_content: None, .. }))
    };
    // Without storage, OpenAI can only read reasoning that carries its encrypted content.
    if !store && input.iter().any(unusable) {
        warnings.push(json!({
            "type": "other",
            "message": "Reasoning parts without encrypted content are not supported when store is false. Skipping reasoning parts.",
        }));
        input.retain(|item| !unusable(item));
    }
    Ok(input)
}
