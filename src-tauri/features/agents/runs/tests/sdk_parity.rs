//! Replays what the Vercel AI SDK sent and parsed against these clients, so a request or a parsed
//! stream that differs from the SDK fails here. Record new fixtures with
//! the recorder in the TypeScript runtime, in git history before it was removed.
// Fixtures are read from this crate's own test folder.
#![allow(clippy::disallowed_methods)]

mod support;

use std::{fs, path::PathBuf};

use futures_util::StreamExt;
use agent_runs::model_calls::{resolve_model, CallOptions, Credential, ModelError, ModelRoute, ProviderId};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    name: String,
    model_id: String,
    credential_provider: ProviderId,
    reasoning: Option<String>,
    /// Kept as written: tool inputs' key order reaches the wire, and a `Value` would sort it.
    options: Box<serde_json::value::RawValue>,
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

/// A JavaScript error's `cause` is the engine's own object, not part of the contract. The message
/// of the SDK's own errors doesn't serialize there, and here it reads differently: what a JSON
/// parser says isn't the same in two languages.
fn without_cause(mut part: Value) -> Value {
    if let Some(error) = part.get_mut("error").and_then(Value::as_object_mut) {
        error.remove("cause");
        if error.get("name").and_then(Value::as_str).is_some_and(|name| name.starts_with("AI_")) {
            error.remove("message");
        }
    }
    part
}

/// Whether a thrown message is the provider's words, rather than a JSON parser's or a validator's.
fn message_is_comparable(message: &str) -> bool {
    !message.starts_with("JSON parsing failed") && !message.starts_with("Type validation failed")
}

/// Ids the SDK makes up where a provider sends none (`generateId`) are random, so they compare by
/// where they first appear. Anything else, such as an id the provider sent, must match exactly.
fn with_generated_ids_numbered(parts: &[Value]) -> Vec<Value> {
    let generated = |id: &str| id.len() == 16 && id.chars().all(|character| character.is_ascii_alphanumeric());
    let mut seen: Vec<String> = Vec::new();
    let mut numbered = |id: &str| {
        let at = seen.iter().position(|known| known == id).unwrap_or_else(|| {
            seen.push(id.to_owned());
            seen.len() - 1
        });
        format!("generated-{at}")
    };
    parts
        .iter()
        .cloned()
        .map(|mut part| {
            for key in ["id", "toolCallId"] {
                let id = part.get(key).and_then(Value::as_str).filter(|id| generated(id)).map(str::to_owned);
                if let Some(id) = id {
                    part[key] = json!(numbered(&id));
                }
            }
            part
        })
        .collect()
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
    let options: CallOptions = serde_json::from_str(fixture.options.get())
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
            assert_eq!(
                json!(with_generated_ids_numbered(&parts)),
                json!(with_generated_ids_numbered(&expected)),
                "{name}: parts"
            );
        }
        (Err(ModelError::Api { status, message, retryable, .. }), Some(thrown)) => {
            assert_eq!(Some(status), thrown.status_code, "{name}: status");
            assert_eq!(Some(retryable), thrown.is_retryable, "{name}: retryable");
            if let Some(theirs) = thrown.message.as_deref().filter(|theirs| message_is_comparable(theirs)) {
                assert_eq!(message, theirs, "{name}: message");
            }
        }
        // The SDK refused the call before sending anything.
        (Err(ModelError::Unsupported(message)), Some(thrown))
            if thrown.name.as_deref() == Some("AI_UnsupportedFunctionalityError") =>
        {
            assert_eq!(Some(message.as_str()), thrown.message.as_deref(), "{name}: message");
        }
        // The SDK's stream itself failed partway. Here that's a last error part.
        (Ok(stream), Some(thrown)) if thrown.status_code.is_none() => {
            let mut parts: Vec<Value> = stream.map(|part| serde_json::to_value(part).unwrap()).collect().await;
            let last = parts.pop().unwrap_or(Value::Null);
            assert_eq!(last["type"], "error", "{name}: the stream ends in an error");
            assert_eq!(json!(parts), json!(fixture.parts), "{name}: parts before the failure");
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

#[tokio::test]
async fn google_matches_the_sdk() {
    for path in fixtures_for("google") {
        replay(&path).await;
    }
}

#[tokio::test]
async fn gateway_matches_the_sdk() {
    for path in fixtures_for("gateway") {
        replay(&path).await;
    }
}

#[tokio::test]
async fn anthropic_matches_the_sdk() {
    for path in fixtures_for("anthropic") {
        replay(&path).await;
    }
}

#[tokio::test]
async fn openai_responses_matches_the_sdk() {
    for path in fixtures_for("openai-responses") {
        replay(&path).await;
    }
}
