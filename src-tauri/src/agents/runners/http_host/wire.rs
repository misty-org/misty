//! Readers for the hosted tools' payloads: permission questions, usage and
//! errors, mapped onto Misty's runner vocabulary.
use serde_json::{json, Value};

use super::{
    super::{
        bridge::classify_command,
        events::{ActionKind, PermissionRequest, RunnerEvent, Usage},
    },
    count_at, text_at,
};

/// What an OpenCode permission is about.
pub(super) fn opencode_permission(properties: &Value) -> Option<PermissionRequest> {
    let id = text_at(properties, "/id")?.to_owned();
    let permission = text_at(properties, "/permission")
        .or_else(|| text_at(properties, "/type"))
        .unwrap_or("")
        .to_owned();
    let pattern = text_at(properties, "/patterns/0")
        .or_else(|| text_at(properties, "/pattern"))
        .map(str::to_owned);
    let command = text_at(properties, "/metadata/command")
        .map(str::to_owned)
        .or(pattern.clone());
    let path = text_at(properties, "/metadata/filepath")
        .map(str::to_owned)
        .or(pattern);
    let (kind, path, command) = match permission.as_str() {
        "read" | "glob" | "grep" | "list" | "lsp" => (ActionKind::Read, path, None),
        "edit" | "write" | "patch" | "multiedit" => (ActionKind::Edit, path, None),
        "bash" => (
            command
                .as_deref()
                .map(classify_command)
                .unwrap_or(ActionKind::Run),
            None,
            command,
        ),
        "webfetch" | "websearch" | "codesearch" => (ActionKind::Network, None, None),
        _ => (ActionKind::Other, path, None),
    };
    Some(PermissionRequest {
        id,
        tool: permission,
        kind,
        path,
        command,
        input: properties.clone(),
    })
}

pub(super) fn opencode_usage(info: &Value) -> Usage {
    Usage {
        input: count_at(info, &["/tokens/input"]),
        output: count_at(info, &["/tokens/output"]) + count_at(info, &["/tokens/reasoning"]),
        cache_write: count_at(info, &["/tokens/cache/write"]),
        cache_read: count_at(info, &["/tokens/cache/read"]),
        model: text_at(info, "/modelID").unwrap_or("").to_owned(),
    }
}

pub(super) fn opencode_error(value: &Value) -> Option<String> {
    ["/error/data/message", "/error/message", "/data/message"]
        .iter()
        .find_map(|pointer| text_at(value, pointer))
        .map(str::to_owned)
}

pub(super) fn dsh_rejected(message: &str) -> Value {
    json!({ "kind": "rejected", "error": { "name": "UserQuestionError", "code": "cancelled", "message": message } })
}

/// An approval request, classified from whatever the request names.
pub(super) fn dsh_approval(event: &str, value: &Value) -> PermissionRequest {
    let request = &value["request"];
    let tool = ["/tool", "/name", "/toolName", "/kind"]
        .iter()
        .find_map(|pointer| text_at(request, pointer))
        .unwrap_or("")
        .to_owned();
    let command = ["/command", "/arguments/command", "/input/command"]
        .iter()
        .find_map(|pointer| text_at(request, pointer))
        .map(str::to_owned);
    let path = ["/path", "/file", "/arguments/path", "/input/path"]
        .iter()
        .find_map(|pointer| text_at(request, pointer))
        .map(str::to_owned);
    let kind = match (&command, &path) {
        (Some(command), _) => classify_command(command),
        (None, Some(_))
            if ["edit", "write", "patch"]
                .iter()
                .any(|word| tool.to_lowercase().contains(word)) =>
        {
            ActionKind::Edit
        }
        _ => ActionKind::Other,
    };
    PermissionRequest {
        id: event.to_owned(),
        tool,
        kind,
        path,
        command,
        input: request.clone(),
    }
}

pub(super) fn dsh_chunk(value: &Value) -> Option<RunnerEvent> {
    let chunk = &value["frame"]["chunk"];
    if text_at(value, "/frame/type") != Some("chunk") {
        return None;
    }
    let text = text_at(chunk, "/text").unwrap_or("").to_owned();
    match text_at(chunk, "/type")? {
        "text-delta" if !text.is_empty() => Some(RunnerEvent::Delta { text }),
        "reasoning-delta" if !text.is_empty() => Some(RunnerEvent::Thinking { text }),
        "usage" => {
            let usage = &chunk["usage"];
            Some(RunnerEvent::Usage(Usage {
                input: count_at(usage, &["/inputTokens", "/promptTokens", "/input_tokens"]),
                output: count_at(
                    usage,
                    &["/outputTokens", "/completionTokens", "/output_tokens"],
                ),
                cache_write: count_at(usage, &["/cacheWriteTokens", "/cache_write_tokens"]),
                cache_read: count_at(
                    usage,
                    &[
                        "/cachedInputTokens",
                        "/cacheReadTokens",
                        "/cache_read_tokens",
                    ],
                ),
                model: String::new(),
            }))
        }
        _ => None,
    }
}

/// An RPC reply's value, or None when it failed.
pub(super) fn dsh_reply(status: u16, body: &Value) -> Option<&Value> {
    if !(200..300).contains(&status) || body.pointer("/result/ok") != Some(&json!(true)) {
        return None;
    }
    body.pointer("/result/value")
}
