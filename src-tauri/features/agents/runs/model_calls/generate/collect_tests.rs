//! Adding up a stream.
use futures_util::stream;
use serde_json::json;

use super::*;

fn parts(values: Value) -> ModelStream {
    let list: Vec<StreamPart> = serde_json::from_value(values).unwrap();
    Box::pin(stream::iter(list))
}

fn written(turn: &CollectedTurn) -> Value {
    serde_json::to_value(&turn.content).unwrap()
}

#[tokio::test]
async fn parts_are_assembled_in_the_order_they_began() {
    let turn = collect_turn(parts(json!([
        { "type": "stream-start", "warnings": [{ "type": "other", "message": "Careful." }] },
        { "type": "response-metadata", "id": "r1", "modelId": "m", "timestamp": "2026-01-01T00:00:00.000Z" },
        { "type": "reasoning-start", "id": "r" },
        { "type": "reasoning-delta", "id": "r", "delta": "Let me " },
        { "type": "reasoning-delta", "id": "r", "delta": "think." },
        { "type": "reasoning-end", "id": "r" },
        { "type": "text-start", "id": "t" },
        { "type": "text-delta", "id": "t", "delta": "Hel" },
        { "type": "text-delta", "id": "t", "delta": "lo." },
        { "type": "text-end", "id": "t" },
        { "type": "tool-input-start", "id": "c", "toolName": "look" },
        { "type": "tool-input-delta", "id": "c", "delta": "{\"z\": 1, \"a\": 2}" },
        { "type": "tool-input-end", "id": "c" },
        { "type": "tool-call", "toolCallId": "c", "toolName": "look", "input": "{\"z\": 1, \"a\": 2}" },
        { "type": "finish", "finishReason": { "unified": "tool-calls", "raw": "tool_use" }, "usage": { "inputTokens": { "total": 3 }, "outputTokens": { "total": 4 } } },
    ])))
    .await;
    assert_eq!(turn.text, "Hello.");
    assert_eq!(turn.reasoning_text.as_deref(), Some("Let me think."));
    assert_eq!(turn.response_id.as_deref(), Some("r1"));
    assert_eq!(turn.warnings.len(), 1);
    assert_eq!(turn.finish_reason.as_ref().unwrap().unified, "tool-calls");
    assert_eq!(turn.usage.input_tokens.total, Some(3));
    assert_eq!(
        written(&turn),
        json!([
            { "type": "reasoning", "text": "Let me think." },
            { "type": "text", "text": "Hello." },
            { "type": "tool-call", "toolCallId": "c", "toolName": "look", "input": { "z": 1, "a": 2 } },
        ])
    );
    let AssistantPart::ToolCall { input, .. } = &turn.content[2] else {
        panic!("expected a tool call");
    };
    assert_eq!(input.get(), r#"{"z":1,"a":2}"#, "key order kept and spacing as JSON.stringify writes it");
}

#[tokio::test]
async fn reasoning_metadata_travels_into_provider_options() {
    let turn = collect_turn(parts(json!([
        { "type": "reasoning-start", "id": "r", "providerMetadata": { "openai": { "itemId": "rs_1", "reasoningEncryptedContent": null } } },
        { "type": "reasoning-delta", "id": "r", "delta": "Hmm." },
        { "type": "reasoning-delta", "id": "r", "delta": "", "providerMetadata": { "anthropic": { "signature": "sig-1" } } },
        { "type": "reasoning-end", "id": "r" },
        { "type": "reasoning-start", "id": "r2" },
        { "type": "reasoning-delta", "id": "r2", "delta": "More." },
        { "type": "reasoning-end", "id": "r2", "providerMetadata": { "openai": { "itemId": "rs_2", "reasoningEncryptedContent": "secret-blob" } } },
        { "type": "text-start", "id": "t", "providerMetadata": { "openai": { "itemId": "msg_1" } } },
        { "type": "text-delta", "id": "t", "delta": "Done.", "providerMetadata": { "google": { "thoughtSignature": "sig-2" } } },
        { "type": "text-end", "id": "t" },
        { "type": "tool-call", "toolCallId": "c", "toolName": "look", "input": "{}", "providerMetadata": { "google": { "thoughtSignature": "sig-3" } } },
    ])))
    .await;
    assert_eq!(
        written(&turn),
        json!([
            { "type": "reasoning", "text": "Hmm.", "providerOptions": { "anthropic": { "signature": "sig-1" } } },
            { "type": "reasoning", "text": "More.", "providerOptions": { "openai": { "itemId": "rs_2", "reasoningEncryptedContent": "secret-blob" } } },
            { "type": "text", "text": "Done.", "providerOptions": { "google": { "thoughtSignature": "sig-2" } } },
            { "type": "tool-call", "toolCallId": "c", "toolName": "look", "input": {}, "providerOptions": { "google": { "thoughtSignature": "sig-3" } } },
        ])
    );
}

#[tokio::test]
async fn empty_text_is_dropped_but_empty_reasoning_stays() {
    let turn = collect_turn(parts(json!([
        { "type": "reasoning-start", "id": "r", "providerMetadata": { "anthropic": { "redactedData": "blob" } } },
        { "type": "reasoning-end", "id": "r" },
        { "type": "text-start", "id": "t", "providerMetadata": { "google": { "thoughtSignature": "s" } } },
        { "type": "text-end", "id": "t" },
    ])))
    .await;
    assert_eq!(written(&turn), json!([{ "type": "reasoning", "text": "", "providerOptions": { "anthropic": { "redactedData": "blob" } } }]));
    assert_eq!(turn.text, "");
}

#[tokio::test]
async fn a_restarted_id_begins_a_new_part() {
    let turn = collect_turn(parts(json!([
        { "type": "text-start", "id": "t" },
        { "type": "text-delta", "id": "t", "delta": "One" },
        { "type": "text-end", "id": "t" },
        { "type": "text-start", "id": "t" },
        { "type": "text-delta", "id": "t", "delta": "Two" },
        { "type": "text-end", "id": "t" },
    ])))
    .await;
    assert_eq!(written(&turn), json!([{ "type": "text", "text": "One" }, { "type": "text", "text": "Two" }]));
    assert_eq!(turn.text, "OneTwo");
}

#[tokio::test]
async fn unreadable_tool_input_becomes_an_empty_object() {
    let turn = collect_turn(parts(json!([
        { "type": "tool-call", "toolCallId": "a", "toolName": "t", "input": "{not json" },
        { "type": "tool-call", "toolCallId": "b", "toolName": "t", "input": "" },
        { "type": "tool-call", "toolCallId": "c", "toolName": "t", "input": "5" },
        { "type": "tool-call", "toolCallId": "d", "toolName": "t", "input": "{\"__proto__\":{}}" },
    ])))
    .await;
    let inputs: Vec<&str> = turn.tool_calls.iter().map(|call| call.input.get()).collect();
    assert_eq!(inputs, ["{}", "{}", "{}", "{}"]);
    let valid: Vec<bool> = turn.tool_calls.iter().map(|call| call.input_is_valid).collect();
    assert_eq!(valid, [false, true, false, false]);
    assert_eq!(turn.tool_calls[0].raw_input, "{not json");
}

#[tokio::test]
async fn errors_and_other_parts_dont_stop_collection() {
    let turn = collect_turn(parts(json!([
        { "type": "text-start", "id": "t" },
        { "type": "text-delta", "id": "t", "delta": "Fine" },
        { "type": "error", "error": { "name": "AI_JSONParseError", "text": "{bad" } },
        { "type": "source", "sourceType": "url", "id": "s", "url": "https://example.com" },
        { "type": "text-end", "id": "t" },
    ])))
    .await;
    assert_eq!(turn.text, "Fine");
    assert_eq!(turn.errors.len(), 1);
    assert!(turn.finish_reason.is_none());
}

#[tokio::test]
async fn an_empty_answer_has_no_message() {
    let turn = collect_turn(parts(json!([{ "type": "stream-start", "warnings": [] }]))).await;
    assert!(turn.response_message().is_none());
}
