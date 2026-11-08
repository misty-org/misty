//! Replays what the Vercel AI SDK's `embedMany`, `generateSpeech` and `transcribe` sent and gave back
//! against these clients. Record new fixtures with
//! the recorder in the TypeScript runtime, in git history before it was removed.
// Fixtures are read from this crate's own test folder.
#![allow(clippy::disallowed_methods)]

mod support;

use std::{collections::BTreeMap, fs, path::PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use agent_runs::model_calls::{
    embed_many, generate_speech, resolve_embedding_model, resolve_speech_model, resolve_transcription_model, testing,
    transcribe, Credential, ModelError, ModelRoute, ProviderId, SpeechRequest,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use support::{serve_replies, MockServer, Reply};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    name: String,
    kind: String,
    model_id: String,
    credential_provider: ProviderId,
    input: Value,
    replies: Vec<RecordedReply>,
    unordered_requests: bool,
    sent: Vec<SentRequest>,
    result: Option<Value>,
    thrown: Option<Thrown>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordedReply {
    status: u16,
    content_type: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    body_base64: Option<String>,
}

#[derive(Clone, Deserialize)]
struct SentRequest {
    method: String,
    path: String,
    headers: BTreeMap<String, String>,
    body: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Thrown {
    name: Option<String>,
    message: Option<String>,
    status_code: Option<u16>,
    is_retryable: Option<bool>,
}

/// Transport details the SDK and this client may differ in without any meaning.
const IGNORED_HEADERS: [&str; 7] = [
    "host",
    "connection",
    "content-length",
    "accept-encoding",
    "accept-language",
    "sec-fetch-mode",
    "user-agent",
];

fn replies_of(fixture: &Fixture) -> Vec<Reply> {
    fixture
        .replies
        .iter()
        .map(|reply| {
            let body = match (&reply.body_base64, &reply.body) {
                (Some(encoded), _) => STANDARD.decode(encoded).unwrap(),
                (None, Some(text)) => text.clone().into_bytes(),
                (None, None) => Vec::new(),
            };
            Reply::new(reply.status, &reply.content_type, body)
        })
        .collect()
}

fn route_for(fixture: &Fixture, server: &MockServer) -> ModelRoute {
    ModelRoute {
        reasoning: None,
        credential: Credential {
            provider: fixture.credential_provider,
            api_key: "test-key-parity".into(),
            base_url: Some(server.base_url.clone()),
        },
    }
}

fn options_of(input: &Value) -> Option<Map<String, Value>> {
    input.get("providerOptions").and_then(Value::as_object).cloned()
}

fn numbers_alike(value: &Value) -> Value {
    match value {
        Value::Number(number) => json!(number.as_f64()),
        Value::Array(items) => Value::Array(items.iter().map(numbers_alike).collect()),
        Value::Object(fields) => Value::Object(fields.iter().map(|(key, field)| (key.clone(), numbers_alike(field))).collect()),
        other => other.clone(),
    }
}

fn sorted_by_body(mut requests: Vec<(String, String, BTreeMap<String, String>, Value)>) -> Vec<(String, String, BTreeMap<String, String>, Value)> {
    requests.sort_by_key(|request| request.3.to_string());
    requests
}

fn check_requests(fixture: &Fixture, server: &MockServer) {
    let name = &fixture.name;
    let captured = server.captured.lock().unwrap().clone();
    let ours: Vec<_> = captured
        .into_iter()
        .map(|request| {
            let mut headers: BTreeMap<String, String> = request
                .headers
                .into_iter()
                .filter(|(name, _)| !IGNORED_HEADERS.contains(&name.as_str()))
                .collect();
            if let Some(content_type) = headers.get_mut("content-type") {
                if let Some((plain, _)) = content_type.clone().split_once("; boundary=") {
                    *content_type = plain.to_owned();
                }
            }
            (request.method, request.path, headers, request.body)
        })
        .collect();
    let theirs: Vec<_> = fixture
        .sent
        .iter()
        .cloned()
        .map(|sent| (sent.method, sent.path, sent.headers, sent.body))
        .collect();
    let (ours, theirs) = if fixture.unordered_requests { (sorted_by_body(ours), sorted_by_body(theirs)) } else { (ours, theirs) };
    assert_eq!(ours.len(), theirs.len(), "{name}: request count");
    for (ours, theirs) in ours.iter().zip(&theirs) {
        assert_eq!(ours.0, theirs.0, "{name}: method");
        assert_eq!(ours.1, theirs.1, "{name}: path");
        assert_eq!(ours.3, theirs.3, "{name}: body");
        assert_eq!(ours.2, theirs.2, "{name}: headers");
    }
}

fn check_failure(fixture: &Fixture, error: ModelError) {
    let name = &fixture.name;
    let thrown = fixture.thrown.as_ref().unwrap_or_else(|| panic!("{name}: failed where the SDK didn't: {error}"));
    assert_eq!(Some(error.to_string()), thrown.message, "{name}: message");
    match error {
        ModelError::Api { status, retryable, .. } => {
            assert_eq!(Some(status), thrown.status_code, "{name}: status");
            assert_eq!(Some(retryable), thrown.is_retryable, "{name}: retryable");
        }
        ModelError::NoOutput { name: kind, .. } => assert_eq!(Some(kind), thrown.name.as_deref(), "{name}: kind"),
        ModelError::Unsupported(_) => assert_eq!(thrown.name.as_deref(), Some("AI_UnsupportedFunctionalityError"), "{name}: kind"),
        other => panic!("{name}: unexpected failure: {other}"),
    }
}

fn check_result(fixture: &Fixture, ours: Value) {
    let name = &fixture.name;
    let theirs = fixture.result.as_ref().unwrap_or_else(|| panic!("{name}: the SDK threw, but this client didn't"));
    assert_eq!(numbers_alike(&ours), numbers_alike(theirs), "{name}: result");
}

async fn replay_embed(fixture: &Fixture, route: &ModelRoute, client: &reqwest::Client) {
    let model = resolve_embedding_model(&fixture.model_id, route, client).unwrap();
    let values: Vec<String> = serde_json::from_value(fixture.input["values"].clone()).unwrap();
    let options = options_of(&fixture.input);
    match embed_many(model.as_ref(), &values, options.as_ref(), Some(0)).await {
        Ok(result) => check_result(
            fixture,
            json!({
                "embeddings": result.embeddings,
                "tokens": result.tokens,
                "warnings": result.warnings,
                "providerMetadata": result.provider_metadata,
            }),
        ),
        Err(error) => check_failure(fixture, error),
    }
}

async fn replay_speech(fixture: &Fixture, route: &ModelRoute, client: &reqwest::Client, server: &MockServer) {
    // ElevenLabs has a fixed address, and the SDK's was pointed at the mock the same way.
    let model = if fixture.credential_provider == ProviderId::Elevenlabs {
        let origin = server.base_url.trim_end_matches("/v1");
        testing::elevenlabs_speech_model(client, origin, "test-key-parity", fixture.model_id.trim_start_matches("elevenlabs/"))
    } else {
        resolve_speech_model(&fixture.model_id, route, client).unwrap()
    };
    let text = |key: &str| fixture.input.get(key).and_then(Value::as_str).map(str::to_owned);
    let request = SpeechRequest {
        text: text("text").unwrap(),
        voice: text("voice"),
        output_format: text("outputFormat"),
        instructions: text("instructions"),
        speed: fixture.input.get("speed").and_then(Value::as_f64),
        language: text("language"),
        provider_options: options_of(&fixture.input),
    };
    match generate_speech(model.as_ref(), &request, Some(0)).await {
        Ok(result) => check_result(
            fixture,
            json!({
                "audioBase64": STANDARD.encode(&result.audio),
                "mediaType": result.media_type,
                "format": result.format,
                "warnings": result.warnings,
                "providerMetadata": result.provider_metadata.unwrap_or_else(|| json!({})),
            }),
        ),
        Err(error) => check_failure(fixture, error),
    }
}

async fn replay_transcribe(fixture: &Fixture, route: &ModelRoute, client: &reqwest::Client) {
    let model = resolve_transcription_model(&fixture.model_id, route, client).unwrap();
    let audio = STANDARD.decode(fixture.input["audioBase64"].as_str().unwrap()).unwrap();
    let options = options_of(&fixture.input);
    match transcribe(model.as_ref(), &audio, options.as_ref(), Some(0)).await {
        Ok(result) => check_result(
            fixture,
            json!({
                "text": result.text,
                "segments": result.segments.iter().map(|segment| json!({
                    "text": segment.text,
                    "startSecond": segment.start_second,
                    "endSecond": segment.end_second,
                })).collect::<Vec<_>>(),
                "language": result.language,
                "durationInSeconds": result.duration_in_seconds,
                "warnings": result.warnings,
                "providerMetadata": result.provider_metadata.unwrap_or_else(|| json!({})),
            }),
        ),
        Err(error) => check_failure(fixture, error),
    }
}

async fn replay(path: &PathBuf) {
    let fixture: Fixture = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let server = serve_replies(replies_of(&fixture)).await;
    let route = route_for(&fixture, &server);
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    match fixture.kind.as_str() {
        "embed" => replay_embed(&fixture, &route, &client).await,
        "speech" => replay_speech(&fixture, &route, &client, &server).await,
        "transcribe" => replay_transcribe(&fixture, &route, &client).await,
        other => panic!("{other}: an unknown kind of fixture"),
    }
    check_requests(&fixture, &server);
}

fn fixtures_with(prefix: &str) -> Vec<PathBuf> {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sdk/media");
    let mut files: Vec<PathBuf> = fs::read_dir(&folder)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with(prefix)))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no {prefix} fixtures");
    files
}

#[tokio::test]
async fn embeddings_match_the_sdk() {
    for path in fixtures_with("embed_") {
        replay(&path).await;
    }
}

#[tokio::test]
async fn speech_matches_the_sdk() {
    for path in fixtures_with("speech_") {
        replay(&path).await;
    }
}

#[tokio::test]
async fn transcription_matches_the_sdk() {
    for path in fixtures_with("transcribe_") {
        replay(&path).await;
    }
}
