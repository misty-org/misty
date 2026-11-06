//! The pieces of Google's `contents`, and tool results in them. Ported from `appendToolResultParts`
//! and `appendLegacyToolResultParts` in `convert-to-google-messages.ts`.
use serde::Serialize;
use serde_json::Value;

use crate::sdk::{
    error::ModelError,
    media_type::{detect_in_base64, is_full, top_level},
    prompt::{FileData, OutputItem, ProviderOptions},
    raw_json::RawJson,
};

#[derive(Serialize)]
pub(super) struct Content {
    pub(super) role: &'static str,
    pub(super) parts: Vec<Part>,
}

#[derive(Serialize)]
pub(super) struct SystemInstruction {
    pub(super) parts: Vec<Part>,
}

#[derive(Serialize)]
#[serde(untagged)]
pub(super) enum Part {
    Text {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        thought: Option<bool>,
        #[serde(rename = "thoughtSignature", skip_serializing_if = "Option::is_none")]
        thought_signature: Option<String>,
    },
    InlineData {
        #[serde(rename = "inlineData")]
        inline_data: InlineData,
    },
    FileData {
        #[serde(rename = "fileData")]
        file_data: FileReference,
    },
    FunctionCall {
        #[serde(rename = "functionCall")]
        function_call: FunctionCall,
        #[serde(rename = "thoughtSignature", skip_serializing_if = "Option::is_none")]
        thought_signature: Option<String>,
    },
    FunctionResponse {
        #[serde(rename = "functionResponse")]
        function_response: FunctionResponse,
    },
}

impl Part {
    pub(super) fn plain(text: impl Into<String>) -> Self {
        Self::Text { text: text.into(), thought: None, thought_signature: None }
    }
}

#[derive(Serialize)]
pub(super) struct InlineData {
    #[serde(rename = "mimeType")]
    pub(super) mime_type: String,
    pub(super) data: String,
}

#[derive(Serialize)]
pub(super) struct FileReference {
    #[serde(rename = "mimeType")]
    pub(super) mime_type: String,
    #[serde(rename = "fileUri")]
    pub(super) file_uri: String,
}

#[derive(Serialize)]
pub(super) struct FunctionCall {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) args: RawJson,
}

#[derive(Serialize)]
pub(super) struct FunctionResponse {
    id: String,
    name: String,
    response: ResponseBody,
    #[serde(skip_serializing_if = "Option::is_none")]
    parts: Option<Vec<ResponsePart>>,
}

#[derive(Serialize)]
struct ResponseBody {
    name: String,
    content: ResponseContent,
}

#[derive(Serialize)]
#[serde(untagged)]
pub(super) enum ResponseContent {
    Text(String),
    Json(RawJson),
}

#[derive(Serialize)]
struct ResponsePart {
    #[serde(rename = "inlineData")]
    inline_data: InlineData,
}

/// The `UnsupportedFunctionalityError` message.
pub(super) fn unsupported(functionality: &str) -> ModelError {
    ModelError::Unsupported(format!("'{functionality}' functionality not supported."))
}

/// `resolveFullMediaType`.
pub(super) fn full_media_type(media_type: &str, data: &FileData) -> Result<String, ModelError> {
    if is_full(media_type) {
        return Ok(media_type.to_owned());
    }
    match data {
        FileData::Data { data } => detect_in_base64(data, top_level(media_type))
            .map(str::to_owned)
            .ok_or_else(|| {
                unsupported(&format!(
                    "file of media type \"{media_type}\" must specify subtype since it could not be auto-detected"
                ))
            }),
        FileData::Url { .. } => Err(unsupported(&format!(
            "file of media type \"{media_type}\" must specify subtype since it is not passed as inline bytes"
        ))),
    }
}

/// `readProviderOpts`, reading the part's options for this provider.
fn part_options(options: Option<&ProviderOptions>) -> Option<&Value> {
    let options = options?;
    let non_null = |name: &str| options.get(name).filter(|value| !value.is_null());
    non_null("google").or_else(|| non_null("googleVertex")).or_else(|| non_null("vertex"))
}

