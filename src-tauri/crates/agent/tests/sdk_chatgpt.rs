//! ChatGPT sign-in: every request is reshaped, every answer comes from a stream. Ported from
//! `test/chatgpt-provider.test.ts`.
mod support;

use misty_agent::sdk::{collect_turn, generate_text, testing, CallOptions, Credential, GenerateSettings, ModelError, ModelRoute, ProviderId, resolve_model};
use serde_json::{json, Value};
use support::{serve_replies, MockServer, Reply};

const TOKEN: &str = "chatgpt-access-token-fixture";

/// What the preview refuses (developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
const FORBIDDEN: [&str; 16] = [
    "background",
    "conversation",
    "max_output_tokens",
    "max_tool_calls",
    "metadata",
    "moderation",
    "multi_agent",
    "prompt",
    "prompt_cache_retention",
    "safety_identifier",
    "temperature",
    "top_logprobs",
    "top_p",
    "truncation",
    "user",
    "previous_response_id",
];

fn completed(text: &str) -> Value {
    json!({
        "id": "resp_1",
        "object": "response",
        "created_at": 1_790_000_000,
        "model": "gpt-test",
        "status": "completed",
        "incomplete_details": null,
        "output": [{
            "type": "message",
            "id": "msg_1",
            "role": "assistant",
            "status": "completed",
            "content": [{ "type": "output_text", "text": text, "annotations": [] }],
        }],
        "usage": {
            "input_tokens": 5,
            "output_tokens": 2,
            "input_tokens_details": { "cached_tokens": 0 },
            "output_tokens_details": { "reasoning_tokens": 0 },
        },
    })
}

fn sse(events: &[Value]) -> Reply {
    let body: String = events
        .iter()
        .map(|event| format!("event: {}\ndata: {event}\n\n", event["type"].as_str().unwrap_or("")))
        .collect();
    Reply::new(200, "text/event-stream", body)
}

fn client() -> reqwest::Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::new()
}

fn options(value: Value) -> CallOptions {
    serde_json::from_value(value).unwrap()
}

fn asking(system: &str, text: &str) -> Value {
    json!({
        "prompt": [
            { "role": "system", "content": system },
            { "role": "user", "content": [{ "type": "text", "text": text }] },
        ],
    })
}

fn first_body(server: &MockServer) -> Value {
    server.captured.lock().unwrap()[0].body.clone()
}

#[tokio::test]
async fn calls_the_responses_api_with_the_token_and_only_the_accepted_fields() {
    let server = serve_replies(vec![sse(&[
        json!({ "type": "response.created", "response": { "id": "resp_1" } }),
        json!({ "type": "response.completed", "response": completed("Hello there") }),
    ])])
    .await;
    let mut request = asking("You are Misty.", "Say hello");
    request["maxOutputTokens"] = json!(500);
    request["temperature"] = json!(0.2);
    request["topP"] = json!(0.9);
    request["tools"] = json!([{ "type": "function", "name": "look", "description": "Look.", "inputSchema": { "type": "object", "properties": {} } }]);
    request["providerOptions"] = json!({ "openai": { "user": "someone", "metadata": { "a": "b" }, "previousResponseId": "resp_0" } });
    let (model, prepared) = testing::chatgpt_model(&client(), &server.base_url, TOKEN, "gpt-test", options(request));
    let result = generate_text(model.as_ref(), prepared, GenerateSettings::default()).await.unwrap();
    assert_eq!(result.turn.text, "Hello there");
    assert_eq!(result.turn.finish_reason.as_ref().unwrap().unified, "stop");
    assert_eq!(result.turn.usage.input_tokens.total, Some(5));
    let captured = server.captured.lock().unwrap().clone();
    assert_eq!(captured.len(), 1);
    let request = &captured[0];
    assert_eq!(request.path, "/v1/responses");
    assert_eq!(request.headers["authorization"], format!("Bearer {TOKEN}"));
    assert_eq!(request.headers["accept"], "text/event-stream");
    for field in FORBIDDEN {
        assert!(request.body.get(field).is_none(), "{field}");
    }
    assert_eq!(request.body["model"], json!("gpt-test"));
    assert_eq!(request.body["store"], json!(false));
    assert_eq!(request.body["stream"], json!(true));
    assert!(request.body["instructions"].as_str().unwrap().contains("You are Misty."));
    let roles: Vec<&str> = request.body["input"].as_array().unwrap().iter().filter_map(|item| item["role"].as_str()).collect();
    assert!(!roles.contains(&"system"));
}

