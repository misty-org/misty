//! The prompt in Google's `contents` form. Ported from `convertToGoogleMessages`. Misty uses no
//! provider-defined tools, so server tool calls and results aren't carried.
use serde_json::{json, Value};

use super::parts::{
    full_media_type, function_response, legacy_tool_result_parts, thought_signature, tool_result_parts, unsupported,
    Content, FileReference, FunctionCall, InlineData, Part, ResponseContent, SystemInstruction,
};
use crate::model_calls::error::ModelError;
use crate::model_calls::prompt::{AssistantPart, FileData, Message, ToolOutput, UserPart};

const SKIP_THOUGHT_SIGNATURE_VALIDATOR: &str = "skip_thought_signature_validator";

struct SignatureLog {
    is_gemini_3: bool,
    missing: Vec<String>,
}

fn model_parts(content: &[AssistantPart], log: &mut SignatureLog) -> Vec<Part> {
    let mut signed_call_seen = false;
    let mut parts = Vec::with_capacity(content.len());
    for part in content {
        match part {
            AssistantPart::Text { text, provider_options } => {
                if !text.is_empty() {
                    parts.push(Part::Text {
                        text: text.clone(),
                        thought: None,
                        thought_signature: thought_signature(provider_options.as_ref()),
                    });
                }
            }
            AssistantPart::Reasoning { text, provider_options } => {
                if !text.is_empty() {
                    parts.push(Part::Text {
                        text: text.clone(),
                        thought: Some(true),
                        thought_signature: thought_signature(provider_options.as_ref()),
                    });
                }
            }
            AssistantPart::ToolCall { tool_call_id, tool_name, input, provider_options } => {
                let signature = thought_signature(provider_options.as_ref());
                // Gemini 3 returns one signature for a parallel response, on the first call. Later
                // calls in the same response legitimately have none.
                let skip_mitigation = signature.is_none() && signed_call_seen;
                if signature.is_some() {
                    signed_call_seen = true;
                }
                let effective = signature.or_else(|| {
                    (log.is_gemini_3 && !skip_mitigation).then(|| {
                        log.missing.push(tool_name.clone());
                        SKIP_THOUGHT_SIGNATURE_VALIDATOR.to_owned()
                    })
                });
                parts.push(Part::FunctionCall {
                    function_call: FunctionCall {
                        id: tool_call_id.clone(),
                        name: tool_name.clone(),
                        args: input.clone(),
                    },
                    thought_signature: effective,
                });
            }
        }
    }
    parts
}

fn missing_signature_warning(missing: &[String]) -> Value {
    let mut unique: Vec<&str> = Vec::new();
    for name in missing {
        if !unique.contains(&name.as_str()) {
            unique.push(name);
        }
    }
    let names = unique.iter().map(|name| format!("`{name}`")).collect::<Vec<_>>().join(", ");
    json!({
        "type": "other",
        "message": format!(
            "Replayed {} `functionCall` part(s) for a Gemini 3 model without a `thoughtSignature` (tools: {names}). Injected the documented `skip_thought_signature_validator` sentinel to keep the request from failing with HTTP 400. The likely cause is application code that drops `providerOptions.google.thoughtSignature` when persisting or serializing assistant tool-call messages. See https://ai.google.dev/gemini-api/docs/thought-signatures.",
            missing.len()
        ),
    })
}

pub(super) struct Converted {
    pub(super) contents: Vec<Content>,
    pub(super) system_instruction: Option<SystemInstruction>,
}

pub(super) fn convert(
    prompt: &[Message],
    is_gemma: bool,
    is_gemini_3: bool,
    warnings: &mut Vec<Value>,
) -> Result<Converted, ModelError> {
    let mut system_parts = Vec::new();
    let mut system_texts: Vec<&str> = Vec::new();
    let mut contents: Vec<Content> = Vec::new();
    let mut system_allowed = true;
    let mut log = SignatureLog { is_gemini_3, missing: Vec::new() };
    for message in prompt {
        match message {
            Message::System { content, .. } => {
                if !system_allowed {
                    return Err(unsupported("system messages are only supported at the beginning of the conversation"));
                }
                system_parts.push(Part::plain(content.clone()));
                system_texts.push(content);
            }
            Message::User { content, .. } => {
                system_allowed = false;
                let mut parts = Vec::with_capacity(content.len());
                for part in content {
                    parts.push(match part {
                        UserPart::Text { text } => Part::plain(text.clone()),
                        UserPart::File { data, media_type } => {
                            let mime_type = full_media_type(media_type, data)?;
                            match data {
                                FileData::Url { url } => Part::FileData {
                                    file_data: FileReference { mime_type, file_uri: url.clone() },
                                },
                                FileData::Data { data } => Part::InlineData {
                                    inline_data: InlineData { mime_type, data: data.clone() },
                                },
                            }
                        }
                    });
                }
                contents.push(Content { role: "user", parts });
            }
            Message::Assistant { content, .. } => {
                system_allowed = false;
                contents.push(Content { role: "model", parts: model_parts(content, &mut log) });
            }
            Message::Tool { content, .. } => {
                system_allowed = false;
                let mut parts = Vec::new();
                for part in content {
                    let (name, id) = (part.tool_name.as_str(), part.tool_call_id.as_str());
                    match &part.output {
                        ToolOutput::Content { value } if is_gemini_3 => tool_result_parts(&mut parts, name, id, value)?,
                        ToolOutput::Content { value } => legacy_tool_result_parts(&mut parts, name, id, value)?,
                        ToolOutput::Text { value } | ToolOutput::ErrorText { value } => {
                            parts.push(function_response(name, id, ResponseContent::Text(value.clone())));
                        }
                        ToolOutput::Json { value } | ToolOutput::ErrorJson { value } => {
                            parts.push(function_response(name, id, ResponseContent::Json(value.clone())));
                        }
                        ToolOutput::ExecutionDenied { reason } => {
                            let reason = reason.clone().unwrap_or_else(|| "Tool call execution denied.".into());
                            parts.push(function_response(name, id, ResponseContent::Text(reason)));
                        }
                    }
                }
                contents.push(Content { role: "user", parts });
            }
        }
    }
    if is_gemma && !system_texts.is_empty() {
        if let Some(first) = contents.first_mut().filter(|content| content.role == "user") {
            first.parts.insert(0, Part::plain(format!("{}\n\n", system_texts.join("\n\n"))));
        }
    }
    if !log.missing.is_empty() {
        warnings.push(missing_signature_warning(&log.missing));
    }
    let system_instruction = (!system_parts.is_empty() && !is_gemma).then_some(SystemInstruction { parts: system_parts });
    Ok(Converted { contents, system_instruction })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_later_system_message_is_refused() {
        let prompt = vec![
            Message::User { content: vec![UserPart::Text { text: "Hi.".into() }], provider_options: None },
            Message::System { content: "Late.".into(), provider_options: None },
        ];
        let Err(ModelError::Unsupported(message)) = convert(&prompt, false, false, &mut Vec::new()) else {
            panic!("expected a refusal");
        };
        assert_eq!(message, "'system messages are only supported at the beginning of the conversation' functionality not supported.");
    }
}
