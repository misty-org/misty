//! Non-chat models beyond what a recording can show: keys, refusals and retries.
mod support;

use misty_agent::sdk::{
    embed_many, generate_speech, resolve_embedding_model, resolve_speech_model, resolve_transcription_model, transcribe,
    Credential, ModelError, ModelRoute, ProviderId, SpeechRequest,
};
use serde_json::json;
use support::{serve_replies, MockServer, Reply};

fn route_at(provider: ProviderId, server: &MockServer) -> ModelRoute {
    ModelRoute {
        reasoning: None,
        credential: Credential {
            provider,
            api_key: "secret-key-value".into(),
            base_url: Some(server.base_url.clone()),
        },
    }
}

#[tokio::test]
async fn a_key_echoed_in_a_failure_never_comes_out() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let echo = r#"{"error":{"message":"Bad key secret-key-value.","type":"x","code":1,"status":"BAD"}}"#;
    for (provider, model_id) in [
        (ProviderId::Openai, "openai/m"),
        (ProviderId::Nvidia, "nvidia/m"),
        (ProviderId::Google, "google/m"),
        (ProviderId::Gateway, "gateway/m"),
    ] {
        let server = serve_replies(vec![Reply::new(400, "application/json", echo)]).await;
        let model = resolve_embedding_model(model_id, &route_at(provider, &server), &client).unwrap();
        let error = embed_many(model.as_ref(), &["a".to_owned()], None, Some(0)).await.unwrap_err();
        assert!(!error.to_string().contains("secret-key-value"), "{model_id}: {error}");
    }
    for (provider, model_id) in [(ProviderId::Openai, "openai/m"), (ProviderId::Gateway, "gateway/m")] {
        let server = serve_replies(vec![Reply::new(400, "application/json", echo)]).await;
        let model = resolve_speech_model(model_id, &route_at(provider, &server), &client).unwrap();
        let request = SpeechRequest { text: "Hi.".into(), ..SpeechRequest::default() };
        let error = generate_speech(model.as_ref(), &request, Some(0)).await.unwrap_err();
        assert!(!error.to_string().contains("secret-key-value"), "{model_id}: {error}");
        let server = serve_replies(vec![Reply::new(400, "application/json", echo)]).await;
        let model = resolve_transcription_model(model_id, &route_at(provider, &server), &client).unwrap();
        let error = transcribe(model.as_ref(), b"RIFF", None, Some(0)).await.unwrap_err();
        assert!(!error.to_string().contains("secret-key-value"), "{model_id}: {error}");
    }
    let soniox_echo = r#"{"message":"Bad key secret-key-value."}"#;
    let server = serve_replies(vec![Reply::new(400, "application/json", soniox_echo)]).await;
    let model = resolve_transcription_model("soniox/m", &route_at(ProviderId::Soniox, &server), &client).unwrap();
    let error = transcribe(model.as_ref(), b"RIFF", None, Some(0)).await.unwrap_err();
    assert!(!error.to_string().contains("secret-key-value"), "{error}");
    let failing_job = vec![
        Reply::new(200, "application/json", r#"{"id":"file-1"}"#),
        Reply::new(200, "application/json", r#"{"id":"job-1"}"#),
        Reply::new(200, "application/json", r#"{"id":"job-1","status":"error","error_message":"Key secret-key-value failed."}"#),
        Reply::new(204, "text/plain", ""),
    ];
    let server = serve_replies(failing_job).await;
    let model = resolve_transcription_model("soniox/m", &route_at(ProviderId::Soniox, &server), &client).unwrap();
    let error = transcribe(model.as_ref(), b"RIFF", None, Some(0)).await.unwrap_err();
    assert!(!error.to_string().contains("secret-key-value"), "{error}");
    let echoing_delete = vec![
        Reply::new(200, "application/json", r#"{"id":"file-1"}"#),
        Reply::new(200, "application/json", r#"{"id":"job-1"}"#),
        Reply::new(200, "application/json", r#"{"id":"job-1","status":"completed"}"#),
        Reply::new(200, "application/json", r#"{"id":"job-1","text":"Hi."}"#),
        Reply::new(500, "text/plain", "secret-key-value"),
    ];
    let server = serve_replies(echoing_delete).await;
    let model = resolve_transcription_model("soniox/m", &route_at(ProviderId::Soniox, &server), &client).unwrap();
    let result = transcribe(model.as_ref(), b"RIFF", None, Some(0)).await.unwrap();
    assert!(!json!(result.warnings).to_string().contains("secret-key-value"));
}

#[tokio::test]
async fn providers_without_these_models_say_so() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let route = |provider| ModelRoute {
        reasoning: None,
        credential: Credential { provider, api_key: "secret-key-value".into(), base_url: None },
    };
    let code = |error: ModelError| match error {
        ModelError::Setup { code, .. } => code,
        other => panic!("expected a setup error, got {other}"),
    };
    // ChatGPT sign-in has language models only.
    assert_eq!(code(resolve_embedding_model("chatgpt/text-embedding-3-small", &route(ProviderId::Chatgpt), &client).err().unwrap()), "model_unsupported");
    assert_eq!(code(resolve_embedding_model("elevenlabs/x", &route(ProviderId::Elevenlabs), &client).err().unwrap()), "model_unsupported");
    assert_eq!(code(resolve_speech_model("google/x", &route(ProviderId::Google), &client).err().unwrap()), "model_unsupported");
    assert_eq!(code(resolve_transcription_model("nvidia/x", &route(ProviderId::Nvidia), &client).err().unwrap()), "model_unsupported");
    assert_eq!(code(resolve_speech_model("openai/x", &route(ProviderId::Gateway), &client).err().unwrap()), "model_key_needed");
}

#[tokio::test]
async fn embed_retries_each_call_alone() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let replies = vec![
        Reply::new(429, "application/json", r#"{"error":{"message":"Slow."}}"#).with_header("retry-after-ms", "1"),
        Reply::new(200, "application/json", r#"{"data":[{"embedding":[1,2]}],"usage":{"prompt_tokens":3}}"#),
    ];
    let server = serve_replies(replies).await;
    let model = resolve_embedding_model("openai/m", &route_at(ProviderId::Openai, &server), &client).unwrap();
    let result = embed_many(model.as_ref(), &["a".to_owned()], None, Some(1)).await.unwrap();
    assert_eq!(result.embeddings, vec![vec![1.0, 2.0]]);
    assert_eq!(result.tokens, Some(3));
    assert_eq!(server.captured.lock().unwrap().len(), 2);
}
