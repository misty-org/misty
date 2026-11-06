//! Replays what the Vercel AI SDK sent and parsed against these clients, so a request or a parsed
//! stream that differs from the SDK fails here. Record new fixtures with
//! `src-tauri/services/agent-runtime/test/sdk-parity.record.test.ts`.
mod support;

use std::{fs, path::PathBuf};

use futures_util::StreamExt;
use misty_agent::sdk::{resolve_model, CallOptions, Credential, ModelError, ModelRoute, ProviderId};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    name: String,
    model_id: String,
    credential_provider: ProviderId,
    reasoning: Option<String>,
    options: Value,
    status: u16,
    content_type: String,
    response: String,
    sent: Vec<SentRequest>,
    parts: Vec<Value>,
    thrown: Option<Thrown>,
}

#[derive(Deserialize)]
struct SentRequest {
    method: String,
    path: String,
    headers: std::collections::BTreeMap<String, String>,
    body: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Thrown {
    status_code: u16,
    is_retryable: bool,
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

/// A JavaScript error's `cause` is the engine's own object, not part of the contract.
fn without_cause(mut part: Value) -> Value {
    if let Some(error) = part.get_mut("error").and_then(Value::as_object_mut) {
        error.remove("cause");
    }
    part
}

fn fixtures_for(provider_dir: &str) -> Vec<PathBuf> {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/sdk")
        .join(provider_dir);
    let mut files: Vec<PathBuf> = fs::read_dir(&folder)
        .unwrap_or_else(|_| panic!("no fixtures in {}", folder.display()))
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no fixtures in {}", folder.display());
    files
}

async fn replay(path: &PathBuf) {
    let fixture: Fixture = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let name = &fixture.name;
    let server = support::serve(fixture.status, &fixture.content_type, fixture.response.clone()).await;
    let route = ModelRoute {
        reasoning: fixture.reasoning.clone(),
        credential: Credential {
            provider: fixture.credential_provider,
            api_key: "test-key-parity".into(),
            base_url: Some(server.base_url.clone()),
        },
    };
    let options: CallOptions = serde_json::from_str(&fixture.options.to_string())
        .unwrap_or_else(|error| panic!("{name}: options didn't parse: {error}"));
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let (model, options) = resolve_model(&fixture.model_id, options, &route, &client).unwrap();
    let started = model.stream(options).await;

    let captured = server.captured.lock().unwrap().clone();
    assert_eq!(captured.len(), fixture.sent.len(), "{name}: request count");
    for (ours, theirs) in captured.iter().zip(&fixture.sent) {
        assert_eq!(ours.method, theirs.method, "{name}: method");
        assert_eq!(ours.path, theirs.path, "{name}: path");
        assert_eq!(ours.body, theirs.body, "{name}: body");
        let headers: std::collections::BTreeMap<_, _> = ours
            .headers
            .iter()
            .filter(|(name, _)| !IGNORED_HEADERS.contains(&name.as_str()))
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect();
        assert_eq!(&headers, &theirs.headers, "{name}: headers");
    }

    match (started, &fixture.thrown) {
        (Ok(stream), None) => {
            let parts: Vec<Value> = stream
                .map(|part| without_cause(serde_json::to_value(part).unwrap()))
                .collect()
                .await;
            let expected: Vec<Value> = fixture.parts.iter().cloned().map(without_cause).collect();
            assert_eq!(json!(parts), json!(expected), "{name}: parts");
        }
        (Err(ModelError::Api { status, retryable, .. }), Some(thrown)) => {
            assert_eq!(status, thrown.status_code, "{name}: status");
            assert_eq!(retryable, thrown.is_retryable, "{name}: retryable");
        }
        (Ok(_), Some(_)) => panic!("{name}: the SDK threw, but this client didn't"),
        (Err(error), _) => panic!("{name}: unexpected failure: {error}"),
    }
}

#[tokio::test]
async fn openai_compatible_matches_the_sdk() {
    for path in fixtures_for("openai-compatible") {
        replay(&path).await;
    }
}