/// `String(thoughtSignature)`.
pub(super) fn thought_signature(options: Option<&ProviderOptions>) -> Option<String> {
    match part_options(options)?.get("thoughtSignature")? {
        Value::Null => None,
        Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

/// `parseBase64DataUrl`: `/^data:([^;,]+);base64,(.+)$/s`.
fn base64_data_url(url: &str) -> Option<(&str, &str)> {
    let rest = url.strip_prefix("data:")?;
    let (head, data) = rest.split_once(',')?;
    let media_type = head.strip_suffix(";base64")?;
    (!media_type.is_empty() && !media_type.contains(';') && !data.is_empty()).then_some((media_type, data))
}

pub(super) fn tool_result_parts(
    parts: &mut Vec<Part>,
    tool_name: &str,
    call_id: &str,
    items: &[OutputItem],
) -> Result<(), ModelError> {
    let mut inline = Vec::new();
    let mut texts = Vec::new();
    for item in items {
        match item {
            OutputItem::Text { text } => texts.push(text.clone()),
            OutputItem::File { data: FileData::Data { data }, media_type } => {
                let mime_type = full_media_type(media_type, &FileData::Data { data: data.clone() })?;
                inline.push(ResponsePart {
                    inline_data: InlineData { mime_type, data: data.clone() },
                });
            }
            OutputItem::File { data: FileData::Url { url }, .. } => match base64_data_url(url) {
                Some((media_type, data)) => inline.push(ResponsePart {
                    inline_data: InlineData { mime_type: media_type.to_owned(), data: data.to_owned() },
                }),
                None => texts.push(serde_json::to_string(item).unwrap_or_default()),
            },
        }
    }
    let content = if texts.is_empty() { "Tool executed successfully.".to_owned() } else { texts.join("\n") };
    parts.push(Part::FunctionResponse {
        function_response: FunctionResponse {
            id: call_id.to_owned(),
            name: tool_name.to_owned(),
            response: ResponseBody { name: tool_name.to_owned(), content: ResponseContent::Text(content) },
            parts: (!inline.is_empty()).then_some(inline),
        },
    });
    Ok(())
}

/// Models before Gemini 3 can't take parts inside a function response, so files follow it.
pub(super) fn legacy_tool_result_parts(
    parts: &mut Vec<Part>,
    tool_name: &str,
    call_id: &str,
    items: &[OutputItem],
) -> Result<(), ModelError> {
    for item in items {
        match item {
            OutputItem::Text { text } => parts.push(function_response(tool_name, call_id, ResponseContent::Text(text.clone()))),
            OutputItem::File { data: FileData::Data { data }, media_type } => {
                let mime_type = full_media_type(media_type, &FileData::Data { data: data.clone() })?;
                parts.push(Part::InlineData {
                    inline_data: InlineData { mime_type, data: data.clone() },
                });
                let kind = if top_level(media_type) == "image" { "image" } else { "file" };
                parts.push(Part::plain(format!(
                    "Tool executed successfully and returned this {kind} as a response"
                )));
            }
            OutputItem::File { data: FileData::Url { .. }, .. } => {
                parts.push(Part::plain(serde_json::to_string(item).unwrap_or_default()));
            }
        }
    }
    Ok(())
}

pub(super) fn function_response(tool_name: &str, call_id: &str, content: ResponseContent) -> Part {
    Part::FunctionResponse {
        function_response: FunctionResponse {
            id: call_id.to_owned(),
            name: tool_name.to_owned(),
            response: ResponseBody { name: tool_name.to_owned(), content },
            parts: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_urls_need_base64_and_a_type() {
        assert_eq!(base64_data_url("data:image/png;base64,AAAA"), Some(("image/png", "AAAA")));
        assert_eq!(base64_data_url("data:image/png,AAAA"), None);
        assert_eq!(base64_data_url("data:;base64,AAAA"), None);
        assert_eq!(base64_data_url("data:image/png;base64,"), None);
        assert_eq!(base64_data_url("https://example.com/a.png"), None);
    }
}
