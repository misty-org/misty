use super::header::{encode, MAX_HEADER_BYTES};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};

fn decode(value: &str) -> Value {
    assert!(!value.contains('='), "no padding");
    assert!(!value.contains('+') && !value.contains('/'), "url-safe alphabet");
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(value).unwrap()).unwrap()
}

fn keys(provider: &str) -> Option<String> {
    match provider {
        "anthropic" => Some("sk-ant-test".into()),
        "openai" => Some(" sk-openai-test \n".into()),
        _ => None,
    }
}

#[test]
fn carries_each_role_with_only_the_providers_it_names() {
    let settings = json!({
        "agent_model": "anthropic/claude-sonnet-5-5",
        "embedding_model": "openai/text-embedding-3-small",
        "fast_model": "",
        "reasoning": "high",
        "ollama_base_url": "http://localhost:11434/v1",
    });
    let decoded = decode(&encode(&settings, &keys).unwrap());
    assert_eq!(
        decoded,
        json!({
            "version": 1,
            "providers": {
                "anthropic": { "apiKey": "sk-ant-test" },
                "openai": { "apiKey": "sk-openai-test" },
            },
            "models": {
                "agent": "anthropic/claude-sonnet-5-5",
                "embedding": "openai/text-embedding-3-small",
            },
            "reasoning": "high",
        })
    );
}

#[test]
fn no_agent_model_or_no_key_for_it_sends_nothing() {
    assert!(encode(&json!({}), &keys).is_none());
    assert!(encode(&Value::Null, &keys).is_none());
    assert!(encode(&json!({ "agent_model": "google/gemini-3-pro" }), &keys).is_none());
    assert!(encode(&json!({ "agent_model": "claude-sonnet" }), &keys).is_none());
    assert!(encode(&json!({ "agent_model": "unknown/model" }), &keys).is_none());
    assert!(encode(&json!({ "agent_model": "anthropic/" }), &keys).is_none());
}

#[test]
fn a_role_whose_provider_has_no_key_is_left_out() {
    let settings = json!({
        "agent_model": "anthropic/claude-sonnet-5-5",
        "speech_model": "elevenlabs/eleven_flash_v2_5",
    });
    let decoded = decode(&encode(&settings, &keys).unwrap());
    assert!(decoded["models"].get("speech").is_none());
    assert!(decoded["providers"].get("elevenlabs").is_none());
}

#[test]
fn local_providers_need_an_address_not_a_key() {
    let settings = json!({
        "agent_model": "ollama/qwen3:14b",
        "fast_model": "openai-compatible/llama-4",
        "ollama_base_url": "http://localhost:11434/v1/",
        "openai_compatible_base_url": "ftp://example.test",
    });
    let decoded = decode(&encode(&settings, &keys).unwrap());
    assert_eq!(
        decoded["providers"],
        json!({ "ollama": { "baseURL": "http://localhost:11434/v1" } })
    );
    assert_eq!(decoded["models"], json!({ "agent": "ollama/qwen3:14b" }));
}

#[test]
fn reasoning_defaults_to_low_and_rejects_unknown_levels() {
    let settings = json!({ "agent_model": "anthropic/x", "reasoning": "extreme" });
    assert_eq!(decode(&encode(&settings, &keys).unwrap())["reasoning"], "low");
}

#[test]
fn openrouter_ids_keep_their_nested_model_path() {
    let settings = json!({ "agent_model": "openrouter/anthropic/claude-sonnet-5.5" });
    let key = |provider: &str| (provider == "openrouter").then(|| "or-key".to_string());
    let decoded = decode(&encode(&settings, &key).unwrap());
    assert_eq!(
        decoded["models"]["agent"],
        "openrouter/anthropic/claude-sonnet-5.5"
    );
}

#[test]
fn an_oversized_header_is_not_sent() {
    let settings = json!({ "agent_model": "anthropic/x" });
    let huge = |_: &str| Some("k".repeat(MAX_HEADER_BYTES));
    assert!(encode(&settings, &huge).is_none());
}
