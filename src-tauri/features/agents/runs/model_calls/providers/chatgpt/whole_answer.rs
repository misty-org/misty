//! ChatGPT only answers in a stream, so a caller that wants a whole answer gets it from the stream's
//! last event. Ported from `streamToResponse` in `chatgpt-provider.ts`, plus the part of the SDK's
//! Responses `doGenerate` that reads the response it leaves.
use serde_json::{json, Value};

use crate::model_calls::error::{retryable_status, ModelError};
use crate::model_calls::providers::openai_responses::expanded_tool_call;
use crate::model_calls::stream::{FinishReason, InputTokens, OutputTokens, StreamPart, Usage};

/// The HTTP status a failed plan-usage response maps to (Errors and recovery).
fn failure_status(code: Option<&str>) -> u16 {
    match code {
        Some("subscription_sharing_usage_limit_exceeded") => 429,
        Some("subscription_sharing_usage_unavailable") | Some("subscription_sharing_user_unavailable") => 503,
        Some("subscription_sharing_invalid_user") => 401,
        Some("subscription_sharing_user_not_eligible") | Some("subscription_sharing_route_not_supported") => 403,
        _ => 400,
    }
}

/// Reads a whole event stream and answers as the non-streaming endpoint would: the final response,
/// or the status and code of what went wrong.
pub(super) fn stream_to_response(text: &str) -> Result<Value, (u16, String, String)> {
    let mut last: Option<Value> = None;
    let normalized = text.replace("\r\n", "\n");
    for block in normalized.split("\n\n") {
        let data = block
            .split('\n')
            .filter_map(|line| line.strip_prefix("data:"))
            .map(|value| value.trim_start())
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(event) = serde_json::from_str::<Value>(&data) else {
            continue;
        };
        if matches!(
            event.get("type").and_then(Value::as_str),
            Some("response.completed" | "response.incomplete" | "response.failed")
        ) {
            last = Some(event);
        }
    }
    let Some(event) = last.filter(|event| event.get("response").is_some_and(|response| !response.is_null())) else {
        return Err((502, "stream_incomplete".into(), "ChatGPT ended the answer before it was complete.".into()));
    };
    if event.get("type").and_then(Value::as_str) == Some("response.failed") {
        let error = event.pointer("/response/error");
        let code = error.and_then(|error| error.get("code")).and_then(Value::as_str);
        let message = error.and_then(|error| error.get("message")).and_then(Value::as_str);
        return Err((
            failure_status(code),
            code.unwrap_or("response_failed").to_owned(),
            message.unwrap_or("ChatGPT could not answer.").to_owned(),
        ));
    }
    Ok(event.get("response").cloned().unwrap_or(Value::Null))
}

pub(super) fn failed(status: u16, message: String) -> ModelError {
    ModelError::Api { status, message, retryable: retryable_status(status), retry_after_ms: None }
}

fn usage_of(response: &Value) -> Usage {
    let Some(usage) = response.get("usage").filter(|usage| !usage.is_null()) else {
        return Usage::default();
    };
    let count = |path: &str| usage.pointer(path).and_then(Value::as_u64);
    let input = count("/input_tokens").unwrap_or(0);
    let output = count("/output_tokens").unwrap_or(0);
    let cached = count("/input_tokens_details/cached_tokens").unwrap_or(0);
    let cache_write = count("/input_tokens_details/cache_write_tokens");
    let reasoning = count("/output_tokens_details/reasoning_tokens").unwrap_or(0);
    Usage {
        input_tokens: InputTokens {
            total: Some(input),
            no_cache: Some(input.saturating_sub(cached).saturating_sub(cache_write.unwrap_or(0))),
            cache_read: Some(cached),
            cache_write,
        },
        output_tokens: OutputTokens {
            total: Some(output),
            text: Some(output.saturating_sub(reasoning)),
            reasoning: Some(reasoning),
        },
        raw: Some(usage.clone()),
    }
}

fn finish_reason(response: &Value, has_function_call: bool) -> FinishReason {
    let reason = response.pointer("/incomplete_details/reason").and_then(Value::as_str);
    let unified = match reason {
        None if has_function_call => "tool-calls",
        None => "stop",
        Some("max_output_tokens") => "length",
        Some("content_filter") => "content-filter",
        Some(_) if has_function_call => "tool-calls",
        Some(_) => "other",
    };
    FinishReason { unified: unified.into(), raw: reason.map(str::to_owned) }
}

