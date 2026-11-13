//! `generate_text` against a local server: its retries and structured output, compared with what
//! the SDK's `retryWithExponentialBackoff` and `Output` do.
mod support;

use std::sync::Arc;

use agent_runs::model_calls::{
    generate_text, resolve_model, start_stream, CallOptions, Credential, GenerateResult, GenerateSettings,
    LanguageModel, ModelError, ModelRoute, OutputObject, ProviderId, RawJson, RetryReason,
};
use serde_json::{json, Value};
use support::{serve_replies, MockServer, Reply};

const OK_STREAM: &str = "data: {\"id\":\"c\",\"created\":1790000000,\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello.\"},\"finish_reason\":null}]}\n\ndata: {\"id\":\"c\",\"created\":1790000000,\"model\":\"m\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2}}\n\ndata: [DONE]\n\n";

fn stream_reply(body: &str) -> Reply {
    Reply::new(200, "text/event-stream", body)
}

fn failing(status: u16) -> Reply {
    Reply::new(status, "application/json", r#"{"error":{"message":"Try later."}}"#)
}

fn compatible_model(server: &MockServer) -> (Arc<dyn LanguageModel>, CallOptions) {
    let route = ModelRoute {
        reasoning: None,
        credential: Credential {
            provider: ProviderId::Nvidia,
            api_key: "test-key-parity".into(),
            base_url: Some(server.base_url.clone()),
        },
    };
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    resolve_model("nvidia/test-model", asking("Hi."), &route, &client).unwrap()
}

fn asking(text: &str) -> CallOptions {
    serde_json::from_value(json!({ "prompt": [{ "role": "user", "content": [{ "type": "text", "text": text }] }] })).unwrap()
}

async fn run(replies: Vec<Reply>, settings: GenerateSettings) -> (Result<GenerateResult, ModelError>, MockServer) {
    let server = serve_replies(replies).await;
    let (model, options) = compatible_model(&server);
    (generate_text(model.as_ref(), options, settings).await, server)
}

fn request_count(server: &MockServer) -> usize {
    server.captured.lock().unwrap().len()
}

fn answer_schema() -> OutputObject {
    OutputObject::new(RawJson::from_text(r#"{"type":"object","properties":{"say":{"type":"string"}},"required":["say"]}"#.to_owned()).unwrap())
        .named("voice_turn")
}

#[tokio::test]
async fn text_usage_and_finish_are_collected() {
    let (result, server) = run(vec![stream_reply(OK_STREAM)], GenerateSettings::default()).await;
    let result = result.unwrap();
    assert_eq!(result.turn.text, "Hello.");
    assert_eq!(result.turn.finish_reason.as_ref().unwrap().unified, "stop");
    assert_eq!(result.turn.usage.input_tokens.total, Some(5));
    assert_eq!(result.turn.usage.output_tokens.total, Some(2));
    assert_eq!(result.output().unwrap(), &json!("Hello."));
    assert_eq!(request_count(&server), 1);
}

#[tokio::test]
async fn a_passing_failure_is_tried_again_after_the_wait_the_provider_asked_for() {
    let replies = vec![
        failing(429).with_header("retry-after-ms", "1"),
        failing(500).with_header("retry-after", "0"),
        stream_reply(OK_STREAM),
    ];
    let settings = GenerateSettings { max_retries: Some(4), ..GenerateSettings::default() };
    let started = std::time::Instant::now();
    let (result, server) = run(replies, settings).await;
    assert_eq!(result.unwrap().turn.text, "Hello.");
    assert_eq!(request_count(&server), 3);
    assert!(started.elapsed() < std::time::Duration::from_millis(1500), "the waits were the provider's");
    let captured = server.captured.lock().unwrap();
    assert_eq!(captured[0].body, captured[2].body, "the same request each time");
}

#[tokio::test]
async fn a_client_error_is_not_tried_again() {
    let settings = GenerateSettings { max_retries: Some(4), ..GenerateSettings::default() };
    let (result, server) = run(vec![failing(400), stream_reply(OK_STREAM)], settings).await;
    assert!(matches!(result, Err(ModelError::Api { status: 400, retryable: false, .. })));
    assert_eq!(request_count(&server), 1);
}

#[tokio::test]
async fn retries_run_out_with_every_failure_kept() {
    let settings = GenerateSettings { max_retries: Some(2), ..GenerateSettings::default() };
    let (result, server) = run(vec![failing(503).with_header("retry-after-ms", "0")], settings).await;
    let Err(ModelError::Retry { reason, message, errors }) = result else {
        panic!("expected a retry error");
    };
    assert_eq!(reason, RetryReason::MaxRetriesExceeded);
    assert_eq!(message, "Failed after 3 attempts. Last error: Try later.");
    assert_eq!(errors.len(), 3);
    assert_eq!(request_count(&server), 3);
}

#[tokio::test]
async fn no_retries_when_asked_for_none() {
    let settings = GenerateSettings { max_retries: Some(0), ..GenerateSettings::default() };
    let (result, server) = run(vec![failing(503), stream_reply(OK_STREAM)], settings).await;
    assert!(matches!(result, Err(ModelError::Api { status: 503, .. })));
    assert_eq!(request_count(&server), 1);
}

#[tokio::test]
async fn a_failure_inside_the_stream_fails_the_call_without_a_retry() {
    let bad = "data: {not json\n\ndata: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n";
    let settings = GenerateSettings { max_retries: Some(4), ..GenerateSettings::default() };
    let (result, server) = run(vec![stream_reply(bad), stream_reply(OK_STREAM)], settings).await;
    assert!(matches!(result, Err(ModelError::Api { retryable: false, .. })));
    assert_eq!(request_count(&server), 1);
}

#[tokio::test]
async fn structured_output_asks_for_json_and_reads_the_answer() {
    let body = OK_STREAM.replace("Hello.", r#"{\"say\":\"Hi\"}"#);
    let settings = GenerateSettings { output: Some(answer_schema()), ..GenerateSettings::default() };
    let (result, server) = run(vec![stream_reply(&body)], settings).await;
    assert_eq!(result.unwrap().output().unwrap(), &json!({ "say": "Hi" }));
    let captured = server.captured.lock().unwrap();
    assert_eq!(captured[0].body["response_format"], json!({ "type": "json_object" }));
}

#[tokio::test]
async fn an_answer_that_isnt_json_is_a_failure_of_its_own() {
    let settings = GenerateSettings { output: Some(answer_schema()), ..GenerateSettings::default() };
    let (result, _server) = run(vec![stream_reply(OK_STREAM)], settings).await;
    let Err(ModelError::NoOutput { name, message }) = result else {
        panic!("expected no output");
    };
    assert_eq!(name, "AI_NoObjectGeneratedError");
    assert_eq!(message, "No object generated: could not parse the response.");
}

#[tokio::test]
async fn output_is_read_only_when_the_model_stopped() {
    let cut_off = OK_STREAM.replace("\"finish_reason\":\"stop\"", "\"finish_reason\":\"length\"");
    let settings = GenerateSettings { output: Some(answer_schema()), ..GenerateSettings::default() };
    let (result, _server) = run(vec![stream_reply(&cut_off)], settings).await;
    let result = result.unwrap();
    assert_eq!(result.turn.finish_reason.as_ref().unwrap().unified, "length");
    let Err(ModelError::NoOutput { name, message }) = result.output() else {
        panic!("expected no output");
    };
    assert_eq!(name, "AI_NoOutputGeneratedError");
    assert_eq!(message, "No output generated.");
}

#[tokio::test]
async fn a_stream_is_retried_only_until_it_starts() {
    let server = serve_replies(vec![failing(500).with_header("retry-after-ms", "0"), stream_reply(OK_STREAM)]).await;
    let (model, options) = compatible_model(&server);
    let stream = start_stream(model.as_ref(), options, Some(4)).await.unwrap();
    let turn = agent_runs::model_calls::collect_turn(stream).await;
    assert_eq!(turn.text, "Hello.");
    assert_eq!(request_count(&server), 2);
    let captured = server.captured.lock().unwrap();
    assert_eq!(captured[1].body["messages"], Value::Array(vec![json!({ "role": "user", "content": "Hi." })]));
}

#[tokio::test]
async fn structured_output_reaches_google_as_a_schema() {
    let server = serve_replies(vec![stream_reply(
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"{\\\"say\\\":\\\"Hi\\\"}\"}]},\"finishReason\":\"STOP\"}]}\n\n",
    )])
    .await;
    let route = ModelRoute {
        reasoning: None,
        credential: Credential {
            provider: ProviderId::Google,
            api_key: "test-key-parity".into(),
            base_url: Some(server.base_url.clone()),
        },
    };
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let (model, options) = resolve_model("google/gemini-2.5-flash", asking("Hi."), &route, &client).unwrap();
    let settings = GenerateSettings { output: Some(answer_schema()), ..GenerateSettings::default() };
    let result = generate_text(model.as_ref(), options, settings).await.unwrap();
    assert_eq!(result.output().unwrap(), &json!({ "say": "Hi" }));
    let captured = server.captured.lock().unwrap();
    assert_eq!(
        captured[0].body["generationConfig"],
        json!({
            "responseMimeType": "application/json",
            "responseSchema": { "required": ["say"], "type": "object", "properties": { "say": { "type": "string" } } },
        })
    );
    assert!(!captured[0].path.contains("test-key-parity"), "the key never goes in a URL");
    assert_eq!(captured[0].headers["x-goog-api-key"], "test-key-parity");
}
