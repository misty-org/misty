use super::header::document;
use serde_json::{json, Value};

fn keys(provider: &str) -> Option<String> {
    match provider {
        "anthropic" => Some("sk-ant-test".into()),
        "openai" => Some(" sk-openai-test \n".into()),
        "serper" => Some("serper-test".into()),
        _ => None,
    }
}

#[test]
fn the_composio_key_never_goes_in_the_runtimes_document() {
    let settings = json!({
        "agent_model": "anthropic/claude-sonnet-5-5",
        "search_provider": "composio",
    });
    let with_composio = |provider: &str| match provider {
        super::header::COMPOSIO_KEY => Some("ak_composio_test".to_owned()),
        other => keys(other),
    };
    let decoded = document(&settings, &with_composio).unwrap();
    assert!(!decoded.to_string().contains("ak_composio_test"));
}

#[test]
fn carries_each_role_with_only_the_providers_it_names() {
    let settings = json!({
        "agent_model": "anthropic/claude-sonnet-5-5",
        "embedding_model": "openai/text-embedding-3-small",
        "fast_model": "",
        "reasoning": "high",
        "ollama_base_url": "http://host.docker.internal:11434/v1",
    });
    let decoded = document(&settings, &keys).unwrap();
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
    assert!(document(&json!({}), &keys).is_none());
    assert!(document(&Value::Null, &keys).is_none());
    assert!(document(&json!({ "agent_model": "google/gemini-3-pro" }), &keys).is_none());
    assert!(document(&json!({ "agent_model": "claude-sonnet" }), &keys).is_none());
    assert!(document(&json!({ "agent_model": "unknown/model" }), &keys).is_none());
    assert!(document(&json!({ "agent_model": "anthropic/" }), &keys).is_none());
}

#[test]
fn a_role_whose_provider_has_no_key_is_left_out() {
    let settings = json!({
        "agent_model": "anthropic/claude-sonnet-5-5",
        "speech_model": "elevenlabs/eleven_flash_v2_5",
    });
    let decoded = document(&settings, &keys).unwrap();
    assert!(decoded["models"].get("speech").is_none());
    assert!(decoded["providers"].get("elevenlabs").is_none());
}

#[test]
fn a_saved_soniox_key_reaches_the_live_relay_with_no_transcription_model_set() {
    let settings = json!({ "agent_model": "anthropic/claude-sonnet-5-5" });
    let with_soniox = |provider: &str| match provider {
        "soniox" => Some(" soniox-test ".to_string()),
        other => keys(other),
    };
    let decoded = document(&settings, &with_soniox).unwrap();
    assert_eq!(decoded["providers"]["soniox"], json!({ "apiKey": "soniox-test" }));
    assert!(decoded["models"].get("transcription").is_none());
}

#[test]
fn a_saved_soniox_key_reaches_the_live_relay_with_no_agent_model() {
    let with_soniox = |provider: &str| match provider {
        "soniox" => Some("soniox-test".to_string()),
        other => keys(other),
    };
    let decoded = document(&json!({}), &with_soniox).unwrap();
    assert_eq!(decoded["providers"]["soniox"], json!({ "apiKey": "soniox-test" }));
    assert_eq!(decoded["models"], json!({}));
}

#[test]
fn local_providers_need_an_address_not_a_key() {
    let settings = json!({
        "agent_model": "ollama/qwen3:14b",
        "fast_model": "openai-compatible/llama-4",
        "ollama_base_url": "http://host.docker.internal:11434/v1/",
        "openai_compatible_base_url": "ftp://example.test",
    });
    let decoded = document(&settings, &keys).unwrap();
    assert_eq!(
        decoded["providers"],
        json!({ "ollama": { "baseURL": "http://host.docker.internal:11434/v1" } })
    );
    assert_eq!(decoded["models"], json!({ "agent": "ollama/qwen3:14b" }));
}

#[test]
fn reasoning_defaults_to_low_and_rejects_unknown_levels() {
    let settings = json!({ "agent_model": "anthropic/x", "reasoning": "extreme" });
    assert_eq!(document(&settings, &keys).unwrap()["reasoning"], "low");
}

#[test]
fn openrouter_ids_keep_their_nested_model_path() {
    let settings = json!({ "agent_model": "openrouter/anthropic/claude-sonnet-5.5" });
    let key = |provider: &str| (provider == "openrouter").then(|| "or-key".to_string());
    let decoded = document(&settings, &key).unwrap();
    assert_eq!(
        decoded["models"]["agent"],
        "openrouter/anthropic/claude-sonnet-5.5"
    );
}

#[test]
fn a_chatgpt_token_reaches_the_runtime_document() {
    let settings = json!({ "agent_model": "chatgpt/gpt-6.1-sol", "embedding_model": "ollama-cloud/nomic-embed-text" });
    let runtime_keys = |provider: &str| match provider {
        "chatgpt" => Some("chatgpt-access".to_owned()),
        "ollama-cloud" => Some("ollama-key".to_owned()),
        _ => None,
    };
    let doc = document(&settings, &runtime_keys).unwrap();
    assert_eq!(
        doc["providers"]["chatgpt"],
        json!({ "apiKey": "chatgpt-access" })
    );
    assert_eq!(
        doc["providers"]["ollama-cloud"],
        json!({ "apiKey": "ollama-key" })
    );
}

#[test]
fn carries_the_web_search_key_of_the_chosen_provider() {
    let chosen =
        json!({ "agent_model": "anthropic/claude-sonnet-5-5", "search_provider": "serper" });
    assert_eq!(
        document(&chosen, &keys).unwrap()["search"],
        json!({ "provider": "serper", "apiKey": "serper-test" })
    );
    // Decodo is the default and has no key here, so web search stays off.
    let unset = json!({ "agent_model": "anthropic/claude-sonnet-5-5" });
    assert!(document(&unset, &keys).unwrap().get("search").is_none());
    let unknown =
        json!({ "agent_model": "anthropic/claude-sonnet-5-5", "search_provider": "bing" });
    assert!(document(&unknown, &keys).unwrap().get("search").is_none());
}

#[test]
fn a_voice_id_reaches_the_runtime_only_in_a_safe_form() {
    let key = |_: &str| Some("key".to_owned());
    let settings = |voice: &str| {
        serde_json::json!({ "agent_model": "elevenlabs/x", "speech_voice": voice })
    };
    let decoded = document(&settings("AbC-12_x"), &key).unwrap();
    assert_eq!(decoded["speechVoice"], "AbC-12_x");
    for hostile in ["../../v1/user", "a/b", "a?b=c", "a b", &"x".repeat(65)] {
        let decoded = document(&settings(hostile), &key).unwrap();
        assert!(decoded.get("speechVoice").is_none(), "{hostile}");
    }
    let decoded = document(&serde_json::json!({ "agent_model": "elevenlabs/x" }), &key).unwrap();
    assert!(decoded.get("speechVoice").is_none());
}
