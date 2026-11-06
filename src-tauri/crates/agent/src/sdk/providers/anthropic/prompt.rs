//! Turns a prompt into Anthropic's system blocks and messages. Ported from
//! `convert-to-anthropic-prompt.ts` and `get-cache-control.ts`, without provider-executed tools,
//! citations and compaction, which Misty doesn't use.
use std::borrow::Cow;

use serde_json::{json, Value};

use super::{
    cache_control::CacheControlValidator,
    user_content::user_content,
    wire::{Block, Caller, OutgoingMessage, SystemBlock, ToolInput},
};
use crate::sdk::{
    error::ModelError,
    prompt::{AssistantPart, Message, ProviderOptions},
    providers::media::js_trim,
};

pub(super) struct ConvertedPrompt<'a> {
    pub system: Option<Vec<SystemBlock<'a>>>,
    pub messages: Vec<OutgoingMessage<'a>>,
    pub betas: Vec<&'static str>,
}

pub(super) fn add_beta(betas: &mut Vec<&'static str>, beta: &'static str) {
    if !betas.contains(&beta) {
        betas.push(beta);
    }
}

/// Runs of the same kind of message become one. Tool results count as user messages.
fn group_into_blocks(prompt: &[Message]) -> Vec<&[Message]> {
    fn kind(message: &Message) -> u8 {
        match message {
            Message::System { .. } => 0,
            Message::Assistant { .. } => 1,
            Message::User { .. } | Message::Tool { .. } => 2,
        }
    }
    prompt.chunk_by(|left, right| kind(left) == kind(right)).collect()
}

pub(super) fn convert_prompt<'a>(
    prompt: &'a [Message],
    warnings: &mut Vec<Value>,
    validator: &mut CacheControlValidator,
) -> Result<ConvertedPrompt<'a>, ModelError> {
    let mut system = None;
    let mut messages = Vec::new();
    let mut betas = Vec::new();
    let blocks = group_into_blocks(prompt);
    let block_count = blocks.len();
    for (position, block) in blocks.into_iter().enumerate() {
        match &block[0] {
            Message::System { .. } => {
                let mut content = Vec::new();
                for message in block {
                    if let Message::System { content: text, provider_options } = message {
                        content.push(SystemBlock {
                            kind: "text",
                            text,
                            cache_control: validator.get(provider_options.as_ref(), "system message", true),
                        });
                    }
                }
                // The first block is the top-level prompt, and later ones are sent inline.
                if position == 0 || system.is_none() {
                    system = Some(content);
                } else {
                    messages.push(OutgoingMessage::System { role: "system", content });
                    add_beta(&mut betas, "mid-conversation-system-2026-04-07");
                }
            }
            Message::Assistant { .. } => {
                let is_last_block = position == block_count - 1;
                let content = assistant_content(block, is_last_block, warnings, validator);
                messages.push(OutgoingMessage::Turn { role: "assistant", content });
            }
            _ => {
                let content = user_content(block, &mut betas, warnings, validator)?;
                messages.push(OutgoingMessage::Turn { role: "user", content });
            }
        }
    }
    Ok(ConvertedPrompt { system, messages, betas })
}

fn assistant_content<'a>(
    block: &'a [Message],
    is_last_block: bool,
    warnings: &mut Vec<Value>,
    validator: &mut CacheControlValidator,
) -> Vec<Block<'a>> {
    let mut content = Vec::new();
    for (message_at, message) in block.iter().enumerate() {
        let Message::Assistant { content: parts, provider_options } = message else {
            continue;
        };
        let is_last_message = message_at == block.len() - 1;
        for (at, part) in parts.iter().enumerate() {
            let is_last_part = at == parts.len() - 1;
            let part_options = match part {
                AssistantPart::Text { provider_options, .. }
                | AssistantPart::Reasoning { provider_options, .. }
                | AssistantPart::ToolCall { provider_options, .. } => provider_options.as_ref(),
            };
            // A breakpoint on a message lands on its last part, and is counted even when that part
            // is thinking, which can't hold one.
            let cache_control = validator
                .get(part_options, "assistant message part", true)
                .or_else(|| {
                    if is_last_part {
                        validator.get(provider_options.as_ref(), "assistant message", true)
                    } else {
                        None
                    }
                });
            match part {
                AssistantPart::Text { text, .. } => {
                    // Anthropic refuses trailing whitespace in a pre-filled assistant response.
                    let text = if is_last_block && is_last_message && is_last_part { js_trim(text) } else { text };
                    content.push(Block::Text { text: Cow::Borrowed(text), cache_control });
                }
                AssistantPart::Reasoning { text, provider_options, .. } => {
                    if let Some(block) = thinking_block(text, provider_options.as_ref(), validator, warnings) {
                        content.push(block);
                    }
                }
                AssistantPart::ToolCall { tool_call_id, tool_name, input, provider_options } => {
                    let is_object = input.get().trim_start().starts_with('{');
                    content.push(Block::ToolUse {
                        id: tool_call_id,
                        name: tool_name,
                        input: if is_object {
                            ToolInput::Object(input)
                        } else {
                            ToolInput::Wrapped { raw_invalid_input: input }
                        },
                        caller: caller(provider_options.as_ref()),
                        cache_control,
                    });
                }
            }
        }
    }
    move_tool_use_blocks_to_end(content)
}

/// Thinking goes back with its signature, or Anthropic refuses the turn.
fn thinking_block<'a>(
    text: &'a str,
    options: Option<&ProviderOptions>,
    validator: &mut CacheControlValidator,
    warnings: &mut Vec<Value>,
) -> Option<Block<'a>> {
    let metadata = options.and_then(|options| options.get("anthropic"));
    let field = |name: &str| metadata?.get(name)?.as_str().map(str::to_owned);
    if let Some(signature) = field("signature") {
        validator.get(options, "thinking block", false);
        return Some(Block::Thinking { thinking: text, signature });
    }
    if let Some(data) = field("redactedData") {
        validator.get(options, "redacted thinking block", false);
        return Some(Block::RedactedThinking { data });
    }
    warnings.push(json!({ "type": "other", "message": "unsupported reasoning metadata" }));
    None
}

fn caller(options: Option<&ProviderOptions>) -> Option<Caller> {
    let caller = options?.get("anthropic")?.get("caller")?;
    let kind = caller.get("type")?.as_str()?;
    let tool_id = caller.get("toolId").and_then(Value::as_str).filter(|id| !id.is_empty());
    match (kind, tool_id) {
        ("code_execution_20250825" | "code_execution_20260120", Some(tool_id)) => {
            Some(Caller { kind: kind.to_owned(), tool_id: Some(tool_id.to_owned()) })
        }
        ("direct", _) => Some(Caller { kind: kind.to_owned(), tool_id: None }),
        _ => None,
    }
}

/// Between thinking blocks, tool calls go after everything else.
fn move_tool_use_blocks_to_end(content: Vec<Block<'_>>) -> Vec<Block<'_>> {
    fn flush<'a>(segment: &mut Vec<Block<'a>>, result: &mut Vec<Block<'a>>) {
        let (tools, others): (Vec<_>, Vec<_>) =
            segment.drain(..).partition(|part| matches!(part, Block::ToolUse { .. }));
        result.extend(others);
        result.extend(tools);
    }
    let mut result = Vec::with_capacity(content.len());
    let mut segment = Vec::new();
    for part in content {
        if matches!(part, Block::Thinking { .. } | Block::RedactedThinking { .. }) {
            flush(&mut segment, &mut result);
            result.push(part);
        } else {
            segment.push(part);
        }
    }
    flush(&mut segment, &mut result);
    result
}
