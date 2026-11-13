// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/claude.rs.
//! How the CLI reports a denied tool call: the phrases it uses, the path it names and the error
//! text of each tool_result block.

use serde_json::Value;

/// Phrases the CLI uses when a tool call is denied by the permission
/// system in headless mode (matched case-insensitively against the
/// tool_result error text).
const DENIAL_PHRASES: &[&str] = &[
    "requested permissions",
    "haven't granted it yet",
    "have not granted it yet",
    "requires approval",
    "requires permission",
    "permission denied",
    "blocked for security",
    "blocked. for security",
    "allowed working directories",
    "may only write to files",
    "outside the allowed",
    "outside workspace",
];

/// A declined or skipped question is the user's own answer, not a permission
/// the user could grant here: never surface it as a grant card (CodeBuddy
/// lists a declined AskUserQuestion in the result's `permission_denials`).
pub(super) fn is_question_tool(tool: Option<&str>) -> bool {
    tool == Some("AskUserQuestion")
}

pub(super) fn looks_like_permission_denial(message: &str) -> bool {
    let normalized = message.trim().to_ascii_lowercase();
    !normalized.is_empty() && DENIAL_PHRASES.iter().any(|p| normalized.contains(p))
}

/// First absolute-path-looking token in free text: Windows `C:\…` / `C:/…`
/// or POSIX `/…`, with surrounding quotes and punctuation trimmed.
pub(super) fn extract_absolute_path(text: &str) -> Option<String> {
    for token in text.split_whitespace() {
        let cleaned = token.trim_matches(|c: char| {
            matches!(
                c,
                '"' | '\'' | '`' | ',' | ';' | ')' | '(' | '[' | ']' | '{' | '}' | '.'
            )
        });
        let bytes = cleaned.as_bytes();
        if cleaned.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/')
        {
            return Some(cleaned.to_string());
        }
        if cleaned.starts_with('/') && cleaned.len() > 1 {
            return Some(cleaned.to_string());
        }
    }
    None
}

/// Text payload of a single tool_result block: plain string or joined text
/// parts.
pub(super) fn tool_result_block_text(block: &Value) -> String {
    match block.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// (tool_use id, error text) pairs of tool_result blocks in a "user" stream
/// line. Content may be a plain string or an array of text blocks.
pub(super) fn tool_result_error_blocks(value: &Value) -> Vec<(Option<String>, String)> {
    let mut out = Vec::new();
    let Some(content) = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    else {
        return out;
    };
    for block in content {
        if block.get("type").and_then(Value::as_str) != Some("tool_result") {
            continue;
        }
        if !block
            .get("is_error")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            continue;
        }
        let text = tool_result_block_text(block);
        let text = text.trim().chars().take(500).collect::<String>();
        if !text.is_empty() {
            let id = block
                .get("tool_use_id")
                .and_then(Value::as_str)
                .map(str::to_string);
            out.push((id, text));
        }
    }
    out
}
