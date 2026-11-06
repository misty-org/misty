//! User turns: text, files and tool results, which Anthropic carries together as one user message.
use std::borrow::Cow;

use serde_json::{json, Value};

use super::{
    cache_control::CacheControlValidator,
    prompt::add_beta,
    wire::{Block, Source, ToolResultContent, ToolResultPiece},
};
use crate::sdk::{
    error::ModelError,
    media_type::top_level,
    prompt::{FileData, Message, OutputItem, ToolOutput, ToolResultPart, UserPart},
    providers::media::{decode_text, resolve_full_media_type, unsupported},
};

pub(super) fn user_content<'a>(
    block: &'a [Message],
    betas: &mut Vec<&'static str>,
    warnings: &mut Vec<Value>,
    validator: &mut CacheControlValidator,
) -> Result<Vec<Block<'a>>, ModelError> {
    let mut content = Vec::new();
    for message in block {
        match message {
            Message::User { content: parts, provider_options } => {
                for (at, part) in parts.iter().enumerate() {
                    // A breakpoint on a message lands on its last part.
                    let cache_control = if at == parts.len() - 1 {
                        validator.get(provider_options.as_ref(), "user message", true)
                    } else {
                        None
                    };
                    content.push(user_part(part, cache_control, betas)?);
                }
            }
            Message::Tool { content: parts, provider_options } => {
                for (at, part) in parts.iter().enumerate() {
                    let cache_control = if at == parts.len() - 1 {
                        validator.get(provider_options.as_ref(), "tool result message", true)
                    } else {
                        None
                    };
                    content.push(tool_result(part, cache_control, betas, warnings)?);
                }
            }
            _ => {}
        }
    }
    Ok(content)
}

fn user_part<'a>(
    part: &'a UserPart,
    cache_control: Option<Value>,
    betas: &mut Vec<&'static str>,
) -> Result<Block<'a>, ModelError> {
    let (data, media_type) = match part {
        UserPart::Text { text } => return Ok(Block::Text { text: Cow::Borrowed(text), cache_control }),
        UserPart::File { data, media_type } => (data, media_type.as_str()),
    };
    let top_level = top_level(media_type);
    if top_level == "image" {
        let source = match data {
            FileData::Url { url } => Source::Url { url },
            FileData::Data { data: bytes } => Source::Base64 {
                media_type: Cow::Owned(resolve_full_media_type(media_type, data)?),
                data: bytes,
            },
        };
        return Ok(Block::Image { source, cache_control });
    }
    let is_pdf = top_level == "application"
        && match data {
            FileData::Url { .. } => media_type == "application/pdf",
            FileData::Data { .. } => resolve_full_media_type(media_type, data)? == "application/pdf",
        };
    if is_pdf {
        add_beta(betas, "pdfs-2024-09-25");
        let source = match data {
            FileData::Url { url } => Source::Url { url },
            FileData::Data { data } => Source::Base64 { media_type: Cow::Borrowed("application/pdf"), data },
        };
        return Ok(Block::Document { source, cache_control });
    }
    if media_type == "text/plain" {
        let source = match data {
            FileData::Url { url } => Source::Url { url },
            FileData::Data { data } => Source::Text { media_type: "text/plain", data: decode_text(data) },
        };
        return Ok(Block::Document { source, cache_control });
    }
    Err(unsupported(&format!("media type: {media_type}")))
}

fn tool_result<'a>(
    part: &'a ToolResultPart,
    cache_control: Option<Value>,
    betas: &mut Vec<&'static str>,
    warnings: &mut Vec<Value>,
) -> Result<Block<'a>, ModelError> {
    let content = match &part.output {
        ToolOutput::Content { value } => {
            let mut pieces = Vec::with_capacity(value.len());
            for item in value {
                if let Some(piece) = tool_result_piece(item, betas, warnings)? {
                    pieces.push(piece);
                }
            }
            ToolResultContent::Parts(pieces)
        }
        ToolOutput::Text { value } | ToolOutput::ErrorText { value } => ToolResultContent::Text(Cow::Borrowed(value)),
        ToolOutput::ExecutionDenied { reason } => ToolResultContent::Text(
            reason
                .as_deref()
                .map_or(Cow::Borrowed("Tool call execution denied."), Cow::Borrowed),
        ),
        ToolOutput::Json { value } | ToolOutput::ErrorJson { value } => ToolResultContent::Text(Cow::Borrowed(value.get())),
    };
    let is_error = matches!(part.output, ToolOutput::ErrorText { .. } | ToolOutput::ErrorJson { .. }).then_some(true);
    Ok(Block::ToolResult { tool_use_id: &part.tool_call_id, content, is_error, cache_control })
}

/// Screenshots stay in the tool result as images, which Anthropic takes there directly.
fn tool_result_piece<'a>(
    item: &'a OutputItem,
    betas: &mut Vec<&'static str>,
    warnings: &mut Vec<Value>,
) -> Result<Option<ToolResultPiece<'a>>, ModelError> {
    let (data, media_type) = match item {
        OutputItem::Text { text } => return Ok(Some(ToolResultPiece::Text { text })),
        OutputItem::File { data, media_type } => (data, media_type.as_str()),
    };
    let is_image = top_level(media_type) == "image";
    match data {
        FileData::Url { url } if is_image => Ok(Some(ToolResultPiece::Image { source: Source::Url { url } })),
        FileData::Url { url } => Ok(Some(ToolResultPiece::Document { source: Source::Url { url } })),
        FileData::Data { data: bytes } if is_image => Ok(Some(ToolResultPiece::Image {
            source: Source::Base64 {
                media_type: Cow::Owned(resolve_full_media_type(media_type, data)?),
                data: bytes,
            },
        })),
        FileData::Data { data: bytes } => {
            if resolve_full_media_type(media_type, data)? == "application/pdf" {
                add_beta(betas, "pdfs-2024-09-25");
                return Ok(Some(ToolResultPiece::Document {
                    source: Source::Base64 { media_type: Cow::Borrowed("application/pdf"), data: bytes },
                }));
            }
            warnings.push(json!({
                "type": "other",
                "message": format!("unsupported tool content part type: file with media type: {media_type}"),
            }));
            Ok(None)
        }
    }
}