#[tokio::test]
async fn streams_as_asked_with_the_same_shaping() {
    let server = serve_replies(vec![sse(&[
        json!({ "type": "response.created", "response": { "id": "resp_1", "created_at": 1_790_000_000, "model": "gpt-test" } }),
        json!({
            "type": "response.output_item.added",
            "output_index": 0,
            "item": { "type": "message", "id": "msg_1", "role": "assistant", "status": "in_progress", "content": [] },
        }),
        json!({ "type": "response.output_text.delta", "item_id": "msg_1", "output_index": 0, "content_index": 0, "delta": "Hi" }),
        json!({ "type": "response.output_item.done", "output_index": 0, "item": completed("Hi")["output"][0] }),
        json!({ "type": "response.completed", "response": completed("Hi") }),
    ])])
    .await;
    let mut request = asking("Be brief.", "Hi");
    request["maxOutputTokens"] = json!(100);
    let (model, prepared) = testing::chatgpt_model(&client(), &server.base_url, TOKEN, "gpt-test", options(request));
    let stream = model.stream(prepared).await.unwrap();
    let turn = collect_turn(stream).await;
    assert_eq!(turn.text, "Hi");
    let body = first_body(&server);
    assert_eq!(body["store"], json!(false));
    assert_eq!(body["stream"], json!(true));
    assert_eq!(body["instructions"], json!("Be brief."));
    assert!(body.get("max_output_tokens").is_none());
}

#[tokio::test]
async fn reports_a_plan_usage_limit_as_a_429() {
    let server = serve_replies(vec![sse(&[json!({
        "type": "response.failed",
        "response": { "id": "resp_1", "status": "failed", "error": { "code": "subscription_sharing_usage_limit_exceeded", "message": "Limit reached" } },
    })])])
    .await;
    let (model, prepared) = testing::chatgpt_model(&client(), &server.base_url, TOKEN, "gpt-test", options(asking("Hi.", "Hi")));
    let settings = GenerateSettings { max_retries: Some(0), ..GenerateSettings::default() };
    let error = generate_text(model.as_ref(), prepared, settings).await.err().unwrap();
    let ModelError::Api { status, message, retryable, .. } = error else {
        panic!("expected a provider failure");
    };
    assert_eq!(status, 429);
    assert_eq!(message, "Limit reached");
    assert!(retryable, "a limit can pass, so trying again can help");
}

#[tokio::test]
async fn treats_a_stream_that_ends_early_as_a_failure() {
    let server = serve_replies(vec![sse(&[json!({ "type": "response.created", "response": { "id": "resp_1" } })])]).await;
    let (model, prepared) = testing::chatgpt_model(&client(), &server.base_url, TOKEN, "gpt-test", options(asking("Hi.", "Hi")));
    let settings = GenerateSettings { max_retries: Some(0), ..GenerateSettings::default() };
    let error = generate_text(model.as_ref(), prepared, settings).await.err().unwrap();
    assert!(matches!(error, ModelError::Api { status: 502, retryable: true, .. }), "{error}");
}

#[tokio::test]
async fn a_token_in_a_failure_never_comes_out() {
    let body = json!({ "error": { "message": format!("Bad token {TOKEN}.") } });
    let server = serve_replies(vec![Reply::new(401, "application/json", body.to_string())]).await;
    let (model, prepared) = testing::chatgpt_model(&client(), &server.base_url, TOKEN, "gpt-test", options(asking("Hi.", "Hi")));
    let error = model.stream(prepared).await.err().unwrap();
    assert!(!error.to_string().contains(TOKEN), "{error}");
    assert!(matches!(error, ModelError::Api { status: 401, retryable: false, .. }));
    let failed = json!({ "type": "response.failed", "response": { "error": { "code": "x", "message": format!("Bad {TOKEN}") } } });
    let server = serve_replies(vec![sse(&[failed])]).await;
    let (model, prepared) = testing::chatgpt_model(&client(), &server.base_url, TOKEN, "gpt-test", options(asking("Hi.", "Hi")));
    let settings = GenerateSettings { max_retries: Some(0), ..GenerateSettings::default() };
    let error = generate_text(model.as_ref(), prepared, settings).await.err().unwrap();
    assert!(!error.to_string().contains(TOKEN), "{error}");
}

/// In the runtime this goes through `setDeviceModels`, which isn't part of the model clients. Here
/// the same promise is that a ChatGPT token resolves to a model, whatever address the settings hold.
#[test]
fn takes_a_chatgpt_access_token() {
    let route = ModelRoute {
        reasoning: None,
        credential: Credential { provider: ProviderId::Chatgpt, api_key: TOKEN.into(), base_url: Some("http://127.0.0.1:1/v1".into()) },
    };
    assert!(resolve_model("chatgpt/gpt-test", CallOptions::default(), &route, &client()).is_ok());
    let invalid = ModelRoute {
        reasoning: None,
        credential: Credential { provider: ProviderId::Chatgpt, api_key: TOKEN.into(), base_url: Some("file:///etc/passwd".into()) },
    };
    assert!(resolve_model("chatgpt/gpt-test", CallOptions::default(), &invalid, &client()).is_err());
}