fn push_block(parts: &mut Vec<StreamPart>, id: String, reasoning: bool, text: &str, metadata: Value) {
    if reasoning {
        parts.push(StreamPart::ReasoningStart { id: id.clone(), provider_metadata: Some(metadata) });
        parts.push(StreamPart::ReasoningDelta { id: id.clone(), delta: text.to_owned(), provider_metadata: None });
        parts.push(StreamPart::ReasoningEnd { id, provider_metadata: None });
    } else {
        parts.push(StreamPart::TextStart { id: id.clone(), provider_metadata: Some(metadata) });
        parts.push(StreamPart::TextDelta { id: id.clone(), delta: text.to_owned(), provider_metadata: None });
        parts.push(StreamPart::TextEnd { id, provider_metadata: None });
    }
}

/// The final response as the parts a stream would have given for it.
pub(super) fn response_parts(response: &Value, tools: &[String]) -> Vec<StreamPart> {
    let mut parts = Vec::new();
    let mut has_function_call = false;
    let items = response.get("output").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
    for (index, item) in items.iter().enumerate() {
        let item_id = item.get("id").and_then(Value::as_str).unwrap_or_default();
        match item.get("type").and_then(Value::as_str) {
            Some("reasoning") => {
                let metadata = json!({ "openai": { "itemId": item_id, "reasoningEncryptedContent": item.get("encrypted_content").cloned().unwrap_or(Value::Null) } });
                let summary = item.get("summary").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
                if summary.is_empty() {
                    push_block(&mut parts, format!("{index}-0"), true, "", metadata.clone());
                }
                for (at, piece) in summary.iter().enumerate() {
                    let text = piece.get("text").and_then(Value::as_str).unwrap_or_default();
                    push_block(&mut parts, format!("{index}-{at}"), true, text, metadata.clone());
                }
            }
            Some("message") => {
                let contents = item.get("content").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
                for (at, content) in contents.iter().enumerate() {
                    let text = content.get("text").and_then(Value::as_str).unwrap_or_default();
                    let mut metadata = json!({ "itemId": item_id });
                    if let Some(phase) = item.get("phase").filter(|phase| !phase.is_null()) {
                        metadata["phase"] = phase.clone();
                    }
                    if let Some(annotations) = content.get("annotations").filter(|list| list.as_array().is_some_and(|list| !list.is_empty())) {
                        metadata["annotations"] = annotations.clone();
                    }
                    push_block(&mut parts, format!("{index}-{at}"), false, text, json!({ "openai": metadata }));
                }
            }
            Some("function_call") => {
                has_function_call = true;
                let call_id = item.get("call_id").and_then(Value::as_str).unwrap_or_default();
                let name = item.get("name").and_then(Value::as_str).unwrap_or_default();
                let input = item.get("arguments").and_then(Value::as_str).unwrap_or_default();
                match expanded_tool_call(call_id, name, input, tools, item_id) {
                    Some(expanded) => parts.extend(expanded),
                    None => parts.push(StreamPart::ToolCall {
                        tool_call_id: call_id.to_owned(),
                        tool_name: name.to_owned(),
                        input: input.to_owned(),
                        provider_metadata: Some(json!({ "openai": { "itemId": item_id } })),
                    }),
                }
            }
            _ => {}
        }
    }
    parts.push(StreamPart::Finish {
        finish_reason: finish_reason(response, has_function_call),
        usage: usage_of(response),
        provider_metadata: None,
    });
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sse(events: &[Value]) -> String {
        events
            .iter()
            .map(|event| format!("event: {}\ndata: {event}\n\n", event["type"].as_str().unwrap_or("")))
            .collect()
    }

    #[test]
    fn reports_a_plan_usage_limit_as_a_429() {
        let text = sse(&[json!({
            "type": "response.failed",
            "response": { "id": "resp_1", "status": "failed", "error": { "code": "subscription_sharing_usage_limit_exceeded", "message": "Limit reached" } },
        })]);
        let (status, code, message) = stream_to_response(&text).unwrap_err();
        assert_eq!(status, 429);
        assert_eq!(code, "subscription_sharing_usage_limit_exceeded");
        assert_eq!(message, "Limit reached");
    }

    #[test]
    fn every_failure_code_has_its_status() {
        for (code, status) in [
            ("subscription_sharing_usage_unavailable", 503),
            ("subscription_sharing_user_unavailable", 503),
            ("subscription_sharing_invalid_user", 401),
            ("subscription_sharing_user_not_eligible", 403),
            ("subscription_sharing_route_not_supported", 403),
            ("something_else", 400),
        ] {
            assert_eq!(failure_status(Some(code)), status, "{code}");
        }
        assert_eq!(failure_status(None), 400);
    }

    #[test]
    fn a_failure_without_details_still_says_so() {
        let text = sse(&[json!({ "type": "response.failed", "response": { "id": "resp_1" } })]);
        let (status, code, message) = stream_to_response(&text).unwrap_err();
        assert_eq!((status, code.as_str(), message.as_str()), (400, "response_failed", "ChatGPT could not answer."));
    }

    #[test]
    fn treats_a_stream_that_ends_early_as_a_failure() {
        let text = sse(&[json!({ "type": "response.created", "response": { "id": "resp_1" } })]);
        let (status, code, _) = stream_to_response(&text).unwrap_err();
        assert_eq!(status, 502);
        assert_eq!(code, "stream_incomplete");
    }

    #[test]
    fn the_last_final_event_is_the_answer_and_bad_lines_are_skipped() {
        let mut text = String::from("data: {not json\r\n\r\n: comment\n\n");
        text.push_str(&sse(&[json!({ "type": "response.incomplete", "response": { "id": "a" } })]));
        text.push_str(&sse(&[json!({ "type": "response.completed", "response": { "id": "b" } })]));
        text.push_str("data: [DONE]\n\n");
        assert_eq!(stream_to_response(&text).unwrap()["id"], json!("b"));
    }

    #[test]
    fn a_response_becomes_the_parts_a_stream_would_give() {
        let response = json!({
            "id": "resp_1",
            "output": [
                { "type": "reasoning", "id": "rs_1", "encrypted_content": "blob", "summary": [{ "type": "summary_text", "text": "Thinking." }] },
                { "type": "reasoning", "id": "rs_2", "summary": [] },
                { "type": "message", "id": "msg_1", "role": "assistant", "phase": "final", "content": [{ "type": "output_text", "text": "Hi", "annotations": [] }] },
                { "type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "look", "arguments": "{\"a\":1}" },
            ],
            "usage": { "input_tokens": 5, "output_tokens": 3, "input_tokens_details": { "cached_tokens": 1 }, "output_tokens_details": { "reasoning_tokens": 1 } },
        });
        let parts = serde_json::to_value(response_parts(&response, &["look".into()])).unwrap();
        let parts = parts.as_array().unwrap();
        assert_eq!(parts[0]["providerMetadata"], json!({ "openai": { "itemId": "rs_1", "reasoningEncryptedContent": "blob" } }));
        assert_eq!(parts[1]["delta"], json!("Thinking."));
        assert_eq!(parts[3]["providerMetadata"], json!({ "openai": { "itemId": "rs_2", "reasoningEncryptedContent": null } }));
        assert_eq!(parts[6]["providerMetadata"], json!({ "openai": { "itemId": "msg_1", "phase": "final" } }));
        assert_eq!(parts[9], json!({ "type": "tool-call", "toolCallId": "call_1", "toolName": "look", "input": "{\"a\":1}", "providerMetadata": { "openai": { "itemId": "fc_1" } } }));
        let finish = parts.last().unwrap();
        assert_eq!(finish["finishReason"], json!({ "unified": "tool-calls" }));
        assert_eq!(finish["usage"]["inputTokens"], json!({ "total": 5, "noCache": 4, "cacheRead": 1 }));
        assert_eq!(finish["usage"]["outputTokens"], json!({ "total": 3, "text": 2, "reasoning": 1 }));
    }

    #[test]
    fn being_cut_off_shows_in_the_finish() {
        let response = json!({ "output": [], "incomplete_details": { "reason": "max_output_tokens" } });
        let parts = serde_json::to_value(response_parts(&response, &[])).unwrap();
        assert_eq!(parts[0]["finishReason"], json!({ "unified": "length", "raw": "max_output_tokens" }));
    }
}
